[English](./charts.md) | [中文](./charts.zh-CN.md) | [← Docs](../README.md)

# Charts

Three defects in a row came from the same place: a chart invented something the module already
decided elsewhere. Five lines were drawn in colours nobody checked pairwise, so two of them read as
one line at 1.6px. Axis ticks each printed the time zone, so five ticks said the same thing five
times and collided. An unreadable window was drawn as a chart with nothing in it. This page holds
the rules those three were missing, so the fourth chart does not find them again.

Each rule below is what the code already does. A change that departs from one is a design review
item, not a local call.

## One palette, one owner

The five line colours live in exactly one block:
`products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css` — the dark default at
`:51-55`, the light remap at `:root[data-theme='light'] .mi-crypto-dashboard` `:681-685`.

| Token | Line | Dark | Light |
| --- | --- | --- | --- |
| `--mi-dashboard-chart-qqq` | index | `#55d69b` | `#17835a` |
| `--mi-dashboard-chart-btc` | BTC | `#e5ae43` | `#6f3d10` |
| `--mi-dashboard-chart-eth` | ETH | `#b994ff` | `#6b45c4` |
| `--mi-dashboard-chart-dxy` | dollar | `#7f9ec9` | `#3f6491` |
| `--mi-dashboard-chart-gold` | gold / 3M | `#f2e3a0` | `#8a6d1f` |

A chart names its line and reads the token; it never writes a colour of its own. Consumers rename
the token to their own scale (`CrossAssetObservationPanel.css:33-37`), and the yield curve maps a
tenor to a token (`ustYieldCurve.css:108-112`).

Why one owner matters: the light remap is a contrast fix, not a style choice. The dark values on
white sit at 1.29–2.75:1, and the cream line nearly disappears. Because the fix is one block, every
chart that uses the palette is fixed together. A per-chart override would leave three charts on the
old values.

`crossAssetChartPalette.test.ts` is the guard, and it asserts separation, not taste:

- any two of the five lines must differ by hue ≥ 18°, **or** lightness ≥ 18 points, **or**
  saturation ≥ 25 points (`palettePolicy`);
- in light theme every line is at least 3:1 against the real `--surface` read from the shell
  stylesheet, not against a hardcoded white;
- 3M and 30Y must also differ in contrast ratio by ≥ 1.7×, because the two are told apart by
  brightness at 1.6px, not by a hue nobody can see.

What these gates do **not** cover: `check:hex-color` matches only a declaration whose property is
exactly `color:` (`tools/danger-color-guard/dangerColorGuard.ts:69`), so a hex used as a fill, a
stroke or a custom property is invisible to it. The palette test is the only guard on these five
values. A green hex gate does not mean the chart colours were checked.

Adding a sixth line means adding a sixth token here and extending the pairwise assertion.
The guard holds its five ids as a literal list (`crossAssetChartPalette.test.ts:27`), so a sixth
token that nobody lists is not seen by it. Until a guard derives the token list from the stylesheet,
extending that list is a manual step in the same change — not something the doc can promise on the
guard's behalf.

Reusing a status token (`--success`, `--danger`) is wrong on purpose: a status colour says what the
state asks of the reader, and a series colour says which line this is.

Chart type inside the plot has its own owner: `--mi-chart-label-size: 9px`
(`cryptoDashboard.css:44`). Axis labels, lane labels and marker labels read that token and never
write `9px` (`PositioningPanel.css:64,81,96,100`; `ustYieldCurve.css:86`). It is the one size in the
app that sits below the body scale, and it exists once because a chart label that drifts by a pixel
no longer lines up with its axis. `PositioningPanel.test.tsx:670-673` fails when a call site stops
reading the token.

## Same start means same start

A "return since the window opened" chart rebases every line to one anchor. The y axis always carries
zero: `CrossAssetReturnChart.tsx:198` draws `[max, 0, min]` and collapses to `[0]` when the range is
flat. If zero is not on the axis, "up since the open" is not readable, and two lines that look level
may simply have been cropped.

