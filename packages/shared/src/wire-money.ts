// Reading an amount back off the wire, driven by the schema that declared it.
//
// `money.ts` sets out why an amount is a `bigint` and why the wire form is
// decimal text. What it cannot state there is that the trip is one-way: the
// serialiser under `packages/api-client` writes a `bigint` out as
// `value.toString()`, and the link's JSON codec has a `serialize` hook and no
// `deserialize` one — so nothing on the far side turns "1850000" back into
// 1850000n. The generated client's *type* still says `bigint`, because the type
// is inferred from the contract and the contract is right about what the handler
// produced. TypeScript cannot see the gap, so every screen that adds two amounts
// is one keystroke from a `TypeError` and every screen that compares one to `0n`
// is quietly always wrong.
//
// The fix belongs here rather than in each screen, and it belongs to the schema
// rather than to the value. The contract already says, precisely and in one
// place, which fields are `bigint`; walking that declaration is the only way to
// revive an amount without also mangling something that merely looks like one.
// A "any string of digits becomes a BigInt" pass would eat guest ids, phone
// numbers, service codes and room numbers — all of which are digits and none of
// which are money.
//
// It lives in `@mariva/shared` and not in `packages/api-client` because this is
// where `vndAmountSchema` is declared and where vitest already runs. The
// transport applies it; nothing about the walk is transport-specific.

import { vndAmountTextSchema } from "./money.js";

/**
 * The shape this walker reads off a zod v4 node.
 *
 * zod v4 keeps a schema's definition at `schema._zod.def`, with `def.type`
 * naming the kind — "object", "array", "nullable" and so on. The property is
 * marked internal upstream, so it is described here structurally rather than
 * imported: a shape stated in one place is a shape one upgrade can be checked
 * against, and every read below is already guarded to fall through untouched if
 * the shape is not there.
 */
interface WireNode {
  readonly _zod: { readonly def: WireDef };
}

interface WireDef {
  readonly type: string;
  readonly [member: string]: unknown;
}

function asWireNode(schema: unknown): WireNode | null {
  if (typeof schema !== "object" || schema === null) {
    return null;
  }

  const internals = (schema as { _zod?: unknown })._zod;

  if (typeof internals !== "object" || internals === null) {
    return null;
  }

  const def = (internals as { def?: unknown }).def;

  if (
    typeof def !== "object" ||
    def === null ||
    typeof (def as { type?: unknown }).type !== "string"
  ) {
    return null;
  }

  return schema as WireNode;
}

/**
 * The declared value, with every amount in it back in đồng.
 *
 * **A money leaf is a `bigint` leaf, and that is the whole of the test.** Not a
 * registry entry against `vndAmountSchema`, and not a guess about the value:
 * the serialiser writes *every* `bigint` out as text, so a `bigint` in an output
 * schema is exactly the set of positions that arrive needing to be read back.
 * Marking `vndAmountSchema` alone would have been narrower than the defect —
 * `guest.ts` declares `loyaltyPoints` as a bare `z.bigint()` on the argument
 * that a point is a count and not an amount, and it is on the wire as text all
 * the same — and it would have needed remembering by whoever declares the next
 * one. The node kind needs remembering by nobody.
 *
 * Never throws, and that is deliberate: a decoder that raised on a schema kind
 * it had not met would take down every screen at once, over a field it did not
 * even need to touch. An unrecognised node returns its value untouched, which is
 * the answer for every kind that has no `bigint` under it — which is most of
 * them.
 *
 * Idempotent, so applying it twice costs nothing but time: an amount that is
 * already a `bigint` is not text and falls through.
 *
 * Never mutates. A new object or array is built only along the paths where
 * something actually changed, so a response with no money in it comes back as
 * the very object that went in.
 *
 * @param schema The zod schema the value was declared by — a procedure's output
 *   schema at the transport, any subtree of one during the walk.
 * @param value The value as JSON produced it.
 */
