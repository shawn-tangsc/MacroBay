[English](./tabs.md) | [中文](./tabs.zh-CN.md) | [← Docs](../README.md)

# Tabs

Use `Tabs` from `@platform/ui/components/tabs` when **switching swaps a whole block of content**.
When the same block keeps its place and only one value changes, use `Segmented` instead. The two are
not one component with a `mode` switch: their interaction, ARIA and keyboard differ, and a boolean
would only hide that.

**One definition, one page.** `ChoiceItem` and the stale-`value` fallback (`useChoiceValue`) are
described here, and only here; `segmented.md` points back to this page instead of repeating them.
Changing the shape of `ChoiceItem` or the fallback rule means editing **both** documents in the same
change — a page that silently describes the old shape is worse than a missing page.

## The component

| Export | Use it for |
| --- | --- |
| `Tabs` | One tablist plus one mounted panel per tab. |
| `TabsProps` | The props type. |
| `ChoiceItem` | `{ value, labelKey, disabled? }` — shared with `Segmented`. **Its authoritative definition is here**, in this page. |

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
  panels={{ sources: <Sources />, storage: <Storage /> }}
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
| `panels` | `Readonly<Record<string, ReactNode>>` | yes | One panel per tab, keyed by `value`. **Every panel is mounted**; the inactive ones get the native `hidden` attribute. Loading, empty and error live inside their panel. Without panels this is not a `Tabs` — use `Segmented` or drop the tabs. |

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
- **Every panel stays mounted; the inactive ones are `hidden`.** Switching away and back keeps the
  other half's conversation, its selected timeline entry and its drag width. The inactive panel
  carries the native `hidden` attribute, which leaves both the layout and the accessibility tree —
  `aria-hidden` alone would only hide it from assistive technology, and hand-written `display: none`
  is how the two drift apart.
- **Mounted is not running.** The component mounts panels and wires reachability; it does not pause
  timers, polling or subscriptions inside a hidden panel, and it deliberately offers **no
  visibility callback**. The caller already holds `value` and decides for itself. A component that
  guessed which panel "should stop" would teach callers not to decide.
- **Panels keep their own state.** The component does not derive panel content from props, so an
  inactive panel keeps whatever the reader left in it — that is the point of keeping it mounted.

## How to verify a page that uses it

1. **Keyboard**: ←→ switch and move focus with the selection; Home/End reach the ends.
2. **Reader**: the selected tab is announced once, and the panel is tied to it both ways.
3. **Disabled**: skipped by Tab and by arrows, no tooltip.
4. **Overflow**: the strip scrolls sideways; nothing folds into a "more" menu.
