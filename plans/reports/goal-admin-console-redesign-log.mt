# Admin console redesign goal log

## 2026-08-23 · Baseline and direction

- Read the redesign advice, 18 current-screen captures, dashboard reference,
  admin README, screen intents, NFRs, current tokens, shell, navigation,
  keyboard/palette architecture, component inventory, route inventory, query
  hooks, and the three priority screen implementations.
- Worktree started clean on `feat/m8-shift-handover`.
- The referenced `docs/architecture/design-foundations.md` is already absent
  because commit `385b139` retired it. There is no pending deletion to decide.
- Direction: neo-grotesque operations UI with mineral surfaces, deep spruce,
  rare clay-amber accent, humanist sans type, grouped rail, and room key-tag
  geometry. The console is light for a bright front-desk environment.
- Design dials: variance 3/10, motion 2/10, density 6/10. State feedback only;
  no entrance animation.
- Static proofs live in `apps/admin/prototypes/console-v2/`: Dashboard,
  Bookings with detail, and Rooms with room detail. Production tokens remain
  unchanged pending visual review.
- Reviewed all three at 1440×1000. They share one hierarchy, palette, density,
  radius system, grouped navigation, status language, and action placement.
- Checked all three at 375×812. Document scroll width equals viewport width;
  the booking search and collapsed profile were corrected after the first pass.
- Mock gate accepted. Figtree, mineral surfaces, spruce navigation, clay-amber
  action accents, 12px cards, soft surface elevation, and key-tag room geometry
  can now move into the admin-only production tokens.

### Gates

- `pnpm --filter @mariva/admin typecheck` passed after the production token,
  primitive, console-kit, grouped-navigation, and top-bar foundations landed.

## 2026-08-23 · Production foundation and shell

- Added admin-only console tokens and Figtree. The guest-site token package is
  unchanged.
- Added the reusable console kit: page header, key hint, status chip, stat
  card, filter bar, data-table frame, detail sheet, form section, field, empty
  state, and toolbar, backed by a small local primitive set.
- Rebuilt the authenticated shell as a responsive spruce icon rail with five
  operational groups. Existing role filtering, route ownership, roving focus,
  `g` sequences, and palette registrations still read the same inventory.
- Made the hotel business date visible for every staff role. Drawer state stays
  role-aware, and the top bar now exposes the existing command palette with its
  platform-correct shortcut.
- Migrated Dashboard, Bookings, Arrivals, and Departures to the production kit.
  Queue row focus, Enter-driven sequences, `/` search, `n` booking creation,
  and all existing data hooks remain in place.
- Checkpoint gates passed: admin typecheck, 31 test files / 733 tests, repo
  lint, and the 22-route admin production build.

## 2026-08-23 · Property and guest records

- Migrated Rooms to the accepted master-detail layout. Search and roving focus
  still operate on the full board; out-of-order and closure mutations keep
  their existing role gates, previews, and optimistic query behavior.
- Migrated the touch-first Housekeeping board with larger room-key tiles while
  preserving its deliberate keyboard exception and state-advance mutations.
- Migrated Guests to search results plus a protected detail record. Search
  continues to re-mask identity data, `/` still focuses search, and reveal
  auditing remains unchanged.
- Contained the existing two-axis Rates grid in the console surface system;
  range selection, arrow movement, role gating, and rate-plan forms are intact.
- Checkpoint gates passed: admin typecheck, 31 test files / 733 tests, and repo
  lint. The only lint output is the repository's existing Biome configuration
  deprecation notice.

## 2026-08-23 · Money operations

- Migrated Folios to a card-based master-detail ledger with compact filters,
  explicit loading/empty/error states, and the original paging and roving focus.
- Migrated Payments into a reconciliation workspace with contained history and
  night-detail surfaces. Night selection, discrepancy reads, and role scoping
  continue to use the existing model and queries.
- Migrated Shifts and Finance. Drawer history, handover backlog, cash-book
  recording/correction, exports, inclusive-day filters, and role gates remain
  functionally unchanged.
- Checkpoint gates passed: admin typecheck, 31 test files / 733 tests, and repo
  lint. The existing Biome configuration deprecation notice remains informational.

## 2026-08-23 · Management, access, and v1 retirement

- Migrated Reports, Performance, Revenue, Room status, Audit, and Settings to
  the console kit. Existing ranges, exports, charts, audit detail, account
  creation, property configuration, role gates, and query hooks remain intact.
- Rebuilt the staff login as a focused access card with a spruce property panel.
  Session restoration, return destinations, validation, and autofocus are
  unchanged.
- Enforced the presentation contract across production UI: page titles use no
  more than two words, descriptions no more than twelve, static field help no
  more than eight, keyboard prompts use key chips, and UI text has a 14px floor
  with regular-or-heavier Figtree treatment.
- Removed the old Cormorant, IBM Plex Mono, and shared-token dependencies from
  the admin package. Retired the obsolete `dashboard-launchpad` prototype and
  removed the last v1 display/rhythm utility aliases and dead token references.
- Updated `apps/admin/README.md` and `docs/screens.md` for the admin-only tokens,
  grouped shell, console kit, route-family layouts, current command palette,
  and validation commands.

## 2026-08-23 · Final validation

- Route audit found all 21 page entries. The production build generated 22
  Next.js pages including the framework not-found page; every signed-in feature
  route resolves to its migrated screen under the new shell.
- Protected-diff audit from the pre-goal commit is empty for `apps/web`,
  `apps/api`, and `packages/tokens/tokens.css`.
- `pnpm --filter @mariva/admin typecheck` passed.
- `pnpm --filter @mariva/admin test` passed: 31 files, 733 tests.
- `pnpm lint` passed. Its only output is the repository's informational Biome
  `recommended`-field deprecation notice.
- `pnpm --filter @mariva/admin build` passed and generated all routes.
- Browser e2e was not runnable: the existing console (3002), API (3001), and
  Postgres (5432) listeners were all closed. Per `playwright.config.ts`, no
  service was started by this goal.

### Remaining known issues

- Browser-only NFR-04/NFR-11 checks remain unexecuted until the console, API,
  and Postgres are already running.
- The repository's Biome configuration uses a deprecated field; this does not
  affect the clean lint result.
- No known functional or presentation defects remain from this redesign.
