#!/usr/bin/env tsx
/**
 * 正文说明句门禁（用户 2026-11-10）：「我的界面空间每一寸都是宝贵的……说明性文字统一都放在 icon
 * hover 里面，而且是真的有用才放。」
 *
 * 判据（只做误报最低的一条）：**键名以 `Hint` / `Note` 结尾的文案，只允许出现在 ⓘ 的入口**——
 * `helpTrigger(...)` 实参、`Popover` 的 `content=` 内、`aria-*`、`title=`。出现在正文 JSX 位置即红。
 *
 * 为什么先只做这条：判据二（文案值含句读就是说明）会把标题、枚举里的逗号也抓进来，一出生红一片，
 * 然后一定有人去放宽。先把「名字自己都承认是说明」的那批按住，存量记基线、只许减少。
 *
 * 挡什么：`*.tsx` 里 `*Hint` / `*Note` 文案的**用法点**——成员访问（`text.a.hoursHint`、`labels.xNote`）
 * 与键字符串（`resolveText('…Hint')`）。
 * 不挡什么：i18n 定义文件本身（`*.ts`）、`*.test.*`（断言里的键名是文本，不是渲染位置）。
 *
 * 复算：`pnpm exec tsx scripts/check-body-prose.mts`。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = join(ROOT, 'scripts/body-prose-baseline.json')
const SCAN_ROOTS = ['apps', 'platform', 'products']
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git', 'coverage'])

/** ⓘ 的入口：这些位置出现说明句是**允许**的（默认收起、悬停/聚焦展开）。 */
const ALLOWED_CONTEXT = /helpTrigger\(|\bPopover\b|content=|lines=|aria-|title=|ariaLabelKey=/u

type Finding = { file: string; line: number; key: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full)
  }
  return out
}


/**
 * 纯函数：把「本次命中」并进基线，**只增不减**（`--write-baseline` 的唯一判断，别再写第二套）。
 *
 * `refused` 是这次写入会**删掉或改小**的已有条目（`id（基线 n → 现在 m）` / `现在不存在`）。
 * 有它就必须失败：整份重写共享基线就是「谁最后跑谁说了算」，`ad23571` 这样覆盖过别人三条登记。
 */
export function mergeBaseline(
  baseline: Readonly<Record<string, number>>,
  counts: ReadonlyMap<string, number>
): Readonly<{ merged: Record<string, number>; refused: string[] }> {
  const refused = Object.keys(baseline).flatMap((id) => {
    const now = counts.get(id) ?? 0
    if (!counts.has(id)) return [`${id}（基线 ${baseline[id]} → 现在不存在）`]
    return now < baseline[id]! ? [`${id}（基线 ${baseline[id]} → 现在 ${now}）`] : []
  })
  const merged: Record<string, number> = { ...baseline }
  for (const [id, count] of counts) merged[id] = Math.max(merged[id] ?? 0, count)
  return { merged, refused }
}