- Rebased-to-window values are ratios, not differences: `dailyBriefingSeries.ts:113-115` divides by
  the anchor's `1 + r/100`, and `crossAssetWindowReturns.ts:72` computes a window return as
  `(1 + newer) / (1 + older) - 1`. Subtracting two percentages is wrong the moment both are large.
- A line that is still forming is drawn as a tail and marked as forming
  (`CrossAssetReturnChart.tsx:220`, `text.forming`); it is not counted as a closed point.
- A level chart is not rebased. The yield curve shows levels; a zero line would be meaningless
  there, and the palette still applies.

## Axis labels: compact on the axis, exact in the tooltip

Ticks use the compact clock: same display day `HH:mm`, cross-day `MM-DD HH:mm`, and no zone.
`formatShellClock` from `@platform/ui/time/shellTimeFormat`, zone from `useShellTimeZone()` —
`PositioningChart.tsx:104-107`, `CrossAssetReturnChart.tsx:96`.

The exact instant, with the zone, belongs to the tooltip only (`PositioningChart.tsx:275`,
`CrossAssetReturnChart.tsx:258`). The axis answers "when", the tooltip answers "exactly when". Five
ticks each printing `GMT+8` is the same fact five times, and the labels collide.

- Tick count is fixed per chart: five marks on the funding-rate chart (`positioningAxisTicks.ts:16-31`,
  `steps = 4`), three on the same-start return chart (`CrossAssetReturnChart.tsx:58`, `tickSlots: 3`).
  Changing the count means re-reading the label widths in the same change.
- End labels are anchored, never clipped: first `text-anchor: start`, last `end`, middle `middle`
  (`PositioningChart.tsx:267`); positioned ticks get a translateX compensation
  (`CrossAssetReturnChart.tsx:254`).
- Tick positions snap to a round unit no wider than half a step, so two neighbours cannot land on
  the same mark; if no unit fits, the true positions are kept (`positioningAxisTicks.ts:20-29`).
- Numeric axis text uses `font-variant-numeric: tabular-nums` (`ustYieldCurve.css:86`).
- A date assembled by hand in a component (`YYYY/M/D` and friends) is a defect even when it looks
  right in one locale. It goes through the shell formatter.

## An empty segment is not one thing

Five situations look alike on screen and must not be drawn alike. One empty array for all of them is
the defect: it reports "there is nothing" for a channel that could not be read.

| Situation | Rendering |
| --- | --- |
| The card's data could not be read at all | `StateView` error with retry — never an empty plot (`UstYieldCurveCard.tsx:84-92`) |
| Nothing yet, or not applicable | `StateView` empty with a platform reason, or the card's own sentence through the reason slot (`UstYieldCurveCard.tsx:100`; `CapitalConditionsPanel.tsx:200-207`) |
| One row is switched off | That line leaves the legend with its row — no grey line, no placeholder (`chartLinesHiddenBy`, `CrossAssetReturnChart.tsx:21`) |
| A whole channel could not be read | The call site decides which lines exist: its `hiddenLines` and its state branches. The chart does not guess — `CrossAssetReturnChart.tsx:37-38` says read failure is not its business |
| The window has no comparable data for a line that is otherwise shown | The line is left out of the plot and the legend says one sentence; the reason lives in the chart title's ⓘ (`linesWithoutComparableData`, `CrossAssetReturnChart.tsx:43-54`) |

The last row is one predicate feeding both places, deliberately: the legend sentence and the ⓘ can
never disagree about which line is missing and why.

Inside a tooltip, a missing value is `text.noData` (`CrossAssetReturnChart.tsx:263`), not `0` and
not a dash with no explanation. "This line has no data here" and "this value could not be read"
are different states, and the copy says which one it is.

A gap inside a series is a gap. Do not interpolate across it to make the line look continuous: the
drawn line is a claim that the data existed in between.