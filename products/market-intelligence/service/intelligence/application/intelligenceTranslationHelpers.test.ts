import { describe, expect, it } from 'vitest'

import { shouldTranslateForReason } from './intelligenceTranslationHelpers'

describe('shouldTranslateForReason', () => {
  it('runs automatic work only when auto translation is on', () => {
    for (const reason of ['new-item', 'settings-change', 'replay'] as const) {
      expect(shouldTranslateForReason({ autoTranslateEnabled: false }, reason)).toBe(false)
      expect(shouldTranslateForReason({ autoTranslateEnabled: true }, reason)).toBe(true)
    }
  })

  it('always allows a reader-initiated translation or retry', () => {
    for (const reason of ['manual-selection', 'retry-failed'] as const) {
      expect(shouldTranslateForReason({ autoTranslateEnabled: false }, reason)).toBe(true)
    }
  })
})
