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

  it('keeps the node kinds a closed set, because a new kind is a security decision', () => {
    // 远端文字能决定我们渲染什么，等于写文案的人能决定界面长什么样。所以 `kind` 的闭集不是风格：
    // 有人想加 `kind: 'html'` 时，这条必须红，并且红在一个写着「安全问题」的地方。
    const kinds = [...sourceCode.matchAll(/kind:\s*'([a-z]+)'/gu)].map((match) => match[1])
    // 允许集合是**四种**：三种正文节点 + 代码块。加第五种先红在这里。
    expect([...new Set(kinds)].sort()).toEqual(['code', 'list', 'paragraph', 'section'])
    // 类型声明本身也钉住：三种之外的 kind 不许出现在 TypeScript 里。
    expect(sourceCode).not.toMatch(/kind:\s*'(html|raw|markdown|link|table|image|htmlBlock)'/u)
  })

  it('renders a code block verbatim: no list, no bold, no element, no horizontal scroll', () => {
    const lines = ['npm run verify', '- 这一行不是列表', '**这一行不是加粗**', '<img src=x onerror="alert(1)">']
    const host = mount([{ kind: 'code', lines }])
    const pre = host.querySelector('pre')
    expect(pre).not.toBeNull()
    // 换行结构保留，标记一个字符都不解释。
    expect(pre?.textContent).toBe(lines.join('\n'))
    expect(host.querySelectorAll('ul, li, strong, img')).toHaveLength(0)
    expect(host.innerHTML).not.toContain('dangerouslySetInnerHTML')
    // 长行换行而不是出横向滚动条：规则必须同时具备 pre-wrap 与 anywhere，且**不许** overflow-x: auto/scroll。
    const codeRule = /\.structured-text__code\s*\{([^}]*)\}/u.exec(cssRules)?.[1] ?? ''
    expect(codeRule).toContain('white-space: pre-wrap')
    expect(codeRule).toContain('overflow-wrap: anywhere')
    expect(codeRule).not.toMatch(/overflow-x:\s*(auto|scroll)/u)
  })

  it('shows inline code as monospace text, never as a link or a control', () => {
    const host = mount([{ kind: 'paragraph', runs: [{ text: '先跑 ', bold: false }, { text: 'npm run verify', bold: false, code: true }] }])
    const inline = host.querySelector('code.structured-text__inline-code')
    expect(inline?.textContent).toBe('npm run verify')
    expect(host.querySelectorAll('a')).toHaveLength(0)
    expect(host.querySelectorAll('[href]')).toHaveLength(0)
    // 不是按钮、不带 tabindex：行内代码不是可操作的东西。
    expect(inline?.closest('button, a, [tabindex]')).toBeNull()
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
  // @ts-expect-error 代码块只有 `lines`，没有 `lang`/`title`：远端不能给代码块加解释入口
  const codeWithLang: StructuredTextNode = { kind: 'code', lines: ['x'], lang: 'ts' }
  // @ts-expect-error 行内标记只有 code，没有 href
  const runWithHref: StructuredTextNode = { kind: 'paragraph', runs: [{ text: 'x', bold: false, href: '#' }] }
  const props: Parameters<typeof StructuredText>[0] = {
    // @ts-expect-error 组件不收字符串：输入是节点，不是 Markdown 文本
    nodes: '## 标题'
  }
  void codeWithLang
  void runWithHref
  void wrongKind
  void sectionWithRuns
  void runWithLink
  void props
}
