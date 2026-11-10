// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SettingsRow } from './SettingsRow'

/**
 * 设置行的**固定形状**：左边标签列、右边控件；给了控件列类名才包一层控件容器。
 *
 * 这里不再有形状开关的用例——`meta` / `copyAs` / `labelAs` 与 `SettingField` 的
 * `switchSize` 建于「来源行按注册表用通用组件渲染」那条判据之下；判据改成「来源行保留自己的
 * 行组件」之后它们没有消费方，按 H4 同规删除（2026-11-10）。
 */
describe('SettingsRow', () => {
  it('renders the label column and the bare control when no control wrapper is given', () => {
    const html = renderToStaticMarkup(createElement(SettingsRow, {
      copyClassName: 'copy', label: 'Name', rowClassName: 'row'
    }, createElement('button', null, 'x')))
    expect(html).toBe('<div class="row"><span class="copy">Name</span><button>x</button></div>')
  })

  it('wraps the label in the head element only when a head class is given', () => {
    const html = renderToStaticMarkup(createElement(SettingsRow, {
      copyClassName: 'copy', headClassName: 'head', label: 'Name', rowClassName: 'row'
    }, createElement('button', null, 'x')))
    expect(html).toBe('<div class="row"><span class="copy"><span class="head">Name</span></span><button>x</button></div>')
  })

  it('puts the row attributes on the row and the control attributes on the control wrapper', () => {
    const html = renderToStaticMarkup(createElement(SettingsRow, {
      controlAttributes: { 'aria-describedby': 'why' },
      controlWrapperClassName: 'control',
      copyClassName: 'copy',
      label: 'Name',
      rowAttributes: { 'data-setting-key': 'k' },
      rowClassName: 'row'
    }, createElement('button', null, 'x')))
    expect(html).toBe('<div class="row" data-setting-key="k"><span class="copy">Name</span><div class="control" aria-describedby="why"><button>x</button></div></div>')
  })
})
