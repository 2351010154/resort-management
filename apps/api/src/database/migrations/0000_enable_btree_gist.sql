-- The first migration, and the reason Drizzle was chosen over an ORM that hides
-- SQL: the correctness thesis of this system is that double-booking is
-- impossible by database constraint, and the constraint that does it needs an
-- extension no schema builder can express.
--
--   EXCLUDE USING gist (room_id WITH =, stay_range WITH &&)
--
-- A GiST index natively handles the range overlap operator (&&) but not scalar
-- equality (=). btree_gist adds the missing operator classes, so both halves
-- live in one index. Without it, `P1-INV-02` cannot be written at all.
--
-- Enabled before any table exists, because an extension is a property of the
-- database rather than of a table — and because a migration that adds it
-- alongside the table needing it fails on a fresh database exactly once,
-- confusingly, at the worst time.

CREATE EXTENSION IF NOT EXISTS btree_gist;
