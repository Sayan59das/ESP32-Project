# EcoSort Edge console: design notes

A "calm instrument panel": flat bordered surfaces on a warm neutral ground, one hue per
outcome, big tabular numerals, and almost no motion. Built for an operator about 2 m from
the screen, who needs the two counters and the latest verdict at a glance.

This file describes the console. The home (`/`) and testing (`/testing`) pages share its
tokens, type and outcome colours but are 3D scroll stories: see "The 3D pages" at the end.

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
   graphic pairing the design uses (86 pairings, light and dark) and runs in `make lint`.

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
| Primitives | `Button` (primary, secondary, ghost), `Badge` (7 tones), `Card`, `Dialog` (native `<dialog>`), `Skeleton`, `EmptyState`, `Measured` / `NotMeasured`, `VisuallyHidden`, `Icon` (21 inline SVGs) |
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

| State                      | What the operator sees                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading                    | Still skeletons (no shimmer), `aria-busy`                                                                                                                                                                   |
| Empty run                  | Last item shows the four steps: place, hold, counted or unsure, remove; "Nothing in this run yet" in the log                                                                                                |
| Counted / unsure           | Verdict strip over the held frame, camera chip, the count's 250 ms highlight, a new log row                                                                                                                 |
| Live updates paused        | Banner with how long and "counts shown are the last received", counters desaturated, "Reconnecting" badge                                                                                                   |
| Service unreachable        | Alert banner with the next step; tiles say "No counts" (no skeletons that never end)                                                                                                                        |
| Not linked, not responding | Message over the camera with the fix (port busy, no board, heartbeat lost); alert link badge                                                                                                                |
| Board restarted            | Notice in the link panel; counts before and after are kept                                                                                                                                                  |
| Preview paused             | The viewer's own pause: picture stops, counting and verdicts continue, "Preview paused" instead of "No frames"                                                                                              |
| Simulated / replay         | Inverse badge in the header and on the camera; the link badge says "Simulator" or "Replay", never "Linked", and the camera chip says "no camera in use". Generated items must never look like a live camera |
| Not measured               | `NotMeasured`: the words in a dashed outline                                                                                                                                                                |
| Error, 404                 | `ErrorScreen` with "Try again" and "Reload the console"; `global-error` for a failed root layout                                                                                                            |

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

## The 3D pages

`/` and `/testing` are stories told over a fixed three.js canvas (`components/scene/`). The
words are HTML on solid cards (or, in each page's opening, straight on the world), so they
read the same with the canvas off. The rules above still hold: the numbers on `/testing` come
from `data/testing.json` and say "Not measured yet" or "Not added yet" when they are missing;
simulated data is never shown as real; the three outcomes keep their colours and icons.

- **The world.** One scene per page (`components/scene/scenes/`), made in code: a concrete
  recycling yard under a haze (slab joints, safety paint, crates, drums, flattened cans, bales,
  and the silos and sheds of a plant fading into the distance), the Sorter (a ribbed bin with a
  lens, a recycling mark and a lid in the three outcome colours), a lane and three bins that
  carry their outcome's mark, a pipeline of glass blocks, towers of light, screens, a field of
  photograph tiles, empty frames. Scraps of paper drift through the air. Light and dark are two
  palettes of the same world (`engine/palette.ts`); the outcome colours do not change.
- **The camera** follows a spline through poses keyed to chapters (`lib/scene/rig.ts`), resting
  while a chapter's card is pinned and moving between chapters. The reader's position drives it
  through a critically damped spring (`smoothDamp` in `lib/scene/math.ts`), so a wheel's steps,
  a dragged scrollbar and a jump from the chapter dots are all one continuous move; the field of
  view opens a little at speed. On a narrow screen the picture moves into the top half and the
  words sit below.
- **Labels** pinned to points in the world are decoration that repeats the text. Each leans to a
  side that is on screen and clear of the cards and of the other labels, or hides
  (`lib/scene/labels.ts`).
- **Motion.** Default on, off for `prefers-reduced-motion`, and a "Pause animation" button
  remembers the choice. Still mode renders on demand only. `?frame=2.5&time=10&quality=low`
  freezes a chapter for review and tests.
- **Cost.** Three quality tiers (bloom and shadows only on the top one), a software renderer is
  forced to the lowest. If frames run slow it draws fewer pixels first, a step at a time, and
  only then gives up bloom and shadows; it never steps back up. Every shader is compiled and
  every generated texture uploaded before the first frame, so nothing stalls when a chapter's
  objects first come into view. Only the home and testing pages load three.js.
- **Contrast.** Small text straight on the world is `--ink` only, checked against the world's
  mist and ground colours (`--scene-mist`, `--scene-ground`, kept in step with the palette).
