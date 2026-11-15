import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **已下线源的作业定义不许再被引用**（2026-11-16，Chief 要求先红后绿）。
 *
 * 第二次栽在同一件事上：新鲜度读取器与补跑命令都还连着 Narwhal 的作业 id，而 Narwhal
 * 自 11-13 后再没跑过——于是「数据 8 分钟新」被算成「过期两天」，补采还打到一条已下线
 * 的作业上。只靠人记，下次换源还会漏。
 *
 * 允许出现的地方只有三处，各有理由：
 * - `narwhalCalendarJob.ts`：那些 id 的**定义处**（随旧源一起删）；
 * - `marketCalendarFreshnessFromJobs.ts`：迁移期仍把它们算进「在跑的采集作业」（删源那笔同笔删掉）；
 * - 本守卫与相关用例：要能说出这两个 id 才检查得了。
 * 其它任何**真实引用**（import/调用/配置值）都红。
 */
const SERVICE = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RETIRED = ['refreshNarwhalCalendarTick', 'refreshNarwhalCalendarSweep']
const ALLOWED = [
  'intelligence/macro-calendar/narwhal-calendar/narwhalCalendarJob.ts',
  'intelligence/macro-calendar/marketCalendarFreshnessFromJobs.ts'
]

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { files(full, out); continue }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('已下线源的作业定义不再被引用', () => {
  /**
   * **仍然引用它们的四处**（2026-11-16 实测，随旧源删除一起消失）。
   *
   * 用「精确清单」而不是「空数组」：现在删源没做完，空数组不可能绿；精确清单让
   * **多一处就红、少一处也红**——涨了说明有人又接上旧源，减了说明删源推进了，必须同笔改这份数。
   */
  const KNOWN_OFFENDERS = [
    'bootstrap.ts: refreshNarwhalCalendarTick',
    'intelligence/application/sourceJobRegistration.ts: refreshNarwhalCalendarTick',
    'intelligence/application/sourceJobRegistration.ts: refreshNarwhalCalendarSweep',
    'intelligence/audit/syncRunProjection.ts: refreshNarwhalCalendarTick',
    'intelligence/audit/syncRunProjection.ts: refreshNarwhalCalendarSweep'
  ]

  it('除定义处、迁移期的新鲜度清单与已登记的五处外，没有任何文件引用 Narwhal 的两个作业 id', () => {
    const offenders: string[] = []
    for (const file of files(SERVICE)) {
      const rel = relative(SERVICE, file)
      if (ALLOWED.includes(rel)) continue
      const source = readFileSync(file, 'utf8')
      for (const id of RETIRED) {
        if (source.includes(id)) offenders.push(`${rel}: ${id}`)
      }
    }
    expect(offenders.sort()).toEqual([...KNOWN_OFFENDERS].sort())
  })
})
