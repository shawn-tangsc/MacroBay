import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 反向守卫：调度/分析路径上不许再出现「按本机时区构造墙上时刻」的写法
 * （`new Date(year, month, day, hour)` 或带分钟的 5 参形式）。
 * 墙上时间 → 瞬时只允许经 `platform/time/timeZoneClock.instantForWallClock`。
 */
const FIVE_ARG_DATE = /new Date\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,/g

describe('slot construction guard', () => {
  it('never builds a wall-clock instant by hand in the scheduling paths', () => {
    const dir = __dirname
    const offenders: string[] = []

    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
      const source = readFileSync(join(dir, name), 'utf8')
      if (FIVE_ARG_DATE.test(source)) offenders.push(name)
      FIVE_ARG_DATE.lastIndex = 0
    }

    expect(offenders).toEqual([])
  })
})
