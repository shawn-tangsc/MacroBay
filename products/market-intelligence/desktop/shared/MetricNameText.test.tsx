// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { MetricNameText } from './MetricNameText'

/**
 * 名称列按界面语言取主名（用户 2026-11-20：「英文主题还是有中文写死」）。
 *
 * 三条判据：
 * 1. `en-US` 且英文可得 → 渲染结果**不含 CJK**（正则断言）；
 * 2. `en-US` 且英文缺失 → 回退中文名（不显示等于把这条藏起来，更糟）；
 * 3. `zh-CN` → 与原来逐字一致（中文主语 + 英文小灰字）。
 */
let root: Root | undefined
let host: HTMLDivElement | undefined
const CJK = /[\u3400-\u9fff]/u

afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host?.remove(); host = undefined })

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(node) })
  return host
}

describe('MetricNameText by interface language', () => {
  it('shows English only under en-US, with no CJK left in the cell', async () => {
    const el = await mount(<MetricNameText zh="非农新增就业" en="Nonfarm payrolls" locale="en-US" />)
    expect(el.textContent).toBe('Nonfarm payrolls')
    expect(el.textContent).not.toMatch(CJK)
    // 英文是主语：不能套上「次要信息」那档小灰字。
    expect(el.querySelector('.mi-name__en')).toBeNull()
  })

  it('falls back to the Chinese name when no English name exists at all', async () => {
    // 真库 3430 行里有 2042 行没有任何英文名：不给名字等于把这条藏起来，所以回退中文。
    const el = await mount(<MetricNameText zh="未季调消费者物价指数" en={null} locale="en-US" />)
    expect(el.textContent).toBe('未季调消费者物价指数')
  })

  it('keeps the Chinese layout byte-for-byte: Chinese first, English as the small grey line', async () => {
    const el = await mount(<MetricNameText zh="非农新增就业" en="Nonfarm payrolls" locale="zh-CN" />)
    expect(el.textContent).toBe('非农新增就业Nonfarm payrolls')
    expect(el.querySelector('.mi-name__en')?.textContent).toBe('Nonfarm payrolls')
    // 没有英文时不留半句。
    const onlyZh = await mount(<MetricNameText zh="非农新增就业" en={null} locale="zh-CN" />)
    expect(onlyZh.textContent).toBe('非农新增就业')
    expect(onlyZh.querySelector('.mi-name__en')).toBeNull()
  })

  it('keeps the owner suffix in both languages', async () => {
    const el = await mount(<MetricNameText zh="费城联储" en="Philadelphia Fed" owner="母指标 · 子项" locale="en-US" />)
    expect(el.textContent).toBe('Philadelphia Fed母指标 · 子项')
    expect(el.querySelector('.mi-name__owner')).not.toBeNull()
  })
})
