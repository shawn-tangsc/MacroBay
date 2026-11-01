[English](./ui-state-components.md) | [中文](./ui-state-components.zh-CN.md) | [← Docs](../README.md)

# State components

Every region that can be empty, waiting, broken, switched off or not permitted renders `StateView`.
It is the one state surface; the older `EmptyState`, `ErrorState` and `DisabledHint` are retired as
each call site migrates, with no compatibility layer and no second implementation.

One component, six states, and copy that is chosen by code rather than written by hand. That is the
whole point: twenty-three spellings of "empty" and eighteen of "error" grew because every page wrote
its own sentence, and a page that catches an error and shows "no data" lies to the reader.

## The component

| Export | Use it for |
| --- | --- |
| `StateView` | A region with a settled state: empty, error, disabled, permission, loading, or just its normal content. |
| `StateViewState` | The closed set: `normal` / `loading` / `empty` / `error` / `disabled` / `permission`. |
| `StateViewAction` | At most one action: `{ labelKey, onSelect }`. |
| `StateViewProps` | The props union, typed per state. |

```tsx
import { StateView } from '@platform/ui/components/state'
```

Source: `platform/ui/components/state/` (`StateView.tsx`, `stateView.css`, the component test).
The contract is `docs-private/05-desktop/ui-state-components-contract.md` §13; the visual spec is
`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html`.

### Props

`StateViewProps` is a discriminated union on `state`, so a missing required field fails the build
instead of falling back to a generic sentence.

| Prop | Type | Required for | Meaning |
| --- | --- | --- | --- |
| `state` | `StateViewState` | always | Which of the six states this region is in. |
| `resolveText` | `(key: StateViewTextKey) => string` | optional | Test-only override. Production resolves through `useStateViewText()`, whose copy lives once in `platform/ui/components/state/stateViewText.ts`. |
| `reasonCode` | a closed set, one per state | `empty` / `error` / `disabled` / `permission` | A **code**, never a sentence. The key is `ui.state.<state>.reason.<code>`. A code that belongs to another state does not compile. |
| `action` | `{ labelKey, onSelect }` | `empty` except `not-yet`; `error`; `disabled` / `target-disabled`; `permission`; never for `not-yet`, `capability-not-wired` | At most one action. The label is a key, not text. Where the reader has nothing to do, passing one does not compile. |
| `details` | `{ summaryKey, bodyKey }` | `error` only | Troubleshooting detail, folded by default. |
| `size` | `'sm' \| 'md' \| 'lg'` | optional, default `md` | `lg` = full page (220), `md` = inside a card (80). `sm` is reserved and must not be used yet. |
| `children` | `ReactNode` | `normal` only | The region's own content. |
| `className` | `string` | optional | Positioning only; never restyle the internals. |

There is no `icon`, no `title`, no `description`, no `reason` string and no `spinner?: boolean`.
Icons come from one table inside the component and are chosen by `state` alone.

## What each state renders

| `state` | Icon | Announced | Must answer |
| --- | --- | --- | --- |
| `normal` | — | no | Renders `children` only: no wrapper, no reserved rows. |
| `loading` | `LoadingState` | by `LoadingState` | What is being waited for. |
| `empty` | circle | no | Why there is nothing (not configured / filtered out / not collected yet). |
| `error` | `!` | `role="status"` + `aria-live="polite"` | What failed and what the reader can do. |
| `disabled` | circle-slash | no | Why it cannot be used, and one action that unlocks it — or none when the platform side is not wired. |
| `permission` | lock | no | What is missing and who grants it, plus one action that opens system settings. Only for capabilities the system can answer for. |

`disabled` and `permission` share the same neutral colour on purpose. They stay distinguishable in
grayscale because the outline differs (circle-slash vs lock) and the action slot differs. Do not
separate them by colour.

The reason codes are a closed set. The action column is enforced by the type, not by review:

