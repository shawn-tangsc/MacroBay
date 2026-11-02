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
| `focusPolicy` | `'move-in' \| 'stay'` | no, default `move-in` | `move-in` for a panel the reader opened with a button; `stay` when the panel only follows a selection in a list. |
| `contentId` | `string` | with `focusPolicy="stay"` | The stable id of what the panel currently shows. **Required on that branch**: without it the component cannot tell a re-render from a real change. |

## Rules the component enforces

- **No mask, no focus trap, no global Esc.** The reader is expected to move between the panel and
  the page; stealing Esc would fight the page's own Esc.
- **Two sizes only, and no pixels from call sites.** `flex` keeps its `46vw` cap internally.
- **The collapse control belongs to the component**, named from its own copy table — a resolver may
  return an empty string for an unknown key, and an empty name is a nameless button.
- **Width never animates**, and the arrival fade reads `--motion-enter` — the component holds no
  duration literal. `tokens.css` zeroes every `--motion-*` under `prefers-reduced-motion`, in one
  place, so there is no second media query here.
- **Focus follows the reader's intent, not a boolean.** `move-in` moves focus into the body and
  returns it on close; `stay` moves nothing, because the reader is walking a list and being pulled
  into the panel on every selection would make three events impossible to compare.
- **`stay` announces, because a still focus says nothing.** With focus parked, a screen-reader user
  who selects the next item would hear nothing; the panel announces the new title once, politely,
  debounced 400 ms and deduplicated **by `contentId`, never by title** — two sessions both named
  "FOMC meeting" in one slot would otherwise stay silent on the second, so a burst of changes lands
  as one sentence rather than three.
  `move-in` has no live region at all - its focus move already speaks.
- **Focus goes back where it came from.** The component remembers what had focus when it opened and
  restores it on close; a caller does not have to (three call sites would each forget differently).
