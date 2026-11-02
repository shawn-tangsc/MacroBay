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

Source: `platform/ui/components/state/` (`StateView.tsx`, `stateView.css`, `stateViewText.ts`, the component tests). The state/reason-code unions are defined once in `platform/contracts/queryOutcome.ts`; `StateView` re-exports them, and `QueryOutcome<T>` is the shape a query layer returns.
The contract is `docs-private/05-desktop/ui-state-components-contract.md` §13; the visual spec is
`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html`.

### Props

`StateViewProps` is a discriminated union on `state`, so a reason code that belongs to another
state fails the build
instead of falling back to a generic sentence.

| Prop | Type | Required for | Meaning |
| --- | --- | --- | --- |
| `state` | `StateViewState` | always | Which of the six states this region is in. |
| `resolveText` | `(key: StateViewTextKey) => string` | optional | Test-only override. Production resolves through `useStateViewText()`, whose copy lives once in `platform/ui/components/state/stateViewText.ts`. |
| `reasonCode` | a closed set, one per state | `empty` / `error` / `disabled` / `permission` | A **code**, never a sentence. The key is `ui.state.<state>.reason.<code>`. A code that belongs to another state does not compile. |
| `action` | `{ labelKey, onSelect }` | optional for every state; whether a state has one is a scenario decision, not a type rule. `empty` except `not-yet`; `error`; `disabled` / `target-disabled`; `permission`; never for `not-yet`, `capability-not-wired` | At most one action. The label is a key, not text. Where the reader has nothing to do, passing one does not compile. |
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

The reason codes are a closed set. The action column is **a review criterion, not a type rule**
(2026-11-02): whether a state has an action depends on the situation, not on `state × reason`.
`error` and a recoverable `empty` must carry one; `empty · not-yet` and
`disabled · capability-not-wired` may carry none. `refresh` means "get a newer copy"; `retry` only when the previous attempt failed — using `retry`
for a refresh tells the reader a stale value failed. There is no "run it once now" key: a code that
needs one gets the code and the key in the same change, never the key on its own.

| `state` | `reasonCode` | Action | Meaning |
| --- | --- | --- | --- |
| `empty` | `never-created` | required: create — `create` | Nothing has ever been created. |
| `empty` | `filtered-out` | required: clear the filter — `clear-filter` | There is data; the filter hides it. |
| `empty` | `no-target-bound` | required: bind a target — `bind-target` | No target is bound yet. |
| `empty` | `nothing-enabled` | required: enable — `enable` | Nothing is enabled. |
| `empty` | `none-installed` | required: one recovery per site — `install` (a list to pick from) / `focus-form` (a form on screen) / `bind-target` (a target to bind) / `open-settings` (no entry here) | Nothing has ever been installed or bound here; the reader can fix it. |
| `empty` | `no-target-selected` | required: focus the selector — `select-target` / `focus-form` | A target exists to pick, but none is selected yet. |
| `empty` | `not-yet` | forbidden | It only appears once something has happened; a button here would be a fake action. |
| `empty` | `never-ran` | required: run it now — `run-now` | Nothing has run yet; the reader can start it. Kept apart from `not-yet`, which is a fact with nothing to do. |
| `empty` | `target-missing` | required: back to the list — `back-to-list` | The target itself was deleted: this is "cannot reach it", not "nothing there". Never `target-disabled`, whose action is to enable. |
| `empty` | `older-than-window` | required: view all — `widen-time-window` | There is data, but all of it falls outside this window — this is "looked, and it exists", not "nothing yet". |
| `empty` | `nothing-in-window` | optional — `widen-time-window` or `open-settings` when the site has one | The window really has nothing in it — this is "looked, and there is none", which `not-yet` must never be used for. A month with no events can offer "open settings"; genuinely no news offers nothing. |
| `error` | `unreadable` | required: retry — `retry` | The data could not be read — this is not "there is none". |
| `error` | `unavailable` | required: check the source — `check-source` / `retry` / `refresh` | The source itself is unavailable; retrying blindly achieves nothing. |
| `error` | `operation-failed` | required: retry — `retry` | A write (create, save, update, delete) did not go through — this is not a read failure. |
| `error` | `needs-restart` | required: restart the app — `restart-app` | A local interface is missing; only a restart loads it. |
| `error` | `page-load-failed` | required: reload the page — `reload-page` | The page itself did not load. Reloading the page is the fix — not `retry` (a failed operation) and not `restart-app` (a different cost). |
| `disabled` | `capability-not-wired` | forbidden | The platform side is not connected; nothing is wrong on the reader's side. |
| `disabled` | `target-disabled` | required: enable — `enable` | The target was switched off. |
| `disabled` | `precondition-unsaved` | required: save — `save` | The form has unsaved changes; saving unlocks it. |
| `permission` | `not-granted` | required: open system settings — `open-system-settings` | Only for capabilities where the system can answer whether permission was granted. |

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

