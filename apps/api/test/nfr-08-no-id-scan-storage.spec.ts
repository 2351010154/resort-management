// The absence that `FR-GST-02` promises, asserted as a property of the tree.
//
// `FR-GST-02`: an identity document is **checked, transcribed and discarded**.
// Staff read the CCCD to complete the lưu trú declaration, the particulars land
// on the registration record, and the image is never persisted — "no bucket, no
// stored object, no view path, nothing to delete". `NFR-08` states the same
// thing as a number: identity-document images at rest, **0**, and calls it
// "structural, not a measurement".
//
// A measurement can be taken. An absence cannot — there is no query that
// returns the scans nobody stored. What can be checked is the machinery that
// would have to exist first: a column to hold a key, a bucket to hold an
// object, a route to hand one back, a signature to make that route reachable.
// None of those can be added quietly, and none of them can be added without
// touching the files this scan reads. So the requirement is proved the only way
// it can be — by reading the source and asserting the storage path was never
// built.
//
// **What is forbidden, precisely.** Storage, persistence and retrieval of an
// identity-document image: a path/key column, an object-storage client, a
// presigned URL, a route that returns image bytes.
//
// **What is not forbidden.** Receiving one. The transcribe-and-discard desk
// flow needs an endpoint that accepts an upload, reads the particulars off it
// and drops the bytes without writing them anywhere. That endpoint is the
// requirement working, not a violation of it, so nothing here matches on
// multipart handling, file interceptors or upload routes. A future reader
// adding that endpoint should expect this file to stay green; a future reader
// adding somewhere to *put* the bytes should expect it to go red, which is the
// entire point.
//
// **On vacuity.** A structural test that scans nothing passes forever and
// guards nothing, and it fails silently — a wrong glob, a renamed directory or
// a regex that cannot match all look exactly like compliance. Two defences run
// below. Each scan asserts it visited a plausible number of real files, so a
// directory that moves takes the suite down rather than the guarantee. And each
// detector is fired at synthetic source containing the violation it exists to
// catch, so a pattern that has stopped matching is caught by the pattern's own
// test rather than by the incident.
//
// This file needs no database and touches none. It reads the repository from
// disk with Node's `fs`, so it behaves the same on the Windows machine it was
// written on and the Linux container CI runs it in.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const API_SRC = join(REPO_ROOT, "apps", "api", "src");
const SHARED_SRC = join(REPO_ROOT, "packages", "shared", "src");
const MIGRATIONS_DIR = join(API_SRC, "database", "migrations");
const SCHEMA_DIR = join(API_SRC, "database", "schema");
const CONTRACT_DIR = join(SHARED_SRC, "contract");

/**
 * Names a column, key, field or capability would have to take to *refer to* a
 * stored image, or to hand one back.
 *
 * Matched against source with `_`, `-` and `.` removed and the rest lowercased,
 * so one entry covers `scan_path`, `scanPath`, `scan-path` and the RBAC key
 * `guest.id-scan.view` at once — the spellings the same idea arrives in across
 * SQL, Drizzle, a URL and a capability string.
 *
 * Every entry pairs the document with a *reference* noun (path, key, url,
 * object, bucket) or a *retrieval* verb (view, download, get, serve). The bare
 * nouns — `id_scan`, `scan_image`, `cccd_photo` — are deliberately absent, and
 * their absence is the transcribe-and-discard flow being left room to exist:
 * the field an upload arrives in is named after the bytes, and the RBAC matrix
 * already carries `guest.id-scan.upload` for exactly that. A name says nothing
 * about whether the bytes were kept. A name that points somewhere does.
 */
