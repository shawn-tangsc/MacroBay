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
| Tabs | platform `Tabs`; the workspace tab strip is the **one** registered exception | a third hand-drawn tab strip | `check-tab-role` |
| Single choice | `Segmented` / `Select` (closed set) | two control types in one row | **human review** |
| On / off | antd `Switch` | hand-written `role="switch"` | **human review** |
| Drawer / modal header action | the header's `actions` slot (12px from close, one action) | stretching the title row with product CSS | **human review** (component test only) |
| Buttons | primary / secondary / icon / inline text / destructive — one tier per action | a hand-drawn pill, a 28px icon button, red only on hover | **human review** |
| Inline text action (a "retry / shorten the lede / show details" inside a sentence, a notice bar, or a status line) | `<Button type="text" size="small" className="text-action">` | `type="link"` (antd `colorLink` is not a token — it introduces a second interaction colour); a hand-written `<button>`; per-call-site antd default overrides (`height` / `padding` / `font-size`) | **human review**: `type="link"` may only go down (baseline 2026-11-12: **12 sites in 8 files**, to be cleared); once it reaches 0, any new one is rejected |
| Explanatory prose | the `ⓘ` beside that row's or group's title (`IconButton` + `Popover`), collapsed by default | a sentence, half-sentence, parenthetical or em-dash supplement in the body | `check:body-prose` |
| Card-level action | **on the card title row, right side**: one action (enable source / retry) whenever any source the card depends on is unconfigured or unreadable; the body only names the missing cell | a second copy of that action inside the card; two entries for one action on a screen | **human review** (criterion below) |
| Small text the reader must read (11px `--font-meta` and above) | `--text` / `--text-secondary`; hierarchy from weight or position | `--muted` on text the reader must see | **human review**: measured contrast against the surface it actually sits on ≥ **4.5:1** — measure it, never judge by eye |

**A disabled control's reason: first ask whether it is already visible (narrowed 2026-11-20; the user had the redundant sentence deleted).** Two tests:

- **A reader can tell at a glance why it cannot be pressed → write no sentence.** Visible state may carry it: the spinner on the button, the "in progress" row in the list, and the control's own `aria-busy` are the evidence. Adding "a run is in progress. Try again when it finishes." says the same thing twice.
- **Cannot be told from the interface → it must be written**, through `DisabledHint` (visible text plus `aria-describedby`): no permission, source not configured, quota exhausted.

Check: a disabled control renders **either** a reason sentence **or** visible state that carries the reason (an in-progress row, a spinner, `aria-busy`); it is a defect only when neither exists. Counterexample: the `analysisInFlight` sentence was deleted — a spinning button and an in-progress row sit right beside it.

**A card-level action lives only on the title row (2026-11-11).** If any source a card depends on is unconfigured or unreadable, the action (enable source / retry) sits on the **right of the card title row**; the body only names the missing cell and never repeats the action. **One action, one entry per screen.**
Criterion: any source unconfigured → the title row has it; everything configured → no action; count of that action on the screen = 1.
**Exception:** when **none** of the sources a card depends on is configured, the action moves into the content-area veil, centred; the title row carries no action and the card still holds exactly one entry. Criterion: with nothing configured the card has exactly one focusable element and no title-row action.

**The inline-text-action rule forbids writing the appearance yourself, not using the class (2026-11-12, UI design final).** `.text-action` (`platform/ui/styles/textAction.css`) is designed to sit on an antd `Button`: it supplies `--accent`, the underline, the `2px` focus ring and the disabled state (`--muted`, no underline). A call site adds no size or colour of its own. The three rules in `dailyBriefing.css` that override antd defaults are the counterexample.
**Register the exception:** links that are not actions (a file download `<a download>`, an external `<a href>`) stay anchors and are out of scope; if one appears, record it as "the component cannot express this" with the reason.

## 2. Type and weight

Only four weights: **400 / 500 / 600 / 650**. Everything else (620, 680, 700, 750) merges back.

