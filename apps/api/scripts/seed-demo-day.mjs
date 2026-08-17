// Stages one convincing day at the property, so the console has something to
// show. The seeded property (`db:seed`) spreads five hundred stays across a
// whole year, which leaves any single day holding one or two of them — correct
// as a fixture, and empty as a demonstration.
//
// This is additive. It creates stays and never deletes one, so it can be run
// against a database that already carries work without taking anything away.
// `db:seed` is the opposite and says so: it empties the tables it owns first.
//
//   node apps/api/scripts/seed-demo-day.mjs --email <staff> --password <secret>
//
// Everything it can do through the public contract, it does through the public
// contract — the same routes the console calls, so a run of this script is also
// a walk of the desk's endpoints. One step cannot be done that way and is
// explained where it happens: see `backdate`.

import { parseArgs } from "node:util";
import { Client } from "pg";

const { values } = parseArgs({
  options: {
    api: { type: "string", default: "http://localhost:3001" },
    email: { type: "string" },
    password: { type: "string" },
    database: { type: "string" },
    arrivals: { type: "string", default: "10" },
    inhouse: { type: "string", default: "6" },
    departures: { type: "string", default: "4" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.email || !values.password) {
  process.stderr.write(
    "Usage: seed-demo-day.mjs --email <staff address> --password <secret> [--api URL] [--database URL]\n" +
      "       [--arrivals N] [--inhouse N] [--departures N] [--dry-run]\n",
  );
  process.exit(1);
}

// A demo stager pointed at a real property would invent guests in it. The
// address is the only thing that says which property this is, so it is the
// thing to refuse on.
const api = values.api.replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(api)) {
  process.stderr.write(
    `Refusing to stage demo data against ${api} — this script invents stays, and only a local property should receive them\n`,
  );
  process.exit(1);
}

const counts = {
  arrivals: Number(values.arrivals),
  inhouse: Number(values.inhouse),
  departures: Number(values.departures),
};

/** Names the invented guests carry, so a demo screen reads like a hotel. */
const GUEST_NAMES = [
  "Nguyễn Thị Mai",
  "Trần Văn Hùng",
  "Lê Minh Anh",
  "Phạm Thu Hà",
  "Hoàng Đức Long",
  "Vũ Ngọc Lan",
  "Đặng Quốc Bảo",
  "Bùi Kim Chi",
  "Đỗ Thanh Tùng",
  "Ngô Phương Linh",
  "James Whitfield",
  "Sarah Chen",
  "Marco Rossi",
  "Yuki Tanaka",
  "Anna Kowalski",
  "David Okonkwo",
  "Elena Petrova",
  "Thomas Müller",
  "Priya Nair",
  "Carlos Mendez",
];

const NATIONALITIES = ["VN", "VN", "VN", "GB", "US", "IT", "JP", "PL", "NG"];

let token;

async function call(method, path, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${path} → ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : undefined;
}

/** `YYYY-MM-DD` plus whole days, without dragging a date library in. */
function shiftDate(date, days) {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function pick(list, index) {
  return list[index % list.length];
}

async function signIn() {
  const session = await call("POST", "/auth/staff/sign-in", {
    email: values.email,
    password: values.password,
  });
  token = session.accessToken;
  return session.user;
}

/**
 * Rooms nobody is in, by type, so every stay this stages can be given one.
 *
 * The board answers occupancy for the business date, which is the same question
 * "can this arrival be put here" asks. Rooms already out of order are left
 * where they are — a demo that quietly cleaned them would be hiding the state
 * somebody set.
 *
 * `CLEAN` or `INSPECTED` and nothing else, because that is the room-ready rule
 * check-in itself enforces. A room merely unoccupied is not a room a guest may
 * be walked into: an earlier run of this script leaves a few `DIRTY` on purpose
 * (step 4), and offering one back would assign the room and then be refused at
 * check-in, leaving the stay holding a room it never entered.
 */
async function freeRooms() {
  const board = await call("GET", "/housekeeping/board");
  const byType = new Map();

  for (const room of board.rooms) {
    if (room.isOccupied) continue;
    if (room.status !== "CLEAN" && room.status !== "INSPECTED") continue;
    const rooms = byType.get(room.roomType) ?? [];
    rooms.push(room.roomNumber);
    byType.set(room.roomType, rooms);
  }

  return { businessDate: board.businessDate, byType };
}

/**
 * Types that can actually take a stay across these nights.
 *
 * The board answers which rooms are empty *today*, which is a different
 * question from whether a type has inventory across every night of a stay: a
 * confirmed booking arriving next week holds its type's inventory without
 * anybody yet being in a room. Asking `/availability` — the route the guest
 * funnel searches with — is the authority on the second question, and it is
 * asked once per stay rather than once per run, so every answer already
 * accounts for what this run has booked so far.
 */
async function availableTypes(checkIn, checkOut, adults) {
  const query = new URLSearchParams({
    checkIn,
    checkOut,
    adults: String(adults),
  });
  const { offers } = await call("GET", `/availability?${query}`);
  return offers.filter((offer) => offer.isAvailable).map((offer) => offer.code);
}

/**
 * Creates one confirmed stay and hands back what the later steps need.
 *
 * The contact is whole — an address and a name — because the funnel's rule is
 * that half a contact is worse than none, and a desk booking is held to it too.
 */
async function createStay({ roomType, checkIn, checkOut, adults, index }) {
  const name = pick(GUEST_NAMES, index);
  const booking = await call("POST", "/bookings", {
    roomType,
    checkIn,
    checkOut,
    adults,
    children: 0,
    ratePlan: "STANDARD",
    contactEmail: `demo-day-${index}@mariva.test`,
    contactName: name,
  });
  return { ...booking, guestName: name, index };
}

/**
 * Puts the guest in a room and registers the party — the desk's own sequence,
 * in the order `arrivals` walks it.
 *
 * Rooms are tried rather than chosen. The board answers who is in a room
 * *today*, which is a different question from whether the room is free across
 * this stay's nights: a seeded booking that arrives next week already holds its
 * room, and the board has no way to say so. Rather than reproduce the
 * availability query here, the assignment is attempted and a refusal moves on
 * to the next room — the exclusion constraint is the authority either way.
 */
async function admit(stay, rooms) {
  let roomNumber;

  while (rooms.length > 0) {
    const candidate = rooms.shift();
    try {
      await call("PUT", `/bookings/${stay.id}/room`, {
        roomNumber: candidate,
      });
      roomNumber = candidate;
      break;
    } catch (error) {
      if (!/already held|CONFLICT/.test(error.message)) throw error;
    }
  }

  if (!roomNumber) return undefined;

  await call("POST", `/bookings/${stay.id}/check-in`, {
    guests: [
      {
        fullName: stay.guestName,
        nationality: pick(NATIONALITIES, stay.index),
      },
    ],
  });
  return roomNumber;
}

/**
 * Puts something on the folio, so the ledger a demo opens is not blank and the
 * dashboard's unsettled count has something to count.
 *
 * Breakfast and the extra bed carry a published price, so neither may be sent
 * an amount — the catalog is the authority and the route refuses one for an
 * item that has it. The minibar and the laundry publish no price, so they are
 * the other half of the rule and must carry theirs.
 */
async function charge(stay) {
  const items =
    stay.index % 3 === 0
      ? [{ code: "BREAKFAST", quantity: 2 }]
      : stay.index % 3 === 1
        ? [
            { code: "BREAKFAST", quantity: 2 },
            { code: "MINIBAR", quantity: 1, grossAmount: "180000" },
          ]
        : [
            { code: "EXTRA_BED", quantity: 1 },
            { code: "LAUNDRY", quantity: 1, grossAmount: "220000" },
          ];

  for (const item of items) {
    try {
      await call("POST", `/bookings/${stay.id}/folio/service-items`, item);
    } catch (error) {
      // A catalog without the item is not worth losing the run over — the stay
      // is still a stay, it just carries one fewer line.
      process.stderr.write(`  (skipped ${item.code}: ${error.message})\n`);
    }
  }
}

/**
 * Moves a checked-in stay back one night, which is the one thing the contract
 * cannot be asked for.
 *
 * The departures board reads `CHECKED_IN` stays whose departure is the business
 * date, and the business date is derived from the wall clock rather than stored
 * — so it cannot be rolled forward to make one. Meanwhile the domain refuses to
 * create a stay arriving before today (a stay cannot arrive in the past) and
 * refuses a stay of no nights, which between them make "arrived yesterday,
 * leaves today" unconstructible through the API. Both refusals are right and
 * neither should be relaxed for a demo.
 *
 * So the stay is created as tonight's, admitted properly, and then its nights
 * are moved back by one — booking, room assignment and the type's counters
 * together, in one transaction, so the three never disagree. The counters are
 * moved rather than recomputed: the night being left gives a room back and the
 * night being taken consumes one, which is exactly what the stay moving means.
 */
async function backdate(client, stays) {
  await client.query("BEGIN");
  try {
    for (const stay of stays) {
      const { rows } = await client.query(
        "select check_in_date::text as ci, check_out_date::text as co, room_type_id from booking where id = $1",
        [stay.id],
      );
      const [row] = rows;
      const from = row.ci;
      const to = row.co;

      await client.query(
        "update booking set check_in_date = check_in_date - 1, check_out_date = check_out_date - 1 where id = $1",
        [stay.id],
      );
      await client.query(
        "update room_assignment set check_in_date = check_in_date - 1, check_out_date = check_out_date - 1 where booking_id = $1",
        [stay.id],
      );

      // The nights the stay used to own are given back, and the ones it now
      // owns are taken. A one-night stay makes this a single swap; the loop is
      // written for any length so a longer demo stay does not silently skew a
      // counter.
      for (let night = from; night < to; night = shiftDate(night, 1)) {
        await client.query(
          "update type_inventory set sold_rooms = sold_rooms - 1 where room_type_id = $1 and stay_date = $2",
          [row.room_type_id, night],
        );
        await client.query(
          "update type_inventory set sold_rooms = sold_rooms + 1 where room_type_id = $1 and stay_date = $2",
          [row.room_type_id, shiftDate(night, -1)],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const user = await signIn();
  const { businessDate, byType } = await freeRooms();
  const types = [...byType.keys()].sort();

  if (types.length === 0) {
    throw new Error("No free room of any type — nothing can be staged");
  }

  const tomorrow = shiftDate(businessDate, 1);
  const inThree = shiftDate(businessDate, 3);

  process.stdout.write(
    `Signed in as ${user.email} (${user.role})\n` +
      `Business date ${businessDate}\n` +
      `Free rooms: ${[...byType].map(([t, r]) => `${t} ${r.length}`).join(", ")}\n\n`,
  );

  if (values["dry-run"]) {
    process.stdout.write(
      `Would stage ${counts.arrivals} arrivals, ${counts.inhouse} in-house stays, ` +
        `${counts.departures} departures. Nothing written.\n`,
    );
    return;
  }

  // One pool per type, drained as rooms are taken, so two stays are never
  // offered the same room and a room refused for one is not offered to the next.
  const pool = new Map(types.map((type) => [type, [...byType.get(type)]]));

  let index = 0;
  let skipped = 0;
  const staged = { arrivals: 0, inhouse: 0, departures: 0, rooms: [] };

  /**
   * Stages one stay and hands it back, or hands back nothing when the property
   * has no room to put it in.
   *
   * A full house is a legitimate answer here, not a failure: this script is
   * additive and may be pointed at a property that is already busy, so a type
   * that cannot take these nights is stepped over rather than crashed on. The
   * count that is actually staged is reported at the end, so a short run says
   * so instead of looking like a complete one.
   */
  async function stage({ checkOut, occupy }) {
    const at = index++;
    const adults = 1 + (at % 2);
    const offered = await availableTypes(businessDate, checkOut, adults);

    // A stay that is going to be walked into a room needs both answers: the
    // type has inventory for the nights, *and* there is a physical room free
    // today to put the guest in.
    const usable = offered.filter(
      (type) => !occupy || (pool.get(type) ?? []).length > 0,
    );

    if (usable.length === 0) {
      skipped += 1;
      return undefined;
    }

    const roomType = pick(usable, at);
    const stay = await createStay({
      roomType,
      checkIn: businessDate,
      checkOut,
      adults,
      index: at,
    });

    if (!occupy) return stay;

    const room = await admit(stay, pool.get(roomType));
    if (!room) {
      skipped += 1;
      return undefined;
    }

    await charge(stay);
    staged.rooms.push(room);
    return stay;
  }

  // 1. Arrivals — left `CONFIRMED` on purpose. These are what the demo checks
  //    in live, so the queue must still have them to work.
  for (let n = 0; n < counts.arrivals; n += 1) {
    const checkOut = pick([tomorrow, inThree], index);
    if (await stage({ checkOut })) staged.arrivals += 1;
  }

  // 2. In-house — admitted, and staying past tonight, so the board shows the
  //    property occupied and the folios have somebody to belong to.
  for (let n = 0; n < counts.inhouse; n += 1) {
    if (await stage({ checkOut: inThree, occupy: true })) staged.inhouse += 1;
  }

  // 3. Departures — admitted the same way, then moved back a night so they
  //    leave today. See `backdate` for why this one step leaves the contract.
  const leaving = [];
  for (let n = 0; n < counts.departures; n += 1) {
    const stay = await stage({ checkOut: tomorrow, occupy: true });
    if (!stay) continue;
    leaving.push(stay);
    staged.departures += 1;
  }

  if (leaving.length > 0) {
    const connectionString = values.database ?? process.env.DATABASE_URL;
    if (!connectionString) {
      process.stderr.write(
        "\nNo --database / DATABASE_URL, so the departures could not be moved back a night.\n" +
          "They are staged as in-house stays leaving tomorrow instead.\n",
      );
      staged.departures = 0;
    } else {
      const client = new Client({ connectionString });
      await client.connect();
      try {
        await backdate(client, leaving);
      } finally {
        await client.end();
      }
    }
  }

  // 4. A few rooms left dirty, so "rooms not ready" is a number somebody has to
  //    do something about rather than a zero.
  const board = await call("GET", "/housekeeping/board");
  const dirty = board.rooms
    .filter((room) => !room.isOccupied && room.status === "CLEAN")
    .slice(0, 5);

  for (const room of dirty) {
    await call("PUT", `/housekeeping/rooms/${room.roomNumber}/condition`, {
      status: "DIRTY",
    });
  }

  process.stdout.write(
    `Staged on ${businessDate}:\n` +
      `  ${staged.arrivals} arrivals awaiting check-in\n` +
      `  ${staged.inhouse} in-house stays, folios open\n` +
      `  ${staged.departures} departures due out today\n` +
      `  ${dirty.length} rooms left dirty\n` +
      `  rooms occupied: ${staged.rooms.join(", ") || "none"}\n` +
      (skipped > 0
        ? `  ${skipped} stays skipped — the property had no room free for them\n`
        : ""),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
