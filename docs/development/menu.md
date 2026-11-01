[English](./menu.md) | [中文](./menu.zh-CN.md) | [← Docs](../README.md)

# Menus

Right-click and context menus render `ContextMenu` from `@platform/ui/components/menu`. A menu row
is neither a button nor a clickable list row: it is a menu item, and there is exactly one
implementation of one.

This exists because three surfaces each drew their own menu — their own positioning, their own
outside-click handler, their own Esc handling — and only some of them could be reached from the
keyboard.

## The component

| Export | Use it for |
| --- | --- |
| `ContextMenu` | A menu opened at a viewport point: right-click, Shift+F10, a "more" caret. |
| `MenuItem` | One row: `{ key, labelKey, disabled?, tone? }`. |
| `MENU_TONES` | The closed set: `['default', 'danger']`. |
| `MenuAnchor` | `{ x, y }` in viewport coordinates. |

```tsx
import { ContextMenu, type MenuItem } from '@platform/ui/components/menu'
```

Source: `platform/ui/components/menu/`.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `open` | `boolean` | yes | When false the component renders nothing at all. |
| `anchor` | `MenuAnchor \| null` | yes | Where to open, in viewport coordinates. |
| `items` | `readonly MenuItem[]` | yes | The rows, in order. |
| `onSelect` | `(key: string) => void` | yes | Receives the item's `key`, never its index. |
| `onClose` | `() => void` | yes | Called on Esc, outside click, and after a selection. |
| `ariaLabelKey` | `string` | yes | The menu's accessible name, as an i18n key. A context menu has no trigger to borrow a name from. |
| `resolveText` | `(key: string) => string` | yes | The caller's text resolver; the component holds no copy and imports no i18n. |
| `className` | `string` | no | Positioning extras only; never restyle the internals. |

`MenuItem` is `{ key, labelKey, disabled?, tone? }`: `key` is what comes back from `onSelect`,
`labelKey` is a key (a literal sentence does not compile), and `tone: 'danger'` is the only way to
mark a destructive row — call sites cannot pass a colour.

## What is wrapped and what is ours

**The list is antd's `Menu`, not a second implementation.** Items, selected state, `danger` styling,
and the arrow / Home / End / Enter keyboard model all come from antd, which is what makes this a thin
wrapper rather than a fourth menu in the codebase.

Ours are the three things antd's `Menu` does not do on its own:

1. **Point anchoring.** `Dropdown` anchors a popup to a trigger element. A right-click has no
   trigger — it has an `(x, y)` — so the component renders into a portal and positions itself.
2. **Viewport clamping.** After measuring, it pulls itself back inside the window, so a right-click
   near the bottom edge does not open half off-screen.
3. **Dismissal.** Esc, a click outside, or a selection closes it and tells the caller, which is what
   keeps the trigger's `aria-expanded` and the focus return in the caller's hands.

It renders through `createPortal` into `document.body`: drawers and lists scroll with `overflow`,
and a menu rendered in place would be clipped.

## Usage

```tsx
// Correct: point, items, key back.
const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

<ContextMenu
  open={menu !== null}
  anchor={menu}
  ariaLabelKey="ui.menu.row-actions"
  items={[
    { key: 'translate', labelKey: 'ui.menu.translate' },
    { key: 'delete', labelKey: 'ui.menu.delete', tone: 'danger' }
  ]}
  onSelect={(key) => {
    if (key === 'translate') void translate()
    if (key === 'delete') void remove()
  }}
  onClose={() => setMenu(null)}
  resolveText={t}
/>

// Wrong: a hand-written row, a literal label, a colour prop, an index callback.
<div role="menu">
  <button role="menuitem" onClick={() => pick(0)}>Delete</button>
</div>
```

## Migrating a hand-written menu

| Where | Now | Becomes |
| --- | --- | --- |
| `apps/desktop-shell/src/renderer/src/shell/workspace/WorkspaceTabMenu.tsx` (used by `WorkspaceTabStrip`) | Self-drawn `role="menu"` + own keyboard model | `ContextMenu` with the Tab's viewport rect as `anchor` |
| `apps/desktop-shell/src/renderer/src/shell/model-service/ProviderRowContextMenu.tsx` | Self-drawn fixed-position menu with its own clamp | `ContextMenu`, anchor from the `contextmenu` event |
| `apps/desktop-shell/src/renderer/src/shell/model-service/ModelServiceProviderMoreMenu.tsx` | Self-drawn `role="menu"` list | `ContextMenu`, anchor from the trigger's rect |
| `products/market-intelligence/desktop/features/industry/news-sentiment/NewsSentimentDrawer.tsx` (`mi-news-drawer__context`) | Self-drawn `role="menu"` with hand-written items | `ContextMenu`, anchor from the `contextmenu` event |

Already-antd `Dropdown` surfaces keep working and are **not** rewritten in place — they are wrapped
by their trigger, not point-anchored, so they are not what this component replaces. When one of them
needs a shared row model, it should consume `MenuItem` rather than grow a fifth shape:
`AssistantSidePanel`, `WorkspacePanelToolbar`, `SessionItem`, `AgentMessageFileArtifacts`,
`OpenExternalAppButton`, `SelectionContextMenu`.

Migration is each owning line's work: this component lands first, call sites switch afterwards, and
the old component is deleted in the change that removes its last caller.

## How to verify a menu

1. **Keyboard**: Shift+F10 or right-click opens it, focus lands on the first enabled row, arrows
   move, Esc closes and focus returns to where it was.
2. **Key, not index**: the handler receives `key`; reordering `items` must not change what an entry
   does.
3. **Danger**: the destructive row is the token colour, and the call site has no colour prop.
4. **Edges**: open it near the right and bottom edges; the whole menu stays inside the window.
5. **Copy**: every row's text comes from a key; grep the call site for literal sentences.
