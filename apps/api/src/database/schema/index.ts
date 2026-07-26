// The single entry point drizzle-kit reads to diff the schema and the single
// object the Drizzle client is typed by. One file per domain lands here at M3
// (`P1-SCH-*`), each re-exported below and owned by the module that names it —
// docs/architecture/repository-structure.md §apps/api.
//
// Empty today, and deliberately not deleted: `drizzle-kit generate` needs this
// path to exist, and the first table is an added export rather than a new
// convention.

export {};
