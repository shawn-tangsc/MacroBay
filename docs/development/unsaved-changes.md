[English](./unsaved-changes.md) | [中文](./unsaved-changes.zh-CN.md) | [← Docs](../README.md)

# Closing a container that holds unsaved input

Any container whose close can discard what the reader typed — drawer, modal, edit panel, multi-step
form — must publish an **entry × state matrix** before it is implemented, and update it whenever a
close path changes. The matrix is the artifact; this page is the rule that demands it.

Why a matrix and not a sentence: the failure mode is never "we forgot to ask". It is **"we asked on
one path and not the other"** — a container can be built specifically to stop silent loss on close
and still drop the edits in one state, because only the obvious row was considered. A judgement that
is written correctly, with one state missing from the case list, is how that survives review.

## The two hard rules

**1. `dirty` is about the draft, never about a success state.**

```
dirty = there is a draft AND it differs from what was read
```

Never `state === 'ready' && draftChanged`. Gating on "loaded successfully" is exactly how
**save-failed** escaped: the save failed, the draft was still in memory, but the state was no longer
`ready`, so `dirty` read false and the close that followed threw the edits away. If there is a draft,
it is dirty. Only "no draft at all" (for example a failed initial read) is clean.

**2. After fixing one path, walk the whole table again.**

Fixing the row you were told about is not fixing the table. Every entry has to be re-answered, and
every cell that changes behaviour needs a case — **both directions**, "asks" and "does not ask". A
missing "does not ask" case is how a dialog starts appearing on a clean close.

**3. A successful save moves the baseline.**

When a save succeeds, the values just written become the new "what was read". Otherwise `dirty` stays
true and the next close asks to discard edits that are already stored — a false alarm that teaches the
reader to click through the dialog, which is how the real warning stops working. Closing immediately
after a save hides this (nothing left to lose); a container that stays open after saving does not.

## The matrix

Rows are entries, columns are states. Every cell answers three things: does it close, does it ask,
and what happens to the input.

| Entry \ State | clean | has draft | save failed (draft kept) | load failed (no draft) | save in flight |
| --- | --- | --- | --- | --- | --- |
| Cancel button | closes | asks | **asks** | closes | decide and state it |
| Esc | closes | asks | **asks** | closes | decide and state it |
| Backdrop / mask | closes | asks | **asks** | closes | decide and state it |
| Close after a successful save | closes | closes (nothing left to lose) | n/a | n/a | n/a |
| Unmount (parent rerender, route change, window close) | — | cannot ask; see below | cannot ask | — | — |

- **Entries**: at least the five above. If the container is opened from more than one place, each
  opener that can unmount it is another row.
- **States**: at least the four above. `save failed` is the one that is always forgotten, because it
  looks like "not dirty" — a failed save leaves the draft in memory, so it is the *most* dirty state.
- **Save in flight**: closing mid-save is a real entry. Either the close waits for the save, or the
  save continues after the container closes — but it must be decided, written in the cell, and
  covered by a case. Silently closing and cancelling the save is a third behaviour nobody chose.

## Unmount cannot be intercepted

A container that is unmounted has no chance to ask. So the matrix row for unmount is not "handled";
it is one of two statements:

1. the parent guarantees it does not unmount the container while `dirty` (for example it disables the
   route change, or the drawer owns the only close control), or
2. losing the input there is accepted, with the reason. "The window closed" is usually acceptable;
   "the parent re-rendered" never is, because that is a bug the reader sees as random loss.

Writing "unmount: handled" without one of these two is a claim with nothing behind it.

## The confirmation surface

Use the platform confirm (`useConfirm` from `@platform/ui/components/confirm`), with `tone: 'danger'`.
The danger tone puts initial focus on cancel — that is enforced by the shared options builder, not by
the call site, so do not add your own focus handling and do not hand-roll a second dialog.

Copy names the **loss**, not a section: "the unsaved edits" rather than "the edits in these two
sections", because a single boolean cannot tell which section changed, and naming one would be a
claim the code does not support.

## Worked example

A container with one `dirty` across two sections and every close entry funnelled through a single
`requestClose` — the shape most containers end up with:

| Entry | clean | draft | save failed |
| --- | --- | --- | --- |
| Cancel / Esc / backdrop / header X | close | ask | ask |
| Successful save | close | close | — |

`dirty` must therefore be the union of the sections that can hold a draft
(`generation.dirty || ai.dirty` for a two-section container), where each section computes it from
"draft differs from what was read" — not from `state === 'ready'`.

## How to verify

1. Write one case per cell whose behaviour differs from the row above it at minimum, and always both
   directions: a clean close shows no dialog, a dirty close shows it and does not close.
2. For each "asks" entry, assert the container is still mounted after the prompt appears, and that it
   closes only after the destructive action.
3. Cover **save-failed** explicitly: make the save reject, close, and assert the question appears.
4. Cover **Esc** separately from the button. Both funnel into the same callback today; a future
   refactor that bypasses one of them will not be caught by the button case. Dispatch the keydown on
   the container's own panel with `keyCode: 27` — a `document`-level event does not reach antd's
   handler, so that version of the test passes nothing.
5. Re-read the matrix after the fix and tick every cell, including the ones you did not touch.
