# EcoSort Edge console: design notes

A "calm instrument panel": flat bordered surfaces on a warm neutral ground, one hue per
outcome, big tabular numerals, and almost no motion. Built for an operator about 2 m from
the screen, who needs the two counters and the latest verdict at a glance.

Everything here is plain CSS Modules over the tokens in `styles/tokens.css`. There are no
runtime UI dependencies. Fonts and icons are bundled, so the console makes no external
requests.

## Rules that shape every component

1. **The server owns the truth.** Counts come from `State.counts` and nothing in the
   browser adds, subtracts, rolls or estimates one. Display-only ratios (an item's share,
   the length of a bar) are computed from server values, never stored.
2. **Nothing is faked silently.** Simulated and replayed data carry an inverse badge in the
   header and on the camera window. A missing measurement says "Not measured yet", never 0,
   a dash or an estimate.
3. **Three outcomes.** Recyclable, Trash and Unsure (below 60% confidence, counted in
   neither bin). Unsure is amber and is never styled as an error.
4. **Colour never works alone.** Every outcome and status pairs its colour with an icon and
   a word.
5. **WCAG 2.2 AA** in both themes. `scripts/check_contrast.py` checks every text and
   graphic pairing the design uses (78 pairings, light and dark) and runs in `make lint`.

## Outcomes: colour, icon, wording

| Outcome    | Fill (counters) | Icon                | Word       | What happened to the count |
| ---------- | --------------- | ------------------- | ---------- | -------------------------- |
| Recyclable | green           | circular arrow      | Recyclable | Counted as recyclable      |
| Trash      | slate           | bin                 | Trash      | Counted as trash           |
| Unsure     | amber           | framed question (?) | Unsure     | Not counted in either bin  |

The single source is `components/outcome.ts`. Each outcome has four tokens: a **fill** for
the big counters and the verdict strip, a **tint** and **ink** for badges and rows, and a
**mark** for bars and icons on a surface (bright amber cannot reach 3:1 on a light surface,
so the mark is darker there). Unsure bars are hatched as well as amber. The server's item
name (for example "Non-recyclable") is shown beside the bin word when it says more.

## Tokens

Light is the default. Dark follows the system unless the viewer picked a theme with the
switch in the header (`data-theme` on `<html>`, remembered in `localStorage`, with a script
in `<head>` that sets it before first paint). The two dark blocks in `tokens.css` must stay
identical; the contrast script fails if they drift.

| Token group | Light / dark                                                                     |
| ----------- | -------------------------------------------------------------------------------- |
| ground      | `#f2f0ea` / `#0e1311`, the page                                                  |
| surface     | `#fbfaf6` / `#161c19`, panels; `surface-sunk` `#e9e6dd` / `#1f2723` for insets   |
| ink         | `#1b211e` / `#e6ebe7`; `ink-muted` `#545b56` / `#a3ada7`                         |
| lines       | `line` (decorative), `line-strong` `#767a72` / `#7d8882` (controls, 3:1)         |
| recyclable  | fill `#1d6b45` / `#1f7048`, mark `#1d6b45` / `#5fbf8a`, plus tint and ink        |
| trash       | fill `#4a535c` / `#4f5a64`, mark `#4a535c` / `#9aa6b1`, plus tint and ink        |
| unsure      | fill `#e0a019`, mark `#9a6200` / `#e0a019`, plus tint and ink                    |
| signal      | `#1d5a8c` / `#7fb3e0`: link, live, focus. Alert `#a3302a` / `#e5736a`: faults    |
| camera      | `video-bed`, `on-video`, `focus-on-video`, `alert-on-video`: dark in both themes |

- **Type.** Archivo (variable weight and width) for numerals and headings: narrow, so a
  counter fits its tile. Atkinson Hyperlegible Next for running text. Both are in
  `app/fonts` with their licences. Sizes run `xs` 13 px to `3xl` 44 px; the counters are
  fitted to their tile (up to 160 px) from the digit count. All numerals are tabular.
- **Space.** 4 px half step, then an 8 px unit: 8, 12, 16, 24, 32, 40, 48, 64. Gutter 24.
- **Radius.** 3, 6 and 10 px. **Elevation.** Borders do the work; only dialogs have a shadow.
- **Motion.** `fast` 120 ms, `base` 200 ms, `highlight` 250 ms, one easing. Nothing loops.
  `prefers-reduced-motion` sets every duration to 0.

