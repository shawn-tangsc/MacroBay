[English](./meta-chip.md) | [中文](./meta-chip.zh-CN.md) | [← Docs](../README.md)

# Category chips

A **category noun** — macro, rates, US equities, crypto, a protocol or tool name — renders `MetaChip`
from `@platform/ui/components/meta-chip`. A **status word** (enabled, stale, read failed) is
`StatusPill`; a **count** is `CountBadge`; **one sentence after an action** is `Toast`.

The two look alike on purpose and must not be swapped: the distinction is not colour, it is **dot vs
no dot** and **capsule vs square**. Remove colour and they still read differently.

## The component

| Export | Use it for |
| --- | --- |
| `MetaChip` | One category label: a key, resolved by the caller. |
| `MetaChipProps` | The props type. |

```tsx
import { MetaChip } from '@platform/ui/components/meta-chip'

<MetaChip labelKey="macro.rates" resolveText={t} />
```

Source: `platform/ui/components/meta-chip/`. **Basis: self-implemented.** There is no antd primitive
for a neutral, non-interactive category label — `Tag` is a chip *family* with colour presets, a close
affordance and a different size vocabulary, and this component is one 18 px neutral span. The look is
defined in the prototype `docs-private/05-desktop/ui-audit/prototypes/2026-11-02-toast-metachip.html` ②.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `labelKey` | `string` | yes | The category name, **as a key**. |
| `resolveText` | `(key: string) => string` | yes | Your resolver. Unknown keys return an empty string; the component never falls back to the key name. |

There is deliberately **no** `tone`, `color`, `icon`, `onClick`, `onSelect`, `disabled`, `children` or
`size`. A category does not carry colour (text is the distinction), and a chip that reacts to a click
is a button — use `IconButton`/`Button`; a filter is `Segmented`.

### Rules for call sites

- **Length:** at most 8 CJK characters / 16 characters. Longer means it is a sentence, not a
  category; the chip does not truncate or wrap.
- **One row, up to five.** Beyond five, wrap onto the next line; never collapse into “+3”.
- **Spacing 6, vertically centred.** Put the chips in a flex row with `gap: 6px` and
  `align-items: center`. Next to a `StatusPill` (18 vs 20.5 high) centre alignment is the rule —
  top alignment makes the two rows of text sit off each other.
- **No tooltip on a chip.** If the text does not fit, the text is not a category; use body copy or a
  description instead of a hover.
- **Every chip has a key.** The component holds no copy and imports no i18n.
- **Not for status or counts.** Those are `StatusPill` and `CountBadge`; “translated / untranslated”
  and sentiment direction are their own labels, not chips.
