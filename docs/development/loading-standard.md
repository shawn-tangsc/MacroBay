[English](./loading-standard.md) | [中文](./loading-standard.zh-CN.md) | [← Docs](../README.md)

# Loading Standard

The app has exactly one loading UI: a centered spinning ring, with the wait's copy underneath it.
Every page, panel, card, drawer, list area and in-flight control reuses it. A loading state is never
written by hand on a page.

This is a rule, not a suggestion. Loading affordances used to grow page by page — a muted
`loading…` paragraph here, an AntD `Spin` there, three different rotation keyframes — until a reader
could not tell "waiting" from "empty" or "broken". The single component, the tree guards and this
document exist to keep that from coming back.

## The component

| Export | Use it for |
| --- | --- |
| `LoadingState` | A region with nothing to show yet: page, panel, card, drawer body, list area. Centers the ring in its own box. |
| `LoadingSpinner` | A ring inside a control that already carries the copy — a pill, an icon button, a row badge. Decorative (`aria-hidden`). |

```tsx
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
```

Source: `platform/ui/components/loading/` (`LoadingState.tsx`, `loadingState.css`, the component test
and the tree guards).

### Props

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `label` | `string` | — | Visible copy under the ring. Required unless `ariaLabel` is given. |
| `ariaLabel` | `string` | — | Accessible name when the region already names the wait elsewhere. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | `sm` inside a control, `md` for a region, `lg` for a full page slot. |
| `layout` | `'block' \| 'inline'` | `'block'` | Block centers a region; inline sits in a status bar or a row. |
| `fill` | `boolean` | `false` | Take the parent's height (a flex/grid region that already has one). |
| `minHeight` | `number` | stylesheet `96` | Pixel floor for a short block. Ignored with `fill`. |
| `className` | `string` | — | Region positioning only. Never restyle the ring. |

The root renders `role="status"`, `aria-live="polite"`, `aria-busy="true"` and
`data-loading-state`; the ring is `aria-hidden`. The visual spec is `2px` ring (`3px` at `lg`), one
turn per `720ms`, ring `--muted-strong`, copy `--muted` at `12px`, block minimum `96px`, inline gap
`6px`. Both themes work with no per-page colors, and `prefers-reduced-motion` slows the turn instead
of hiding it.

## Which pattern to use

| Situation | Pattern |
| --- | --- |
| A region with nothing to show yet | `<LoadingState label={...} />` |
| The same, in a region that owns its height | `<LoadingState label={...} fill />` |
| A short block in a form or settings section | `<LoadingState label={...} minHeight={120} />` |
| A status bar, list row or inline metadata | `<LoadingState layout="inline" size="sm" label={...} />` |
| A control that already carries the copy | `<LoadingSpinner size="sm" />` |
| A button performing an action | AntD `Button loading` / `confirmLoading` |
| A settled state: empty, unavailable, permission off | A dedicated empty/error state, never a spinner |
| A static state glyph (step marker, badge) | A static lucide icon, never a spinner |

```tsx
// Region waiting for its first read.
<LoadingState label={text.loading} />

// Drawer body that already owns a height.
<LoadingState label={text.loading} fill />

// Status bar.
<LoadingState layout="inline" size="sm" label={text.status.loading} />

// Control-level ring, named by the control's own text.
<button className="model-service-pill" aria-busy={running}>
  {running ? <LoadingSpinner size="sm" /> : null}
  {running ? `${labels.detectModels} ${done}/${total}` : labels.detectModels}
</button>
```

## Do not

```tsx
<p>loading…</p>                      // a sentence pretending to be a loading surface
<div aria-busy="true" />             // an empty box
<Spin />                             // a second spinner implementation
<Loader2 className="spin" />         // a static loader glyph plus a local animation
```

```css
@keyframes my-page-spin { to { transform: rotate(360deg); } }   /* only one rotation exists */
```

## Copy and accessibility

- All copy comes from i18n: `platformText` in the shell, `productText` in a product module.
- One line of meaning: what is being read, not an apology or a duration estimate.
- No diagnostics in the label — no retry counts, failure codes, ids or timestamps. Those belong to
  the error state.
- When a heading or status bar already names the wait, pass `ariaLabel` alone instead of repeating
  the sentence under the ring.

## Adding a loading surface

1. Is this actually a wait with nothing to show yet? If content stays on screen, use a
   control-level indicator instead of replacing the region.
2. Pick a pattern from the table above; do not invent a third layout.
3. Keep the container that owns layout, borders and scroll. Replace only the placeholder inside it.
4. Import from `@platform/ui/components/loading`; the owning layer provides the copy.
5. Give the state a floor (`minHeight`) or `fill` so the ring is centered in a real box.
6. Delete the old local CSS (`__state` loading rules, `.spin`, keyframes) in the same change.
7. Run the touched page's tests, then `pnpm typecheck` and `pnpm build`.

## Enforcement

`platform/ui/components/loading/loadingStandard.test.ts` scans the tree and fails when:

- a second `rotate(360deg)` animation appears outside `loadingState.css`;
- a component imports `Loader2` / `LoaderCircle` from lucide;
- any stylesheet defines a `.spin` animation class.

If a guard blocks a legitimate need, extend the standard — component, CSS, tests and this document
together — instead of adding an exception.
