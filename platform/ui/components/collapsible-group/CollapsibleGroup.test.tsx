// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CollapsibleGroup, type CollapsibleGroupProps } from './CollapsibleGroup'

const keys = (value: string): string => value

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function props(overrides: Partial<CollapsibleGroupProps> = {}): CollapsibleGroupProps {
  return {
    titleKey: 'ui.test.groupTitle',
    metaKey: 'ui.test.groupCount',
    metaParams: { total: '41' },
    rows: [{ key: 'r1', labelKey: 'ui.test.rowOne', metaKey: 'ui.test.rowTime' }],
    resolveText: keys,
    ...overrides
  }
}

async function mount(overrides: Partial<CollapsibleGroupProps> = {}): Promise<HTMLDivElement> {
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
