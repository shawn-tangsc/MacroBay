// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { resolveProductTextKey } from '../../../shared/i18n/productTextKey'
import { CellSourceWord, format } from './capitalTables'

/**
 * 「这一格没启用」那句话只有**一个出处**：`sourcesNotEnabledWithSource`（带 `{source}`）。
 *
 * 为什么钉它：这句话原先在四个地方各自拼一遍——句子取一条键、括号与源名在代码里手拼。
 * 句子改了、或者中英文用了不同的括号，四处就会各说一套，而且**没有任何用例会红**，
 * 因为每一处看着都「有文案」。用例分两层：
 *
 * 1. **行为**：渲染出来的句子，就是「键按 `{source}` 填好」的那句（键是唯一出处）；
 * 2. **源码**：四个调用点都不再把括号与源名手拼在键后面（`…sourcesNotEnabled'）}（` 这个形状）。
 *
 * 第 2 层是形状守卫而不是行为守卫：它挡的是「重新手拼」这一种改法，句子的对错由第 1 层管。
 */
const KEY = 'pages.intelligence.portal.data.sourcesNotEnabledWithSource'
const SOURCE_LABEL = '0xRouter 聚合行情'

const CALL_SITES = [
  'products/market-intelligence/desktop/features/industry/capital-conditions/capitalTables.tsx',
  'products/market-intelligence/desktop/features/industry/market-sentiment/SentimentOptionsCard.tsx'
]

describe('「这一格没启用」的句子', () => {
  it.each(['zh-CN', 'en-US'] as const)('在 %s 里带 {source} 占位', (locale) => {
    const template = resolveProductTextKey(locale, KEY)
    expect(template).toContain('{source}')
    // 占位前面必须有那句「没启用」：只剩一个括号的话，读者读不出发生了什么。
    expect(template.replace('{source}', '').trim().length).toBeGreaterThan(1)
  })

  it.each(['zh-CN', 'en-US'] as const)('渲染 %s 时键是唯一出处，源名填进括号', (locale) => {
    const markup = renderToStaticMarkup(createElement(ShellLanguageProvider, {
      language: locale,
      children: createElement(CellSourceWord, { availability: { sourceLabel: SOURCE_LABEL, onOpenSources: () => undefined } })
    }))
    expect(markup).toContain(format(resolveProductTextKey(locale, KEY), { source: SOURCE_LABEL }))
  })

  it.each(CALL_SITES)('%s 不再把括号与源名手拼在句子后面', (file) => {
    const code = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(code).toContain('sourcesNotEnabledWithSource')
    // 旧形状：先取纯句子，再在字符串里补一个全角括号和源名。
    expect(code).not.toMatch(/sourcesNotEnabled'\)\}（/)
  })
})