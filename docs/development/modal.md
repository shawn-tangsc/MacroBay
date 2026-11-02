[English](./modal.md) | [中文](./modal.zh-CN.md) | [← Docs](../README.md)

# Modals

A modal dialog with a form or long content renders `Modal` from
`@platform/ui/components/modal`. Confirmation dialogs (one sentence, a dangerous button) are
`confirmAction`, not this component.

**Status: skeleton — not yet callable.** The width tiers, `centered`, layering and runtime-data
titles are still open decisions; the call-site inventory and the open questions are in
`docs-private/05-desktop/ui-audit/modal-call-site-requirements-2026-11-02.md`. Do not migrate call
sites until those are decided: without a width tier the dialog would silently keep antd's 520 px.

## The component

| Export | Use it for |
| --- | --- |
| `Modal` | One dialog: title or screen-reader name, a footer slot, children. |
| `ModalProps` | The props type. |
| `MODAL_CLOSE_KEY` | `ui.modal.close` — the platform name of the close control. |

```tsx
import { Modal } from '@platform/ui/components/modal'
```

Source: `platform/ui/components/modal/`. **Basis: antd `Modal`.** The mask, focus trap, scroll
lock, Escape handling and focus return all come from the library; the component does not write a
second one.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `open` | `boolean` | yes | Whether the dialog is shown. |
| `onClose` | `() => void` | yes | Shared by the mask, Escape and the close control. |
| `titleKey` | `string` | one of the two | The visible title, **as a key**. A literal sentence is not accepted. |
| `ariaLabelKey` | `string` | one of the two | Required when there is no visible title. The two are exclusive in the type: a dialog with neither has no accessible name. |
| `footer` | `ReactNode` | no | The action row. **Not passing it renders no footer at all** — the component does not add Save/Cancel. Buttons belong to the caller. |
| `children` | `ReactNode` | yes | The dialog body. Loading and empty states use `LoadingState` / `StateView` inside it. |
| `className` | `string` | no | Your own class, for tests and legacy names. It cannot set a width. |
| `resolveText` | `(key: string) => string` | yes | Your resolver. Unknown keys return an empty string by convention; the component never falls back to the key name. |

### What the component decides, so call sites do not

- **The close control.** It is rendered by the component, with one platform key (`ui.modal.close`,
  “Close dialog” / “关闭弹窗”) resolved from the component's own table. It deliberately does **not**
  go through `resolveText`: a resolver that maps unknown keys to `''` would leave the button with no
  name at all. This is the same rule as `Drawer`.
- **A headless dialog still has a name.** With `ariaLabelKey`, the name is rendered as a visually
  hidden title and the title bar is hidden; the dialog is still announced by its name rather than as
  an unnamed “dialog”.
- **No default footer.** antd renders its own OK/Cancel footer when `footer` is omitted; the
  component passes `null` instead, so “no footer” means no footer.

### Motion

Per `docs-private/05-desktop/ui-audit/ui-motion-spec-2026-11-02.md` the dialog arrives with opacity
plus a 4 px rise rather than a scale. The motion override lands with the dialog spec; until then the
component keeps antd's default and the tier work has not started.

### Not decided yet

Width tiers, `centered`, a layering value for dialogs that must sit above a drawer, and titles that
are runtime data (a skill name) are open. Do not add them here or at a call site before the contract
says which shape they take.
