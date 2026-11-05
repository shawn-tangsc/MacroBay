// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { briefingExportFileName, posterExportBackground } from './dailyBriefingExport'

describe('posterExportBackground', () => {
  it('reads the paper colour the poster is painted in', () => {
    const poster = document.createElement('div')
    poster.style.backgroundColor = 'rgb(244, 239, 228)'
    document.body.append(poster)

    expect(posterExportBackground(poster)).toBe('rgb(244, 239, 228)')
  })

  // A wrapper with no paper of its own must not become an opaque export: passing the library an
  // unreadable value paints the image on a colour the stylesheet never chose.
  it('says nothing when the element paints no background', () => {
    const bare = document.createElement('div')
    document.body.append(bare)

    expect(posterExportBackground(bare)).toBeUndefined()
    expect(posterExportBackground(null)).toBeUndefined()
  })
})

describe('briefingExportFileName', () => {
  it('names the file after the edition language, not the interface language', () => {
    // The interface may be Chinese while the reader exports the English edition; a `-zh-CN.png`
    // name would tell them the picture is in a language it is not.
    expect(briefingExportFileName({ edition: { date: '2026-11-03', locale: 'en-US' } }))
      .toBe('mi-daily-brief-2026-11-03-en-US.png')
    expect(briefingExportFileName({ edition: { date: '2026-11-03', locale: 'zh-CN' } }))
      .toBe('mi-daily-brief-2026-11-03-zh-CN.png')
  })

  it('keeps two periods of the same day and language apart, and leaves the old name alone', () => {
    // 一天多期之后，"日期 + 语言"不再唯一：两个期同一天同语言，文件名一样就会互相覆盖，
    // 而读者会以为留下的那份是第一次导出的。期自己的小时就是那个区分。
    const morning = briefingExportFileName({ edition: { date: '2026-11-04', locale: 'zh-CN', periodId: 'p-morning', periodTime: '2026-11-04T00:00:00.000Z' } })
    const noon = briefingExportFileName({ edition: { date: '2026-11-04', locale: 'zh-CN', periodId: 'p-noon', periodTime: '2026-11-04T04:00:00.000Z' } })
    expect(morning).toBe('mi-daily-brief-2026-11-04-0000-zh-CN.png')
    expect(noon).toBe('mi-daily-brief-2026-11-04-0400-zh-CN.png')
    expect(morning).not.toBe(noon)
    // 没有时间就只有期号；`default` 与"什么字段都没有"都还是旧名字——已下载过的人不该被改名绕晕。
    expect(briefingExportFileName({ edition: { date: '2026-11-04', locale: 'zh-CN', periodId: 'asia/open' } }))
      .toBe('mi-daily-brief-2026-11-04-asiaopen-zh-CN.png')
    expect(briefingExportFileName({ edition: { date: '2026-11-04', locale: 'zh-CN', periodId: 'default' } }))
      .toBe('mi-daily-brief-2026-11-04-zh-CN.png')
  })
})
