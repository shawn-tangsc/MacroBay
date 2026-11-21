import { describe, expect, it } from 'vitest'

import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'
import { describeNormalizeQueue, staleReceivedRecordPolicy } from './normalizeQueueDiagnostics'

const NOW = Date.parse('2026-11-21T16:00:00.000Z')
const OLD = '2026-11-19T20:14:59.000Z'
const FRESH = '2026-11-21T15:30:00.000Z'

function record(input: Readonly<{
  sourceId: string
  detectedAt: string
  state?: RawIntelligenceRecord['processingState']
}>): RawIntelligenceRecord {
  const id = `raw-${input.sourceId}-${input.detectedAt}-${input.state ?? 'received'}`
  return {
    rawRecordId: id,
    sourceId: input.sourceId,
    runId: `run-${id}`,
    detectedAt: input.detectedAt,
    payloadFormat: 'json',
    payloadRefType: 'inline',
    payloadBody: '{}',
    payloadHash: `${id}-hash`,
    sourceDedupeKey: id,
    processingOwner: 'generic-intelligence',
    processingState: input.state ?? 'received',
    parserVersion: 'fixture-v1',
    storageTier: 'hot',
    archiveStatus: 'none'
  }
}

describe('normalizeQueueDiagnostics', () => {
  it('counts the queue itself, not just news, so a frozen queue cannot look green', () => {
    /* 2026-11-21：采集全绿、新闻停在两天前。当时 930 条待办里 730 条是行情记录，
       只盯新闻的判据会漏掉这一半——所以第二个数字不分来源。 */
    const diagnostics = describeNormalizeQueue(
      [
        record({ sourceId: 'coindesk-rss', detectedAt: OLD }),
        record({ sourceId: 'binance-spot-market', detectedAt: OLD }),
        record({ sourceId: 'alternative-fear-greed', detectedAt: OLD }),
        record({ sourceId: 'coindesk-rss', detectedAt: FRESH }),
        // 已经处理掉的记录不算积压：判的是「还没动」的那部分。
        record({ sourceId: 'binance-spot-market', detectedAt: OLD, state: 'normalized' })
      ],
      NOW
    )

    expect(diagnostics.staleNewsCount).toBe(1)
    expect(diagnostics.staleReceivedCount).toBe(3)
  })

  it('does not count a record that is still inside the one-day window', () => {
    const diagnostics = describeNormalizeQueue(
      [record({ sourceId: 'binance-spot-market', detectedAt: new Date(NOW - staleReceivedRecordPolicy.staleAfterMs + 60_000).toISOString() })],
      NOW
    )

    expect(diagnostics.staleReceivedCount).toBe(0)
  })
})
