import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：**日历对源不感知**——读者看到的行不该因为「这条来自 narwhal 还是 0xrouter」走不同逻辑。
 *
 * 现存用法**全部在基线里、目标是清零**；**新的一处都不许加**。不许拿「读数链需要」（新源优先、
 * 旧源回退）当理由——那条链正是 S2 要删掉的东西，写进注释就等于给它发了授权。
 *
 * 计数的写法（漏一种就等于没守）：
 *   单/双引号、模板串、大写形态 `'Narwhal'`/`'0xRouter'`、常量名
 *   `marketCalendarProviderId`/`marketCalendarLegacyProviderId`/`marketCalendarSourceName`、
 *   前缀串 `macro-calendar-narwhal`/`-0xrouter`；数组包含里的字面量同样会被计数。
 * **`.tsx` 也在范围内**：规则说「组件里按源分支就算错」，那就必须真的看组件。
 *
 * **i18n 按「文件用途」判，不按词判**：允许出现源名的文案集中列在 `I18N_SOURCE_NAME_FILES`
 * （整文件豁免），**其余 i18n 文件零豁免**，出现即红。不按词判是因为「含『来源』就放行」会被
 * 这样绕过：`'card.cpi.yoy': '数据来源：Narwhal'`、`'calendar.row.cpi': 'Narwhal CPI 年率'`。
 * 判据从「这行有没有某几个词」变成「这个文件是干什么的」。
 *
 * 基线与本用例同一笔提交；不带基线就是出生即红的门禁。
 */
const PRODUCT = new URL('../../../', import.meta.url).pathname
/** 扫描根的**期望值**：改扫描根必须同时改这里，diff 里藏不住。 */
const EXPECTED_ROOTS = Object.freeze(['service/intelligence/macro-calendar', 'desktop', 'contracts'])
const ROOTS = EXPECTED_ROOTS
const PATTERN = /(['"`])(?:narwhal|0xrouter|Narwhal|0xRouter)\1|marketCalendarProviderId|marketCalendarLegacyProviderId|marketCalendarSourceName|macro-calendar-narwhal|macro-calendar-0xrouter/g
const SOURCE_NAME = /narwhal|0xrouter/i

/**
 * 允许出现源名的 i18n 文件（**整文件豁免**）。
 *
 * 今天就是这三份：源显示名与源清单、以及汇总文案表（`productText.ts` 是它们的生成汇总）。
 * 目标是继续收拢到专用文件；收拢不改变判据——**其余 i18n 文件零豁免**。
 */
const I18N_SOURCE_NAME_FILES = Object.freeze([
  'desktop/shared/i18n/productText.ts',
  'desktop/shared/i18n/text/settings/intelligenceSources.ts',
  'desktop/shared/i18n/text/settings/macroCalendar.ts'
])
/** 名表的**显式路径清单**：改名或挪位置这里对不上 → 红；清单空着也红。 */
const NAME_TABLE_PATHS = Object.freeze([
  'service/intelligence/macro-calendar/marketCalendarDisplayNameTables.ts',
  'service/intelligence/macro-calendar/marketCalendarCodeNames.ts',
  'service/intelligence/macro-calendar/marketCalendarGermanSourceMappings.ts',
  /* 标准码表（`9650d74`）：四列名 **就住在这里**——它就是名表本体，不是又长出一份。 */
  'service/intelligence/macro-calendar/marketCalendarCodeTable.ts',
  /*
   * 按国家建出的新码表（`5647ea4`）：与基准码表**同一职责**——对外提供「码 → 四列名」，
   * 每个码的中英全称/简称只在这里写一次。它同样是名表本体，不是又抄了一份列名。
   */
  'service/intelligence/macro-calendar/marketCalendarCountryCodeTable.ts'
])
const BASELINE = new URL('./__baselines__/source-literals.json', import.meta.url).pathname
/**
 * 逐处锚点的基线：每处写「哪段代码、几处、为什么」，`sites` 之和必须等于 `count`。
 * 少一处就红——删旧源、删 helper 的那笔必须把数字同笔改小，不许留着变成永远不减的数。
 */
const ANCHORED_BASELINE = 'service/intelligence/macro-calendar/macroIndicatorReadService.ts'
/**
 * 只给构造出的行盖「来源标记」的 helper。定义之外必须还有调用点：
 * helper 若只服务旧源，旧源退役那笔要连它一起删，并在同一笔把它从这个清单里摘掉。
 */
const SOURCE_TAG_HELPERS = Object.freeze(['toNarwhalRow', 'toLegacyRow'])

function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__baselines__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...files(full)); continue }
    if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

type BaselineEntry = {
  count: number
  why?: string
  sites?: readonly { at: string; count: number; what: string }[]
}
type Baseline = { files: Record<string, BaselineEntry> }

function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
}

