// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { briefingExportFileName, posterExportBackground } from './dailyBriefingExport'

describe('posterExportBackground', () => {
  it('reads the paper colour the poster is painted in', () => {
    const poster = document.createElement('div')
    poster.style.backgroundColor = 'rgb(244, 239, 228)'
    document.body.append(poster)

    expect(posterExportBackground(poster)).toBe('rgb(244, 239, 228)')
  })

  // A wrapper with no paper of its own must not become an opaque export: passing the library an
  // unreadable value paints the image on a colour the stylesheet never chose.
  it('says nothing when the element paints no background', () => {
    const bare = document.createElement('div')
    document.body.append(bare)

    expect(posterExportBackground(bare)).toBeUndefined()
    expect(posterExportBackground(null)).toBeUndefined()
  })
})

describe('briefingExportFileName', () => {
  it('names the file after the edition language, not the interface language', () => {
    // The interface may be Chinese while the reader exports the English edition; a `-zh-CN.png`
    // name would tell them the picture is in a language it is not.
    expect(briefingExportFileName({ edition: { date: '2026-11-03', locale: 'en-US' } }))
      .toBe('mi-daily-brief-2026-11-03-en-US.png')
    expect(briefingExportFileName({ edition: { date: '2026-11-03', locale: 'zh-CN' } }))
      .toBe('mi-daily-brief-2026-11-03-zh-CN.png')
  })
})
