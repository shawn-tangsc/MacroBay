[English](./tabs.md) | [中文](./tabs.zh-CN.md) | [← Docs](../README.md)

# Tabs

Use `Tabs` from `@platform/ui/components/tabs` when **switching swaps a whole block of content**.
When the same block keeps its place and only one value changes, use `Segmented` instead. The two are
not one component with a `mode` switch: their interaction, ARIA and keyboard differ, and a boolean
would only hide that.

## The component

| Export | Use it for |
| --- | --- |
| `Tabs` | One tablist plus its panel. |
| `TabsProps` | The props type. |
| `ChoiceItem` | `{ value, labelKey, disabled? }` — shared with `Segmented`. |

```tsx
<Tabs
  items={[
    { value: 'sources', labelKey: 'settings.tabs.sources' },
    { value: 'storage', labelKey: 'settings.tabs.storage' }
  ]}
  value={tab}
  onChange={setTab}
  ariaLabelKey="settings.tabs.group"
  resolveText={t}
  panel={tab === 'sources' ? <Sources /> : <Storage />}
/>
```

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `items` | `ChoiceItem[]` | yes | The tabs. `value` is a stable identifier, **never an index**. |
| `value` | `string` | yes | The selected tab's `value`. |
| `onChange` | `(value: string) => void` | yes | Emits the new `value`. |
| `ariaLabelKey` | `string` | yes | The tablist's accessible name, **as a key**. |
| `resolveText` | `(key: string) => string` | yes | The caller's resolver. |
| `panel` | `ReactNode` | yes | The selected panel. Loading, empty and error live inside it. Without a panel this is not a `Tabs` — use `Segmented` or drop the tabs. |

## Rules the component enforces

- **Ids are the component's.** `aria-controls` and `aria-labelledby` are generated with `useId` and
  pointed at each other; call sites never pass ids, so the two ends cannot drift apart.
- **Exactly one `aria-selected="true"`.**
- **Keyboard**: arrow keys switch immediately (this interaction *is* "show me the other block"),
  Home/End jump to the first and last tab.
- **Disabled tabs** leave the tab order and are skipped by the arrows. They carry no tooltip — a
  disabled control takes no focus.
- **The tab strip never shows a spinner.** Loading/empty/error belong to the panel.
- **A stale `value` still leaves the group reachable.** If `value` is not in `items` (an item was
  added or removed), the first enabled tab takes the keyboard entry and the component calls
  `onChange(firstEnabled)` **once**, in an effect, keyed by the stale value. Showing A while the
  caller still holds B would let a later save or export act on B.
- **`panel` must derive from the same `value`.** Between the fallback callback and the caller's
  re-render the panel may still show the old content; that frame is the caller's obligation, not
  something the component can fix.

## How to verify a page that uses it

1. **Keyboard**: ←→ switch and move focus with the selection; Home/End reach the ends.
2. **Reader**: the selected tab is announced once, and the panel is tied to it both ways.
3. **Disabled**: skipped by Tab and by arrows, no tooltip.
4. **Overflow**: the strip scrolls sideways; nothing folds into a "more" menu.
