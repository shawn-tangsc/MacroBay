[English](./segmented.md) | [中文](./segmented.zh-CN.md) | [← Docs](../README.md)

# Segmented

Use `Segmented` from `@platform/ui/components/segmented` when the **same block keeps its place and
one value changes** — a range, a view, a language. When switching swaps a whole block, use `Tabs`.

## The component

| Export | Use it for |
| --- | --- |
| `Segmented` | One group of mutually exclusive values. |
| `SegmentedProps` | The props type. |
| `ChoiceItem` | `{ value, labelKey, disabled? }` — shared with `Tabs`. |

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `items` | `ChoiceItem[]` | yes | The values. `value` is a stable identifier, never an index. |
| `value` | `string` | yes | The current value. |
| `onChange` | `(value: string) => void` | yes | Emits the new value. |
| `ariaLabelKey` | `string` | yes | The group's accessible name, as a key. |
| `resolveText` | `(key: string) => string` | yes | The caller's resolver. |

## Rules the component enforces

- **It is a group of pressed values, not a tablist.** The container is `role="group"` and the chosen
  item is `aria-pressed="true"`; exactly one is pressed.
- **Arrows move focus; Enter or Space selects.** Moving focus must not change the value here — the
  reader is usually comparing two or three options before deciding.
- **Disabled values** leave the tab order and the arrow sequence.
- **Selection reads in grayscale**: the chosen item differs by fill and weight, not by hue.
- **A stale `value` still leaves the group reachable**, and the component calls
  `onChange(firstEnabled)` once, the same rule as `Tabs`.

## How to verify a page that uses it

1. **Keyboard**: ←→ move focus without changing the value; Enter or Space selects.
2. **Reader**: the group has a name and exactly one value is pressed.
3. **Disabled**: skipped by Tab and by the arrows.
4. **Grayscale**: the chosen value is still obvious.
