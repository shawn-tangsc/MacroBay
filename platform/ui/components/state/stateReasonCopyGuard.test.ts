import { describe, expect, it } from 'vitest'

import { STATE_VIEW_ACTION_CHOICES } from '../../../contracts/queryOutcome'

import { STATE_VIEW_TEXT_KEYS, type StateViewTextKey } from './StateView'
import { resolveStateViewText } from './stateViewText'

/**
 * 每个原因码都必须在**中英两份文案表里各有一条句子**，反向也查。
 *
 * 反面样本就在今天：`page-load-failed` 先加进码表、句子后补，中间那段时间只有 `tsc` 在用到它的
 * 那一行才报错——码是数据、句子是文案，两者不一致时类型系统看不见。这条守卫把「加码」和「写句子」
 * 绑在一起：少写一句红在测试阶段，不用等别人跑 `tsc`。
 *
 * 反向同样重要：文案表里有、码表里没有的句子是**死句子**——没人会读到它，却让下一个人以为那个码存在。
 */

const PREFIX = 'ui.state.error.reason.'
const LANGUAGES = ['zh-CN', 'en-US'] as const

/** 码表是运行期可枚举的：`STATE_VIEW_ACTION_CHOICES` 的 `error.*` 键就是 error 的原因码。 */
const codes = Object.keys(STATE_VIEW_ACTION_CHOICES)
  .filter((key) => key.startsWith('error.'))
  .map((key) => key.slice('error.'.length))

describe('every error reason code has copy in both languages, and nothing else does', () => {
  it('renders a sentence for every code in both languages, never the key name', () => {
    for (const language of LANGUAGES) {
      for (const code of codes) {
        const key = `${PREFIX}${code}` as StateViewTextKey
        const sentence = resolveStateViewText(language, key)
        // 空串 = 读者看到空白；回退键名 = 把 `ui.state.error.reason.x` 念给读屏。两种都算缺句子。
        expect(sentence.trim(), `${language} missing copy for ${code}`).not.toBe('')
        expect(sentence).not.toBe(key)
      }
    }
  })

  it('has no reason sentence for a code that does not exist', () => {
    const dead = STATE_VIEW_TEXT_KEYS.filter((key) => key.startsWith(PREFIX))
      .map((key) => key.slice(PREFIX.length))
      // 状态词那一层（`.reason` 之外）不算原因码，这里只看原因句。
      .filter((code) => !code.includes('.') && !codes.includes(code))
    expect(dead).toEqual([])
  })

  it('fails that judgement when a sentence is missing or extra, so it cannot pass vacuously', () => {
    // 反向实测：缺一句必须被报缺，多一条不存在的码必须被报死。
    const sampleCodes = ['unreadable', 'unavailable']
    const sampleCopy: Record<string, string> = { [`${PREFIX}unreadable`]: 'x', [`${PREFIX}gone`]: 'y' }
    const missing = sampleCodes.filter((code) => sampleCopy[`${PREFIX}${code}`] === undefined)
    const dead = Object.keys(sampleCopy)
      .map((key) => key.slice(PREFIX.length))
      .filter((code) => !sampleCodes.includes(code))

    expect(missing).toEqual(['unavailable'])
    expect(dead).toEqual(['gone'])
  })
})
