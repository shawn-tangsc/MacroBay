[English](./tooltip.md) | [中文](./tooltip.zh-CN.md) | [← Docs](../README.md)

# Tooltips

A short explanation attached to a trigger renders `Tooltip` from
`@platform/ui/components/tooltip`. Do not use the native `title` attribute: it only follows the
mouse and never enters the accessible description, so keyboard users never see it.

**The bubble lives under `document.body`.** Triggers sit inside frames that clip (`overflow: hidden`), transform, or have not been laid out on the first frame; a popup mounted beside such a trigger gets clipped or measured at `(0, 0)` and lands in the window corner. The container is fixed by the component, not passed by call sites.

## The component

| Export | Use it for |
| --- | --- |
| `Tooltip` | One hint, attached to one focusable trigger. |
| `TooltipProps` | The props type. |

The copy ceiling — **20 Chinese characters / 44 Latin characters** (what still fits on one line at
12 px inside the 250 px bubble) — is a documented acceptance criterion, not a code constant: a test
that only asserts "the constant is 20" passes forever and guards nothing.

```tsx
import { Tooltip } from '@platform/ui/components/tooltip'
```

**Basis: antd `Tooltip`.** Positioning, flipping and viewport clamping are the library's; this
component adds the focus trigger and the copy rules.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `labelKey` | `K extends string` | one of | The hint, **as a key**. `K` is inferred from `resolveText`, so a resolver typed to an explicit key union locks the allowed keys. |
| `dataText` | `string` | one of | The hint **is** runtime data — a headline, an instrument name. Comes from a variable, never a literal sentence. |
| `labelParams` | `Readonly<Record<string, string>>` | no | Values to fill `{name}` placeholders. **Already formatted** strings only (`Finder`, `289/289`). |
| `resolveText` | `(key: K) => string` | yes | The caller's resolver. An unknown key resolves to an empty string. |
| `children` | `ReactElement` | yes | The trigger. It must be focusable — a button, a link, or something with `tabIndex`. |

`labelParams` is the same shape and the same implementation as `IconButton.ariaLabelParams` and
`Popover.labelParams` (`fillLabelParams`): values in, no formatting inside the component, and a
missing parameter stays visible as `{name}` rather than vanishing. A hint that names an object
("Open in Finder") is still **one line** — multi-line explanations belong to `Popover.lines`, and
`labelParams` is not a way to assemble a paragraph.

There is no `placement`, no `open`, no `onOpenChange` and no rich content: the trigger set and the
position are fixed behaviour, not call-site options. The bubble sits below the trigger and flips up
only when there is no room.

## Rules the component enforces

- **Focus shows the hint immediately**; hover waits 300 ms. The reader who tabbed in already pointed
  at it — making them wait is the bug this component exists to fix.
- **An empty sentence renders no tooltip.** Never fall back to the key name: reading
  `ui.tooltip.refresh` aloud is worse than saying nothing.
- **No wrapper element.** The trigger is passed through untouched; wrapping it would break the
  parent's layout and invite the "focusable wrapper" variant.
- **Disabled elements never carry a tooltip.** A disabled control cannot take focus, so its hint
  would only ever be reachable with a mouse. Write the reason as visible text instead. Enforced by a
  call-site scan (`tooltipCallSiteGuard.test.ts`): a `<Tooltip>` whose trigger carries `disabled` is
  red.

## Rules for call sites

- One line only: at most **20 Chinese characters / 44 Latin characters**. Longer text becomes a
  visible note or a folded detail — a tooltip is not documentation.
- A tooltip explains; it never carries the only copy of a fact. If losing the tooltip loses the
  information, it belongs in the page.
- **Typed keys where the key set is closed.** A resolver typed to a key union (for example
  `(key: AgentTooltipKey) => string`) makes `labelKey` compile-checked: a key outside the union is a
  `tsc` error even when it lives in a constant or a wrapper. The scan guard only sees literals, so
  typed keys are what closes the gap. Derive union member types from the product text subtree with
  `DotPaths` (`platform/i18n`) — never over the whole text table, which would re-type every file on
  each copy change.
- **A hint whose sentence is assembled from data is not migrated.** Keep the `aria-label`, which is
  the accessible name and reads the same fact. `params` will not be added: a sentence the reader has
  to hover to read is the problem this component exists to remove.

## How to verify a page that uses it

1. **Keyboard**: Tab to the trigger — the hint appears at once, and Escape closes it with focus
   staying on the trigger.
2. **Mouse**: hovering waits about 300 ms; leaving removes it.
3. **Name**: the hint is the trigger's accessible description (`aria-describedby`), not a `title`.
4. **Length**: the hint stays on one line inside the sanctioned ceiling.
