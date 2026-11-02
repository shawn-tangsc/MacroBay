import { describe, expect, it } from 'vitest'

import { updateDownloadPageUrl } from '../updateSource'
import { isAllowedUpdateLinkUrl, openUpdateLink } from './openUpdateLink'

describe('opening the download page', () => {
  it('opens the constant page and reports success', async () => {
    const opened: string[] = []
    const result = await openUpdateLink({
      openExternal: async (url) => {
        opened.push(url)
      },
      log: () => undefined
    })

    expect(result).toEqual({ ok: true })
    expect(opened).toEqual([updateDownloadPageUrl()])
  })

  it('answers ok:false instead of throwing when the system refuses to open it', async () => {
    const result = await openUpdateLink({
      openExternal: async () => {
        throw new Error('Failed to open')
      },
      log: () => undefined
    })

    expect(result).toEqual({ ok: false })
  })

  it('only lets https pages on the allowlisted host through', () => {
    const page = updateDownloadPageUrl()
    expect(isAllowedUpdateLinkUrl(page)).toBe(true)
    // 坏地址从真地址派出来，**不要**把发布地址的字面量抄第二遍：全仓「发布地址只出现一次」有守卫用例守着。
    for (const rejected of [
      page.replace('https://', 'http://'),
      'https://example.invalid/shawn-tangsc/MacroBay',
      'file:///Applications/MacroBay.app',
      'javascript:alert(1)',
      'not a url'
    ]) {
      expect(isAllowedUpdateLinkUrl(rejected), rejected).toBe(false)
    }
  })

  it('never takes a url from the caller: the payload has no address to pass', () => {
    // 契约层面的防守：这个函数只收 ports，不收地址。类型上就没有「传地址」这条路。
    expect(openUpdateLink.length).toBe(1)
  })
})
