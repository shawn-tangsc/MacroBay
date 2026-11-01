// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { posterExportBackground } from './dailyBriefingExport'

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