## Components

| Group      | Components                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives | `Button` (primary, secondary, ghost), `Badge` (7 tones), `Card`, `Dialog` (native `<dialog>`), `Skeleton`, `EmptyState`, `Measured` / `NotMeasured`, `VisuallyHidden`, `Icon` (22 inline SVGs) |
| Console    | `SiteHeader`, `ThemeToggle`, `CameraWindow`, `BinReadout`, `LastVerdict`, `ItemBreakdown`, `LinkStatus` (`LinkBadge`, `LinkPanel`), `RunControls`, `EventLog`, `ConnectionBanner`              |
| Pages      | `Console` (the `/` page), `FlowDiagram` (`/project`), `ErrorScreen` (error and 404)                                                                                                            |
| Logic      | `lib/reducer.ts` (the only state), `cameraState.ts`, `linkView.ts`, `connection.ts`, `announce.ts`, `format.ts`, `metrics.ts`, `copy.ts` (all user-facing wording)                             |

`/styleguide` shows the tokens and primitives; it returns 404 in a production build.

## Layout

The camera window is a square, and the bin readout sits flush under it at exactly the same
width, so the counters are the biggest thing on the page. Width comes from one variable,
`--stage-size`, snapped to a multiple of 32 px so the 160 by 120 frame scales by a whole
number.

- 1920 by 1080: one screen. The stage is 480 px, the counters 160 px, and the log scrolls
  inside its card.
- 960 px and up: stage on the left; last item, by item, link and the log on the right.
  1600 px and up puts the three panels in one row.
- Under 960 px: one column in reading order, the log full width last. Under 768 px the
  panels stack; under 480 px the log folds the time under the verdict.
- No horizontal scroll from 1280 down to 320 px (1280 at 400% zoom).

## States

| State                      | What the operator sees                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Loading                    | Still skeletons (no shimmer), `aria-busy`                                                                      |
| Empty run                  | Last item shows the four steps: place, hold, counted or unsure, remove; "Nothing in this run yet" in the log   |
| Counted / unsure           | Verdict strip over the held frame, camera chip, the count's 250 ms highlight, a new log row                    |
| Live updates paused        | Banner with how long and "counts shown are the last received", counters desaturated, "Reconnecting" badge      |
| Service unreachable        | Alert banner with the next step; tiles say "No counts" (no skeletons that never end)                           |
| Not linked, not responding | Message over the camera with the fix (port busy, no board, heartbeat lost); alert link badge                   |
| Board restarted            | Notice in the link panel; counts before and after are kept                                                     |
| Preview paused             | The viewer's own pause: picture stops, counting and verdicts continue, "Preview paused" instead of "No frames" |
| Simulated / replay         | Inverse badge in the header and on the camera, never hidden                                                    |
| Not measured               | `NotMeasured`: the words in a dashed outline                                                                   |
| Error, 404                 | `ErrorScreen` with "Try again" and "Reload the console"; `global-error` for a failed root layout               |

## Accessibility

- A skip link is the first Tab stop on every page. Every control has a visible 2 px focus
  ring (a lighter one inside the camera window); dialogs trap Tab and return focus.
- One polite live region announces each verdict with the server's counts, link faults and
  the stream resuming, at most one message every 2 s.
- Headings are h1 > h2 > h3 in order; tables have captions; scroll areas are named by them.
- Targets are at least 24 px; Windows High Contrast keeps the chosen theme and source
  visible; widened text spacing (WCAG 1.4.12) does not cut off the counters.
- The camera picture can be paused (WCAG 2.2.2). Pausing never stops the counting.

## Test hooks

`count-recyclable`, `count-trash`, `count-unsure`, `bin-readout`, `camera-viewport`,
`count-highlight`; regions named "Recyclable", "Trash" and "Unsure"; the dialogs "Start a
new run?" and the frame dialog; buttons named `Show the frame for ...`.
`e2e/` covers layout, offline, counts matching the API, states, keyboard and axe in both
themes; `lib/*.test.ts` covers the logic.

## Adding to it

Use tokens, not raw values. If a new colour pair carries text or a graphic, add it to
`PAIRINGS` in `scripts/check_contrast.py` and check both themes. Put new wording in
`lib/copy.ts`. Do not add a number that the server did not send.
