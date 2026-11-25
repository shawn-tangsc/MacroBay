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
 * 不挡什么：i18n 定义文件本身（`*.ts`）、`*.test.*`（断言里的键名是文本，不是渲染位置）、
 * **截图面**（见 `CAPTURE_ONLY_SURFACES`：那几个文件的产物是一张图，不是屏幕上的界面）。
 *
 * 豁免**只免这一条**（说明句出现在正文位置）。别以为进了名单就什么都放过：内部进度话术
 * （「本版只验证…」「本版不采集…」）、手写第二份文案、图上的数不走契约结算，在导出面上**同样禁**，
 * 由 `scripts/capture-surfaces.test.mts` 另管——那条测试不认名单豁免，只认事实。
 *
 * 复算：`pnpm exec tsx scripts/check-body-prose.mts`。
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = join(ROOT, 'scripts/body-prose-baseline.json')
const SCAN_ROOTS = ['apps', 'platform', 'products']
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git', 'coverage'])

/** ⓘ 的入口：这些位置出现说明句是**允许**的（默认收起、悬停/聚焦展开）。 */
const ALLOWED_CONTEXT = /helpTrigger\(|\bPopover\b|content=|lines=|aria-|title=|ariaLabelKey=|labelKeys=/u

type Finding = { file: string; line: number; key: string }

/**
 * 截图面：产物是**一张图**、不是一屏界面的文件。
 *
 * 豁免的理由**不是「读者看不见」**——那张图会被存档、转发、被不相干的人读到，比屏幕上的字活得久。
 * 理由是**产物形态**：PNG 里没有 hover、没有可点的 `ⓘ`，也没有可以省下来的屏幕空间预算；
 * 「把说明收进浮层」在图上不存在，而这句话本身是内容（这一版缺不缺数据、有没有另一种语言版），
 * 删了就变成「残缺的一期看起来是完整的」。
 *
 * 判据只认**这个文件自己是不是只用来画图**（不是「这句话看起来像说明」）：
 * - 按文件写死，精确相对路径、`*.tsx`、不许通配/目录/正则（形状由 `captureSurfacePathProblem` 校验，
 *   用例在 `scripts/capture-surfaces.test.mts`）；
 * - 加一条要过架构师：名单只在本文件的 diff 里增删，别处不得改；
 * - 结构上也要立得住：条目必须能被反向依赖证明「只被那个导出入口引用」
 *   （`BriefingPosterWindow` 的 importer 恰好是 `pages/briefing-poster/index.tsx`，多一个可见页面即红）；
 * - 同样的命中出现在**别的**文件里照样红：白名单不是整门禁的旁路，基线那边照旧只降不升。
 *
 * 今天两条，形状同一个：导出面自己一个文件。
 * - 海报窗口：主进程 `show:false` 起一个不显示的窗口，画完 `capturePage()` 就把窗口销毁
 *   （`window/briefingPosterCapture.ts`），页面上没有控件、没有壳层状态；
 * - 页面的离屏导出节点：`DailyBriefingShareHost`（`aria-hidden` + `left:-20000px`），
 *   页面自己截图导出、推图都用这一块。
 */
const CAPTURE_ONLY_SURFACES: readonly string[] = [
  'products/market-intelligence/desktop/pages/intelligence/BriefingPosterWindow.tsx',
  'products/market-intelligence/desktop/pages/intelligence/DailyBriefingShareHost.tsx'
]

/** 纯函数：这个文件是不是截图面（相对仓库根、`/` 分隔）。 */
export function isCaptureOnlySurface(file: string): boolean {
  return CAPTURE_ONLY_SURFACES.includes(file)
}

/** 名单本身也要能被测试读到（每条都必须在仓库里存在）。 */
export function captureOnlySurfaces(): readonly string[] {
  return CAPTURE_ONLY_SURFACES
}

/**
 * 纯函数：名单条目的形状问题（`null` = 合格）。
 *
 * 只许「精确相对路径 + `.tsx`」：通配会顺手放过一批文件，目录会连以后新建的文件一起放过，
 * 正则更没法审——三种都会把「这一处是不是导出面」变成没人复核的默认值。
 */
export function captureSurfacePathProblem(entry: string): string | null {
  if (!entry.endsWith('.tsx')) return '必须是 .tsx 文件'
  if (entry.includes('\\')) return '必须用 / 分隔'
  if (entry.startsWith('/') || entry.startsWith('./') || entry.includes('//')) return '必须是相对仓库根的规范路径'
  if (/[*?[\]{}()|+^$]/u.test(entry)) return '不许通配、目录或正则'
  if (entry.endsWith('/')) return '不许是目录'
  const absolute = join(ROOT, entry)
  if (!existsSync(absolute)) return '文件不存在'
  if (!statSync(absolute).isFile()) return '不是单个文件'
  return null
}

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

/**
 * 把浮层表达式整块剥掉：`lines={…}` / `content={…}` 里出现的是说明句的**入口**，不是正文。
 * 块可能是跨行的，键还可能来自 helper（`key('columnScopeNote')`）——所以按花括号配平整块移除，
 * 不做「同一行里有 `lines=`」那种按行判断（`CapitalConditionsPanel.tsx:352` 就是跨行的反例）。
 */
export function stripFloatingBlocks(text: string): string {
  let out = ''
  let cursor = 0
  for (const [start, end] of floatingBlockSpans(text)) {
    out += text.slice(cursor, start)
    // 用等量空白替换，保持行号不变（行号仍要指得准）。
    out += text.slice(start, end).replace(/[^\n]/gu, ' ')
    cursor = end
  }
  return out + text.slice(cursor)
}

/** 浮层表达式的字符区间：`lines={…}` / `content={…}`，按花括号配平，跨行也算。 */
export function floatingBlockSpans(text: string): ReadonlyArray<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = []
  let index = 0
  while (index < text.length) {
    const match = /(?:lines|content)=\{/u.exec(text.slice(index))
    if (match === null) break
    const start = index + match.index
    const end = blockEnd(text, start + match[0].length - 1)
    spans.push([start, end])
    index = end
  }
  return spans
}

/**
 * 从 `{` 开始配平到它的闭括号，**跳过字符串与模板字面量里的括号**。
 *
 * 为什么要认引号：这段区间原来只决定「剥掉哪些字符」，判错是多剥/少剥（假红，安全）；
 * 现在它还是 `exemptHintKeySpans` 的豁免边界，判错就会把正文当成水口**放过**——
 * `lines={['a}b']}` 里那个 `}` 不是块的结束，认错就会把后面的正文一起圈进豁免。
 *
 * 模板字面量按 `${…}` 进表达式、回到反引号退出递归处理；`\` 跳过下一个字符。
 * 未闭合的字符串一直读到文末：区间更大＝剥得更多＝更容易报红，方向与「不放过正文」一致。
 */
function blockEnd(text: string, open: number): number {
  const stack: string[] = ['{']
  let index = open + 1
  while (index < text.length) {
    const char = text[index]
    const top = stack[stack.length - 1]
    if (top === '{') {
      if (char === "'" || char === '"' || char === '`') { stack.push(char); index += 1; continue }
      if (char === '{') { stack.push('{'); index += 1; continue }
      if (char === '}') { stack.pop(); index += 1; if (stack.length === 0) return index; continue }
      index += 1
      continue
    }
    if (char === '\\') { index += 2; continue }
    if (top === '`' && char === '$' && text[index + 1] === '{') { stack.push('{'); index += 2; continue }
    if (char === top) { stack.pop(); index += 1; continue }
    index += 1
  }
  return text.length
}

/** 每行的起始偏移：命中位置按**字符位置**判，不按行判（同一行里可能两种位置都有）。 */
export function lineStartOffsets(text: string): readonly number[] {
  const starts: number[] = []
  let offset = 0
  for (const line of text.split('\n')) { starts.push(offset); offset += line.length + 1 }
  return starts
}

function lineOfOffset(starts: readonly number[], index: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid]! <= index) low = mid
    else high = mid - 1
  }
  return low
}

