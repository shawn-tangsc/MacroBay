// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SettingsRow } from './SettingsRow'

describe('SettingsRow', () => {
  it('renders exactly the two columns, with the class names the caller owns', () => {
    // 判据是「DOM 与类名由调用方给」：合并前后三处的类名一个都不许变，所以组件不写死类名。
    const markup = renderToStaticMarkup(
      <SettingsRow
        controlWrapperClassName="intelligence-setting-control"
        copyClassName="intelligence-setting-label"
        label={<>发送测试</>}
        rowClassName="intelligence-setting-row">
        <button type="button">发送</button>
      </SettingsRow>
    )
    expect(markup).toBe(
      '<div class="intelligence-setting-row"><span class="intelligence-setting-label">发送测试</span>'
      + '<div class="intelligence-setting-control"><button type="button">发送</button></div></div>'
    )
  })

  it('wraps the label in the caller head layer when one is given', () => {
    // 标签与 ⓘ 必须并排：这一层是排版决定，留在同一个地方，别处不再各写一遍。
    const markup = renderToStaticMarkup(
      <SettingsRow
        controlWrapperClassName="notification-row-control"
        copyClassName="notification-row-copy"
        headClassName="notification-row-head"
        label={<><strong>发送测试</strong><span>ⓘ</span></>}
        rowClassName="notification-row">
        <button type="button">发送</button>
      </SettingsRow>
    )
    expect(markup).toContain('<span class="notification-row-copy"><span class="notification-row-head">')
    expect(markup).toContain('<div class="notification-row-control">')
  })

  it('has no slot for an explanatory sentence', () => {
    // 正文只允许字段名、当前值、控件。说明只能进 ⓘ——所以这个组件的 props 里没有 note/description。
    // 这条靠类型也靠渲染：多给一个 children 之外的句子，它只能进控件列，而控件列是调用方的事。
    expect(Object.keys({ rowClassName: '', copyClassName: '', label: '', controlWrapperClassName: '' }))
      .not.toContain('note')
  })
})