/** 当前每个文件的命中数：与基线同一套数法，别处不许再算一遍。 */
function currentCounts(): Record<string, number> {
  const current: Record<string, number> = {}
  for (const root of ROOTS) {
    for (const file of files(join(PRODUCT, root))) {
      const rel = relative(PRODUCT, file)
      const source = readFileSync(file, 'utf8')
      const isI18n = rel.includes('shared/i18n/')
      const hits = isI18n
        ? (I18N_SOURCE_NAME_FILES.includes(rel) ? 0
          : source.split('\n').filter((line) => SOURCE_NAME.test(line)).length)
        : (source.match(PATTERN) ?? []).length
      if (hits) current[rel] = hits
    }
  }
  return current
}

describe('源名字面量守卫', () => {
  it('新增一处源名分支必须同时登记基线（四种写法 + .tsx）', () => {
    const baseline = readBaseline()
    const current = currentCounts()
    const growth = Object.entries(current)
      .filter(([rel, count]) => count > (baseline.files[rel]?.count ?? 0))
      .map(([rel, count]) => `${rel}: ${baseline.files[rel]?.count ?? 0} → ${count}`)
    expect(growth, `源名用法新增，必须在 __baselines__/source-literals.json 登记并写理由：\n${growth.join('\n')}`)
      .toEqual([])
  })
})

describe('基线是双向棘轮，不是永久豁免', () => {
  it('源名用法减少时，数字必须在同一笔改小', () => {
    // 只挡涨不挡降的棘轮会养出一串「永远减不下去的数」：删了旧源，数字还挂着，下一个读者
    // 就以为那里真有一处例外。所以降了也红，逼着删减那一笔同时把条目收掉。
    const baseline = readBaseline()
    const current = currentCounts()
    const stale = Object.entries(baseline.files)
      .filter(([rel, entry]) => (current[rel] ?? 0) < entry.count)
      .map(([rel, entry]) => `${rel}: 基线 ${entry.count} → 现在 ${current[rel] ?? 0}`)
    expect(stale, `基线过期：这些文件的源名用法已经减少，必须在同一笔把数字改小（删旧源/删 helper 的那笔要把对应条目一起收掉）：\n${stale.join('\n')}`)
      .toEqual([])
  })

  it('读数服务的 5 处必须逐处带锚点——一处代码没了，对应条目就得同笔删', () => {
    const entry = readBaseline().files[ANCHORED_BASELINE]
    expect(entry?.sites?.length ?? 0, `这条基线必须逐处列出锚点，不许只留一个数字：${ANCHORED_BASELINE}`).toBeGreaterThan(0)
  })

  it('带锚点的条目：各处之和等于 count，且每处锚点仍在文件里', () => {
    const problems: string[] = []
    for (const [rel, entry] of Object.entries(readBaseline().files)) {
      if (entry.sites === undefined) continue
      const sum = entry.sites.reduce((total, site) => total + site.count, 0)
      if (sum !== entry.count) problems.push(`${rel}: 锚点之和 ${sum} ≠ count ${entry.count}`)
      const source = readFileSync(join(PRODUCT, rel), 'utf8')
      for (const site of entry.sites) {
        if (!site.what.trim()) problems.push(`${rel}: 锚点「${site.at}」没写 what`)
        if (!source.includes(site.at)) {
          problems.push(`${rel}: 锚点已不存在「${site.at}」——这段代码删了，就要同笔把 count 改小并删掉这条`)
        }
      }
    }
    expect(problems, `锚点和代码对不上，基线必须跟着代码走：\n${problems.join('\n')}`).toEqual([])
  })

  it('盖来源标记的 helper 不许留成死壳（定义之外必须还有调用点）', () => {
    const source = readFileSync(join(PRODUCT, ANCHORED_BASELINE), 'utf8')
    const orphans = SOURCE_TAG_HELPERS
      .filter((helper) => (source.split(`${helper}(`).length - 1) < 2)
      .map((helper) => `${helper}：定义之外找不到调用点`)
    expect(orphans, `这些 helper 已经没人用了，却把源名留在文件里、把基线数字顶在上面；` +
      `旧源退役时连它一起删，并从 SOURCE_TAG_HELPERS 摘掉：\n${orphans.join('\n')}`).toEqual([])
  })
})

