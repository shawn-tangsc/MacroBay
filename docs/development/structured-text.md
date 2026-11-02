[English](./structured-text.md) | [中文](./structured-text.zh-CN.md) | [← Docs](../README.md)

# Structured text

Remote prose — release notes, changelogs, an "about" page — renders through `StructuredText` from
`@platform/ui/components/structured-text`. It is **not a rich-text renderer**, and that is the point.

## Why the input is a closed structure

The text comes from a server. If remote text could decide what we render, whoever writes it decides what
our interface shows. So the component takes three node kinds and nothing else:

```ts
type StructuredTextNode =
  | { kind: 'section'; title: string }
  | { kind: 'paragraph'; runs: { text: string; bold: boolean }[] }
  | { kind: 'list'; items: { text: string; bold: boolean }[][] }
```

Parsing happens in the main process. `StructuredText` only arranges these three shapes into semantic
DOM. There is no code path that takes HTML or a Markdown string — the type has no such hole, which is a
design decision rather than an omission.

## The rules, and why each exists

- **No `dangerouslySetInnerHTML`, no Markdown library inside the component.** Every string is rendered as
  text: `<img src=x onerror=…>` shows up as those characters and creates no element.
- **A link is never a link.** No `<a>`, no `href`, nothing opens on click. An address inside a sentence is
  content, not an affordance; rendering it clickable would hand the remote side a way to point our UI
  somewhere.
- **Semantic output, no extra ARIA.** Sections render as `<h3>` (the page owns `h1`/`h2`, and the document
  outline must not be reordered by body copy), paragraphs as `<p>`, lists as `<ul>` / `<li>`. No `role`,
  no `aria-*`: this is ordinary document content, not a landmark.
- **Long runs break instead of widening the page.** `overflow-wrap: anywhere` — a 300-character unbroken
  string (URL, hash, base64 fragment) wraps; `break-all` is deliberately not used because it cuts ordinary
  English words in half.
- **The component does not decide width.** The container does; the page caps reading width (480 px). The
  component only guarantees it will not push the container wider.
- **No expansion state.** `maxNodes` truncates and nothing else; "show all / show less" belongs to the page,
  which owns the flag.

## Using it

```tsx
<StructuredText nodes={releaseNotes} />        // all nodes
<StructuredText nodes={releaseNotes} maxNodes={8} />  // page-controlled "show all"
```

## What the tests can and cannot prove

`StructuredText.test.tsx` proves the security half directly, because it is DOM-shaped: a hostile snippet
becomes text, a URL produces zero `<a>` and no `href`, the three kinds map to the three tags, and the
package imports no HTML sink or Markdown parser. Two things it cannot do in a DOM without layout: it
asserts the **rule** for wrapping (`overflow-wrap: anywhere`) rather than a measured `scrollWidth`, and it
asserts the CSS declares no fixed width. The real-browser measurement for a 300-character run
(`scrollWidth === clientWidth`) is taken with a CDP probe and reported with the evidence, not asserted here.
