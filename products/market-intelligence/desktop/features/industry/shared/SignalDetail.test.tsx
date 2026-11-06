// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { SignalDetail } from './SignalDetail'

const zh = productText['zh-CN'].pages.intelligence.portal.dashboard.positioning
const base = {
  id: 'mi-signal-detail-test',
  titleKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsTitle'
}

describe('the shared chip detail', () => {
  it('renders the module text verbatim: the component formats nothing', () => {
    const markup = renderToStaticMarkup(createElement(SignalDetail, {
      ...base,
      rows: [
        { labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsRule', value: zh.signalDetailsRuleName },
        { labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsVolume', value: '3.84×' }
      ],
      noteKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsNote'
    }))
    // The region is named by its title; the labels are keys resolved at render.
    expect(markup).toContain(`aria-label="${zh.signalDetailsTitle}"`)
    expect(markup).toContain(zh.signalDetailsRuleName)
    expect(markup).toContain('3.84×')
    expect(markup).toContain(zh.signalDetailsNote)
    expect(markup).toContain('role="region"')
  })

  it('groups rows under their own labels, for a chip whose readings are one list per leg', () => {
    const markup = renderToStaticMarkup(createElement(SignalDetail, {
      ...base,
      groups: [
        { labelKey: 'pages.intelligence.portal.dashboard.divergence.legs.stablecoin', rows: [{ labelKey: 'pages.intelligence.portal.dashboard.divergence.chipFreshLabel', value: '在新鲜期内' }] },
        { labelKey: 'pages.intelligence.portal.dashboard.divergence.legs.open-interest', rows: [{ labelKey: 'pages.intelligence.portal.dashboard.divergence.chipFreshLabel', value: '在新鲜期内' }] }
      ]
    }))
    expect(markup).toContain(productText['zh-CN'].pages.intelligence.portal.dashboard.divergence.legs['open-interest'])
    expect(markup.match(/在新鲜期内/g)).toHaveLength(2)
  })

  it('omits the note when the module has nothing to add', () => {
    const markup = renderToStaticMarkup(createElement(SignalDetail, {
      ...base,
      rows: [{ labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsRule', value: '持仓骤降' }]
    }))
    expect(markup).not.toContain('<p')
  })
})
