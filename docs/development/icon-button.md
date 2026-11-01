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

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ariaLabelKey` | `string` | yes | The screen-reader name, **as a key**. A literal sentence does not compile in review and defeats i18n. |
| `icon` | `LucideIcon` | yes | A lucide component. The component marks it `aria-hidden`; do not pass an `<img>` or a text glyph. |
| `size` | `'sm' \| 'md'` | yes | `sm` = 22 px inline, `md` = 24 px card header and toolbar. |
| `onSelect` | `() => void` | yes | Click handler. |
| `resolveText` | `(key: string) => string` | yes | The caller's text resolver; the component holds no copy and imports no i18n. |
| `disabled` | `boolean` | no | Native `disabled`: it leaves the tab order and stops firing. |
| `tooltipKey` | `string` | no | Explanation on hover **and focus**, key only. There is no native `title`. |
| `variant` | `'plain' \| 'solid'` | no, default `plain` | `solid` adds a border and a surface tint for toolbar rows. |

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
  the name is spoken once, not twice.
- **One focus ring:** `:focus-visible` gets a 2 px accent outline with a 2 px offset. There is no
  `outline: none` anywhere in the stylesheet.
- **`type="button"`:** an icon button inside a form never submits it.
- **No colour semantics:** the icon button is neutral. A destructive action is a button with text,
  not a red icon.

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
4. **Tooltip**: focusing the button shows the hint; a native `title` tooltip means the wrong path.
