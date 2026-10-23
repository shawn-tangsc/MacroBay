import { describe, expect, it } from 'vitest'

import {
  buildAgentQuoteInsertion,
  buildAgentQuotedSelectionText,
  readAgentSelectedText
} from './agentSelectionContext'

describe('readAgentSelectedText', () => {
  it('returns empty text for a missing selection', () => {
    expect(readAgentSelectedText(null)).toBe('')
  })

  it('returns empty text for a collapsed selection', () => {
    expect(
      readAgentSelectedText({
        rangeCount: 1,
        isCollapsed: true,
        toString: () => 'selected text'
      })
    ).toBe('')
  })

  it('trims the live selection text', () => {
    expect(
      readAgentSelectedText({
        rangeCount: 1,
        isCollapsed: false,
        toString: () => '  selected text  '
      })
    ).toBe('selected text')
  })
})

describe('buildAgentQuotedSelectionText', () => {
  it('converts selected text into blockquote markup', () => {
    expect(buildAgentQuotedSelectionText('alpha\nbeta')).toBe('<blockquote>\n\nalpha\nbeta\n</blockquote>\n')
  })

  it('preserves blank lines inside the quote block body', () => {
    expect(buildAgentQuotedSelectionText('alpha\n\nbeta')).toBe('<blockquote>\n\nalpha\n\nbeta\n</blockquote>\n')
  })
})

describe('buildAgentQuoteInsertion', () => {
  it('returns empty text when the selection has no content', () => {
    expect(buildAgentQuoteInsertion('', '   ')).toBe('')
  })

  it('appends quoted content with breathing room when the draft already has text', () => {
    expect(buildAgentQuoteInsertion('Current draft', 'alpha\nbeta')).toBe('\n<blockquote>\n\nalpha\nbeta\n</blockquote>\n\n')
  })

  it('starts with the quote block when the draft is empty', () => {
    expect(buildAgentQuoteInsertion('', 'alpha')).toBe('<blockquote>\n\nalpha\n</blockquote>\n\n')
  })
})