const STORED_IMAGE_REFERENCE_TOKENS = [
  "scanpath",
  "scankey",
  "scanurl",
  "scanuri",
  "scanobject",
  "scanbucket",
  "scanblob",
  "scanstorage",
  "imagepath",
  "imagekey",
  "imageurl",
  "imageuri",
  "imageobject",
  "imagebucket",
  "documentpath",
  "documentkey",
  "documenturl",
  "documenturi",
  "photopath",
  "photokey",
  "photourl",
  "scanview",
  "viewscan",
  "scandownload",
  "downloadscan",
  "getscan",
  "fetchscan",
  "servescan",
] as const;

/**
 * Holding the bytes in the database instead of a bucket.
 *
 * A reference token only catches an image kept *somewhere else*. Postgres will
 * hold the picture directly, and a `bytea` column is how — no bucket to name,
 * no key to spot. The tree has no binary column of any kind today, so the type
 * itself is the signal and needs no qualifier around it.
 */
const BINARY_COLUMN_TOKENS = ["bytea", "blob"] as const;

/**
 * Object storage, and the signatures that make an object reachable.
 *
 * Matched raw and lowercased rather than normalised, because these are literal
 * identifiers, package names and endpoints. Deliberately narrow: the tree uses
 * the word "bucket" for rate-limit buckets, so "bucket" on its own would flag
 * the limiter and teach the next reader to ignore this file.
 */
const OBJECT_STORAGE_TOKENS = [
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
  "aws-sdk",
  "s3client",
  "putobjectcommand",
  "getobjectcommand",
  "createpresignedpost",
  "getsignedurl",
  "presigned",
  "r2.cloudflarestorage.com",
  "r2bucket",
  "r2_bucket",
  "s3_bucket",
  "r2_access_key",
  "s3_access_key",
  "aws_access_key",
  "minio",
] as const;

/**
 * Handing image bytes back to a caller.
 *
 * Response media types and the file-streaming primitives a view route would
 * need. Request-side upload handling is absent from this list on purpose —
 * see the note at the top of the file.
 */
const IMAGE_RESPONSE_TOKENS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/*",
  "streamablefile",
  "sendfile",
  "createreadstream",
] as const;

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly token: string;
}

/**
 * Blanks out comments, keeping every byte position and line break.
 *
 * Without this the scan reads its own documentation. `schema/guest.ts` explains
 * at length that there is no bucket for a path column to point at, and a naive
 * substring search would report that sentence as the violation it exists to
 * deny. Positions are preserved so reported line numbers stay usable.
 *
 * String and template literals are left intact: a forbidden route path or media
 * type lives inside quotes, and blanking those would blind the scan to the
 * clearest evidence it can find.
 */
function stripComments(source: string, isSql: boolean): string {
  let out = "";
  let index = 0;

  const blank = (text: string): string => text.replace(/[^\n]/g, " ");

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (char === "'" || char === '"' || (!isSql && char === "`")) {
      const start = index;
      index += 1;

      while (index < source.length) {
        if (source[index] === "\\" && !isSql) {
          index += 2;
          continue;
        }

        // SQL escapes a quote by doubling it, and the doubled pair reads as a
        // close followed by an immediate reopen, which lands in the same place.
        if (source[index] === char) {
          index += 1;
          break;
        }

        index += 1;
      }

      out += source.slice(start, index);
      continue;
    }

    const lineCommentOpens = isSql ? char === "-" && next === "-" : char === "/" && next === "/";

    if (lineCommentOpens) {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(index, stop));
      index = stop;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(index, stop));
      index = stop;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Lowercases and drops the separators that split one idea into two words. */
function normalise(text: string): string {
  return text.toLowerCase().replaceAll(/[_.-]/g, "");
}

/**
 * Reports every forbidden token in one file's source.
 *
 * Takes source rather than a path so the same function the repository scan uses
 * can be fired at synthetic source in the positive-proof tests below. A
 * detector proven on a string it was handed is a detector, not a description.
 */
