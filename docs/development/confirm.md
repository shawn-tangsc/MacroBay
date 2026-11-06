[English](./confirm.md) | [中文](./confirm.zh-CN.md) | [← Docs](../README.md)

# Confirmation dialogs

Before something irreversible, ask once. Render `ConfirmProvider` at the root of every render root,
then call `useConfirm()` where the action happens.

```tsx
const confirm = useConfirm()
confirm({
  title: t.deleteTitle,
  description: t.deleteConsequence,
  confirmLabel: t.delete,
  cancelLabel: t.cancel,
  tone: 'danger',
  onConfirm: () => deleteIt()
})
```

## Where it renders, and why that is the whole point

The dialog is created by `Modal.useModal()` inside `ConfirmProvider`, and the provider's
`contextHolder` sits **inside the tree**. That is what makes it inherit the surrounding
`ConfigProvider` — theme, locale, button config. A static `Modal.confirm` mounts outside React and
takes antd's default theme, which is why a dark window used to show a pale dialog.

Two rules follow from it:

- **Every render root mounts the provider.** The main window and each detached window are separate
  roots; a detached window cannot inherit the main window's provider. That is where this bug appeared.
- **There is no fallback.** `useConfirm()` without a provider throws, and so does the legacy
  `confirmAction()`. A silent fallback is how the pale dialog survived: it kept working, with the
  wrong theme, and raised nothing.

`confirmAction()` remains for the call sites that have not migrated; it renders through the instance
registered by the nearest provider, so it is themed too. New code uses `useConfirm()`.

## Failure handling: a trade-off, not an oversight

`onOk` **absorbs a failure and the dialog closes**; the caller shows the reason inline (all call
sites already do). Focus returns to the button that opened the dialog.

The alternative was keeping the dialog open for an in-place retry. `isSilent` — the flag that keeps
antd from re-throwing a rejected handler — is not honoured on the `useModal()` instance (measured:
the callback was never called). The rejection therefore re-throws along antd's own chain and surfaces
as a process-level unhandled rejection, which makes the test phase exit non-zero. **A leaked rejection
costs more than an in-place retry**: the first pollutes logs and blocks the gate, the second costs one
extra click. Reverting this needs a different dialog implementation, not a flag.

## Copy and behaviour

- No internal strings. `title`, `confirmLabel`, `cancelLabel` are required; `tone` is required so each
  call site answers "can this be undone?".
- `tone: 'danger'` puts the initial focus on **cancel** — holding Enter must not run a destructive
  action twice.
- The dialog is not a message box and not a receipt: it exists for a choice with two outcomes.

## Testing components that use it

Use `renderWithConfirm` from `platform/ui/components/confirm/confirmTestSupport`. One entry point:

```tsx
const view = renderWithConfirm(<MyPage />)
view.clickDialogButton('Delete')
await view.unmount()
```

Hand-rolling the provider wrapper in each test file is how sixteen tests failed at once — the shared
premise got duplicated and one copy was missing.
