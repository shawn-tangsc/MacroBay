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
