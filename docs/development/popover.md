[English](./popover.md) | [中文](./popover.zh-CN.md) | [← Docs](../README.md)

# Popovers

A multi-line explanation attached to a trigger renders `Popover` from
`@platform/ui/components/popover`. Do not hand-write a floating panel and do not import antd's
`Popover` directly: both lose the focus and dismissal rules below.

`Tooltip` is the one-line case — a hint the reader scans and leaves. This is for the other case: a
paragraph that needs reading, or something the reader wants to pin and compare while looking at the
page underneath.

## The component

| Export | Use it for |
| --- | --- |
| `Popover` | One explanation panel, attached to one focusable trigger. |
| `PopoverProps` | The props type. |

```tsx
import { Popover } from '@platform/ui/components/popover'
```

**Basis: antd `Popover`.** Positioning, flipping and viewport clamping are the library's; this
component adds the open/close model, the width cap and the focus return.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `labelKey` | `K extends string` | yes | The explanation, **as a key**. `K` is inferred from `resolveText`, so a resolver typed to a key union locks the allowed keys. |
| `resolveText` | `(key: K) => string` | yes | The caller's resolver. An unknown key resolves to an empty string. |
| `children` | `ReactElement` | yes | The trigger. It must be focusable — a button, a link, or something with `tabIndex`. |

There is no `placement`, no `open`, no `onOpenChange` and no arbitrary `content` node: the open
model and the position are fixed behaviour, not call-site options.

## Rules the component enforces

- **Hover and focus both open it.** A reader who tabs in should see it without reaching for the
  mouse; that is the half a tooltip-first design keeps forgetting.
- **Clicking the trigger pins it.** Hover alone cannot hold a paragraph open while the reader looks
  at the page underneath, and the naive fix — passing `['hover', 'focus', 'click']` to antd — closes
  it the moment the mouse leaves, so it never actually pins.
- **A click elsewhere closes it, without stealing focus.** The place the reader clicked is where
  they want to be; moving focus back to the trigger would fight them.
- **Esc closes it and returns focus to the trigger.** Otherwise focus lands on `body` and a keyboard
  reader loses their place.
- **Maximum width 320 px**, text wraps, the page never widens.
- **An empty sentence renders no bubble.** Reading a key name aloud is worse than saying nothing;
  the same rule as `Tooltip`.

## Call-site rule

New code imports this component. The 7 remaining `import { Popover } from 'antd'` sites are a
migration backlog, recorded in `popoverCallSiteGuard.test.ts`; that list only shrinks. Switching one
site means deleting its line in the same change — the guard fails on a stale entry, which is how the
backlog stays honest instead of becoming a permanent exemption.

```tsx
// Correct: key-shaped copy, one focusable trigger.
<Popover labelKey="pages.intelligence.sources.help" resolveText={t}>
  <IconButton ariaLabelKey="pages.intelligence.sources.helpLabel" icon={HelpCircle} size="sm"
    onSelect={() => undefined} resolveText={t} />
</Popover>

// Wrong: a hand-written floating panel, or a literal sentence.
<div className="my-popover">先检查来源，再重新采集……</div>
```

## How to verify a popover

1. **Keyboard**: Tab to the trigger opens it, Esc closes it and focus is back on the trigger.
2. **Pinning**: click the trigger, move the mouse away — the panel stays; click elsewhere — it
   closes and focus stays where you clicked.
3. **Width**: a long sentence wraps inside 320 px and does not widen the page.
4. **Copy**: the text comes from a key; a literal sentence does not pass the guard.