export function reviveWireMoney(schema: unknown, value: unknown): unknown {
  const node = asWireNode(schema);

  // Null and undefined are the same fact whatever the schema says about the
  // position they are in, and no schema kind below has anything to do to them.
  if (node === null || value === null || value === undefined) {
    return value;
  }

  const def = node._zod.def;

  switch (def.type) {
    case "bigint":
      // Only the exact wire form. Anything else — an amount already read back,
      // a value from a server that did not honour the contract — passes
      // through, because `BigInt("")` and `BigInt("12.5")` throw and a screen
      // showing a wrong figure beats a screen that does not render.
      return typeof value === "string" &&
        vndAmountTextSchema.safeParse(value).success
        ? BigInt(value)
        : value;

    case "object":
      return reviveObject(def, value);

    case "record":
      return isPlainRecord(value)
        ? reviveEntries(value, () => def.valueType)
        : value;

    case "array":
      return reviveItems(value, () => def.element);

    case "tuple":
      return reviveItems(value, (index) => {
        const items = Array.isArray(def.items) ? def.items : [];

        return index < items.length ? items[index] : def.rest;
      });

    // One inner type, wrapped for a reason that says nothing about the shape
    // underneath it. `default` and `prefault` are here because a default that
    // was applied server-side is still serialised through the inner type.
    case "nullable":
    case "optional":
    case "nonoptional":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
      return reviveWireMoney(def.innerType, value);

    // A pipe carries the input schema on `in` and the output schema on `out`,
    // and what came off the wire is the output. A codec is a pipe with the two
    // transforms attached, so the same branch reads both.
    case "pipe":
      return reviveWireMoney(def.out, value);

    case "lazy":
      return typeof def.getter === "function"
        ? reviveWireMoney((def.getter as () => unknown)(), value)
        : value;

    case "intersection": {
      // Both sides describe the same value, so both get a turn at it.
      const left = reviveWireMoney(def.left, value);

      return reviveWireMoney(def.right, left);
    }

    case "union":
      return reviveUnion(def, value);

    default:
      return value;
  }
}

function reviveObject(def: WireDef, value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }

  const shape = isPlainRecord(def.shape) ? def.shape : {};

  // Driven by the keys the value actually has, not by the shape's: a response
  // carrying a member the client's copy of the contract has not heard of yet
  // must survive, and `catchall` is where an object says what such a member is.
  return reviveEntries(value, (key) =>
    key in shape ? shape[key] : def.catchall,
  );
}

/**
 * Every branch gets a turn, in order, each seeing what the last one made of it.
 *
 * There is no cheap way to tell which branch of a union produced a value that is
 * still in its wire form — parsing it would fail, since the amounts in it are
 * text and the branch says `bigint`. Folding is safe because reviving is
 * schema-driven and idempotent: a branch that has nothing to say about a
 * position leaves it exactly as it found it, and a branch that has already
 * revived a position hands the next one a `bigint`, which no branch will touch
 * again. The one arrangement this would read wrongly is a union whose branches
 * disagree about a single key — `bigint` in one and digit-text in the other —
 * which no contract shape has and which would be an ambiguity worth removing
 * rather than decoding around.
 */
function reviveUnion(def: WireDef, value: unknown): unknown {
  const options = Array.isArray(def.options) ? def.options : [];

  return options.reduce<unknown>(
    (carried, option) => reviveWireMoney(option, carried),
    value,
  );
}

function reviveEntries(
  value: Record<string, unknown>,
  schemaFor: (key: string) => unknown,
): unknown {
  let changed = false;
  const next: Record<string, unknown> = {};

  for (const [key, member] of Object.entries(value)) {
    const revived = reviveWireMoney(schemaFor(key), member);

    next[key] = revived;
    changed ||= revived !== member;
  }

  return changed ? next : value;
}

function reviveItems(
  value: unknown,
  schemaFor: (index: number) => unknown,
): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  let changed = false;
  const next = value.map((item, index) => {
    const revived = reviveWireMoney(schemaFor(index), item);

    changed ||= revived !== item;

    return revived;
  });

  return changed ? next : value;
}

/**
 * An object JSON could have produced.
 *
 * Arrays are excluded because a schema kind that expects members expects a
 * record, and a `Date` or a `Map` cannot reach here at all — nothing survives
 * `JSON.parse` but objects, arrays and primitives.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