- Action labels are **picked from the closed set of action keys**, not written at the call site: a
  reason code fixes the *reason*, the type fixes whether an action is *allowed*, and the call site
  chooses *which* label. When the set has no label for a real next step, add a key in the same
  commit (union + both languages); never widen `labelKey` to `string`, or a typo becomes a sentence
  the reader sees.

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

### A product sentence, with its parameters

The platform code set does not grow product codes. When a product really needs its own wording for
one situation, it overrides **the reason slot only** — the title, icon, live region and action stay
platform-owned:

```tsx
<StateView
  state="disabled"
  reasonCode="target-disabled"
  productReason={{
    key: 'mi.newsSentiment.staleSince',             // product prefix; never ui.*
    params: { moment: formatInstant(updatedAt) },   // already formatted; strings only
    resolve: (key, params) => productT(key, params) // the second argument must be taken
  }}
  action={{ labelKey: 'ui.state.action.refresh', onSelect: refresh }}
/>
```

- `params` carries **already formatted** display values: a time is formatted by the platform's time
  formatter before it is passed, so a product cannot sneak a `number` or a `Date` in, and cannot
  call `toLocaleString()` itself.
- A missing key, an empty string or a thrown error **falls back to the platform sentence**. The
  reason node carries `data-reason-source="product" | "platform"`, so a call-site test can assert
  which path rendered.
- `resolve` must take both arguments: `(key) => …` eats the parameters and leaks `{moment}` into the
  UI — `textResolverGuard` turns red on it.
- It exists only on the four states that have a reason sentence (`empty` / `error` / `disabled` /
  `permission`); passing it on `normal` / `loading` does not compile.

## What a state decision may decide

A state decision produces one `(state, reasonCode)` tuple, and nothing else. These three are
decided by data, never by the state:

| Decided by | Not by the state |
| --- | --- |
| Whether the content renders — `rows.length > 0` | `state === 'empty'` used as the branch that hides a table |
| Whether a control appears — “load more” from `hasMore`, “retry” from the error, “clear filter” from whether a filter is set | a state flag switching a pager on or off |
| Where an action points — from the data context | a reason code implying a destination |

A wrong state costs the reader one sentence they should not have seen. A state that can hide a
table, a pager or a whole page makes the data invisible, and **nobody reports that as a bug** — the
list simply looks finished. So the shape to write is `rows.length > 0 ? <content> : <StateView …>`,
never `<StateView>` on one branch of a ternary whose other branch is the content.

## A product reason sentence

A product may replace **the reason sentence only** (§17) when its own copy carries a fact the
platform cannot know — an as-of time, for instance:

```tsx
<StateView
  state="empty"
  reasonCode="older-than-window"
  productReason={{
    key: 'mi.newsSentiment.stale',
    params: { time: formatTime(asOf, 'minute') },  // formatted by the platform first
    resolve: (key, params) => text[key]?.(params) ?? ''
  }}
  resolveText={t}
/>
```

- `key` must carry the product prefix (`mi.*`); the guard scans for it.
- `params` only accepts strings: format the moment with the platform formatter first. Numbers are
  rejected, so a raw timestamp cannot reach the sentence.
- Missing key, empty string or a throw **falls back to the platform sentence**. The reason node
  carries `data-reason-source="product" | "platform"`, so a call-site test can assert which path ran;
  a silent fallback would hide the missing copy.
- Titles, icons, announcements and actions stay the platform's. This is one slot, not a second copy
  table.

## How to verify a page that uses it

1. **Height**: in DevTools the `.state-view` element must report `min-height: 220px` for `lg` and
   `80px` for `md`. Read the computed value, do not eyeball the screenshot.
2. **Live regions**: only `error` may carry `aria-live`, and it must also be the only live region on
   screen. `loading` already has one, inside `LoadingState` — the page must not add a second.
3. **No action placeholder**: `capability-not-wired` without `action` renders no button and no empty row; `permission` always carries one "open system settings", and that handler must really open the system settings — a required action with an empty handler is a dead button moved, not fixed.
4. **Grayscale**: a filtered screenshot of `disabled` and `permission` must still tell them apart.
5. **No copy in the component**: grep the component for sentences; it must contain none.

## A read is not a state view

