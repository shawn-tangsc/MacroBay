import { describe, expect, it } from 'vitest'

import { productText } from '../../desktop/shared/i18n/productText'
import {
  isRegisteredReleaseKey,
  normalizedReleaseText,
  providerReleaseIdentityPolicy,
  providerReleaseTitleKey,
  registeredReleaseIdentities
} from './macroCalendarReleaseIdentity'

/**
 * 官方↔provider 的身份：命名映射（设计 145 §8 B）。
 *
 * 这张表的两种错法后果不对称：漏一条 → 图上多一条竖线（看得见，可补），错并一条 → 图上少一条
 * （看不出来）。所以这里既钉"该认的认得出"，也钉"相邻的两次发布绝不互相命中"。
 */
describe('provider release identity', () => {
  it('names every registered release key the official route uses, and only those', () => {
    const registered = ['cpi', 'core-cpi', 'nonfarm-payrolls', 'unemployment', 'average-hourly-earnings', 'pce', 'core-pce', 'gdp', 'fomc']
    expect(registeredReleaseIdentities.map(identity => identity.titleKey).sort()).toEqual([...registered].sort())
    // 键就是官方路线与事实侧共用的那一套：日历侧的官方行只有在这 9 个键上才算"已发布身份"。
    expect(isRegisteredReleaseKey('cpi')).toBe(true)
    expect(isRegisteredReleaseKey('unknown')).toBe(false)
    expect(isRegisteredReleaseKey('a1b2c3d4-0000-4000-8000-000000000001')).toBe(false)
    expect(isRegisteredReleaseKey(undefined)).toBe(false)
  })

  it('recognises the provider wording observed in the product, in both locales', () => {
    // 观测样本（`crossAssetMarketEventLines.ts` 的注释与日历测试夹具）。
    expect(providerReleaseTitleKey('9月未季调消费者物价指数(年率)')).toBe('cpi')
    expect(providerReleaseTitleKey('美国9月未季调核心消费者物价指数(年率)')).toBe('core-cpi')
    // 设计 117 的口径：季调后非农就业人口变动 / 失业率 / 平均每小时工资月率。
    expect(providerReleaseTitleKey('美国9月季调后非农就业人口变动(万人)')).toBe('nonfarm-payrolls')
    expect(providerReleaseTitleKey('美国9月失业率')).toBe('unemployment')
    expect(providerReleaseTitleKey('美国9月平均每小时工资月率')).toBe('average-hourly-earnings')
    expect(providerReleaseTitleKey('美国9月PCE物价指数年率')).toBe('pce')
    expect(providerReleaseTitleKey('美国9月核心PCE物价指数年率')).toBe('core-pce')
    expect(providerReleaseTitleKey('美国第二季度实际GDP环比年化')).toBe('gdp')
    expect(providerReleaseTitleKey('美联储FOMC利率决议')).toBe('fomc')

    expect(providerReleaseTitleKey('US CPI YoY')).toBe('cpi')
    expect(providerReleaseTitleKey('US Core CPI YoY')).toBe('core-cpi')
    expect(providerReleaseTitleKey('US Nonfarm Payrolls')).toBe('nonfarm-payrolls')
    expect(providerReleaseTitleKey('US Unemployment Rate')).toBe('unemployment')
    expect(providerReleaseTitleKey('US Average Hourly Earnings MoM')).toBe('average-hourly-earnings')
    expect(providerReleaseTitleKey('US Core PCE Price Index YoY')).toBe('core-pce')
    expect(providerReleaseTitleKey('US Real GDP QoQ Annualized')).toBe('gdp')
  })

  it('never merges neighbouring releases that a structural rule would have merged', () => {
    // 8:30 ET 那一分钟同时有 CPI/PPI/零售销售/初请：同国同时刻不是身份，命名才是。
    expect(providerReleaseTitleKey('美国9月PPI年率')).toBeUndefined()
    expect(providerReleaseTitleKey('9月零售销售(月率)')).toBeUndefined()
    expect(providerReleaseTitleKey('美国截至10月11日当周初请失业金人数')).toBeUndefined()
    // 核心与整体、年率与月率、失业率与初请必须分开。
    expect(providerReleaseTitleKey('美国9月核心CPI年率')).toBe('core-cpi')
    expect(providerReleaseTitleKey('美国9月CPI月率')).toBeUndefined()
    expect(providerReleaseTitleKey('美国9月平均每小时工资年率')).toBeUndefined()
    expect(providerReleaseTitleKey('美国9月名义GDP同比')).toBeUndefined()
    expect(providerReleaseTitleKey('美国第二季度GDP平减指数')).toBeUndefined()
    expect(providerReleaseTitleKey('美联储会议纪要')).toBeUndefined()
    expect(providerReleaseTitleKey('US Initial Jobless Claims')).toBeUndefined()
    expect(providerReleaseTitleKey('US Nominal GDP YoY')).toBeUndefined()
    expect(providerReleaseTitleKey('US GDP Deflator')).toBeUndefined()
  })

  it('keeps the core rows off the headline keys, so "核心" never lands on 整体', () => {
    // 核心 PCE 的年率里也含「PCE年率」：`excluded` 是这条的关键，删掉它核心就会并进整体。
    expect(providerReleaseTitleKey('核心PCE年率')).toBe('core-pce')
    expect(providerReleaseTitleKey('核心CPI年率')).toBe('core-cpi')
    expect(providerReleaseTitleKey('Core CPI YoY')).toBe('core-cpi')
  })

  it('refuses to guess when a title matches two keys, and says why in the policy', () => {
    // 歧义由这张表自己制造：命中两个键时返回 undefined，而不是按顺序取第一个。
    const ambiguous = registeredReleaseIdentities.filter(identity => identity.titleKey === 'cpi' || identity.titleKey === 'core-cpi')
    expect(ambiguous).toHaveLength(2)
    expect(providerReleaseIdentityPolicy.ambiguousMatchMerges).toBe(false)
    // 一条标题同时提到两次不同的发布（这里：实际 GDP 与 PCE 年率），谁也不排除谁——宁可不合并。
    expect(providerReleaseTitleKey('美国第三季度实际GDP环比年化与9月PCE年率')).toBeUndefined()
  })

  it('normalises case, spacing and punctuation, and refuses an empty title', () => {
    expect(normalizedReleaseText('US  CPI（YoY）')).toBe('uscpiyoy')
    expect(providerReleaseTitleKey('US CPI（YoY）')).toBe('cpi')
    expect(providerReleaseTitleKey('')).toBeUndefined()
    expect(providerReleaseTitleKey('   ')).toBeUndefined()
  })

  it('names each key in the same words the analysis side uses', () => {
    // 映射的键就是分析侧/模型侧的键：名字对不上就说明有人只改了一边。
    const zh = productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames.eventName as Record<string, string>
    const en = productText['en-US'].pages.intelligence.portal.analysisWorkspace.readableNames.eventName as Record<string, string>
    for (const identity of registeredReleaseIdentities) {
      expect(zh[identity.titleKey], `zh-CN:${identity.titleKey}`).toBeTruthy()
      expect(en[identity.titleKey], `en-US:${identity.titleKey}`).toBeTruthy()
    }
  })
})