| `state` | `reasonCode` | Action | Meaning |
| --- | --- | --- | --- |
| `empty` | `never-created` | required: create | Nothing has ever been created. |
| `empty` | `filtered-out` | required: clear the filter | There is data; the filter hides it. |
| `empty` | `no-target-bound` | required: bind a target | No target is bound yet. |
| `empty` | `nothing-enabled` | required: enable | Nothing is enabled. |
| `empty` | `none-installed` | required: install / bind / open settings, one recovery per site | Nothing has ever been installed or bound here; the reader can fix it. |
| `empty` | `no-target-selected` | required: focus the selector | A target exists to pick, but none is selected yet. |
| `empty` | `not-yet` | never | It only appears once something has happened. |
| `empty` | `older-than-window` | required: view all | There is data, but all of it falls outside this window — this is "looked, and it exists", not "nothing yet". |
| `empty` | `nothing-in-window` | required: view all | The window really has nothing in it — this is "looked, and there is none", which `not-yet` must never be used for. |
| `error` | `unreadable` | required: retry | The data could not be read — this is not "there is none". |
| `error` | `unavailable` | required: check the source | The source itself is unavailable; retrying blindly achieves nothing. |
| `error` | `operation-failed` | required: retry | A write (create, save, update, delete) did not go through — this is not a read failure. |
| `error` | `needs-restart` | required: restart the app | A local interface is missing; only a restart loads it. |
| `disabled` | `capability-not-wired` | never | The platform side is not connected; nothing is wrong on the reader's side. |
| `disabled` | `target-disabled` | required: enable | The target was switched off. |
| `disabled` | `precondition-unsaved` | required: save | The form has unsaved changes; saving unlocks it. |
| `permission` | `not-granted` | required: open system settings | Only for capabilities where the system can answer whether permission was granted. |

### Sizes

| `size` | Position | `minHeight` |
| --- | --- | --- |
| `lg` | Full page | `220` |
| `md` (default) | Inside a card, drawer body | `80` |
| `sm` | List row / table body | not open in this batch |

The two numbers live in one table in the component and are written to `style.minHeight`; do not pass
a pixel value from a call site, and do not write a second `min-height` in page CSS.

## Copy

- Title key: `ui.state.<state>`.
- Reason key: `ui.state.<state>.reason.<code>`.
- By default the component resolves copy through `useStateViewText()` (language from `ShellLanguageProvider`); `resolveText` is a test-only override. The copy table and the action-key constants live once in `platform/ui`.
- A new reason code is a contract change: get it approved, add the sentence in **both** languages in
  the same commit, then use it. Product pages must not invent a code or a sentence of their own.

```tsx
// Correct: state + code, text resolved by the shell.
<StateView
  state="empty"
  reasonCode="never-created"
  resolveText={t}
  action={{ labelKey: 'ui.state.action.create', onSelect: create }}
/>

// Correct: a page-level error with folded detail and a retry.
<StateView
  state="error"
  reasonCode="unreadable"
  resolveText={t}
  details={{ summaryKey: 'ui.state.error.details', bodyKey: 'ui.error.details.body' }}
  action={{ labelKey: 'ui.state.action.retry', onSelect: retry }}
/>

// Correct: nothing has happened yet, so there is no action to give.
<StateView state="empty" reasonCode="not-yet" resolveText={t} />

// Wrong: hand-written copy, a boolean switch, a pixel size, an icon prop.
<StateView state="empty" title="No data" spinner size={120} icon={<Empty />} />
```

## How to verify a page that uses it

1. **Height**: in DevTools the `.state-view` element must report `min-height: 220px` for `lg` and
   `80px` for `md`. Read the computed value, do not eyeball the screenshot.
2. **Live regions**: only `error` may carry `aria-live`, and it must also be the only live region on
   screen. `loading` already has one, inside `LoadingState` — the page must not add a second.
3. **No action placeholder**: `capability-not-wired` without `action` renders no button and no empty row; `permission` always carries one "open system settings", and that handler must really open the system settings — a required action with an empty handler is a dead button moved, not fixed.
4. **Grayscale**: a filtered screenshot of `disabled` and `permission` must still tell them apart.
5. **No copy in the component**: grep the component for sentences; it must contain none.
