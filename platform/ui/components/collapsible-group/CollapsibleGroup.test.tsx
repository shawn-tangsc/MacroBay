// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CollapsibleGroup, type CollapsibleGroupProps, type CollapsibleGroupRow } from './CollapsibleGroup'

const keys = (value: string): string => value

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/**
 * rows 模式的 props：`children` 模式有自己的形状，两者互斥，helper 也分开。
 *
 * 这里逐项写出**具体那一支**而不是 `Extract<Props, { rows }>`：壳的头部现在本身是
 * 「键 / 原文」的联合，`Extract` 会在联合上分发成四个分支，`Partial<>` 再分发一次，
 * 造出来的对象类型对不上——测试 helper 就该是实打实的一种形状。
 */
type RowsModeProps = {
  titleKey: string
  metaKey?: string
  metaParams?: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  maxBodyHeight?: number | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  rows: readonly CollapsibleGroupRow[]
}

function props(overrides: Partial<RowsModeProps> = {}): RowsModeProps {
  return {
    titleKey: 'ui.test.groupTitle',
    metaKey: 'ui.test.groupCount',
    metaParams: { total: '41' },
    rows: [{ key: 'r1', labelKey: 'ui.test.rowOne', metaKey: 'ui.test.rowTime' }],
    resolveText: keys,
    ...overrides
  }
}

async function renderGroup(groupProps: CollapsibleGroupProps): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<CollapsibleGroup {...groupProps} />)
  })
  return host
}

async function mount(overrides: Partial<RowsModeProps> = {}): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<CollapsibleGroup {...props(overrides)} />)
  })
  return host
}

