import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '../../shell/ShellLanguageContext'
import { STATE_VIEW_TEXT_KEYS, type StateViewTextKey } from './StateView'
import { resolveStateViewText, STATE_VIEW_ACTION_KEYS, useStateViewText } from './stateViewText'

/** 最小组件：把 hook 的结果渲染出来，证明语言确实来自上下文而不是参数。 */
function Probe(props: { keys: readonly StateViewTextKey[] }): string {
  const resolve = useStateViewText()
  return <span>{props.keys.map((key) => resolve(key)).join('|')}</span>
}

function rendered(language: 'zh-CN' | 'en-US', keys: readonly StateViewTextKey[]): string {
  return renderToStaticMarkup(
    createElement(ShellLanguageProvider, { language }, createElement(Probe, { keys }))
  )
}

describe('ui.state 文案归平台一处拥有', () => {
  it('闭集里的每个键两种语言都有句子，没有空串', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      for (const key of STATE_VIEW_TEXT_KEYS) {
        expect(resolveStateViewText(language, key), `${language} ${key}`).not.toBe('')
      }
    }
  })

  it('中文与英文不是同一份拷贝（同一键必须真的翻译过）', () => {
    const untranslated = STATE_VIEW_TEXT_KEYS.filter(
      (key) => resolveStateViewText('zh-CN', key) === resolveStateViewText('en-US', key)
    )
    // 允许命中的只有本来就一样的词形；出现新的就说明有人漏翻。
    expect(untranslated).toEqual([])
  })

  it('未知键返回空串，不回退键名（回退会把 `ui.state.*` 念给读屏用户）', () => {
    expect(resolveStateViewText('zh-CN', 'ui.state.nope' as StateViewTextKey)).toBe('')
    expect(resolveStateViewText('en-US', 'ui.state.empty.reason.nope' as StateViewTextKey)).toBe('')
  })

  it('动作键只有一个来源：常量表，且每个键两种语言都有句子', () => {
    const values = Object.values(STATE_VIEW_ACTION_KEYS)
    expect(values.length).toBeGreaterThan(0)

    for (const value of values) {
      // 动作键**不再手写进 `STATE_VIEW_TEXT_KEYS`**：那张清单只剩状态与原因键，
      // 动作键由这个对象推导进类型。两份清单靠人同步，今晚已经掉队过两个。
      expect(STATE_VIEW_TEXT_KEYS as readonly string[]).not.toContain(value)
      expect(value.startsWith('ui.state.action.')).toBe(true)
      // 加键忘写文案 → 这里红，位置就是错过的地方。
      expect(resolveStateViewText('zh-CN', value)).not.toBe('')
      expect(resolveStateViewText('en-US', value)).not.toBe('')
    }
  })

  it('状态与原因键那张清单里，一个动作键都不许混进去', () => {
    const strays = STATE_VIEW_TEXT_KEYS.filter((key) => key.startsWith('ui.state.action.'))
    expect(strays).toEqual([])
  })

  it('hook 从上下文取语言，产品不传语言参数', () => {
    const keys = ['ui.state.empty.reason.not-yet', 'ui.state.action.retry'] as const

    expect(rendered('zh-CN', keys)).toContain('还没有发生过')
    expect(rendered('en-US', keys)).toContain('has not happened yet')
  })
})
