// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { StructuredText, type StructuredTextNode } from './StructuredText'

/**
 * 这个组件的全部价值在于「远端文字不能变成我们的界面」，所以测试的重点不是排版，是**边界**：
 * 一段带着 `<img onerror>` 的文字必须原样显示成字符，一个网址必须只是文字，超长串不许撑破容器。
 * 每一条都要能红——「渲染出来了」不算证据。
 */

const source = readFileSync(join(__dirname, 'StructuredText.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'structuredText.css'), 'utf8')
/** 断言只看代码与规则，不看注释：注释里会写反例（`break-all`、`<a>`）来解释为什么禁止它们。 */
const sourceCode = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
const cssRules = css.replace(/\/\*[\s\S]*?\*\//gu, '')

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function mount(nodes: readonly StructuredTextNode[]): HTMLDivElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(<StructuredText nodes={nodes} />)
  })
  return host
}

const paragraph = (text: string, bold = false): StructuredTextNode => ({ kind: 'paragraph', runs: [{ text, bold }] })

describe('StructuredText', () => {
  it('renders a hostile snippet as characters, never as an element', () => {
    // 这是整个组件存在的理由：远端文字只能变成字，不能变成 DOM。
    const host = mount([paragraph('<img src=x onerror="alert(1)">')])
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('[onerror]')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('never produces a link, a href, or anything clickable', () => {
    const host = mount([paragraph('发布说明见 https://example.com/release 这一页')])
    expect(host.querySelectorAll('a')).toHaveLength(0)
    expect(host.innerHTML).not.toContain('href')
    // 地址仍然是可读的文字——只是不可点。
    expect(host.textContent).toContain('https://example.com/release')
  })

  it('keeps the three node kinds semantic: heading, paragraph, list', () => {
    const host = mount([
      { kind: 'section', title: '新增' },
      { kind: 'paragraph', runs: [{ text: '普通说明', bold: false }] },
      { kind: 'list', items: [[{ text: '第一条', bold: true }]] }
    ])
    // 页面拥有 h1/h2，正文小节从 h3 起。
    expect(host.querySelector('h3')?.textContent).toBe('新增')
    expect(host.querySelector('p')?.textContent).toBe('普通说明')
    expect(host.querySelectorAll('ul > li')).toHaveLength(1)
    expect(host.querySelector('li strong')?.textContent).toBe('第一条')
    // 不加多余的 aria：这是普通文档内容，不是地标。
    expect(host.innerHTML).not.toContain('aria-')
    expect(host.innerHTML).not.toContain('role=')
  })

  it('breaks long unbreakable runs instead of widening the page', () => {
    // happy-dom 不算布局，所以这里判的是**规则本身**；真机上的 scrollWidth === clientWidth 由交付图证明。
    expect(cssRules).toContain('overflow-wrap: anywhere')
    expect(cssRules).not.toContain('break-all')
    // 组件不决定宽度：不许出现 width/min-width 之外的自定义宽度（min-width: 0 是允许的，它防撑破）。
    expect(cssRules).not.toMatch(/(^|[^-])width:\s*\d/u)
  })

  it('truncates by maxNodes without holding any expansion state', () => {
    const nodes: StructuredTextNode[] = [paragraph('一'), paragraph('二'), paragraph('三')]
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root!.render(<StructuredText maxNodes={2} nodes={nodes} />)
    })
    expect([...host.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['一', '二'])
    // 纯渲染：同一个入参渲两次结果一样（没有内部状态）。
    const a = renderToStaticMarkup(<StructuredText maxNodes={2} nodes={nodes} />)
    const b = renderToStaticMarkup(<StructuredText maxNodes={2} nodes={nodes} />)
    expect(a).toBe(b)
  })

  it('admits no rich-text machinery: no HTML sink, no Markdown library, no link builder', () => {
    expect(sourceCode).not.toContain('dangerouslySetInnerHTML')
    expect(sourceCode).not.toMatch(/from ['"](marked|markdown-it|remark|rehype|showdown|micromark)/u)
    expect(sourceCode).not.toContain('innerHTML')
    // 也不许自己拼 `<a href>`：链接在这套结构里不存在。
    expect(sourceCode).not.toMatch(/<a\s|href=/u)
  })
})

/** 编译期契约：节点是封闭结构，多给一个字段就编译不过。 */
export function structuredTextTypeContract(): void {
  // @ts-expect-error `kind` 只能是三种之一
  const wrongKind: StructuredTextNode = { kind: 'html', text: '<b>x</b>' }
  // @ts-expect-error section 只有 title，没有正文
  const sectionWithRuns: StructuredTextNode = { kind: 'section', title: 'x', runs: [] }
  // @ts-expect-error run 只有 text 与 bold
  const runWithLink: StructuredTextNode = { kind: 'paragraph', runs: [{ text: 'x', bold: false, href: 'https://x' }] }
  const props: Parameters<typeof StructuredText>[0] = {
    // @ts-expect-error 组件不收字符串：输入是节点，不是 Markdown 文本
    nodes: '## 标题'
  }
  void wrongKind
  void sectionWithRuns
  void runWithLink
  void props
}