/** 一行里每个声明子各自的初始表达式区间：`const a = X, b = Y` 拆成两个，各判各的。 */
export function declaratorsOnLine(line: string): ReadonlyArray<Readonly<{ name: string; start: number; end: number }>> {
  const head = /\b(?:const|let)\s+/u.exec(line)
  if (head === null) return []
  const out: Array<Readonly<{ name: string; start: number; end: number }>> = []
  let index = (head.index ?? 0) + head[0].length
  while (index < line.length) {
    const nameMatch = /^([A-Za-z_$][\w$]*)\s*=\s*/u.exec(line.slice(index))
    if (nameMatch === null) break
    const start = index + nameMatch[0].length
    let depth = 0
    let quote = ''
    let cursor = start
    for (; cursor < line.length; cursor += 1) {
      const char = line[cursor]!
      if (quote !== '') {
        if (char === '\\') { cursor += 1; continue }
        if (char === quote) quote = ''
        continue
      }
      if (char === "'" || char === '"' || char === '`') { quote = char; continue }
      if ('([{'.includes(char)) depth += 1
      else if (')]}'.includes(char)) depth -= 1
      else if (char === ',' && depth === 0) break
    }
    out.push({ name: nameMatch[1]!, start, end: cursor })
    index = cursor + 1
  }
  return out
}