describe('汇总文案表不许手改', () => {
  it('productText.ts 里每个「值含源名」的 key，都必须在 text/** 里存在同名同值的映射', () => {
    // 按**字符串搜索**不够：同一句值在源文件里出现一次，汇总里手改出第二处同值就查不出；
    // 手改后的新值只要别处也有一份，同样过。所以按 **(key, value) 配对**对齐——
    // 找不到同名同值的映射 → 红。改源文件再重新生成自动就对；直接改汇总，立刻红。
    const aggregate = readFileSync(join(PRODUCT, 'desktop/shared/i18n/productText.ts'), 'utf8')
    // key 有引号的（feed id 那种）也有不带引号的（`linkedTimeProvider:` 这种），两种都收。
    const PAIR = /(?:'([^'\n]{1,160})'|([A-Za-z_$][\w$.-]*))\s*:\s*'([^'\n]*)'/g
    const pairs = [...aggregate.matchAll(PAIR)]
      .map((match) => ({ key: (match[1] ?? match[2])!, value: match[3]! }))
      .filter((pair) => SOURCE_NAME.test(pair.value))
    // 模板串里的值也要收（反引号写的文案一样会给读者看）。
    const templates = [...aggregate.matchAll(/`([^`\n]{1,200})`/g)]
      .map((match) => match[1]!)
      .filter((value) => SOURCE_NAME.test(value))
    // 这 8 串是**已知内联**在汇总里的（市场日历那段还没搬到 `text/**`）。登记为「现状已核实」，
    // **新增一处内联文案 → 红**。S3 清理时连同相关文案一起下掉。
    const inline = new Set([
      "'0xRouter 市场日历'", "'日历时间：Narwhal'", "'前值（Narwhal）'", "'公布值（Narwhal）'",
      "'0xRouter market calendar'", "'Calendar time: Narwhal'", "'Previous (Narwhal)'", "'Actual (Narwhal)'",
      // 源名本身（provider 显示名、来源标签）：值就是源名，属于页面署名/设置那一类。
      "'Narwhal'", "'0xRouter'"
    ])
    const sources: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (entry.endsWith('.ts') && !/\.test\.ts$/.test(entry)) sources.push(readFileSync(full, 'utf8'))
      }
    }
    walk(join(PRODUCT, 'desktop/shared/i18n/text'))
    const missing = pairs
      .filter((pair) => !inline.has(`'${pair.value}'`))
      .filter((pair) => !sources.some((source) => {
        const quotedKey = source.includes(`'${pair.key}': '${pair.value}'`)
          || source.includes(`"${pair.key}": "${pair.value}"`)
        const bareKey = new RegExp(`(?:^|[\\s{,'"])${pair.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*'${pair.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(source)
        return quotedKey || bareKey
      }))
      .map((pair) => `${pair.key}: '${pair.value}'`)
    const missingTemplates = templates
      .filter((value) => !inline.has(`'${value}'`))
      .filter((value) => !sources.some((source) => source.includes(value)))
    expect([...missing, ...missingTemplates],
      `这些文案只在汇总里、text/** 里找不到同名同值（手改过？）：\n${[...missing, ...missingTemplates].join('\n')}`)
      .toEqual([])
  })
})

describe('名表按字段形状抓，不靠命名', () => {
  it('四列名表字段出现两处以上的文件，必须在名表清单里', () => {
    // 锚不是文件名（`calendarCodeTable.ts` 这种根本匹配不上正则），而是**字段形状**：
    // 同时出现 `zhFull/zhShort/enFull/enShort` 里两个以上 → 它就是一张四列名表，必须登记。
    //
    // 判定必须落在**数据**上而不是类型上：`{ zhFull: string }` 是类型声明，`row.names?.zhFull` 是读取，
    // 两者都不构成「一张名表」。第一版用 `includes(field)`，于是客户端的类型形状和导出映射也被当成
    // 名表抓了出来——那种误判最后只能靠往清单里塞文件摆平，而清单一旦开始塞不相干的东西就不再有意义。
    // 所以这里要求「字段名后面紧跟一个字符串字面量」。
    const FIELDS = ['zhFull', 'zhShort', 'enFull', 'enShort'] as const
    const isNameTableField = (source: string, field: string): boolean =>
      new RegExp(`\\b${field}\\s*:\\s*['\"\`]`).test(source)
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (!entry.endsWith('.ts') || /\.test\.ts$/.test(entry)) continue
        const rel = relative(PRODUCT, full)
        if (NAME_TABLE_PATHS.includes(rel) || rel.includes('shared/i18n/')) continue
        const source = readFileSync(full, 'utf8')
        if (FIELDS.filter((field) => isNameTableField(source, field)).length >= 2) offenders.push(rel)
      }
    }
    walk(PRODUCT)
    expect(offenders, `这些文件长着四列名表的样子却没登记在 NAME_TABLE_PATHS 里：\n${offenders.join('\n')}`)
      .toEqual([])
  })
})

describe('名表位置与扫描根', () => {
  it('名表用显式路径清单登记：不存在、或在扫描范围之外 → 红；清单空着也红', () => {
    expect(NAME_TABLE_PATHS.length, '名表清单不能是空的——空清单等于什么都没守').toBeGreaterThan(0)
    for (const path of NAME_TABLE_PATHS) {
      expect(() => statSync(join(PRODUCT, path)), `名表不存在：${path}`).not.toThrow()
      expect(ROOTS.some((root) => path.startsWith(root)), `名表不在扫描范围内：${path}`).toBe(true)
    }
  })

  it('扫描根清单不许被悄悄放宽', () => {
    expect([...ROOTS]).toEqual([...EXPECTED_ROOTS])
    expect(EXPECTED_ROOTS.length).toBe(3)
  })
})
