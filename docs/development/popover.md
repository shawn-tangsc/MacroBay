[English](./popover.md) | [中文](./popover.zh-CN.md) | [← Docs](../README.md)

# Popovers

A multi-line explanation attached to a trigger renders `Popover` from
`@platform/ui/components/popover`. Do not hand-write a floating panel and do not import antd's
`Popover` directly: both lose the focus and dismissal rules below.

`Tooltip` is the one-line case — a hint the reader scans and leaves. This is for the other case: a
paragraph that needs reading, or something the reader wants to pin and compare while looking at the
page underneath.

**The popover owns its anchor.** The trigger is rendered inside `span.platform-popover__anchor`, and the popup measures that node — a trigger component does not have to forward a `ref`. Call sites pass the interaction handlers the render function hands them and nothing else.

**Four caps, and only two of them can be checked mechanically.** At most 4 lines, at most 60 characters per line, at most 360 px wide, at most 320 px tall; content over that scrolls inside the bubble instead of covering what it explains. Width and height are component constants, and `popoverLimitsGuard.test.ts` reads them plus the item count of any literal `lines={[…]}` array — over the cap fails before the commit, not in review. The 60-character rule cannot be checked from source: keys resolve to sentences at runtime, and throwing on a long line in DEV would delete a whole panel over copy, the failure we just refused for `IconButton`. That one stays a review rule.

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
| `labelKey` | `K extends string` | one of | A single-sentence explanation, **as a key**. |
| `lines` | `readonly { labelKey, params? }[]` | one of | A multi-line explanation. Each line carries **its own** params; the first line is the subject and is rendered bold. |
| `content` | `ReactNode` | one of | An explanation the caller has already assembled from its own parts. Rendered verbatim, with no line markup; `resolveText` is not required with it. |
| `labelParams` | `Readonly<Record<string, string>>` | single-line only | Values to fill `{name}` placeholders in the one-line form. **Already formatted** strings only (`10–2`, `289/289`). It does not exist on the multi-line branch: passing it there does not compile. |
| `resolveText` | `(key: K) => string` | yes, on the key branches | The caller's resolver. An unknown key resolves to an empty string. The `content` branch has no key, so it takes no resolver. |
| `trigger` | `(props: PopoverTriggerProps) => ReactElement` | yes | Renders the trigger yourself and spreads the props it is handed. Not a bare element: a bare child invites the component to inject handlers, which is exactly what broke composition. |

`labelKey`, `lines` and `content` are a three-way union: you give exactly one, never two and never
none. `K` is inferred from `resolveText`, so a resolver typed to a key union locks the allowed keys.

### One key or one key per line — never a `\n` in a sentence

`lines` is an array because a multi-line explanation is **structure**, not typography:

```tsx
// Correct: three keys, three lines, the first one carries the emphasis.
<Popover
  lines={[
    { labelKey: '…help.summary' },
    { labelKey: '…help.caveat', params: { range: '10–2' } },
    { labelKey: '…help.howToAdd' }
  ]}
  resolveText={t}
>

// Wrong: one sentence joined with \n and wrapped by CSS.
<Popover labelKey={t('…help.joined')} resolveText={t}>   // t() returns "a\nb\nc"
```

A newline inside a sentence is a typographic accident: translation merges or drops it, and "the
first line is the subject" cannot be expressed inside one string. `popoverCallSiteGuard.test.ts`
fails on a `\n` smuggled into `labelKey` or a `lines` entry.

There is no `placement`, no `open` and no `onOpenChange`: the open model and the position are fixed
behaviour, not call-site options. `content` is not a licence to put controls in the panel — it
carries an explanation the caller has already assembled (see the slot below). A panel that lets the
reader *choose something* (search, filters, a result list) is not this component — it is a picker,
and wrapping a picker in an explanation panel is a classification error, not a migration.

### An assembled explanation: the `content` slot

Some explanations are assembled from several facts, and a fact can be absent this time; a key
template then leaves an empty bracket behind (`source · () · every 30m`). Which fragments may be
missing is the caller's knowledge, so the assembly stays there — the component only offers a slot.

```tsx
<Popover
  content={
    <>
      <span>{sourceName}</span>
      <span>{lastRun}</span>
    </>
  }
  trigger={renderTrigger}
/>
```

- **One of three branches, never two.** `labelKey`, `lines` and `content` are exclusive: a call site
  gives exactly one. `resolveText` is required on the two key branches and absent on this one — there
  is no key to resolve.
- **The node is rendered verbatim** inside the same content node the key branches use, so the
  trigger's `aria-describedby` still names that node and a screen reader reads the caller's text. The
  component adds no line markup, no emphasis and no styling of its own; the slot is a `ReactNode`,
  and nothing about the caller's domain enters the component.
