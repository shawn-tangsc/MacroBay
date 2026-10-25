import { describe, expect, it } from 'vitest'

import {
  binanceAnnouncementCodeFromUrl,
  binanceAnnouncementDetailUrl,
  extractBinanceAnnouncementBody
} from './binanceAnnouncementBody'

const CODE = 'ab3a0eac9e614819b7b6fa0c03504b1f'

function slate(words: string[]) {
  return JSON.stringify({
    data: {
      body: JSON.stringify({
        node: 'root',
        child: words.map((text) => ({
          node: 'element',
          tag: 'p',
          child: [{ node: 'element', tag: 'span', child: [{ node: 'text', text }] }]
        }))
      })
    }
  })
}

describe('binanceAnnouncementBody', () => {
  it('reads the code from either announcement URL shape', () => {
    expect(binanceAnnouncementCodeFromUrl(`https://www.binance.com/en/support/announcement/${CODE}`)).toBe(CODE)
    expect(binanceAnnouncementCodeFromUrl(`https://www.binance.com/en/support/announcement/detail/${CODE}`)).toBe(CODE)
    expect(binanceAnnouncementDetailUrl(CODE)).toContain(`articleCode=${CODE}`)
  })

  it('turns the CMS Slate document into paragraphs', () => {
    const body = 'Binance will remove PTB, AA, OWL, DORA, ELIZAOS and MEMES from Binance Alpha. '.repeat(3)
    const result = extractBinanceAnnouncementBody({ json: slate([body, 'Trading will stop at 2026-10-24 06:00 UTC.']) })
    expect(result.state).toBe('available')
    expect(result.text).toContain('Binance will remove PTB')
    expect(result.text).toContain('Trading will stop')
  })

  it('returns too-short for an empty or malformed body', () => {
    expect(extractBinanceAnnouncementBody({ json: 'not-json' }).state).toBe('too-short')
  })
})