/** 直接运行时才扫仓库；被用例 import 时只导出纯函数（否则 import 会把整条门禁当副作用跑一遍）。 */
const invokedDirectly = process.argv[1]?.endsWith('check-body-prose.mts') === true
function main(): void {
  const findings: Finding[] = []

  for (const root of SCAN_ROOTS) {
    const absolute = join(ROOT, root)
    if (!existsSync(absolute)) continue
    for (const file of walk(absolute)) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, index) => {
        if (ALLOWED_CONTEXT.test(line)) return
        // 键**定义**不是用法：`const X_KEY = '…Hint'` 只是给这段文案起名字，真正渲染在别处。
        // 把定义行算成正文，会让每个把键抽成常量的文件都假红一次。
        if (/^\s*const\s+[A-Z][A-Z0-9_]*\s*=/.test(line)) return
        const keys: string[] = []
        // 成员访问：取最后一段（`text.hours.hoursHint` → `hoursHint`）
        for (const match of line.matchAll(/\.([A-Za-z_$][\w$]*(?:Hint|Note))\b/gu)) keys.push(match[1]!)
        // 键字符串：`'settings.x.hoursHint'`
        for (const match of line.matchAll(/['"`]([\w.$-]*(?:Hint|Note))['"`]/gu)) keys.push(match[1]!)
        for (const key of new Set(keys)) {
          // 基线键必须归一化分隔符：Windows 上 `relative()` 给 `a\\b`，基线里是 `a/b`，两边永远对不上。
          findings.push({ file: relative(ROOT, file).split(sep).join('/'), line: index + 1, key })
        }
      })
    }
  }

  const counts = new Map<string, number>()
  for (const finding of findings) {
    const id = `${finding.file} :: ${finding.key}`
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const BASELINE_NOTE = '正文里出现的 *Hint / *Note 说明句，只允许出现在 ⓘ 入口（helpTrigger / Popover content / aria-* / title=）。**只降不升**：清掉一处就把这里的数字改小，否则报过期。复算：pnpm exec tsx scripts/check-body-prose.mts'

  const baseline: Record<string, number> = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries ?? {}
    : {}

  /**
   * `--write-baseline` **只增不减**（2026-11-10 事故：它整份重写，把别人刚登记的三条覆盖掉了）。
   *
   * 规则：拿「现有基线 ∪ 本次命中」的**并集**写回去——已有条目一个都不删、计数只升不降
   * （命中比基线多才写，少了一律保持原值）。想删条目必须显式用 `--remove '<文件> :: <键>'`，
   * 一次一条，删的理由写进提交说明。
   */
  if (process.argv.includes('--write-baseline')) {
    const { merged, refused } = mergeBaseline(baseline, counts)
    if (refused.length > 0) {
      console.log('--write-baseline 拒绝执行：这次写入会删掉或改写已有条目（共享基线只许增，不许覆盖）：')
      for (const line of refused) console.log(`  ${line}`)
      console.log('要降/删请用 --lower \'<文件> :: <键>\' 或 --remove \'<文件> :: <键>\'，一次一条，理由写进提交说明。')
      process.exit(1)
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify({
      note: BASELINE_NOTE,
      total: Object.values(merged).reduce((sum, value) => sum + value, 0),
      entries: merged
    }, null, 2)}\n`)
    console.log(`基线已合并（只增不减）：合计 ${Object.keys(merged).length} 个位置 / ${Object.values(merged).reduce((s, v) => s + v, 0)} 处`)
    process.exit(0)
  }

  const lower = process.argv.findIndex((arg) => arg === '--lower')
  if (lower !== -1) {
    const target = process.argv[lower + 1]
    if (target === undefined || baseline[target] === undefined) {
      console.log(`--lower 没找到这一条：${target ?? '（没给）'}`)
      process.exit(1)
    }
    const now = counts.get(target) ?? 0
    const next = { ...baseline }
    if (now === 0) delete next[target]
    else next[target] = now
    writeFileSync(BASELINE_PATH, `${JSON.stringify({
      note: BASELINE_NOTE,
      total: Object.values(next).reduce((sum, value) => sum + value, 0),
      entries: next
    }, null, 2)}\n`)
    console.log(`已降一条基线：${target}（${baseline[target]} → ${now}；命中为 0 时该条直接删除）`)
    process.exit(0)
  }

  const removed = process.argv.findIndex((arg) => arg === '--remove')
  if (removed !== -1) {
    const target = process.argv[removed + 1]
    if (target === undefined || baseline[target] === undefined) {
      console.log(`--remove 没找到这一条：${target ?? '（没给）'}`)
      process.exit(1)
    }
    const { [target]: _gone, ...rest } = baseline
    writeFileSync(BASELINE_PATH, `${JSON.stringify({
      note: BASELINE_NOTE,
      total: Object.values(rest).reduce((sum, value) => sum + value, 0),
      entries: rest
    }, null, 2)}\n`)
    console.log(`已删一条基线：${target}（其余条目原样保留）`)
    process.exit(0)
  }

  const added: string[] = []
  const grown: string[] = []
  for (const [id, count] of counts) {
    const allowed = baseline[id] ?? 0
    if (allowed === 0) added.push(`${id}（+${count}）`)
    else if (count > allowed) grown.push(`${id}（基线 ${allowed} → 现在 ${count}）`)
  }
  const stale = Object.keys(baseline).filter((id) => !counts.has(id))

  // **一次跑完、分类报全**：正文命中 / 基线过期 各列一遍再统一退出。
  // 早退会让「想验自己那半」的人跑去 /tmp 跑副本，拿副本数当证据。
  let failed = false
  if (added.length || grown.length) {
    failed = true
    console.log('正文说明句门禁未通过（说明句只许进 ⓘ：helpTrigger / Popover content=` 或 `lines=` / aria-* / title=）：')
    for (const line of [...added, ...grown]) console.log(`  ${line}`)
    console.log('处理方式：把这句话收进 ⓘ（`helpTrigger(...)` 或 `Popover` 的 `content`/`lines`），或删掉它。不许放宽基线。')
  }
  if (stale.length) {
    failed = true
    console.log(`正文说明句门禁：基线过期——${stale.length} 个位置已经不在正文里，请用 --lower/--remove 把基线改小：`)
    for (const id of stale) console.log(`  ${id}`)
  }
  if (failed) process.exit(1)
  console.log(`正文说明句门禁通过：${counts.size} 个位置、合计 ${[...counts.values()].reduce((s, v) => s + v, 0)} 处，都是既有基线（只降不升）。`)

}

if (invokedDirectly) main()
