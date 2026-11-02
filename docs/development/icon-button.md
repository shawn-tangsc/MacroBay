[English](./icon-button.md) | [中文](./icon-button.zh-CN.md) | [← Docs](../README.md)

# Icon buttons

An icon-only trigger — help, close, more, refresh — renders `IconButton` from
`@platform/ui/components/icon-button`. Do not hand-write `<button class="…">` for one.

The component exists because the same trigger grew five sizes (18 / 20 / 22 / 24 / 26) and three
focus styles, one of which removed the ring without a replacement. Both are now fixed in one place.

## The component

| Export | Use it for |
| --- | --- |
| `IconButton` | One icon plus one screen-reader name. |
| `ICON_BUTTON_SIZES` | The closed set: `['sm', 'md']`. |
| `IconButtonSize` | `'sm' \| 'md'` — the same size words `StateView` uses. |
| `IconButtonVariant` | `'plain' \| 'solid'`. |
| `IconButtonProps` | The props type. |

```tsx
import { IconButton } from '@platform/ui/components/icon-button'
```

Source: `platform/ui/components/icon-button/`. Visual spec:
`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html` §②.

**Basis: antd `Button`.** The component wraps it rather than hand-writing a `<button>`, so keyboard,
disabled and `type="button"` behaviour come from the library; the look is still ours (padding 0,
radius 5, transparent background, and our own hover/active). Its click wave is decorative motion and
is turned off once in `platform/ui/theme`, read by both `ConfigProvider`s (main window and detached
window) — never per button.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ariaLabelKey` | `string` | yes | The screen-reader name, **as a key**. A literal sentence does not compile in review and defeats i18n. |
| `ariaLabelParams` | `Record<string, string>` | no | The entity names that go into the label — an event, a source, a model. The sentence itself lives in the text table as a template, e.g. `Open {name} in the calendar`; a parameter that is missing stays visible as `{name}` rather than disappearing. |
| `icon` | `LucideIcon` | yes | A lucide component. The component marks it `aria-hidden`; do not pass an `<img>` or a text glyph. |
| `size` | `'sm' \| 'md'` | yes | `sm` = 22 px inline, `md` = 24 px card header and toolbar. |
| `onSelect` | `(event: React.MouseEvent) => void` | yes | The click handler, **with the event**. Icon buttons sit inside rows that are themselves clickable, so the handler needs `event.stopPropagation()`. A zero-argument handler still compiles and still fires — TypeScript allows a shorter parameter list. |
| `className` | `string` | no | Your own class, for positioning and state. It cannot resize the button: the size is written inline and inline beats any class rule. |
| `style` | `CSSProperties` | no | Positioning only. The component writes `width`/`height` **after** your style, so a call site cannot escape the 22/24 set. |
| `dataAttributes` | `Record<\`data-${string}\`, …>` | no | Test hooks and state flags (`data-redock-tab`). A separate prop rather than arbitrary attributes, so nothing like `width` can slip in. |
| `resolveText` | `(key: string) => string` | yes | The caller's text resolver; the component holds no copy and imports no i18n. |
| `disabled` | `boolean` | no | Native `disabled`: it leaves the tab order and stops firing. Cannot be combined with `tooltipKey` — that combination does not compile. |
| `variant` | `'plain' \| 'solid' \| 'overlay'` | no, default `plain` | `plain` is transparent (inline). `solid` is the toolbar row: a border and a soft surface. `overlay` is for an icon button **absolutely positioned over content** — a border, radius 5, and a deliberately translucent surface so the layer below shows through; hover makes it opaque. Rule: anything floating over arbitrary content is `overlay`, never `plain`. |
| `loading` | `boolean` | no | The click is in flight: the button is disabled, the glyph becomes the platform spinner (`LoadingSpinner`, `sm`), and `onSelect` stops firing. The name and the 22/24 size stay, so a screen reader still knows which button is busy. Not a third size and not a variant. |
| `tooltipKey` | `string` | no | Explanation on hover **and focus**, key only. There is no native `title`. Never together with `disabled`. |
| `variant` | `'plain' \| 'solid'` | no, default `plain` | `solid` adds a border and a surface tint for toolbar rows. |
| `expanded` | `boolean` | no | Set when the button opens a disclosure (a bell that opens a drawer). Maps to `aria-expanded`; omitted from the DOM when not passed. |
| `controls` | `string` | no | The `id` of the region the button expands. Maps to `aria-controls`; omitted when not passed. |
| `pressed` | `boolean` | no | Set for a toggle (the current state is on/off). Maps to `aria-pressed`; omitted when not passed. The accessible name stays constant across both states — the state is not repeated in the name. **No visual change:** the icon or the panel it controls carries the look. |

### Sizes

| `size` | Pixels | Glyph | Position |
| --- | --- | --- | --- |
| `sm` | 22 | 14 | Inside a row, next to text |
| `md` | 24 | 16 | Card header, toolbar |

The pixel values live in one table in the component and are written to the element's inline
`style`, so acceptance measures the element itself. A call site never passes a pixel value, and
`18` / `20` / `26` do not exist.

## Rules the component enforces

- **`aria-label` is mandatory and comes from a key.** The icon is decorative and `aria-hidden`, so
  the name is spoken once, not twice. `ariaLabelKey` and `tooltipKey` stay open strings because every
  call site names its own trigger; `iconButtonKeyGuard.test.ts` keeps them key-shaped — a literal
  sentence, a CJK label or an unresolved key turns that guard red.
- **A tooltip is a description, not decoration.** `Tooltip` ties the resolved hint to the trigger
  with `aria-describedby`; a keyboard user who tabs in gets the sentence, and there is no native
  `title`.
- **`disabled` and `tooltipKey` never coexist.** A disabled button leaves the tab order and cannot
  take focus, so its tooltip would only ever be reachable with a mouse. When the reason matters,
  write it as visible text; the type rejects the combination.
- **One focus ring — and it must win:** `:focus-visible` renders a **2 px accent** outline with a
  **2 px offset** *in the computed style*. The trigger is an antd `Button`, whose own
  `focus-visible` rule outranks a plain `.icon-button:focus-visible` selector; the component raises
  its specificity until the 2 px accent ring is what actually applies. Verify with
  `getComputedStyle` (outline width/colour or the ring's box-shadow), never by eyeballing a
  screenshot, and keep the ring colour at **≥ 3:1** against the app background. There is no `outline: none` without a replacement.

```tsx
// Correct: one icon, one key, one size word.
<IconButton
  ariaLabelKey="ui.icon.close"
  icon={X}
  size="md"
  onSelect={close}
  resolveText={t}
/>

// Correct: toolbar row.
<IconButton ariaLabelKey="ui.icon.refresh" icon={RefreshCw} size="md" variant="solid" onSelect={reload} resolveText={t} />

// Wrong: literal copy, a pixel size, a string glyph, a native tooltip.
<IconButton aria-label="关闭" icon="✕" size={22} title="关闭" />
```

## How to verify a page that uses it

1. **Size**: the button element reports `width` / `height` of 22 or 24 in DevTools. Anything else is
   a call site that bypassed the component.
2. **Name**: with the screen reader on, focusing the button announces the resolved sentence, not a
   key and not the icon.
3. **Focus**: Tab reaches it, and the ring is visible. Disabled buttons are skipped by Tab.
4. **Tooltip**: focusing the button shows the hint, and the trigger's `aria-describedby` resolves to
   that sentence. A native `title` tooltip means the wrong path.
5. **No disabled tooltip**: a gray icon button whose explanation only appears on hover is a
   keyboard dead end — it must not compile, and it must not be worked around with a wrapper.
