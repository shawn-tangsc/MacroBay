[English](./modal.md) | [中文](./modal.zh-CN.md) | [← Docs](../README.md)

# Modals

A modal dialog with a form or long content renders `Modal` from
`@platform/ui/components/modal`. Confirmation dialogs (one sentence, a dangerous button) are
`confirmAction`, not this component.

Width is a closed set, not a number: `compact` 420 / `standard` 520 / `expanded` 720 / `maximum` 860.
The names are deliberately neither the `StateSize` density words nor the `Drawer` width words, because
both would make a wrong assignment compile. The call-site inventory is in
`docs-private/05-desktop/ui-audit/modal-call-site-requirements-2026-11-02.md`.

## The component

| Export | Use it for |
| --- | --- |
| `Modal` | One dialog: title or screen-reader name, a footer slot, children. |
| `ModalProps` | The props type. |
| `MODAL_WIDTHS` | The closed set: `['compact', 'standard', 'expanded', 'maximum']`. |
| `ModalWidth` | The same four words. |
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
| `width` | `ModalWidth` | yes | `compact` 420, `standard` 520, `expanded` 720, `maximum` 860. No default: every call site answers once. |
| `onClose` | `() => void` | yes | Shared by the mask, Escape and the close control. |
| `titleKey` | `string` | one of the two | The visible title, **as a key**. A literal sentence is not accepted. |
| `titleParams` | `Readonly<Record<string, string>>` | no | Values for the title's `{name}` placeholders. Formatted strings only (`3 items`, `10–2`); a missing value stays visible as `{name}`. |
| `ariaLabelKey` | `string` | one of the two | Required when there is no visible title. The two are exclusive in the type: a dialog with neither has no accessible name. |
| `footer` | `ReactNode` | no | The action row. **Not passing it renders no footer at all** — the component does not add Save/Cancel. Buttons belong to the caller. |
| `children` | `ReactNode` | yes | The dialog body. Loading and empty states use `LoadingState` / `StateView` inside it. |
| `className` | `string` | no | Your own class, for tests and legacy names. It cannot set a width. |
| `align` | `'top' \| 'center'` | no, default `top` | Two shapes, not a switch: a task at the top edge, or centred on screen. |
| `layer` | `'base' \| 'over-drawer'` | no, default `base` | The dialog sits in the normal layer or above a drawer. The z-index numbers live inside the component. |
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
- **Two alignments, no `centered` boolean.** `align` is a closed set; `top` matches antd's default,
  `center` is the model-service family. They are two shapes, not one switch.
- **Layering is a word, not a number.** `layer: 'over-drawer'` raises the dialog above a drawer;
  the concrete z-index stays in one table in the component, so no call site passes a number.
- **Titles that are runtime data go through `titleParams`.** A skill or template name is a formatted
  value inside a key's `{name}` template, not a sentence handed to the component.

### Motion

Per `docs-private/05-desktop/ui-audit/ui-motion-spec-2026-11-02.md` the dialog arrives with opacity
plus a 4 px rise rather than a scale. The motion override lands with the dialog spec; until then the
component keeps antd's default and the tier work has not started.

### Migration note

The 15 existing dialogs used 420 / 460 / 520 / 680 / 720 / 860. `460` becomes `standard` 520 and `680`
becomes `expanded` 720, so no dialog gets narrower. Two of the 15 are confirmation dialogs and belong
to `confirmAction`; the self-drawn two-line title in model detection stays an explicit exception.
