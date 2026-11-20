[English](./release-notes.md) | [中文](./release-notes.zh-CN.md) | [← Docs](../README.md)

# Release note body: format limits

The update note shown under **Settings → About** is the **GitHub Release body**, not the release-notes file
in the repository. The parser lives in `platform/updates/contracts/releaseNotes.ts` and understands four
formats only: section headings, paragraphs, bullet lists and inline bold. So the body is not just a piece
of text on a web page; it is content with a hard limit and a few shapes that distort.

This page is for **whoever writes that body**: count it and check it here before pasting into the Release page.

## The body and the repository's full text

- The About page shows the Release body only; `docs/reference/release-notes/<version>.md` and
  `.zh-CN.md` are the full text of the same version, for reading on the web and for the archive.
- **The body is the short version**: it may be shorter and may drop items, but facts and numbers must match
  the full text, and it must not say anything the full text does not say.
- Links in the body are not clickable; they show up as plain text. Send readers to download or report via the
  app's own buttons, not via an address in the body.
- A published body is a historical record: when the rule changes, change the rule, not a body already shipped.

## Hard limit: 200 content units

The limits are in `releaseNotesLimits`:

- `nodes: 200` — content units;
- `textCharacters: 20000` — characters for the whole body;
- `bodyBytes: 256 * 1024` — the byte limit when the body is fetched.

**How a unit is counted**: a section heading is 1, a paragraph is 1, **and each item of a bullet list is 1
too**; a code block is 1. A section with many bullets counts by those bullets, not as one section.

**Going over does not raise an error; it truncates silently**: the body is cut at 200 units and the About
page shows one extra line, "This note is long, so only the beginning is shown; see Release notes for the
full text". Everything after the cut is invisible to the reader; passing 20000 characters sets the same
flag. The 0.4.3 body was 197 units and was not truncated; 0.4.4 was 72. A version that landed close to the
line got lucky, it did not have headroom.

**Count it before publishing**; the check is `truncated: false` and some headroom left:

```bash
npx tsx .scratch/marketing/release-notes-units.mts docs-private/iterations/release-note-<version>.md
# → {"units":72,"truncated":false,"characters":6656}
```

(That script is a local helper that calls `parseReleaseNotes` with the same rule and is not committed; without
it, count as described above: section headings + paragraphs + list items.)

## Shapes that distort

- **`---` between the Chinese and English parts**: it parses as a paragraph containing `---`, so the reader sees
  a lone horizontal bar. Separate languages with a heading, not a rule.
- **`1. 2. 3.` numbered lists**: every physical line becomes its own paragraph, and a manually wrapped second
  line becomes a paragraph of its own. Put numbering inside bullets instead.
- **Tables**: there is no table format; the rows merge into one paragraph and the columns no longer line up.
- **Images**: only the caption text survives; the image itself is not shown.
- **Block quotes `>`**: the leading `>` is dropped and the line shows as an ordinary paragraph.
- **Code blocks**: kept as code, with no markup interpreted inside. Good for commands, not for explanation.

## Reading side: fixed height, no expand

The note block on the About page is **fixed height with its own scroll** (`.about-notes-scroller` uses
`max-height: min(360px, 46vh)`), and there is no "show all" button; scrolling past the end moves the page
behind it.

So the opening must be the most important change of the version, and install, compatibility and known
limitations must sit **within the first 3 blocks** — the part a reader sees on opening, without scrolling.

## Checks before publishing

1. Count the units, confirm `truncated: false`, and leave headroom.
2. Check the shapes: no `---` separator, no numbered list, no table, no image, no address link.
3. Check the order: is the first block the most important change of this version, and are all the
   limitation items within the first 3 blocks.
4. Record the unit count, the `truncated` value and "checked against the in-app display constraints" in the
   release record.
