[English](./disabled-hint.md) | [中文](./disabled-hint.zh-CN.md) | [← Docs](../README.md)

# Disabled controls and their reason

A disabled control must say why, in visible text next to it. `DisabledHint` from
`@platform/ui/components/disabled-hint` renders that reason and links it to the control. A control
that is only greyed out tells the reader "there was something here" and then refuses to say what.

## Which case this covers — and the one it does not

This component covers exactly one situation: **the capability exists but an external condition is
blocking it right now.** The notification channel is the model case — it really is there, the system
has not allowed it, and the reader can go and change that.

It does **not** cover "this build does not have it". A capability that does not exist is not
rendered at all — no row, no switch, no reason. Explaining why a control that should not be on screen
cannot be used is how a greyed-out placeholder becomes permanent, and a permanently dead switch is
the same thing as an icon button with no handler: it tells the reader something is there when
nothing is.

The distinction has a compile-time consequence at the call site: a `wired: false` channel has no
reason copy (there is no row to explain), and a `wired: true` channel that is currently unavailable
must have one.

## Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `labelKey` | `K extends string` | yes | The reason, **as a key**. |
| `resolveText` | `(key: K) => string` | yes | The caller's resolver. An empty string means this layer does not exist. |
| `children` | `ReactElement` | yes | The disabled control. |

```tsx
<DisabledHint labelKey="notifications.desktopBlockedReason" resolveText={t}>
  <Switch checked={false} disabled />
</DisabledHint>
```

## What the component guarantees

- **Visible text and `aria-describedby`, both.** Linking without showing leaves mouse users in the
  dark; showing without linking means a screen reader reaches the control and hears nothing about
  why it cannot be used. `role="note"` alone is not enough for the same reason — it announces a note
  that nobody navigates to.
- **The reason sits in the same view as the control**, on its left within one row. The right side is
  the control area and a sentence there gets squeezed.
- **When the row is too narrow, the reason wraps below the control** — still next to it, never back
  to the other column, because moving it there would read as "this explains the row", not "this is
  why the control is off". Visual order comes from `flex-direction: row-reverse`; the DOM keeps the
  control first, so a screen reader and the tab order see the control before the reason.
- **Never a hover hint.** A disabled control cannot receive focus, so a tooltip on it would be
  mouse-only. That is why this is a component and not a temporary workaround: "a disabled control
  must not explain itself on hover" does not change with the component.
- **The component caches nothing.** It takes a key, not a verdict. Whether the reason still applies
  is computed by the caller on every render.

## The reason must be recomputed, not remembered

The reader's path is: see "the system has not allowed notifications" → open System Settings → allow
it → come back to the app. If the reason is still there when they return, they conclude the setting
did not take effect and go change it again.

So the reason for this case **must not be a value computed once at startup**. Recompute it when the
window regains focus, or when the runtime already emits a change event. Do not add a timer for it:
a settings page that re-reads permission every five seconds looks like software watching what you do,
and it pays a continuous cost for a value only an external change can alter. The rule is the same as
the one that keeps business code out of `setInterval`: use the events the platform already has, and
add an event only when one is missing.

One criterion: **the reason is a question — "does this still apply?" — not a record — "this was once
so."**

## Copy

The sentence describes the reader's situation, not the action they should take:

- Correct: `先选一个助手，才能新建会话` / "Choose an assistant to start a session."
- Wrong: `点击不可用` / "This action is unavailable." — that explains why the button is grey, which
  the reader already saw.

The action belongs in the sentence when there is nothing to click. When there is a real next step,
that is a separate control, not a longer sentence.

## How to verify

1. Tab to the control: a screen reader announces the reason along with the control.
2. The reason is visible without hovering and sits on the same line as the control.
3. Let the external condition change (allow the permission, then return): the reason disappears
   without a reload.
4. `resolveText` returning an empty string leaves neither a reason nor a dangling
   `aria-describedby`.
