[English](./filter-chip.md) | [中文](./filter-chip.zh-CN.md) | [← Docs](../README.md)

# Filter chips

A multi-select filter — a condition that narrows a list — renders `FilterChip` from
`@platform/ui/components/filter-chip`. The boundaries are deliberate:

| Need | Component |
| --- | --- |
| Several filters can be on at once | `FilterChip` |
| One value out of a set, same content | `Segmented` |
| A status word | `StatusPill` |
| A category label that is not a control | `MetaChip` |
| A row with a selected state | none of these — a row is not a chip |

**Basis: antd `Button`.** Keyboard, `type="button"`, disabled and focus come from the library; the
look stays ours (24 high, pill radius, `aria-pressed`-driven selection). Source:
`platform/ui/components/filter-chip/`.

## `FilterChip`

```tsx
import { FilterChip, FilterChipGroup } from '@platform/ui/components/filter-chip'

<FilterChipGroup ariaLabelKey="models.categories" resolveText={t}>
  <FilterChip labelKey="models.category.llm" count="12" pressed={categories.includes('llm')}
    onPressedChange={(next) => toggleCategory('llm', next)} resolveText={t} />
</FilterChipGroup>
```

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `labelKey` | `string` | yes | The filter name, **as a key**. |
| `count` | `string` | no | An **already formatted** count (`3`, `1.2k`). Rendered to the right of the label; the component does not format it again. |
| `pressed` | `boolean` | yes | Whether the filter is on. |
| `onPressedChange` | `(pressed: boolean) => void` | yes | Receives the **next value**. The component negates once; call sites do not re-derive it. |
| `disabled` | `boolean` | no | Disabled. The reason must be **visible next to the chip**; the component offers no tooltip — a disabled element cannot take focus, so a hover-only reason is invisible to keyboard readers. |
| `resolveText` | `(key: string) => string` | yes | Your resolver; unknown keys return an empty string. |
| `dataAttributes` | `Record<\`data-${string}\`, …>` | no | Test hooks and state flags (`data-model-picker-category`). Only `data-*` keys; anything else throws at mount. |

There is no `icon`, `tone`, `color`, `className` or `style`: an icon would need a second explanation
(“what does this glyph mean”), and a series colour is data semantics that belongs to the legend, not
to a filter.

## `FilterChipGroup`

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ariaLabelKey` | `string` | yes | The group's accessible name, **as a key**. Without it a reader hears only “group”. |
| `resolveText` | `(key: string) => string` | yes | The same resolver. |
| `children` | `ReactNode` | yes | The chips. |

## Selected state: one source

The selected look is written **only** as `[aria-pressed='true']`. There is no `.on` class and no
`data-active`: two ways to draw “selected” is two facts that drift, and the failure mode is a chip
that looks on while the reader is told it is off.

`opacity` is reserved for `disabled`. A “not selected” chip is not greyed out — grey means
unavailable, and readers who see grey stop trying.

## Rules for call sites

- **Height is 24**, radius 999. Do not resize per page.
- **Count on the right**; formatted by the caller. If it needs plural rules, format the sentence
  before passing it.
- **A disabled chip needs a visible sentence** — “at least one series must stay visible” — not a
  tooltip.
- **No icon, no series swatch.** Those belong to the chart legend.
