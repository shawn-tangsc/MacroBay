[English](./side-panel.md) | [中文](./side-panel.zh-CN.md) | [← Docs](../README.md)

# Side panels

A panel that appears **beside** the content and makes it narrower uses `SidePanel` from
`@platform/ui/components/side-panel`. If it covers the content with a mask, it is a `Drawer`.

The test in one line: **can the reader still see and click the main content while it is open?**
Yes → `SidePanel`. No → `Drawer`.

| Export | Use it for |
| --- | --- |
| `SidePanel` | One standing panel, two sizes, one collapse control. |
| `SIDE_PANEL_SIZES` | `['rail', 'flex']`. |
| `PANEL_COLLAPSE_KEY` | `ui.panel.close`, the collapse control's name. |

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `open` | `boolean` | yes | Closed renders nothing at all. |
| `onClose` | `() => void` | yes | The collapse control. Returning focus to the trigger is the caller's job. |
| `size` | `'rail' \| 'flex'` | yes | `rail` 282 fixed; `flex` `min(480px, 46vw)` — the ratio lives in the component. |
| `titleKey` | `string` | yes | The panel's heading, as a key. |
| `footer` | `ReactNode` | no | Bottom actions. Not passing it renders no row. |
| `children` | `ReactNode` | yes | Body; the only scrolling region. |
| `resolveText` | `(key: string) => string` | yes | The caller's resolver, for `titleKey`. |

## Rules the component enforces

- **No mask, no focus trap, no global Esc.** The reader is expected to move between the panel and
  the page; stealing Esc would fight the page's own Esc.
- **Two sizes only, and no pixels from call sites.** `flex` keeps its `46vw` cap internally.
- **The collapse control belongs to the component**, named from its own copy table — a resolver may
  return an empty string for an unknown key, and an empty name is a nameless button.
- **Width never animates.** Only a 120 ms opacity fade, off entirely under `prefers-reduced-motion`.
