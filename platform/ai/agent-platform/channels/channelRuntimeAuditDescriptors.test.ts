import { describe, expect, it } from 'vitest'

import { channelInboundAuditCodes } from './channelRuntimeAuditCodes'
import {
  channelRuntimeAuditDescriptors,
  channelTelegramFailureDescriptors,
  describeChannelRuntimeAudit
} from './channelRuntimeAuditDescriptors'
import { channelRuntimeFailureMirrorCodes } from './channelRuntimeFailureMirror'

describe('channel runtime audit descriptors', () => {
  it('covers every code in the closed set, and nothing outside it', () => {
    expect(Object.keys(channelRuntimeAuditDescriptors).sort()).toEqual([...channelInboundAuditCodes].sort())
  })

  it('keeps red for attempted failures only, never for a rule that skipped the attempt', () => {
    // 产品 2026-11-09：**有规则、没尝试 → 中性；尝试了、失败 → 红**。
    const errors = Object.entries(channelRuntimeAuditDescriptors)
      .filter(([, descriptor]) => descriptor.level === 'ERROR')
      .map(([code]) => code)
      .sort()
    expect(errors).toEqual([
      'channel-inbound-failed',
      'channel-receipt-without-work-item',
      'channel-work-capacity-exhausted'
    ])
  })

  it('keeps every rule-based skip neutral: they are not failures', () => {
    for (const code of ['channel-policy-denied', 'channel-mention-required', 'channel-content-rejected', 'channel-stale-generation', 'channel-conversation-switched', 'channel-agent-missing', 'channel-lifecycle-fenced'] as const) {
      expect(describeChannelRuntimeAudit(code)?.level, code).not.toBe('ERROR')
    }
  })

  it('covers every mirrored Telegram failure code, exactly once', () => {
    expect(Object.keys(channelTelegramFailureDescriptors).sort()).toEqual([...channelRuntimeFailureMirrorCodes].sort())
  })

  it('calls a taken bot or a rejected credential an error, but a retrying poll a warning', () => {
    expect(channelTelegramFailureDescriptors['telegram-conflict'].level).toBe('ERROR')
    expect(channelTelegramFailureDescriptors['telegram-provider-rejected'].level).toBe('ERROR')
    // 频率上限是规则（平台会自己重试）：中性，不画红。
    expect(channelTelegramFailureDescriptors['telegram-rate-limited'].level).toBe('INFO')
    // 轮询失败是**尝试过**的失败：红。
    expect(channelTelegramFailureDescriptors['telegram-poll-failed'].level).toBe('ERROR')
  })

  it('keeps ordinary rule-based skips at warn level, and answers nothing for an unknown code', () => {
    expect(describeChannelRuntimeAudit('channel-mention-required')?.level).toBe('INFO')
    expect(describeChannelRuntimeAudit('channel-policy-denied')?.level).toBe('INFO')
    expect(describeChannelRuntimeAudit('some-new-code')).toBeUndefined()
  })
})
