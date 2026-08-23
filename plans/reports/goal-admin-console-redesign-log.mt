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
