[English](./drawer.md) | [中文](./drawer.zh-CN.md) | [← Docs](../README.md)

# Drawers

A side panel that slides over a page renders `Drawer` from `@platform/ui/components/drawer`. Do not
import antd `Drawer` directly, and do not hand-write widths.

The component wraps antd `Drawer` — focus trap, scroll lock, portal, mask, Esc and focus restore are
its job, not ours — and fixes the three things that had drifted across 16 call sites: the width, the
header, and the close control.

If closing the drawer can discard what the reader typed, the close behaviour is a matrix, not a
sentence: see [Closing a container that holds unsaved input](unsaved-changes.md).

## The component

| Export | Use it for |
| --- | --- |
| `Drawer` | One drawer: four sizes, two modes, three slots. |
| `DRAWER_SIZES` | The closed set: `['narrow', 'large', 'wide', 'full']`. |
| `DrawerSize` | `'narrow' \| 'large' \| 'wide' \| 'full'`. |
| `DrawerMode` | `'modal' \| 'inline'`. |
| `DrawerSide` | `'left' \| 'right'` — only meaningful for `mode="inline"`. |
| `DRAWER_CLOSE_KEY` | `ui.drawer.close`: the platform screen-reader name of the close control. |

```tsx
import { Drawer } from '@platform/ui/components/drawer'
```

Source: `platform/ui/components/drawer/`. Visual spec:
`docs-private/05-desktop/ui-audit/prototypes/2026-11-02-drawer-four-sizes.html`.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `open` | `boolean` | yes | Whether the drawer is on screen. |
| `onClose` | `() => void` | yes | Mask click, Esc (modal only) and the close control. |
| `size` | `DrawerSize` | yes | `narrow` 420, `large` 640, `wide` 860, `full` 1040. No default: every call answers it. |
| `mode` | `'modal' \| 'inline'` | no, default `modal` | `modal` has a mask, locks focus and closes on Esc; `inline` sits in the page flow. |
| `side` | `'left' \| 'right'` | no, default `right` | Only for `mode="inline"`. Modal drawers are always right. |
| `header` | `'titled' \| 'none'` | no, default `titled` | A titled header, or no header at all. |
| `titleKey` | `string` | with `header="titled"` | Header text, **as a key**. |
| `titleParams` | `Readonly<Record<string, string>>` | no | Values for `{name}` placeholders in the title. **Already formatted** strings only (`3`, `10–2`). |
| `ariaLabelKey` | `string` | with `header="none"` | The screen-reader name a headless drawer still needs. |
| `titleExtra` | `ReactNode` | no | Badge or action beside the title. Not a custom-header entry. |
| `footer` | `ReactNode` | no | Bottom action row. **Not passing it renders no row at all.** |
| `contentPadding` | `'default' \| 'flush'` | no, default `default` | `flush` for full-bleed content. |
| `children` | `ReactNode` | yes | Body. |
| `className` | `string` | no | Positioning only; it must not carry a width or layout. |
| `resolveText` | `(key: string) => string` | yes | The caller's text resolver, used for `titleKey` only. |

The width is `min(<size>px, 92vw)` inside the component. There is no `width`, no `style`, no
`styles`, no `mask`, no `closable`, no `placement` and no `getContainer`: each of those is how the
same drawer grew a twelfth width.

### Sizes

| `size` | Pixels | Use it for |
| --- | --- | --- |
| `narrow` | 420 | Settings panels, single-column forms |
| `large` | 640 | Two-column detail, inspectors |
| `wide` | 860 | Agent configuration, dashboard panels |
| `full` | 1040 | The widest immersive panel |

### Pass-through list

Only properties that change **when the content exists** are passed through; anything that changes
what it looks like belongs in the spec instead of being threaded through per call site.

| Prop | Why it exists |
| --- | --- |
| `destroyOnHidden` | Some drawers hold detail and filter state that must not survive closing. Undefined by default, so antd's own default applies and nothing implicit is added. |

`afterOpenChange` is deliberately **not** offered: no consumer needs it, and it does not answer the
lifecycle question — whether the content exists is unaffected by it.

## Rules the component enforces

- **The close control is the component's.** It renders `IconButton` with `ui.drawer.close`, resolved
  from the component's own copy table (`drawerText.ts`) — not through your `resolveText`. That is
  deliberate: a resolver may return `''` for an unknown key, and an empty name leaves a button with
  no accessible name. The title still goes through your resolver.
- **Mask and focus lock belong to `modal`.** It dims the page, locks focus and lets antd handle Esc;
  no boolean controls any of the three.
- **`inline` stays out of the focus model.** Opening it **moves no focus** (the reader is working on
  the page; pulling them into the panel loses their place), it locks nothing and draws no mask, and
  while it is open Esc is listened for on the document so it closes even when focus is elsewhere.
  Closing leaves focus where it was. These are fixed per mode, not call-site switches.
- **No footer means no footer row** — not an empty wrapper kept for spacing.
- **Two header states only.** `header="none"` still requires `ariaLabelKey`: an unnamed dialog is
  announced as "dialog".

## How to verify a page that uses it

1. **Width**: in DevTools the content wrapper resolves to the size's pixels, and never to a value
   you passed in. On a narrow window it caps at `92vw`.
2. **Close**: the top-right control is keyboard reachable and its announced name is
   "关闭抽屉" / "Close drawer" — not a key, not empty.
3. **Mode**: a `modal` drawer darkens the page and closes on Esc; an `inline` drawer has no mask and
   does not trap focus.
4. **Footer**: a drawer with no footer shows no empty strip at the bottom.
