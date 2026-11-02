[English](./tooltip.md) | [中文](./tooltip.zh-CN.md) | [← Docs](../README.md)

# Tooltips

A short explanation attached to a trigger renders `Tooltip` from
`@platform/ui/components/tooltip`. Do not use the native `title` attribute: it only follows the
mouse and never enters the accessible description, so keyboard users never see it.

## The component

| Export | Use it for |
| --- | --- |
| `Tooltip` | One hint, attached to one focusable trigger. |
| `TOOLTIP_MAX_CJK` | 28 — the ceiling for a Chinese hint. |
| `TOOLTIP_MAX_LATIN` | 60 — the ceiling for a Latin hint. |
| `TooltipProps` | The props type. |

```tsx
import { Tooltip } from '@platform/ui/components/tooltip'
```

**Basis: antd `Tooltip`.** Positioning, flipping and viewport clamping are the library's; this
component adds the focus trigger and the copy rules.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `labelKey` | `string` | yes | The hint, **as a key**. |
| `resolveText` | `(key: string) => string` | yes | The caller's resolver. An unknown key resolves to an empty string. |
| `children` | `ReactElement` | yes | The trigger. It must be focusable — a button, a link, or something with `tabIndex`. |

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
  would only ever be reachable with a mouse. Write the reason as visible text instead.

## Rules for call sites

- One line only: at most **28 Chinese characters / 60 Latin characters**. Longer text becomes a
  visible note or a folded detail — a tooltip is not documentation.
- A tooltip explains; it never carries the only copy of a fact. If losing the tooltip loses the
  information, it belongs in the page.

## How to verify a page that uses it

1. **Keyboard**: Tab to the trigger — the hint appears at once, and Escape closes it with focus
   staying on the trigger.
2. **Mouse**: hovering waits about 300 ms; leaving removes it.
3. **Name**: the hint is the trigger's accessible description (`aria-describedby`), not a `title`.
4. **Length**: the hint stays on one line inside the sanctioned ceiling.
