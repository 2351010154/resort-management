# Dashboard launchpad — prototype

**This folder is a prototype. Nothing in the console imports it, and nothing
should until a decision says otherwise.**

It holds the parts of a front-desk launchpad comp: four operational counts, an
arrivals/departures table, and a right-hand rail. Kept because the composition
is worth something and re-deriving it would cost a day.

Before anything here is promoted into `app/`, `components/ui/` or
`features/dashboard/`, know what is wrong with it:

- **Half the rail has no product behind it.** Concierge tools, guest requests,
  wake-up calls, maintenance tickets and priority tasks have no domain module,
  no schema and no functional requirement. The `message`, `bell`, `clock` and
  `wrench` icons below exist only to draw them.
- **The handoff note is real but early.** Shift handover is `FR-OPS-01`, M8, and
  `docs/screens.md` puts the shift in the shell's top bar rather than on the
  dashboard.
- **The type does not render as designed.** `prototype.css` reads
  `--font-ui` and `--font-display`, which `@mariva/tokens` does not define —
  `apps/web` sets them through `next/font`. Here they fall back to generic
  monospace and serif, so this is not yet evidence about the console's
  typography.
- **`--dusk-amber` is used as text and as focus outlines.** Against `--ivory`
  that is ~2.7:1 — below WCAG AA for text (4.5:1) and below the 3:1 a focus
  indicator needs.
- **The date in the comp is the calendar date.** Every count on the screen is
  keyed to the business date, which rolls at 04:00 `Asia/Ho_Chi_Minh`. See
  `lib/business-date.ts`.
- **The rail's counts contradict the cards.** Twelve arrivals beside eight
  arrivals awaiting check-in, with nothing on screen explaining the difference.

`docs/screens.md` §Staff surfaces is the authority on what the dashboard is:
a launchpad of four counts leading into their family screens, not a report.

## Hero Background Images

Selected from design materials for luxury hotel aesthetic:

### Primary Hero Image
- **File**: `assets/images/hero-lobby.webp`
- **Source**: Aman Tokyo - Japan - Lobby.webp
- **Description**: Dramatic modern hotel lobby with soaring ceiling design, dark sophisticated palette with warm wood accents. Features elegant seating areas and striking architectural lines. Perfect for admin dashboard hero section backdrop.
- **Dimensions**: High-resolution WebP format
- **Usage**: Main landing page hero background

### Alternate Hero Image
- **File**: `assets/images/hero-resort.webp`
- **Source**: 210204_AmanHero_Square5_0_4.webp
- **Description**: Pristine tropical beach and resort aerial view with turquoise waters. Provides a lighter, more aspirational alternate for seasonal or property-specific theming.
- **Usage**: Optional alternate hero background or property showcase

## Dashboard Icons

Created as 24×24 outline SVG icons with 2px stroke weight. All use `currentColor` for flexible theming.

### Icon Inventory

| Icon | File | Usage |
|------|------|-------|
| Briefcase | `assets/icons/briefcase.svg` | Arrivals awaiting check-in |
| Suitcase | `assets/icons/suitcase.svg` | Departures and checkout |
| Bed | `assets/icons/bed.svg` | Housekeeping status |
| Document | `assets/icons/document.svg` | Unsettled folios |
| Message | `assets/icons/message.svg` | Concierge requests |
| Bell | `assets/icons/bell.svg` | Guest requests/notifications |
| Clock | `assets/icons/clock.svg` | Wake-up calls |
| Wrench | `assets/icons/wrench.svg` | Maintenance tasks |

### Icon Style
- **Format**: SVG (inline-ready)
- **Size**: 24×24 viewBox
- **Stroke**: 2px, currentColor
- **Style**: Outline/line icons for clean, professional aesthetic
- **Compatibility**: Works with light and dark themes via currentColor

## Asset Organization

```
apps/admin/prototypes/dashboard-launchpad/assets/
├── images/
│   ├── hero-lobby.webp      (primary hero background)
│   └── hero-resort.webp     (alternate hero)
└── icons/
    ├── briefcase.svg
    ├── suitcase.svg
    ├── bed.svg
    ├── document.svg
    ├── message.svg
    ├── bell.svg
    ├── clock.svg
    └── wrench.svg
```

## Serving these

Nothing serves them today. They sit beside the prototype rather than under
`apps/admin/public/`, so the console's origin does not carry a hero photograph
and eight icons for a screen that does not exist.

Whatever promotes this prototype moves the files it actually keeps into
`public/` and references them from there. Copy no more than that: a marketing
photograph on an operational screen was already argued against, and four of the
icons draw features the product has not agreed to.

## Design Notes

The lobby image provides:
- Professional, luxury hospitality aesthetic
- Deep, sophisticated color palette (dark slate/navy base)
- Architectural drama suitable for hero treatment
- High contrast for overlaid UI elements and text
- Modern luxury positioning aligned with Mariva brand

Icons maintain:
- Consistent 2px stroke weight
- Simple, scannable shapes
- Theme-agnostic via currentColor
- Professional outline style matching modern dashboard UX
