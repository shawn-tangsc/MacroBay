[English](./toast.md) | [中文](./toast.zh-CN.md) | [← Docs](../README.md)

# Toasts

A sentence after an action renders through `ToastHost` + `useToast()` from
`@platform/ui/components/toast`. A message that needs a decision is a `Modal`, not a toast.

Mount the host **once per render root** (main window and each detached window); a toast cannot appear
in a window that has no host.

### API

| Export | Use it for |
| --- | --- |
| `ToastHost` | The queue and the region. Mount once, around your tree. |
| `useToast()` | `success` / `info` / `danger`. Throws when no host is mounted. |
| `TOAST_CLOSE_KEY` | `ui.toast.close` — the close control's name. |

| Call | Duration | Notes |
| --- | --- | --- |
| `toast.success({ titleKey, descKey?, action? })` | 3s | |
| `toast.info({ ... })` | 3s | |
| `toast.danger({ titleKey, action })` | 6s | `action` is **required by the type**: a failure the reader can only read about is half a message. |

## Rules the component enforces

- **At most two on screen.** A third evicts the oldest instead of queueing, and eviction never takes
  focus — the reader may be typing in a dialog.
- **Hover or focus pauses; leaving resumes the remaining time**, not a fresh duration. Restarting the
  clock would quietly give the reader three more seconds and no test would notice.
- **The region is click-through** (`pointer-events: none`), only each toast is interactive. The
  bottom-right block is invisible; leaving it interactive covers the page's own buttons.
- **Layer 1600, above dialogs** (the drawer layer is 1500). A hint that appears after the reader
  closes a dialog must not be hidden by it. The layer is not a prop.
- **Announced politely**: `role="status"` with `aria-live="polite"`, never `alert`, and it never
  steals focus.
- **The close control is the component's**, named from its own copy table — a caller's resolver may
  return an empty string, and an empty name is a nameless button.

## How to verify a page that uses it

1. Trigger a success: it appears bottom right and leaves after about 3s.
2. Hover it just before it would leave: it stays; move away and it leaves after the remainder.
3. Trigger three in a row: only two exist, the oldest is gone, and focus never moves.
