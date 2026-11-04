import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'

/**
 * Small shape/reasoning guards shared by the editorial validator. Kept together so the validator
 * itself stays under its size ceiling; behaviour is unchanged — this is a pure move.
 */
import type { DailyBriefLedePattern } from '../../../contracts/dailyBriefing'

export function isLedePattern(value: unknown): value is DailyBriefLedePattern {
  return value === 'event-shock' || value === 'surprise-gap' || value === 'tension' || value === 'structure' || value === 'setup' || value === 'outlier' || value === 'falsification'
}

/**
 * A next-focus rationale has to name a transmission channel into the crypto book, not just say the
 * event is important or imminent. The vocabulary is deliberately broad (assets and channels) so a
 * correct sentence is not rejected for wording, while "it is the next event" is.
 */
export function hasBriefingNextTransmission(text: string): boolean {
  return /\b(?:btc|eth|bitcoin|ether|crypto|stablecoins?|etfs?|on-chain|liquidity|dollar|dxy|yields?|rates?|risk assets?|risk appetite)\b|比特币|以太坊|加密|稳定币|流动性|美元|收益率|利率|风险资产|链上/i.test(text)
}

export function collectToolResults(invocations: readonly AgentRuntimeToolInvocation[]): Map<string, { title: string; publishedAt?: string }> {
  const results = new Map<string, { title: string; publishedAt?: string }>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (!value || typeof value !== 'object') return
    const row = value as { title?: unknown; url?: unknown; publishedAt?: unknown; content?: unknown; results?: unknown }
    if (typeof row.url === 'string') {
      results.set(row.url, { title: typeof row.title === 'string' ? row.title : row.url, ...(typeof row.publishedAt === 'string' ? { publishedAt: row.publishedAt } : {}) })
    }
    if (row.content !== undefined) walk(row.content)
    if (row.results !== undefined) walk(row.results)
  }
  for (const invocation of invocations) walk(invocation.output)
  return results
}
