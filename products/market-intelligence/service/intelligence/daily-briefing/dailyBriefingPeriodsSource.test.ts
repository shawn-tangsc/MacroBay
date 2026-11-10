import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createBriefingPeriodsSource } from './dailyBriefingPeriodsSource'

const dirs: string[] = []
async function tempFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-periods-source-'))
  dirs.push(dir)
  return join(dir, name)
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('the runtime period source', () => {
  it('reads one default period, in the reader language, when nothing is configured', async () => {
    const filePath = await tempFile('daily-briefing-periods.json')
    const source = createBriefingPeriodsSource({ filePath, locale: async () => 'en-US' })

    const periods = await source.getPeriods()

    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({ id: 'default', generationTime: '07:00', windowHours: 24, language: 'en-US' })
  })

  it('reads the reader configuration once it exists, and never writes one', async () => {
    const filePath = await tempFile('daily-briefing-periods.json')
    await writeFile(filePath, JSON.stringify({
      version: 1,
      periods: [
        { id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN' },
        { id: 'period_evening', generationTime: '21:30', windowHours: 12, language: 'zh-CN' }
      ]
    }), 'utf8')
    const source = createBriefingPeriodsSource({ filePath, locale: async () => 'zh-CN' })

    expect((await source.getPeriods()).map((period) => period.generationTime)).toEqual(['07:00', '21:30'])
    // Reading is not a write: the file keeps exactly what the reader configured.
    expect(JSON.parse(await readFile(filePath, 'utf8')).periods).toHaveLength(2)
  })

  it('keeps an emptied configuration empty instead of growing a default back', async () => {
    const filePath = await tempFile('daily-briefing-periods.json')
    await writeFile(filePath, JSON.stringify({ version: 1, periods: [] }), 'utf8')
    const source = createBriefingPeriodsSource({ filePath, locale: async () => 'zh-CN' })

    expect(await source.getPeriods()).toEqual([])
  })
})

describe('periods written before the language was part of a period', () => {
  const legacyFile = async (): Promise<string> => {
    const filePath = await tempFile('daily-briefing-periods.json')
    await writeFile(filePath, JSON.stringify({
      version: 1,
      periods: [
        { id: 'default', generationTime: '07:00', windowHours: 24 },
        { id: 'period_evening', generationTime: '21:30', windowHours: 12 }
      ]
    }), 'utf8')
    return filePath
  }

  it('fills the language from the edition each period actually generated, and falls back once otherwise', async () => {
    const filePath = await legacyFile()
    const source = createBriefingPeriodsSource({
      filePath,
      locale: async () => 'zh-CN',
      // 只有 evening 这一期真的生成过版次（链接表里恰好一种语言）；default 一次都没有。
      editionLocales: async () => new Map([['period_evening', new Set(['en-US'] as const)]])
    })

    const periods = await source.getPeriods()

    // 期数与时刻都不许变：类型收紧最怕的就是这一条旧数据被当成不合法丢掉。
    expect(periods.map((period) => period.id)).toEqual(['default', 'period_evening'])
    expect(periods.map((period) => period.generationTime)).toEqual(['07:00', '21:30'])
    // 有版次的用版次自己的语言（事实）；从没生成过的才用当前界面语言（推定）。
    expect(periods.map((period) => period.language)).toEqual(['zh-CN', 'en-US'])
    const written = JSON.parse(await readFile(filePath, 'utf8')) as { periods: readonly { language?: string }[] }
    expect(written.periods.map((entry) => entry.language)).toEqual(['zh-CN', 'en-US'])
  })

  it('writes the repair once and leaves the second read untouched', async () => {
    const filePath = await legacyFile()
    const source = createBriefingPeriodsSource({
      filePath,
      locale: async () => 'zh-CN',
      editionLocales: async () => new Map()
    })

    const first = await source.getPeriods()
    const afterFirst = await readFile(filePath, 'utf8')
    const second = await source.getPeriods()

    expect(second).toEqual(first)
    expect(await readFile(filePath, 'utf8')).toBe(afterFirst)
  })

  it('does not rewrite a file whose periods all carry a language', async () => {
    const filePath = await tempFile('daily-briefing-periods.json')
    await writeFile(filePath, JSON.stringify({
      version: 1,
      periods: [{ id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN' }]
    }), 'utf8')
    const before = await readFile(filePath, 'utf8')
    const source = createBriefingPeriodsSource({ filePath, locale: async () => 'zh-CN' })

    await source.getPeriods()

    expect(await readFile(filePath, 'utf8')).toBe(before)
  })
})

/**
 * C15a: the settings surface now writes through this same source. Every method must therefore wait
 * for the one-time move — a write that lands first would produce a period file without the marker,
 * and the next start would read "periods exist" and skip the move for good.
 */
describe('the write seam waits for the one-time move', () => {
  const legacyMigration = {
    readLegacyPeriods: async () => [
      { id: 'default', generationTime: '07:00', windowHours: 24 },
      { id: 'evening', generationTime: '21:30', windowHours: 12 }
    ],
    additionalLanguages: async () => [] as const
  }

  it('an update on a fresh upgrade moves the old rows first, marker included', async () => {
    const filePath = await tempFile('daily-briefing-periods.json')
    const source = createBriefingPeriodsSource({
      filePath,
      locale: async () => 'zh-CN',
      legacyPeriodsMigration: legacyMigration
    })

    // Deliberately no `getPeriods()` before this: the settings page's first action can be a write.
    const result = await source.editor.update('default', { generationTime: '08:00', windowHours: 24, language: 'zh-CN' })

    expect(result.state).toBe('saved')
    const document = JSON.parse(await readFile(filePath, 'utf8')) as {
      periods: readonly { id: string; generationTime: string }[]
      markers?: Record<string, unknown>
    }
    // The old second period is still there — the move ran before the write, not after it.
    expect(document.periods.map((period) => period.id)).toEqual(['default', 'evening'])
    expect(document.periods.map((period) => period.generationTime)).toEqual(['08:00', '21:30'])
    expect(typeof document.markers?.['migrated.legacyGlobalSettings.v1']).toBe('string')
  })

  it('create and remove wait too, and never drop the marker', async () => {
    const filePath = await tempFile('daily-briefing-periods.json')
    const source = createBriefingPeriodsSource({
      filePath,
      locale: async () => 'zh-CN',
      legacyPeriodsMigration: legacyMigration
    })

    const created = await source.editor.create({ generationTime: '09:00', windowHours: 12, language: 'en-US' })
    expect(created.state).toBe('saved')
    const removed = await source.editor.remove('evening')
    expect(removed.state).toBe('removed')

    const document = JSON.parse(await readFile(filePath, 'utf8')) as {
      periods: readonly { id: string; generationTime: string }[]
      markers?: Record<string, unknown>
    }
    expect(document.periods.map((period) => period.generationTime).sort()).toEqual(['07:00', '09:00'])
    expect(typeof document.markers?.['migrated.legacyGlobalSettings.v1']).toBe('string')
  })

  it('list answers after the move, so the panel never shows an empty file as "no periods"', async () => {
    const filePath = await tempFile('daily-briefing-periods.json')
    const source = createBriefingPeriodsSource({
      filePath,
      locale: async () => 'zh-CN',
      legacyPeriodsMigration: legacyMigration
    })

    const listed = await source.editor.list('zh-CN')

    expect(listed.map((period) => period.id)).toEqual(['default', 'evening'])
  })
})