`StateView` expresses **settled** states only: the read finished and produced empty, error, disabled or
permission. Waiting is not one of them — it belongs to `LoadingState`. Getting this wrong is not a
style matter; it is the bug the reader reports as “先转圈 → 闪一下读取失败 → 才出数据” in almost every
module, and it comes in two spellings of the same mistake:

1. **A settled initial value.** A hook whose first state is `error` / `unavailable` / `empty` renders
   the failure (or an empty window) on mount, before any read has happened, then flips to data.
2. **Waiting written as “unavailable”.** Setting `unavailable` with a code while the read is still in
   flight. Any consumer that branches on `state === 'unavailable'` — and most do — draws an error
   during the wait.

Three rules follow. They are contract, not advice:

1. **First entry shows waiting, never a settled state.** A read starts as `loading`. An initial
   `error` / `unavailable` / `empty` is a defect even when the data arrives within the same tick.
2. **Waiting is spelled `loading`.** A failure code may not stand in for “not finished yet”. If a
   budget or timeout is what ends the wait, it ends it as a failure — not as a waiting state with a
   failure code.
3. **A failed refresh keeps the rows.** When a previous success is on screen and a refresh fails, keep
   the data and mark it stale (`data-stale`, plus the stale marker in the copy). Falling back to the
   error screen deletes information the reader already had; the “we could not refresh” fact belongs
   beside the data, not instead of it.

### `AsyncState<T>`: one lifecycle for every read

Fourteen modules each writing their own three-way union is how one bug returns fourteen times. One
implementation lives in `platform/ui/async/asyncState.ts`:

```ts
export type AsyncState<T> =
  | { status: 'loading'; data?: never }
  | { status: 'ready'; data: T; refreshing?: true; stale?: true }
  | { status: 'error'; reasonCode: ErrorReasonCode; data?: never }
```

- `data` exists **only** on `ready`, so “loading, and here is… nothing” cannot be destructured and a
  first frame that draws an error cannot be written: `error` has no data and `loading` has no data,
  which means every branch that needs rows must first prove `ready`.
- `reasonCode` is the closed set from `platform/contracts/queryOutcome`. `AsyncState` is the read's
  **lifecycle**; `QueryOutcome` is the settled **data-layer** result. One wraps the other, they are
  not two vocabularies for the same thing.
- `refreshing` and `stale` are different facts: `refreshing` means a newer read is in flight while the
  old rows stay; `stale` means the newest attempt failed and the rows on screen are an earlier read.
  Copy distinguishes them; neither is allowed to blank the data.
- Start with the factory (`initialAsyncState<T>()`), never with a hand-written literal — the only
  legal initial value is `loading`.
- Transition helpers own the rules: `beginRefresh(prev)` keeps `data`, `failRefresh(prev, reason)`
  keeps `data` and sets `stale`, `settle(prev, data)` clears both flags. A call site that writes its
  own `setState({ status: 'error' })` on refresh is the bug this type exists to prevent.

### Migrating a read to it

The change is almost always the same shape: the local union and the hand-written setter go away, and
the three helpers replace them.

```ts
// Before: a settled state as the initial value — one frame of "could not read" on every mount.
const [state, setState] = useState<View>('unavailable')
useEffect(() => { read().then(rows => setState(rows), () => setState('unavailable')) }, [])
// refresh: setState('unavailable')   ← deletes what the reader was looking at

// After: loading first, and a failed refresh keeps the rows.
const [state, setState] = useState<AsyncState<Row[]>>(initialAsyncState)
useEffect(() => {
  setState(beginRefresh)
  read().then(rows => setState(prev => settle(prev, rows)), () => setState(prev => failRefresh(prev, 'unreadable')))
}, [reloadKey])
// render: loading → <StateView state="loading" />; error → <StateView state="error" reasonCode={state.reasonCode} />
// ready → <Rows rows={state.data} stale={state.stale === true} refreshing={state.refreshing === true} />
```

### How to enforce it

- **Mechanically**: `scripts/check-async-initial-state.mts` (wired into `pnpm verify`) fails when a
  `useState` initial value is a settled state — `{ state: 'error' | 'unavailable' | 'empty' … }` or
  `{ status: 'error' }` — and when a `useState` initializer is a call to something other than the
  factory. It carries a **shrinking allowlist** for legacy sites; the allowlist may only lose entries.
- **By test**: `platform/ui/async/expectWaitingFirst.tsx` renders a surface with a deferred read and
  asserts, before resolving: `[data-state]` carries no `error` / `empty` / `disabled` / `permission`,
  and `[data-loading-state]` is present. Every list, card and drawer that reads data gets one such
  case — it is the only check that catches “loading written as unavailable”, because that spelling is
  type-correct.
