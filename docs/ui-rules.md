# MacroBay UI rules (one page)

[English](./ui-rules.md) | [中文](./ui-rules.zh-CN.md)

> One page, one copy. Every other document points here; none repeats this text.

## 1. Quick reference

| Scenario | Must use | Never | Criterion |
|---|---|---|---|
| Icon-only trigger | `IconButton` (`sm` 22 / `md` 24, label required) | hand-written `<button>`; 26/28px | `iconButtonKeyGuard`, `iconGlyphVariantGuard` |
| Empty / error / disabled / permission | `StateView` (`state` + `reasonCode`) | a local empty state or error paragraph | `stateViewCallSiteGuard`, `check:state-content-ternary` |
| Multi-line explanation | `Popover` (hover/focus opens, click pins, Esc returns focus) | hand-written panel; antd `Popover` directly | `popoverCallSiteGuard`, `popoverLimitsGuard` |
| One-line hint | `Tooltip` | — | `tooltipCallSiteGuard` |
| Right-click menu | `ContextMenu` (`items: {key,labelKey,disabled?,tone?}`) | `<button role="menuitem">`, clickable `<li>` | **human review** |
| Status word | `StatusPill` (closed tone set) | hand-written pill; colour on the word | `statusPillKeyGuard` |
| Waiting region | `LoadingState` / `LoadingSpinner` | local spinner, CSS rotation, antd `Spin`, `loading…` | `loadingStandard` |
| Collapsible group header | platform `CollapsibleGroup`: **the shell owns the row and the arrow, the author owns the content** | a hand-drawn arrow, a second row click handler, any focusable element in the header | `CollapsibleGroup` header guard (at the call site) |
| Tabs | platform `Tabs`; the workspace tab strip is the one registered exception | a third hand-drawn tab strip | **human review** |
| Single choice | `Segmented` / `Select` (closed set) | two control types in one row | **human review** |
| On / off | antd `Switch` | hand-written `role="switch"` | **human review** |
| Drawer / modal header action | the header's `actions` slot (12px from close, one action) | stretching the title row with product CSS | **human review** (component test only) |
| Buttons | primary / secondary / icon / inline text / destructive — one tier per action | a hand-drawn pill, a 28px icon button, red only on hover | **human review** |
| Inline text action | `.text-action` | a bordered box inside a sentence | **human review** |

## 2. Type and weight

Only four weights: **400 / 500 / 600 / 650**. Everything else (620, 680, 700, 750) merges back.

| Use | Size / line height / weight | Token |
|---|---|---|
| Row title | 12 / 1.5 / 500 | `--font-body` / `--line-body` |
| Row meta (time, source, count) | 11 / 1.5 / 400 + `tabular-nums` | `--font-meta` / `--line-meta` |
| Body sentence | 12 / 1.5 / 400 | `--font-body` / `--line-body` |
| Group heading | 11.5 / 1.6 / 600 | `--font-section` / `--line-section` |
| Reading note | 11.5 / 1.6 / 400 | same |
| Card / section title | 13 / 1.4 / 650 | **missing** |
| Settings label | 13 / 1.4 / 400 | **missing** |
| Table figure, axis | 11 / 1 / 400 or 600 + `tabular-nums` | **missing** |

- A row title is one step lighter than its group heading (500 vs 600): content is lighter than structure.
- **A collapsible group's header row uses the group-heading tier**: `--font-section` / `--line-section` / 600 / `--muted-strong`. The platform `CollapsibleGroup` must use the same values, or shell and pages drift apart again.
- Card title 13 still has **no token**; use the literal.
- **Equivalent replacement only**: swap 12 / 11 / 11.5 for the references, visually unchanged. Raising 10 / 10.5 / 9.5 to 11 is a **visible change** — separate commit, with a before/after comparison.
- **Never substitute 10 / 10.5 / 9.5.**

## 3. Spacing

| Rule | Value |
|---|---|
| Allowed steps | **4 / 6 / 8 / 10 / 12 / 16** |
| List row | height 44 (one line) / 60 (two); **32 for dense streams such as logs and message feeds**, inline padding 12, title to meta 8 |
| New values | a non-step value is a defect; the existing ones merge file by file, no repo-wide rewrite |
| Two-column rows (field area + trailing control) | field area **`flex: 1; min-width: 0`**, trailing control **`flex: none`** |

## 4. Colour

**Criterion:** without `min-width: 0` on the field area, a long string is squeezed into a one-character-per-line column — that is how the 403 line in `ProviderDetail` broke. Every two-column row follows the row above.

| Token | Use | Never |
|---|---|---|
| `--text` | body, labels, values | — |
| `--text-strong` | emphasis inside a reading | whole paragraphs |
| `--muted` | meta, units, instants | anything the reader must act on |
| `--muted-strong` | secondary heading | body |
| `--border` / `--border-strong` | separators, card edges | as a text colour |
| `--surface*` | backgrounds | as a text colour |
| `--accent` | the single interaction colour | **warnings, errors, "important"** |
| `--danger` | destructive and failure text | decoration, emphasis |
| `--warning` | caution that is not a failure | errors |
| `--success` | confirmed / healthy | "no data" |
| `--mi-dashboard-*` | dashboard semantic colours | borrowing across modules |

Three gates, each with one hole:

| Gate | Catches | Does not catch |
|---|---|---|
| `check:hex-color` | hard-coded hex | **the wrong colour for the meaning** (accent as a warning) |
| `check:undefined-token` | an undefined `var(--x)` | a defined token used in the wrong place |
| `check:danger-color` | new `color: var(--danger)` beyond the baseline | `background` / `border-color` danger, or another red used instead |

So **wrong-colour-for-meaning and non-foreground danger have no gate**; keep both on the review checklist.

## 5. Never do

- Hand-write `<button>` instead of `IconButton`.
- Use a non-tier weight (620 / 680 / 700 / 750).
- Hard-code a px font size instead of the size tier.
- Hand-write `role="switch"`.
- Hand-draw `role="tab"` (except the registered workspace tab strip).
- Hand-format `YYYY/M/D`.
- Print the same fact twice on one row.
- Offer **Retry on an unrecoverable failure** (an official source returning 403, data written by another version) — a retry that must fail is a fake control. Say "unavailable", give the reason, and say nobody knows when it will recover.
