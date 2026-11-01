[English](./status-pill.md) | [中文](./status-pill.zh-CN.md) | [← Docs](../README.md)

# Status pills

A settled state — "enabled", "stale", "failed", "updating", "off" — renders `StatusPill` from
`@platform/ui/components/status-pill`. Do not hand-write a `<span class="…">` chip for one.

The component exists because the same three words were drawn in five places, in two local
implementations, each with its own size and colour. One 11px type size and one tone set is now the
only way to draw them.

## The component

| Export | Use it for |
| --- | --- |
| `StatusPill` | One state word plus one helper dot. |
| `STATUS_PILL_TONES` | The closed set: `['ok', 'warn', 'bad', 'info', 'muted']`. |
| `StatusPillTone` | `'ok' \| 'warn' \| 'bad' \| 'info' \| 'muted'`. |
| `StatusPillProps` | The props type. |

```tsx
import { StatusPill } from '@platform/ui/components/status-pill'
```

Source: `platform/ui/components/status-pill/`. Visual spec:
`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html` §③.

### Props

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `tone` | `'ok' \| 'warn' \| 'bad' \| 'info' \| 'muted'` | yes | The state's tone. A sixth tone does not compile. |
| `labelKey` | `string` | yes | The state word, **as a key**. The component holds no copy and imports no i18n. |
| `resolveText` | `(key: string) => string` | yes | The caller's text resolver. |

There is no `size`, no `className` and no click handler. The spec gives one type size (11px) and
forbids 9px; a second size would be a new type scale invented at a call site.

### Tones

| `tone` | Means | Token (dot + border) |
| --- | --- | --- |
| `ok` | Working, enabled, saved | `--success` |
| `warn` | Stale, degraded, needs a look — **not** an error | `--caution` |
| `bad` | Failed | `--danger` |
| `info` | In progress, or a neutral notice | `--accent` |
| `muted` | Off, paused, not configured | `--muted` |

The tone rides on **the dot and the border**, and the word itself stays `--text-strong`. That is a
deliberate departure from colouring the text: `color: var(--danger)` is a foreground the
`check:danger-color` gate refuses to grow (3.25–3.94 against dark surfaces, body-text floor 4.5),
and an 11px pill word is body text. The pill still reads in grayscale — the word carries the state,
the dot and the border only reinforce it.

## Rules the component enforces

- **The pill must have a word.** The dot is `aria-hidden` decoration; turning colour off must not
  remove the state. There is no icon-only pill and no "dot only" variant.
- **One tone per pill, five tones total.** No custom colour comes through props.
- **It is a `<span>`, not a button.** A pill is a state, not an action: a verb like "click to
  refresh" belongs in a button. Making the pill clickable would only make that mistake look
  intended.
- **`warn` and `bad` never borrow each other's token** — a stale value is not a failure.
- **`labelKey` must be a key.** It stays an open string because every call site names its own state
  word, so `statusPillKeyGuard.test.ts` holds the line: a `<StatusPill …>` call site that passes a
  sentence, a CJK label or an already-resolved string turns that guard red. Variables and constants
  are judged by their definition, not by the guard.
- **The name belongs to this component.** A second `StatusPill` declared outside `platform/` is a
  collision — the same guard fails on it. The count chip on the translation settings page is a
  label+value badge, not a state, and is named `CountBadge`.

## Rules for call sites

- **Stay inside six Chinese characters / twelve English characters.** Longer text does not shrink
  the type and does not truncate silently; move the detail next to the pill or shorten the word.
- **Never two pills of the same tone in one row.** A row shows the states it needs, not one per
  column artefact.
- **No verbs inside a pill.** "Refresh failed" is a state; "click to refresh" is a control.
- Status text goes through `resolveText` from a key; the pill never contains a literal sentence.

## How to verify a page that uses it

1. **Grayscale**: turn the page greyscale. Each pill is still identifiable from its word alone.
2. **Type**: DevTools reports `font-size: 11px` and `line-height: 1.5`.
3. **Colour**: the dot and border use one token per tone; the component stylesheet contains no hex
   literal.
4. **Structure**: `<span>`, no `<button>`, no `onClick`.