function scanSource(
  file: string,
  source: string,
  tokens: readonly string[],
  options: { readonly normalised: boolean; readonly sql: boolean },
): Finding[] {
  const stripped = stripComments(source, options.sql);
  const findings: Finding[] = [];

  stripped.split("\n").forEach((rawLine, offset) => {
    const line = options.normalised ? normalise(rawLine) : rawLine.toLowerCase();

    for (const token of tokens) {
      if (line.includes(token)) {
        findings.push({ file, line: offset + 1, token });
      }
    }
  });

  return findings;
}

/** Every file under `root` whose name ends in one of `extensions`, recursively. */
function filesUnder(root: string, extensions: readonly string[]): string[] {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        extensions.some((extension) => entry.name.endsWith(extension)) &&
        // `node_modules` and build output are somebody else's source and would
        // make the result depend on what happens to be installed.
        !entry.parentPath.split(sep).some((part) => part === "node_modules" || part === "dist"),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

function scanFiles(
  paths: readonly string[],
  tokens: readonly string[],
  options: { readonly normalised: boolean; readonly sql: boolean },
): Finding[] {
  return paths.flatMap((path) =>
    scanSource(relative(REPO_ROOT, path), readFileSync(path, "utf8"), tokens, options),
  );
}

/** Turns findings into a message that names the file and line to open. */
function describeFindings(findings: readonly Finding[]): string {
  return findings.map(({ file, line, token }) => `${file}:${line} — ${token}`).join("\n");
}

const migrationFiles = filesUnder(MIGRATIONS_DIR, [".sql"]);
const schemaFiles = filesUnder(SCHEMA_DIR, [".ts"]).filter((path) => !path.endsWith(".spec.ts"));
const controllerFiles = filesUnder(API_SRC, [".controller.ts"]);
const contractFiles = filesUnder(CONTRACT_DIR, [".ts"]).filter((path) => !path.endsWith(".spec.ts"));
const sourceFiles = [...filesUnder(API_SRC, [".ts"]), ...filesUnder(SHARED_SRC, [".ts"])];

describe("identity-document images are never stored (FR-GST-02, NFR-08)", () => {
  // The guarantee is only as real as the surface it was read from. These floors
  // are the count at the time of writing, rounded down hard: they are not there
  // to track the tree's growth, they are there so that a directory which moves,
  // empties or stops matching the extension filter fails loudly instead of
  // producing a clean scan of nothing.
  describe("the scan reaches the files it claims to check", () => {
    it("reads the applied migrations", () => {
      expect(migrationFiles.length).toBeGreaterThanOrEqual(25);
    });

    it("reads the schema definitions", () => {
      expect(schemaFiles.length).toBeGreaterThanOrEqual(15);
    });

    it("reads the controllers", () => {
      expect(controllerFiles.length).toBeGreaterThanOrEqual(15);
    });

    it("reads the shared contracts", () => {
      expect(contractFiles.length).toBeGreaterThanOrEqual(10);
    });

    it("reads the API and shared source trees", () => {
      expect(sourceFiles.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe("nothing in the tree stores or serves one", () => {
    it("no migration adds a column that could hold an image reference", () => {
      const findings = scanFiles(migrationFiles, STORED_IMAGE_REFERENCE_TOKENS, {
        normalised: true,
        sql: true,
      });

      expect(describeFindings(findings)).toBe("");
    });

    it("no schema declares a column that could hold an image reference", () => {
      const findings = scanFiles(schemaFiles, STORED_IMAGE_REFERENCE_TOKENS, {
        normalised: true,
        sql: false,
      });

      expect(describeFindings(findings)).toBe("");
    });

    it("no migration or schema declares a binary column", () => {
      const findings = [
        ...scanFiles(migrationFiles, BINARY_COLUMN_TOKENS, { normalised: true, sql: true }),
        ...scanFiles(schemaFiles, BINARY_COLUMN_TOKENS, { normalised: true, sql: false }),
      ];

      expect(describeFindings(findings)).toBe("");
    });

    it("no source file names an image reference field", () => {
      const findings = scanFiles(sourceFiles, STORED_IMAGE_REFERENCE_TOKENS, {
        normalised: true,
        sql: false,
      });

      expect(describeFindings(findings)).toBe("");
    });

    it("no object-storage client or presigned URL exists anywhere", () => {
      const findings = scanFiles(sourceFiles, OBJECT_STORAGE_TOKENS, {
        normalised: false,
        sql: false,
      });

      expect(describeFindings(findings)).toBe("");
    });

    it("no controller returns image bytes", () => {
      const findings = scanFiles(controllerFiles, IMAGE_RESPONSE_TOKENS, {
        normalised: false,
        sql: false,
      });

      expect(describeFindings(findings)).toBe("");
    });

    it("no contract declares an image response", () => {
      const findings = scanFiles(contractFiles, IMAGE_RESPONSE_TOKENS, {
        normalised: false,
        sql: false,
      });

      expect(describeFindings(findings)).toBe("");
    });
  });

  // Everything above asserts an empty result, and an empty result is what a
  // broken detector returns too. These cases hand each detector the violation
  // it was written for and require it to be found, so the suite above can only
  // be green because the tree is clean.
  describe("each detector catches the violation it exists for", () => {
    it("catches a scan-path column added by a migration", () => {
      const findings = scanSource(
        "synthetic.sql",
        "alter table registration add column cccd_scan_path text;",
        STORED_IMAGE_REFERENCE_TOKENS,
        { normalised: true, sql: true },
      );

      expect(findings).toEqual([{ file: "synthetic.sql", line: 1, token: "scanpath" }]);
    });

    it("catches the camelCase spelling a Drizzle schema would use", () => {
      const findings = scanSource(
        "synthetic.ts",
        'export const registration = pgTable("registration", { documentKey: text("document_key") });',
        STORED_IMAGE_REFERENCE_TOKENS,
        { normalised: true, sql: false },
      );

      expect(findings.map((finding) => finding.token)).toContain("documentkey");
    });

    it("catches an image held in the database itself", () => {
      const findings = scanSource(
        "synthetic.sql",
        "alter table registration add column cccd_document bytea;",
        BINARY_COLUMN_TOKENS,
        { normalised: true, sql: true },
      );

      expect(findings).toEqual([{ file: "synthetic.sql", line: 1, token: "bytea" }]);
    });

    it("catches a capability granting sight of a stored scan", () => {
      const findings = scanSource(
        "synthetic.ts",
        '{ key: "guest.id-scan.view", row: "View ID scan" },',
        STORED_IMAGE_REFERENCE_TOKENS,
        { normalised: true, sql: false },
      );

      expect(findings.map((finding) => finding.token)).toContain("scanview");
    });

    // The counterpart to the case above, and the reason the bare nouns are not
    // tokens: these two capability keys are in the tree today and are the
    // requirement working — a scan may be handed *in*, never handed back.
    it("passes the upload capabilities the matrix already carries", () => {
      const findings = scanSource(
        "synthetic.ts",
        '{ key: "guest.id-scan.upload-own" },\n{ key: "guest.id-scan.upload" },',
        STORED_IMAGE_REFERENCE_TOKENS,
        { normalised: true, sql: false },
      );

      expect(findings).toEqual([]);
    });

    it("catches presigned-URL generation", () => {
      const findings = scanSource(
        "synthetic.ts",
        'import { getSignedUrl } from "@aws-sdk/s3-request-presigner";',
        OBJECT_STORAGE_TOKENS,
        { normalised: false, sql: false },
      );

      expect(findings.map((finding) => finding.token)).toContain("getsignedurl");
      expect(findings.map((finding) => finding.token)).toContain("@aws-sdk/s3-request-presigner");
    });

    it("catches an object-storage bucket configured in the environment", () => {
      const findings = scanSource(
        "synthetic.ts",
        "R2_BUCKET: z.string().min(1),",
        OBJECT_STORAGE_TOKENS,
        { normalised: false, sql: false },
      );

      expect(findings.map((finding) => finding.token)).toContain("r2_bucket");
    });

    it("catches a route that returns image bytes", () => {
      const findings = scanSource(
        "synthetic.controller.ts",
        '@Header("Content-Type", "image/jpeg")\n@Get(":id/scan")\nreturn new StreamableFile(bytes);',
        IMAGE_RESPONSE_TOKENS,
        { normalised: false, sql: false },
      );

      expect(findings.map((finding) => finding.token)).toEqual(["image/jpeg", "streamablefile"]);
    });

    // The transcribe-and-discard endpoint the desk flow needs: bytes arrive,
    // the particulars are read off them, nothing is written. It must stay
    // green, or the first person to build `FR-GST-02` properly will delete
    // this file to get their work merged.
    it("passes an upload route that reads the document and keeps nothing", () => {
      const uploadRoute = [
        '@Post("registration/:id/transcribe")',
        '@UseInterceptors(FileInterceptor("document"))',
        "async transcribe(@UploadedFile() document: Express.Multer.File) {",
        "  const particulars = await this.reader.read(document.buffer);",
        "  return this.registrations.record(particulars);",
        "}",
      ].join("\n");

      const findings = [
        ...scanSource("synthetic.controller.ts", uploadRoute, IMAGE_RESPONSE_TOKENS, {
          normalised: false,
          sql: false,
        }),
        ...scanSource("synthetic.controller.ts", uploadRoute, OBJECT_STORAGE_TOKENS, {
          normalised: false,
          sql: false,
        }),
        ...scanSource("synthetic.controller.ts", uploadRoute, STORED_IMAGE_REFERENCE_TOKENS, {
          normalised: true,
          sql: false,
        }),
      ];

      expect(findings).toEqual([]);
    });
  });

  // The stripper is what keeps the scan honest in both directions: prose about
  // the forbidden thing must not read as the forbidden thing, and code must not
  // be able to hide inside a comment.
  describe("comments are read as prose, code is not", () => {
    it("ignores a comment that describes what is forbidden", () => {
      const findings = scanSource(
        "synthetic.ts",
        "// There is no scan_path column here and never will be.\nexport const guest = {};",
        STORED_IMAGE_REFERENCE_TOKENS,
        { normalised: true, sql: false },
      );

      expect(findings).toEqual([]);
    });

    it("ignores a SQL comment and keeps the line numbers of what follows", () => {
      const findings = scanSource(
        "synthetic.sql",
        "-- no scan_path is added below\n\nalter table registration add column id_scan_key text;",
        STORED_IMAGE_REFERENCE_TOKENS,
        { normalised: true, sql: true },
      );

      expect(findings).toEqual([{ file: "synthetic.sql", line: 3, token: "scankey" }]);
    });

    it("still sees a column whose default is a comment-like string", () => {
      const findings = scanSource(
        "synthetic.sql",
        "alter table registration add column scan_url text default '-- none';",
        STORED_IMAGE_REFERENCE_TOKENS,
        { normalised: true, sql: true },
      );

      expect(findings).toEqual([{ file: "synthetic.sql", line: 1, token: "scanurl" }]);
    });

    it("still sees a forbidden literal inside a string", () => {
      const findings = scanSource(
        "synthetic.ts",
        'const path = "https://account.r2.cloudflarestorage.com/scans";',
        OBJECT_STORAGE_TOKENS,
        { normalised: false, sql: false },
      );

      expect(findings.map((finding) => finding.token)).toEqual(["r2.cloudflarestorage.com"]);
    });

    it("is not fooled by a division that looks like a comment opener", () => {
      const findings = scanSource(
        "synthetic.ts",
        'const ratio = total / count;\nconst mime = "image/png";',
        IMAGE_RESPONSE_TOKENS,
        { normalised: false, sql: false },
      );

      expect(findings).toEqual([{ file: "synthetic.ts", line: 2, token: "image/png" }]);
    });
  });
});