| Use | Size / line height / weight | Token |
|---|---|---|
| Row title | 12 / 1.5 / 500 | `--font-body` / `--line-body` |
| Row meta (time, source, count) | 11 / 1.5 / 400 + `tabular-nums` | `--font-meta` / `--line-meta` |
| Body sentence | 12 / 1.5 / 400 | `--font-body` / `--line-body` |
| Group heading | 11.5 / 1.6 / 600 | `--font-section` / `--line-section` |
| Reading note | 11.5 / 1.6 / 400 | same |
| Page name (the screen's subject, e.g. a detail header) | 16 / 1.35 / 650 / `--text-strong` | **missing** (literal 16; the screen subject only — never a section title, never a row, **never a card header**: the config drawer's in-card title was removed, `3403c15`) |
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
| Page outer padding | **24** (page frame only; never inline, never between blocks, and **never a card's inner padding** — a drawer card uses 16) |
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
| `--info` | **Direction**: "below expectation" border/ink; on the light theme it outlines rather than fills | Any good/bad verdict — a high CPI is not "good" |
| `--mi-dashboard-*` | dashboard semantic colours | borrowing across modules |

**Small text that must be read never uses `--muted` (2026-11-21; the clock plaque measured 3.82:1).** `--muted` is for meta the reader may skip. A number or word the reader must catch keeps `--text` or `--text-secondary`, and hierarchy comes from weight or position rather than from dimming it. Criterion: the contrast between the small text and **the surface it actually sits on** (plaque fill, card fill) is ≥ 4.5:1, computed from the real values of that surface — measuring, not eyeballing. Counterexample: the clock plaque's "4 days away" sat on `#293958` in `--muted`, **3.82:1**; raising it to `--text` 650 gives **9.50:1**, with the value stepping back to `--text-secondary` 500 at **6.29:1**.

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
- Hand-draw `role="tab"` (except the registered workspace tab strip — **the only exception today**, registered in `scripts/check-tab-role.mts`; `ModelServiceModelDrawer` is not a second one: its `role="switch"` debt was removed with the source, and tabs were never its business).
- Hand-format `YYYY/M/D`.
- Print the same fact twice on one row.
- Put explanatory prose in the body — scope notes, implementation detail, reassurance ("only affects…", "will not affect…").
- Offer **Retry on an unrecoverable failure** (an official source returning 403, data written by another version) — a retry that must fail is a fake control. Say "unavailable", give the reason, and say nobody knows when it will recover.

## 6. Animation

**Rotation belongs to loading — with exactly one named exception.** By default only `loadingState.css` may rotate (a spinner means "in progress"). The single exception is the clock card's decorative sweep, and it must be **registered by name**, never waved through as a category:

| | |
|---|---|
| Exception | `.mi-clock__orbit` in `products/market-intelligence/desktop/pages/intelligence/clockCard.css` (that selector only) |
| Form | The gradient fan rotates itself: `animation: mi-clock-spin 8s linear infinite`, `@keyframes { to { transform: rotate(360deg) } }`, `transform-origin: 156px 153px` |
| Why it cannot be confused with loading | While loading, the whole block is replaced by `loadingState`, so the two are never on screen together; and it is not a progress indicator — it is there whether or not anything is happening |
| Reduced motion | `animation: none`, and the light **must stay visible** (frozen in place). **`display: none` is forbidden** — on 2026-11-15 it was hidden without telling anyone, the user read it as broken, and it cost two hours |

**Check:** `loadingStandard` reads the rule as "any `rotate` animation outside this one named exception fails". Add a rotation anywhere else and the guard must fail; delete this exception and the clock card's sweep test must fail.

**Tell the user about visual changes.** Before stopping, hiding or replacing anything the user can see, say in the group which element, what it becomes, and why. A silent visual change is the same class of problem as silently deleting a feature: the user thinks it broke and nobody knows why.
