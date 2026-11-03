import { describe, expect, it } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import {
  CHANNEL_ENABLE_FAILURE_REASONS,
  CHANNEL_MUTATION_FAILURE_REASONS,
  channelFailureReason,
  enableFailureSentence,
  mutationFailureSentence
} from './channelSettingsPresentation'

const zh = platformText['zh-CN'].settings
const en = platformText['en-US'].settings

/**
 * 失败的话必须**每一种失败都有**。
 *
 * 这条断言存在的理由：上一版只映射了自检的 5 个码，别的码（凭据没存、频道不在了、运行时没起来）
 * 全落进兜底句「原因没有上报」——用户看到的就是「失败但不知道为什么」。所以这里钉几件事：
 * 两张闭集里每个码在中英两套文案表里都有话；闭集外走一句实话，且绝不出现内部码。
 */
describe('failure sentences', () => {
  it('has plain words for every code in both closed sets, in both locales', () => {
    for (const code of [...CHANNEL_ENABLE_FAILURE_REASONS, ...CHANNEL_MUTATION_FAILURE_REASONS]) {
      for (const labels of [zh, en]) {
        const sentence = channelFailureReason(code, labels)
        expect(sentence).not.toBeNull()
        expect(sentence).not.toContain(code)
        expect(sentence?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('says something honest for a code outside the closed set, without the internal code', () => {
    for (const labels of [zh, en]) {
      expect(channelFailureReason('some-new-code', labels)).toBeNull()
      const enableSentence = enableFailureSentence({ ok: false, code: 'some-new-code' }, labels) ?? ''
      const mutationSentence = mutationFailureSentence({ ok: false, code: 'some-new-code' }, labels) ?? ''
      for (const sentence of [enableSentence, mutationSentence]) {
        expect(sentence).not.toContain('some-new-code')
        // 「拿不到」不许写成「没有上报」：那是把空值包装成解释。
        expect(sentence).not.toContain('没有上报')
        expect(sentence).not.toContain('not reported')
      }
    }
  })

  it('reads the reason first, then the code, and treats a missing answer as a failure', () => {
    // 自检失败：带 reason。
    expect(enableFailureSentence({ ok: false, code: 'channel-smoke-failed', reason: 'telegram-conflict' }, zh)).toBe(
      zh.channelFailureReason['telegram-conflict']
    )
    // 只有 code 的失败（凭据没存 / 频道不在了 / 运行时没起来）：也必须翻成人话。
    expect(enableFailureSentence({ ok: false, code: 'channel-credential-missing' }, zh)).toBe(
      zh.channelFailureReason['channel-credential-missing']
    )
    // 成功 → 不说话。
    expect(enableFailureSentence({ ok: true, code: 'runtime-ready' }, zh)).toBeNull()
    // 什么都没拿回来也是没开成：给一句实话，不许静默回弹。
    expect(enableFailureSentence(undefined, zh)).toBe(zh.channelFailureReasonUnknown)
  })

  it('never calls a mutation successful without an explicit ok', () => {
    // 只有 `ok === true` 才算成功：新建/编辑/删除失败时是正常返回 `{ ok:false, code }`。
    expect(mutationFailureSentence({ ok: true, code: 'configuration-ready' }, zh)).toBeNull()
    expect(mutationFailureSentence({ ok: false, code: 'channel-agent-missing' }, zh)).toBe(
      zh.channelFailureReason['channel-agent-missing']
    )
    // 没拿回结果 / 结果里没有 ok：一样算没成功，给的是「没成功」那句，不是「成功」。
    expect(mutationFailureSentence(undefined, zh)).toBe(zh.channelOperationFailedUnknown)
    expect(mutationFailureSentence({}, zh)).toBe(zh.channelOperationFailedUnknown)
  })
})
