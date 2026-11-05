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

  it('tells apart any two editions of one day, and leaves the old name alone', () => {
    // 判据是"同一天任意两期文件名必须不同"，不是"名字里必须含某项"——否则下次又要加一个字段。
    const name = (edition: Record<string, unknown>): string => briefingExportFileName({ edition: { date: '2026-11-04', locale: 'zh-CN', ...edition } as never })
    // ① 同一时刻、不同窗口：07:00 / 24h 与 07:00 / 4h（R4 明确允许）
    const wide = name({ periodId: 'a', periodTime: '2026-11-04T07:00:00.000Z', windowHours: 24 })
    const narrow = name({ periodId: 'b', periodTime: '2026-11-04T07:00:00.000Z', windowHours: 4 })
    expect(wide).toBe('mi-daily-brief-2026-11-04-0700-24h-zh-CN.png')
    expect(narrow).toBe('mi-daily-brief-2026-11-04-0700-4h-zh-CN.png')
    // ② 同一时刻、同一窗口、不同语言
    expect(name({ periodId: 'a', periodTime: '2026-11-04T07:00:00.000Z', windowHours: 24, locale: 'en-US' } as never)).toContain('-en-US.png')
    // ③ 同一时刻、同一窗口、同一语言的两次手动生成：只差完成时刻
    const first = name({ periodId: 'a', periodTime: '2026-11-04T07:00:00.000Z', windowHours: 24, periodKind: 'manual', generatedAt: '2026-11-04T07:02:11.000Z' })
    const again = name({ periodId: 'a', periodTime: '2026-11-04T07:00:00.000Z', windowHours: 24, periodKind: 'manual', generatedAt: '2026-11-04T09:41:05.000Z' })
    expect(first).toBe('mi-daily-brief-2026-11-04-0700-24h-070211-zh-CN.png')
    expect(first).not.toBe(again)
    // 旧版次（什么字段都没有）与 `default` 仍是旧名字。
    expect(name({})).toBe('mi-daily-brief-2026-11-04-zh-CN.png')
    expect(name({ periodId: 'default' })).toBe('mi-daily-brief-2026-11-04-zh-CN.png')
  })
})