- **An empty slot means "nothing to say this frame", not missing copy.** When the caller's
  conditional assembly yields `null`/`false`, neither the bubble nor the trigger renders, and nothing
  throws in development — a frame with no fragment at all is exactly the case this slot exists for.
  The missing-copy rule above belongs to the key branches.
- **Still an explanation, not a place for controls.** Links, filters or a result list in the slot make
  it a picker in disguise, and the classification rule below still applies.

## Rules the component enforces

- **The trigger is composed, not captured.** The component hands the call site
  `{ onSelect, onMouseEnter, onMouseLeave, onFocus, onBlur, expanded }` and the call site spreads
  them onto a real control (`IconButton` takes `onSelect`/`expanded`; a plain element maps
  `onSelect` to `onClick` and `expanded` to `aria-expanded`). It never clones the element and never
  injects handlers behind the call site's back — that older shape could not combine with a control
  that already binds its own click, which is how a header "?" ended up opening on neither hover nor
  focus.
- **Missing copy is a defect, not a state.** In development the component throws when the sentence
  resolves to empty, so the gap surfaces where it was made instead of shipping a silent blank. In
  production it renders neither the panel nor the trigger — a button that opens nothing is the fake
  control this whole pass exists to remove. Fix the copy; do not paper over it with interaction.
- **A control whose name is its explanation is not "missing copy".** A refresh button with an
  `ariaLabelKey` and no popover is fine: the question is whether the reader is told something, not
  whether a `Popover` exists.
- **Hover and focus both open it.** A reader who tabs in should see it without reaching for the
  mouse; that is the half a tooltip-first design keeps forgetting.
- **Clicking the trigger pins it.** Hover alone cannot hold a paragraph open while the reader looks
  at the page underneath, and the naive fix — passing `['hover', 'focus', 'click']` to antd — closes
  it the moment the mouse leaves, so it never actually pins.
- **A click elsewhere closes it, without stealing focus.** The place the reader clicked is where
  they want to be; moving focus back to the trigger would fight them.
- **Esc closes it and returns focus to the trigger.** Otherwise focus lands on `body` and a keyboard
  reader loses their place. **It closes only the popover**: the settings panel or dialog underneath
  has its own Esc handler, and one keypress must not close both — the reader pressed "close this
  explanation" and would lose the panel they were in. The popover handles the key in the capture
  phase, before the outer handler sees it; with no popover open it registers nothing and Escape
  passes through.
- **Maximum width 320 px**, text wraps, the page never widens.
- **An empty sentence renders no bubble.** Reading a key name aloud is worse than saying nothing;
  the same rule as `Tooltip`. With `lines`, a line that resolves to nothing is dropped, and when every
  line is empty the whole bubble is absent — never an empty frame.
- **Multi-line comes from an array of keys, never from `\n`.** A newline is a typographic accident:
  translation merges or eats it, and only an array can say which line is the subject. A call site that
  puts `\n` into a `labelKey` or `lines` entry is red in `popoverCallSiteGuard.test.ts`.
- **Placeholders are filled from `labelParams` and never re-formatted here.** The component receives
  `10–2` or `289/289` already formatted by the caller: numbers, units and clocks are the caller's
  knowledge, and a second formatter here is how the same number ends up written two ways. A missing
  parameter keeps its `{name}` visible instead of silently dropping a number.
- **The first line carries the emphasis** (`600`), the rest are detail. Without that distinction three
  lines read as three equal facts.

## Placeholders

Each line takes its own `params` (contract §8): a page that shows five facts, each with a different
as-of time, keeps them in one bubble without a shared parameter bag. `labelParams` exists only on the
single-line branch — passing it with `lines` does not compile, so "one bag for the whole block" and
"one bag per line" cannot both live here.

`labelParams` takes values that are **already formatted by the caller**: the component formats no
numbers and no dates, because the same value formatted in two places ends up looking like two
different facts. A parameter that is missing stays visible as `{name}` rather than vanishing —
a reader can see that something was not wired, while a silently dropped number reads as a real
measurement. `fillLabelParams` is shared with `IconButton`, so the two cannot drift.

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

// Correct: a multi-line explanation with a filled value, one key per line.
<Popover
  lines={['…policy.summary', '…policy.example', '…policy.howToAdd']}
  labelParams={{ span: '10–2' }}
  resolveText={t}>

// Wrong: a hand-written floating panel, a literal sentence, or lines joined by \n.
<div className="my-popover">先检查来源，再重新采集……</div>
```

## How to verify a popover

1. **Keyboard**: Tab to the trigger opens it, Esc closes it and focus is back on the trigger.
2. **Pinning**: click the trigger, move the mouse away — the panel stays; click elsewhere — it
   closes and focus stays where you clicked.
3. **Width**: a long sentence wraps inside 320 px and does not widen the page.
4. **Lines**: an explanation passed as `lines` renders one line per key, and the first line is bold.
5. **Copy**: the text comes from a key; a literal sentence or a `\n`-joined one does not pass the
   guard.
