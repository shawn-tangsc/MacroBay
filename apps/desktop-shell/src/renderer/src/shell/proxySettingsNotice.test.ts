import { describe, expect, it } from 'vitest'

import { platformText } from '../i18n/platformText'

import { proxyAddressUsesImplicitSocks5, proxyRejectionNotice } from './proxySettingsNotice'

const labels = platformText['zh-CN'].preferences
const enLabels = platformText['en-US'].preferences

describe('proxySettingsNotice', () => {
  it('turns each rejection code into the sentence the settings page shows', () => {
    expect(proxyRejectionNotice(new Error('Error invoking remote method: proxy_settings_rejected:unparsable'), labels))
      .toBe(labels.proxyRejectedUnparsable)
    expect(proxyRejectionNotice(new Error('proxy_settings_rejected:unsupported-protocol'), labels))
      .toBe(labels.proxyRejectedUnsupportedProtocol)
    expect(proxyRejectionNotice(new Error('proxy_settings_rejected:empty'), labels))
      .toBe(labels.proxyRejectedEmpty)
  })

  it('falls back to nothing for errors that are not proxy rejections', () => {
    expect(proxyRejectionNotice(new Error('boom'), labels)).toBeNull()
    expect(proxyRejectionNotice(undefined, labels)).toBeNull()
  })

  it('names the rejection in English too, without leaking the raw code', () => {
    const text = proxyRejectionNotice(new Error('proxy_settings_rejected:unparsable'), enLabels)
    expect(text).toBe(enLabels.proxyRejectedUnparsable)
    expect(text).not.toContain('proxy_settings_rejected')
  })

  it('tells the user when a bare host:port is being read as socks5', () => {
    expect(proxyAddressUsesImplicitSocks5('127.0.0.1:7890')).toBe(true)
    expect(proxyAddressUsesImplicitSocks5('socks5://127.0.0.1:7890')).toBe(false)
    expect(proxyAddressUsesImplicitSocks5('http://127.0.0.1:7890')).toBe(false)
    // 解析不出来的地址不会显示这句解释——它连解释的前提都不成立，保存时会被直接拒。
    expect(proxyAddressUsesImplicitSocks5('myproxy')).toBe(false)
  })
})
