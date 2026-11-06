import { describe, expect, it } from 'vitest'

import { briefingEventTitles } from './briefingEventTitles'

/**
 * 事件名只有一张表、中英两列；页面手里那张是界面语言的。英文版次必须取英文列（`02` `A0.9`）。
 */
describe('the event-name table follows the edition, not the interface', () => {
  it('takes the English names for an English edition under a Chinese interface', () => {
    const titles = briefingEventTitles({ pageLocale: 'zh-CN', editionLocale: 'en-US', pageTitles: { 'core-cpi': '核心 CPI' } })
    expect(titles['core-cpi']).toBe('Core CPI')
    expect(titles['cpi']).toBe('CPI')
    // 整张表里不许有中日韩字符：这一版是英文的。
    expect(Object.values(titles).join(' ')).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('takes the Chinese names for a Chinese edition under an English interface', () => {
    const titles = briefingEventTitles({ pageLocale: 'en-US', editionLocale: 'zh-CN' })
    expect(titles['core-cpi']).toBe('核心 CPI')
    expect(titles['cpi']).toBe('消费者物价指数（CPI）')
  })

  it('keeps the page table when the edition is in the same language', () => {
    const pageTitles = { 'core-cpi': '自定义名字' }
    expect(briefingEventTitles({ pageLocale: 'zh-CN', editionLocale: 'zh-CN', pageTitles })).toBe(pageTitles)
  })

  it('falls back to the registered table, never to the interface language', () => {
    const titles = briefingEventTitles({ pageLocale: 'zh-CN', editionLocale: 'en-US' })
    expect(titles['fomc']).toBe('FOMC decision')
    expect(Object.values(titles).join(' ')).not.toMatch(/[\u3400-\u9fff]/)
  })
})
