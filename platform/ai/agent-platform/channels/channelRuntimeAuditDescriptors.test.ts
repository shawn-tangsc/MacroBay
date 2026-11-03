import { describe, expect, it } from 'vitest'

import { channelInboundAuditCodes } from './channelRuntimeAuditCodes'
import { channelRuntimeAuditDescriptors, describeChannelRuntimeAudit } from './channelRuntimeAuditDescriptors'

describe('channel runtime audit descriptors', () => {
  it('covers every code in the closed set, and nothing outside it', () => {
    expect(Object.keys(channelRuntimeAuditDescriptors).sort()).toEqual([...channelInboundAuditCodes].sort())
  })

  it('treats only the five real failures as errors', () => {
    const errors = Object.entries(channelRuntimeAuditDescriptors)
      .filter(([, descriptor]) => descriptor.level === 'ERROR')
      .map(([code]) => code)
      .sort()
    expect(errors).toEqual([
      'channel-agent-missing',
      'channel-inbound-failed',
      'channel-lifecycle-fenced',
      'channel-receipt-without-work-item',
      'channel-work-capacity-exhausted'
    ])
  })

  it('keeps ordinary rule-based skips at warn level, and answers nothing for an unknown code', () => {
    expect(describeChannelRuntimeAudit('channel-mention-required')?.level).toBe('WARN')
    expect(describeChannelRuntimeAudit('channel-policy-denied')?.level).toBe('WARN')
    expect(describeChannelRuntimeAudit('some-new-code')).toBeUndefined()
  })
})