/** 说明句的键写法：成员访问（`copy.liveHint`）与键字符串（`'…liveHint'`），含它在行内的区间。 */
const HINT_TOKEN = /\.([A-Za-z_$][\w$]*(?:Hint|Note))\b|(['"`])([\w.$-]*(?:Hint|Note))\2/gu

/**
 * 「先把键赋给变量、再交给 ⓘ」的写法：`const liveHint = t('…liveHint')` → `lines={[liveHint]}`。
 *
 * 判据是**所有使用点都在浮层水口里**，不是「变量名出现过一次就算」：只要这个变量还有一处出现在正文
 * （普通 JSX 位置），它就不豁免——否则把同一句话再渲染一次就绕过了门禁。
 * 水口只认这几种：`lines={…}` / `content={…}` 块内、`title=` / `aria-*` / `helpTrigger(`、
 * 以及 `hintKey={X}` / `labelKey={X}` / `ariaLabelKey={X}` 这三类把键原样交给组件的属性。
 *
 * 基线里 `BriefingManualRunDialog.tsx :: nowHint` 那条**不是「过期条目」，是「原来就命中、被这条
 * 豁免放过」**：判据与基线同一笔收是对的，但别读成「基线里写着的东西都可以顺手清」——清不清看的是
 * 它现在还在不在正文里。
 *
 * **已知边界，不是漏判，别去「修」它**：跨文件常量不追。键从别的模块 import 进来再赋值时，
 * 这里看不到它的使用点，一律从严按正文报。修它要引入真正的数据流分析，而收益抵不上
 * 「正文被当成水口放过」的代价——从严最多让人把句子直接写进 ⓘ，不会漏掉正文里的一句说明。
 *
 * 返回**键在源码里的字符区间**（不是行号）：豁免只覆盖那个定义表达式里的那一次键，
 * 同一行别处的正文照旧算命中——整行豁免等于给这一行的每个使用点发通行证
 * （`const a = copy.aHint, b = copy.bodyHint` 会把 b 一起放过）。
 */
export function exemptHintKeySpans(source: string): ReadonlyArray<readonly [number, number]> {
  const spans = floatingBlockSpans(source)
  const starts = lineStartOffsets(source)
  const lines = source.split('\n')
  const inSpans = (index: number): boolean => spans.some(([start, end]) => index >= start && index < end)
  const exempt: Array<readonly [number, number]> = []

  lines.forEach((line, lineIndex) => {
    for (const declarator of declaratorsOnLine(line)) {
      const expression = line.slice(declarator.start, declarator.end)
      const tokens: Array<readonly [number, number]> = []
      const lineStart = starts[lineIndex] ?? 0
      for (const match of expression.matchAll(HINT_TOKEN)) {
        // `declarator.start` 是**行内**偏移，豁免区间要的是**文件内**偏移：漏了这层加法，
        // 区间会落到文件开头附近的无关代码上，等于这条豁免从来没生效（实测踩过）。
        const at = lineStart + declarator.start + (match.index ?? 0)
        tokens.push([at, at + match[0].length] as const)
      }
      if (tokens.length === 0) continue

      const uses: number[] = []
      for (const match of source.matchAll(new RegExp(`\\b${declarator.name}\\b`, 'gu'))) {
        const at = match.index ?? 0
        if (lineOfOffset(starts, at) === lineIndex) continue
        uses.push(at)
      }
      if (uses.length === 0) continue
      const allInSinks = uses.every((at) => {
        if (inSpans(at)) return true
        // **按位置判，不按整行判**：同一行里既可能有 `{liveHint}` 的正文，也可能有 `lines={[liveHint]}`。
        // 用整行 `ALLOWED_CONTEXT` 判断，等于给这一行的每个使用点都发通行证（反向判据当场失效）。
        const prefix = source.slice(starts[lineOfOffset(starts, at)] ?? 0, at)
        return /(?:hintKey|labelKey|ariaLabelKey)=\{[^}]*$/u.test(prefix)
          || /\b(?:title|aria-[a-z-]+)=\{[^}]*$/u.test(prefix)
          || /\bhelpTrigger\([^)]*$/u.test(prefix)
      })
      if (allInSinks) exempt.push(...tokens)
    }
  })
  return exempt
}

const invokedDirectly = process.argv[1]?.endsWith('check-body-prose.mts') === true
function main(): void {
  const findings: Finding[] = []

  for (const root of SCAN_ROOTS) {
    const absolute = join(ROOT, root)
    if (!existsSync(absolute)) continue
    for (const file of walk(absolute)) {
      const id = relative(ROOT, file).split(sep).join('/')
      if (isCaptureOnlySurface(id)) continue
      const source = readFileSync(file, 'utf8')
      const text = stripFloatingBlocks(source)
      // 先把键赋给变量、再交给 ⓘ 的写法：**只豁免那个定义表达式里的那一次键**（按位置，不按行）。
      // 同一行别处的正文照旧算命中——整行豁免会把 `const a = copy.aHint, b = copy.bodyHint` 一起放过。
      const exempt = exemptHintKeySpans(source)
      const exemptAt = (at: number): boolean => exempt.some(([start, end]) => at >= start && at < end)
      const starts = lineStartOffsets(text)
      text.split('\n').forEach((line, index) => {
        if (ALLOWED_CONTEXT.test(line)) return
        // 键**定义**不是用法：`const X_KEY = '…Hint'` 只是给这段文案起名字，真正渲染在别处。
        // 把定义行算成正文，会让每个把键抽成常量的文件都假红一次。
        if (/^\s*const\s+[A-Z][A-Z0-9_]*\s*=/.test(line)) return
        const keys: string[] = []
        // 成员访问：取最后一段（`text.hours.hoursHint` → `hoursHint`）
        for (const match of line.matchAll(/\.([A-Za-z_$][\w$]*(?:Hint|Note))\b/gu)) {
          if (!exemptAt((starts[index] ?? 0) + (match.index ?? 0) + 1)) keys.push(match[1]!)
        }
        // 键字符串：`'settings.x.hoursHint'`
        for (const match of line.matchAll(/['"`]([\w.$-]*(?:Hint|Note))['"`]/gu)) {
          if (!exemptAt((starts[index] ?? 0) + (match.index ?? 0) + 1)) keys.push(match[1]!)
        }
        for (const key of new Set(keys)) {
          // 基线键必须归一化分隔符：Windows 上 `relative()` 给 `a\\b`，基线里是 `a/b`，两边永远对不上。
          findings.push({ file: id, line: index + 1, key })
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
