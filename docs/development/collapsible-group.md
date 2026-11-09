[English](./collapsible-group.md) | [中文](./collapsible-group.zh-CN.md) | [← Docs](../README.md)

# Collapsible groups

A disclosure block — a header row that opens a body — renders `CollapsibleGroup` from
`@platform/ui/components/collapsible-group`, on top of antd `Collapse` in `ghost` mode. It is the
only place a disclosure header and its chevron are drawn: call sites must not write `<details>`,
must not assemble "header row + expanded area" themselves, and must not each draw their own arrow.

## What the shell fixes

Four behaviours live in the component, so a call site cannot get them wrong:

- **the chevron sits at the far right** and rotates 180° when open;
- **the expand animation** comes from antd `Collapse` — no hand-written height transition;
- **`aria-expanded` + `aria-controls`**: rc-collapse only emits `aria-expanded`, so the component
  generates the id, puts it on the body, and points the header at it;
- **the whole row toggles**, not just the 14 px chevron.

Three constraints come with it:

- **groups are independent** (one `Collapse` each — never an accordion);
- **collapsed by default**, and the open state is not persisted and not put in the URL;
- **the body scrolls, the header does not move away** (`maxBodyHeight`, default 320); the
  scrollbar appears only inside the body.

## Content: `rows` or `children`, never both

| Mode | Use it for | What the shell provides |
| --- | --- | --- |
| `rows` | A list of rows | Row semantics: `StatusPill` slot, right-aligned meta, and a whole-row button when the row has an action |
| `children` | Anything else (tables, forms, explanatory blocks) | Only the behaviours above — **no row semantics**; the accessibility of your own content is yours |

The two are a union: passing both, or neither, does not compile.

## Collapsed content is mounted and hidden, not absent

Because `aria-controls` must name a node that really exists, the body is rendered from the first
frame and the collapsed state sets `display: none`. **Assert visibility, not DOM presence**: a test
that expects "zero nodes" will disagree with this component by design.

The agreed wording (UI, 2026-11-09):
> "Not shown" means the node exists but is collapsed — invisible, unreadable, taking no space.
> "Not in the DOM" applies only to whether a body-copy sentence has moved into its ⓘ.

## How to verify a page that uses it

1. Keyboard: Tab to the header, Enter/Space opens it, the header stays put while the body scrolls.
2. Two groups on one page open and close independently.
3. A long list (real data volume, not two rows) scrolls inside the body; the header does not leave
   the panel.
