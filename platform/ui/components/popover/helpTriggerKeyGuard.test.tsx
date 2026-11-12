// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '../../shell/ShellLanguageContext'

import { helpTrigger } from './helpTrigger'
import { HELP_TRIGGER_KEY, resolveHelpTriggerText } from './helpTriggerText'

/**
 * `helpTrigger` 的读屏名：**平台给的一句真话**，不是调用点传进来的浮层正文。
 *
 * 改之前组件里有个自造的解析器：`resolveText={(key) => key === 'ui.help.trigger' ? label : ''}`，
 * 而 `ui.help.trigger` 在任何文案表里都不存在——那颗 ⓘ 的名字其实是调用点塞的句子
 * （没人传就退回浮层正文），同一个动作在不同页面读出不同的话。
 *
 * 判据分三层，最外面一层是行为：
 * 1. 渲染出来那颗按钮的 `aria-label` 就是「查看说明」/「Show details」（不是句子、不是键名、不是空串）；
 * 2. 这句话在 `platform/ui` 的文案表里真实存在（中英各一句，都不是空串）；
 * 3. 源码里不再有自造解析器、也不再收 `label` 入参——把假键写回去必须红。
 */
const SOURCE = readFileSync(join(__dirname, 'helpTrigger.tsx'), 'utf8')

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function renderAriaLabel(language: 'zh-CN' | 'en-US'): Promise<string | null> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language,
      children: helpTrigger({ text: '关掉后不再调用模型。' })
    }))
  })
  return host.querySelector('button')?.getAttribute('aria-label') ?? null
}

describe('helpTrigger 的读屏名', () => {
  it('names the trigger with the platform sentence, not the sentence it explains', async () => {
    expect(await renderAriaLabel('zh-CN')).toBe('查看说明')
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    expect(await renderAriaLabel('en-US')).toBe('Show details')
  })

  it('keeps both languages in the platform copy table, non-empty and translated', () => {
    expect(resolveHelpTriggerText('zh-CN', HELP_TRIGGER_KEY)).toBe('查看说明')
    expect(resolveHelpTriggerText('en-US', HELP_TRIGGER_KEY)).toBe('Show details')
    // 同一个键两种语言不能是同一份拷贝（说明真的翻译过，不是占位）。
    expect(resolveHelpTriggerText('zh-CN', HELP_TRIGGER_KEY))
      .not.toBe(resolveHelpTriggerText('en-US', HELP_TRIGGER_KEY))
    expect(HELP_TRIGGER_KEY).toBe('ui.help.trigger')
  })

  it('does not make up its own resolver, and takes no label it could stuff a sentence into', () => {
    // 反向：把 `resolveText={(key) => key === 'ui.help.trigger' ? … : ''}` 写回来，这条红。
    expect(SOURCE).not.toMatch(/key\s*===\s*['"]ui\.help\.trigger['"]/u)
    expect(SOURCE).not.toMatch(/label\s*\?\s*:/u)
    // 正向：可访问名用的是平台键常量，解析器来自平台那张表。
    expect(SOURCE).toContain('ariaLabelKey={HELP_TRIGGER_KEY}')
    expect(SOURCE).toContain('useHelpTriggerText()')
  })
})