describe('CollapsibleGroup', () => {
  it('is collapsed by default, and the header says so', async () => {
    const host = await mount()

    const header = host.querySelector<HTMLElement>('.ant-collapse-header')!
    expect(header).not.toBeNull()
    expect(header.getAttribute('aria-expanded')).toBe('false')
    // 收起时展开区存在但不可见：id 要一直在，`aria-controls` 才不可能指向空节点。
    const body = host.querySelector<HTMLElement>('.collapsible-group__body')
    expect(body).not.toBeNull()
    // 收起态：内容节点在、但 `display: none`（antd 用 `-inactive` + 行内 display 表达）。
    const content = body?.closest<HTMLElement>('.ant-collapse-content')
    expect(content?.className).toContain('ant-collapse-content-inactive')
    expect(content?.style.display).toBe('none')
  })

  it('toggles from anywhere on the row, and points aria-controls at the region it opens', async () => {
    const host = await mount()

    // 点标题（不是箭头）：整行可点。
    const title = host.querySelector<HTMLElement>('.collapsible-group__title')!
    await act(async () => {
      title.click()
    })

    const header = host.querySelector<HTMLElement>('.ant-collapse-header')!
    expect(header.getAttribute('aria-expanded')).toBe('true')
    const controls = header.getAttribute('aria-controls')
    expect(controls).not.toBeNull()
    // 指向的节点必须真的存在——指向一个不存在的 id 比没有更糟。
    expect(document.getElementById(controls!)).not.toBeNull()
    expect(host.querySelector('.collapsible-group__row')).not.toBeNull()
  })

  it('keeps two groups independent: opening one does not close the other', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <>
          <CollapsibleGroup {...props()} />
          <CollapsibleGroup {...props({ titleKey: 'ui.test.otherTitle' })} />
        </>
      )
    })

    const headers = [...host.querySelectorAll<HTMLElement>('.ant-collapse-header')]
    await act(async () => {
      headers[0]!.querySelector<HTMLElement>('.collapsible-group__title')!.click()
    })

    expect(headers[0]!.getAttribute('aria-expanded')).toBe('true')
    expect(headers[1]!.getAttribute('aria-expanded')).toBe('false')
  })

  it('scrolls the expanded body, never the header', async () => {
    const host = await mount({
      maxBodyHeight: 200,
      rows: Array.from({ length: 41 }, (_, index) => ({ key: `r${index}`, labelKey: `ui.test.row${index}` }))
    })
    const title = host.querySelector<HTMLElement>('.collapsible-group__title')!
    await act(async () => {
      title.click()
    })

    const body = host.querySelector<HTMLElement>('.collapsible-group__body')!
    // 41 条：上限写在展开区自己身上，滚动条只出现在这里；头行是它的兄弟，不在滚动容器内。
    expect(body.style.maxHeight).toBe('200px')
    expect(body.contains(host.querySelector('.collapsible-group__title'))).toBe(false)
    expect(body.querySelectorAll('.collapsible-group__row')).toHaveLength(41)
    // 样式规则与行内上限一致：溢出时自己滚。
    // happy-dom 不加载组件样式表：直接读源文件（与本目录其他守卫同一手法）。
    const css = readFileSync(join(__dirname, 'collapsibleGroup.css'), 'utf8')
    expect(css).toMatch(/\.collapsible-group__body\s*\{[^}]*overflow:\s*auto/u)
  })

  it('paints the header with the group tier, and row titles one step lighter', () => {
    // 壳头行与分组标题同类：11.5 / 1.6 / 600 / muted-strong；列表行标题 12 / 1.5 / 500。
    // 两档必须差一档，否则同一列表里出现两种「可折叠头」（界面设计 2026-11-09 裁定）。
    const css = readFileSync(join(__dirname, 'collapsibleGroup.css'), 'utf8')
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`)
      return css.slice(start, css.indexOf('}', start))
    }
    const head = rule('.collapsible-group__title')
    expect(head).toContain('font-size: var(--font-section)')
    expect(head).toContain('font-weight: 600')
    expect(head).toContain('line-height: var(--line-section)')
    expect(head).toContain('color: var(--muted-strong)')

    const row = rule('.collapsible-group__row-title')
    expect(row).toContain('font-size: var(--font-body)')
    expect(row).toContain('font-weight: 500')
    expect(row).toContain('line-height: var(--line-body)')
  })

  it('accepts custom content instead of rows, and keeps the same six behaviours', async () => {
    // children 模式：壳只提供行为（头行档、箭头、aria、整行可点、默认收起、展开区自滚、头行不滚走），
    // 内容由调用方给；行级语义（整行按钮 / StatusPill 槽）不在这个模式下。
    const host = await renderGroup({
      titleKey: 'ui.test.groupTitle',
      resolveText: keys,
      maxBodyHeight: 240,
      children: <table data-custom-content><tbody><tr><td>自定义内容</td></tr></tbody></table>
    })

    const header = host.querySelector<HTMLElement>('.ant-collapse-header')!
    expect(header.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      host.querySelector<HTMLElement>('.collapsible-group__title')!.click()
    })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(header.getAttribute('aria-controls')!)).not.toBeNull()

    const body = host.querySelector<HTMLElement>('.collapsible-group__body')!
    expect(body.style.maxHeight).toBe('240px')
    expect(body.contains(host.querySelector('.collapsible-group__title'))).toBe(false)
    expect(body.querySelector('[data-custom-content]')).not.toBeNull()
    // children 模式下不渲染任何行级元素：没有 rows 就没有按钮行。
    expect(body.querySelector('.collapsible-group__row')).toBeNull()
  })

  it('takes a row label from a copy key, and a data label as the literal text', async () => {
    // 文案走键、数据走原文：会话名这类运行时字符串不是键，当键传进去会让解析器把数据翻成空串。
    const resolveText = vi.fn((value: string) => (value === 'ui.test.rowKey' ? '来自文案表' : ''))
    const host = await mount({
      rows: [
        { key: 'copy', labelKey: 'ui.test.rowKey' },
        { key: 'data', labelText: '2026/11/9 20:45 持仓骤降', metaText: '20:45' }
      ],
      resolveText
    })
    await act(async () => {
      host.querySelector<HTMLElement>('.collapsible-group__title')!.click()
    })

    const rows = [...host.querySelectorAll<HTMLElement>('.collapsible-group__row')]
    const copyRow = rows.find((row) => row.textContent?.includes('来自文案表'))!
    const dataRow = rows.find((row) => row.textContent?.includes('持仓骤降'))!
    // 文案行：解析器被调用，且行里是解析结果。
    expect(copyRow).toBeDefined()
    expect(resolveText).toHaveBeenCalledWith('ui.test.rowKey')
    // 数据行：原文进 DOM，**解析器没有被拿它的文字去查**（不被当成键）。
    expect(dataRow.textContent).toContain('2026/11/9 20:45 持仓骤降')
    expect(dataRow.textContent).toContain('20:45')
    expect(resolveText).not.toHaveBeenCalledWith('2026/11/9 20:45 持仓骤降')
  })

  it('is controlled when `open` is given: it reports the request and renders what it is told', async () => {
    const onOpenChange = vi.fn()
    // 受控：点击只发回调，组件不偷偷改自己的状态（`open={false}` 时点完仍是收起）。
    const host = await renderGroup({ ...props(), open: false, onOpenChange })
    await act(async () => {
      host.querySelector<HTMLElement>('.collapsible-group__title')!.click()
    })
    const header = host.querySelector<HTMLElement>('.ant-collapse-header')!
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })

  it('follows an external `open` change, and still toggles on its own when uncontrolled', async () => {
    const host = await renderGroup({ ...props(), open: false })
    const header = host.querySelector<HTMLElement>('.ant-collapse-header')!
    expect(header.getAttribute('aria-expanded')).toBe('false')

    // 外部改 `open` → 立刻展开（受控的判据在「外部」这一侧）。
    await act(async () => {
      root!.render(<CollapsibleGroup {...props()} open />)
    })
    expect(host.querySelector<HTMLElement>('.ant-collapse-header')!.getAttribute('aria-expanded')).toBe('true')

    // 非受控（不传 open）仍然自己开合：内部状态那条路没被受控改坏。
    const uncontrolled = await mount()
    const ownHeader = uncontrolled.querySelector<HTMLElement>('.ant-collapse-header')!
    expect(ownHeader.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      uncontrolled.querySelector<HTMLElement>('.collapsible-group__title')!.click()
    })
    expect(ownHeader.getAttribute('aria-expanded')).toBe('true')
  })

  it('takes a group title from data as well as from a key, without asking the resolver', async () => {
    // 日期（「11-07」）是数据不是文案键：`titleKey` 收不了它。与行标题同一规则——
    // 文案走键、数据走原文，解析器不被拿数据去查。
    const resolveText = vi.fn((value: string) => value)
    const host = await renderGroup({
      titleText: '11-07',
      metaText: '共 41 条',
      resolveText,
      rows: [{ key: 'r1', labelText: '会话名', metaText: '20:45' }]
    })

    expect(host.querySelector('.collapsible-group__title')!.textContent).toBe('11-07')
    expect(host.querySelector('.collapsible-group__meta')!.textContent).toBe('共 41 条')
    expect(resolveText).not.toHaveBeenCalled()
  })

  it('leaves the body uncapped when the caller says so, so a parent can own the scroll', async () => {
    // 两层折叠：外层展开区自滚（上限 320），内层每天一组不设上限——否则同一条列表上
    // 会出现两条互相套着的滚动条，滚到一半就卡在里层。
    const host = await renderGroup({
      titleText: '今天',
      resolveText: keys,
      maxBodyHeight: null,
      rows: [{ key: 'r1', labelText: '会话名' }]
    })
    await act(async () => {
      host.querySelector<HTMLElement>('.collapsible-group__title')!.click()
    })

    const body = host.querySelector<HTMLElement>('.collapsible-group__body')!
    expect(body.style.maxHeight).toBe('')
    // 溢出仍然不裁：上限交给外层，CSS 的 `overflow: auto` 在外层有上限时才会滚。
    expect(host.querySelector<HTMLElement>('.collapsible-group__title')!.closest('.collapsible-group__body')).toBeNull()
  })

  it('renders a row as a button only when the row has an action', async () => {
    const onSelect = vi.fn()
    const host = await mount({
      rows: [
        { key: 'a', labelKey: 'ui.test.rowA', onSelect },
        { key: 'b', labelKey: 'ui.test.rowB' }
      ]
    })
    const title = host.querySelector<HTMLElement>('.collapsible-group__title')!
    await act(async () => {
      title.click()
    })

    const rows = [...host.querySelectorAll<HTMLElement>('.collapsible-group__row')]
    const actionRow = rows.find((row) => row.textContent === 'ui.test.rowA')!
    const plainRow = rows.find((row) => row.textContent === 'ui.test.rowB')!
    expect(actionRow.tagName).toBe('BUTTON')
    expect(plainRow.tagName).toBe('DIV')

    await act(async () => {
      actionRow.click()
    })
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})
