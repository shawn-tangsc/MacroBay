import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { judgeTextKey, looksLikeTextKey } from '../textKeyShape'
import { sentinelResolveText } from '../resolveTextShape'
import { declaredTextKeysIn, literalAriaLabelKeys } from '../textKeyPaths'
import { resolveDrawerText } from '../drawer/drawerText'
import { resolveModalText } from '../modal/modalText'
import { resolvePanelText } from '../side-panel/panelText'
import { resolveToastText } from '../toast/toastText'
import { resolveHelpTriggerText } from '../popover/helpTriggerText'

/**
 * `IconButton` 的读屏名与提示只收 i18n 键，但为了不逼产品绕过组件，类型是开区间 `string`
 * （见 `IconButton.tsx` 里那段说明）。开区间就得有一条守卫替类型把关：
 * **键长什么样**——点分小写，无空白、无中文。写成一个中文句子、或者把已解析好的文案直接
 * 塞进去，读屏会念出键名或者一句脱离语言环境的话，这里当场变红。
 */
const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'platform', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/**
 * 键的形状：点分，**允许驼峰**（产品文案键就是 `portal.calendarCard.openCalendar` 这种），
 * 但不许空白、不许中文——那才是「一句话被当成键」的样子。
 *
 * 判据只有这一份（`../textKeyShape`）：`StatusPill`、`Tooltip` 用同一个函数，不留第二套标准。
 * 这里只判「像不像键」，不判「键在不在表里」：产品自有 i18n 表是合法来源，键在不在那张表里
 * 由各产品自己的用例保证，组件侧无法枚举。
 */

type Offender = { file: string; line: number; prop: string; value: string }

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (entry.name === 'iconButtonKeyGuard.test.ts') continue
    // 产品侧那条守卫的夹具里就有「写坏的键」，它们不是调用点。
    if (entry.name === 'ariaLabelKeyGuard.test.ts') continue
    found.push(join(dir, entry.name))
  }
  return found
}

/**
 * 取出每个 `<IconButton …>` 开标签的文本。
 *
 * **必须按组件切段**：`ariaLabelKey` 这个属性名在别的组件上也用（过滤器组、状态药丸…），
 * 全文件扫会把它们的键算到本组件头上——一条只会误伤的守卫，最后会被人加豁免而不是被修。
 *
 * 标签里可能含 `{…}`（内联处理器、模板字符串），所以按花括号深度找 `>`，不用 `indexOf('>')`。
 */
export function iconButtonTags(text: string): string[] {
  const tags: string[] = []
  for (const match of text.matchAll(/<IconButton\b/g)) {
    let depth = 0
    let end = -1
    for (let index = (match.index ?? 0) + 1; index < text.length; index += 1) {
      const char = text[index]
      if (char === '{') depth += 1
      else if (char === '}') depth = Math.max(0, depth - 1)
      else if (char === '>' && depth === 0) {
        end = index
        break
      }
    }
    if (end !== -1) tags.push(text.slice(match.index ?? 0, end + 1))
  }
  return tags
}

function offendersIn(file: string): Offender[] {
  const text = readFileSync(file, 'utf8')
  const offenders: Offender[] = []
  // 只认赋/传字面量：`ariaLabelKey: '…'`、`tooltipKey="…"`。变量、常量、函数调用一律跳过。
  const pattern = /(?:ariaLabelKey|tooltipKey)\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/g
  for (const tag of iconButtonTags(text)) {
    const tagStart = text.indexOf(tag)
    for (const match of tag.matchAll(pattern)) {
      const value = match[1] ?? ''
      // 先展开同文件字符串常量再判；展开不了就跳过（与传变量同级，不扩张判据）。
      if (judgeTextKey(text, value) !== 'reject') continue
      const line = text.slice(0, tagStart + (match.index ?? 0)).split('\n').length
      offenders.push({ file, line, prop: match[0].split(/[:=]/)[0]!.trim(), value })
    }
  }
  return offenders
}

describe('IconButton key guard', () => {
  it('only ever passes key-shaped strings as the screen-reader name and tooltip', () => {
    const offenders = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root))).flatMap((file) =>
      offendersIn(file).map((offender) => ({ ...offender, file: relative(ROOT, offender.file) }))
    )

    expect(offenders).toEqual([])
  })

  it('catches a sentence and a CJK label, so the guard cannot pass vacuously', () => {
    const bad = [
      "<IconButton ariaLabelKey='Close the panel' />",
      "<IconButton tooltipKey='关闭面板' />",
      "<IconButton ariaLabelKey = 'ui.icon.close ' />"
    ]
      .map((tag) => [...tag.matchAll(/(?:ariaLabelKey|tooltipKey)\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/g)][0]?.[1] ?? '')
      .filter((value) => !looksLikeTextKey(value))

    expect(bad).toHaveLength(3)
  })
  it('尺度收紧的方向：句子和带空白的值仍然被拒', () => {
    // 放开驼峰不能顺手把「一句话」也放进来——这才是这条守卫存在的理由。
    expect(looksLikeTextKey('portal.calendarCard.openCalendar')).toBe(true)
    expect(looksLikeTextKey('ui.state.action.focus-form')).toBe(true)
    expect(looksLikeTextKey('打开日历')).toBe(false)
    // 点分但含中文：只有真按「无中文」判才拦得住，只判「有没有点」会放它过去。
    expect(looksLikeTextKey('ui.state.刷新')).toBe(false)
    expect(looksLikeTextKey('Open the calendar')).toBe(false)
    expect(looksLikeTextKey('nokeydothere')).toBe(false)
  })

})

/**
 * 守卫 A（平台/壳层）：`ariaLabelKey` 的**字面量**必须是某张文案表里声明过的键。
 *
 * 这一侧没有统一点分表（各屏有自己的本地映射），所以「声明过」按两处收：
 * 树内对象字面量的**属性路径**，以及组件自带 `*Text.ts` 的键与 `*_KEY` 常量（`textKeyPaths`）。
 *
 * 为什么必须按属性路径而不是「文件里出现过这个字符串」：哨兵解析器自己就把键写在比较式里
 * （`key === 'briefingPush.stripInfo'`），按「出现过」判它一定绿；按属性名判它才红。
 *
 * 已知残差：键是运行时拼出来的字符串时 AST 收不到——这类只允许登记例外，默认没有例外。
 */
describe('ariaLabelKey 必须是声明过的键（平台/壳层）', () => {
  /** 守卫自己的实现文件会把 `ariaLabelKey` 写进正则与类型，它们不是调用点。 */
  const GUARD_IMPLEMENTATION = new Set([
    'platform/ui/components/textKeyPaths.ts',
    'platform/ui/components/resolveTextShape.ts'
  ])

  function offendersIn(sources: ReadonlyArray<Readonly<{ path: string; text: string }>>): string[] {
    const declared = declaredTextKeysIn(sources)
    return sources.flatMap((source) => literalAriaLabelKeys(source.text)
      .filter((entry) => !declared.has(entry.key))
      .map((entry) => `${source.path}:${entry.line} ${entry.key}`))
  }

  it('only ever names a key some text table declares', () => {
    const sources = ['platform', 'apps']
      .flatMap((root) => sourceFiles(join(ROOT, root)))
      .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
      // 用例里的 `ui.test.*` 是夹具键，不是调用点：守卫看的是产品与平台的源码。
      .filter((source) => !/\.test\.(ts|tsx)$/.test(source.path))
      .filter((source) => !GUARD_IMPLEMENTATION.has(source.path))

    expect(offendersIn(sources)).toEqual([])
  })

  it('tells a declared key from a key that only appears in a comparison', () => {
    const real = { path: 'a.tsx', text: "const T = { ui: { drawer: { close: '关闭' } } }\n<IconButton ariaLabelKey=\"ui.drawer.close\" />" }
    const fake = { path: 'b.tsx', text: "<IconButton ariaLabelKey=\"ui.not.defined\" />" }
    const sentinel = { path: 'c.tsx', text: "<IconButton ariaLabelKey=\"briefingPush.stripInfo\" resolveText={(key) => key === 'briefingPush.stripInfo' ? 'x' : ''} />" }

    expect(offendersIn([real])).toEqual([])
    expect(offendersIn([fake])).toEqual(['b.tsx:1 ui.not.defined'])
    // 哨兵自己把键写在比较式里——按属性名判它仍是「没声明过」。
    expect(offendersIn([sentinel])).toEqual(['c.tsx:1 briefingPush.stripInfo'])
  })
})

/**
 * 守卫 B：`resolveText` 不许是「哨兵形状」。
 *
 * 抓三类：首参与字符串字面量做 `===`/`!==`、对首参 `switch`、函数体恒等（`(key) => key`）。
 * **不抓**「内联 lambda 一律」：平台各屏合法地写 `resolveText={(key) => localMap[key] ?? ''}`，
 * 一刀切只会把合规代码全打红，然后被加豁免。
 */
/**
 * 平台侧的另一半：`ui.*` 这类键要能从**组件自带表**里真解析出来，不是「声明过」就算数。
 * 这一侧没有统一点分表，所以用各组件自己的解析器（与运行时同一个函数）；两张语言各取一次。
 */
describe('ui.* 键要能从组件自带表里解析出来', () => {
  const resolvers: ReadonlyArray<(language: 'zh-CN' | 'en-US', key: string) => string> = [
    (language, key) => resolveDrawerText(language, key as never),
    (language, key) => resolveModalText(language, key as never),
    (language, key) => resolvePanelText(language, key as never),
    (language, key) => resolveToastText(language, key as never),
    (language, key) => resolveHelpTriggerText(language, key)
  ]

  const resolves = (key: string): boolean => resolvers.some((resolve) =>
    resolve('zh-CN', key) !== '' && resolve('en-US', key) !== '')

  /**
   * 只断「真键解析得出句子」这半边：组件表对未知键**回退到它唯一那句话**（`?? ZH_CN[CLOSE_KEY]`），
   * 所以单靠解析器调用**证明不了**键存在——反例必须由上半条「属性名声明」来抓。
   * 两条合起来才是完整判据：声明过（挡哨兵）且解析得出（挡插错父节点）。
   */
  it('resolves the component-owned keys through their own tables', () => {
    expect(resolves('ui.drawer.close')).toBe(true)
    expect(resolves('ui.help.trigger')).toBe(true)
  })
})

describe('resolveText 不许是哨兵形状', () => {
  /**
   * 归属由**元素本身**决定（`sentinelResolveText` 里按 JSX 标签名判），不再数行数：
   * 数行的窗口在长开标签、属性顺序、格式化差异下都会飘，同一类哨兵时红时不红。
   */
  function sentinelsIn(sources: ReadonlyArray<Readonly<{ path: string; text: string }>>) {
    return sources.flatMap((source) => sentinelResolveText(source.path, source.text))
  }

  it('never hard-codes key → sentence in a comparison, a switch or an identity function', () => {
    const sources = ['apps', 'platform', 'products']
      .flatMap((root) => sourceFiles(join(ROOT, root)))
      .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
      // 用例里的哨兵是**反向夹具**（它们必须红），不参与「当前树全绿」这条。
      .filter((source) => !/\.test\.(ts|tsx)$/.test(source.path))
      .filter((source) => !source.path.startsWith('platform/ui/components/textKeyPaths.ts')
        && !source.path.startsWith('platform/ui/components/resolveTextShape.ts'))

    expect(sentinelsIn(sources).map((entry) => `${entry.path}:${entry.line} ${entry.shape}`)).toEqual([])
  })

  /**
   * 已知漏掉的九处形状（平台设置已在 `525ca4c` 修完，这里只留形状作夹具）。
   *
   * 它们共同的特征：**调用点的开标签很长**，`resolveText` 距离开标签超过 6 行。
   * 旧实现按「`resolveText` 上方 6 行内出现过组件名」过滤，于是这九处一条都没抓到——
   * 数行数在多层 props、格式化差异下都会飘，这也正是这个窗口必须换成 AST 的原因。
   */
  const MULTILINE_SENTINELS: ReadonlyArray<readonly [string, string]> = [
    ["ApiAddressSection", "const X = <IconButton\n  ariaLabelKey=\"modelService.requestConfig\"\n  dataAttributes={{ 'data-apiaddresssection': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.requestConfig\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.requestConfig' ? labels.requestConfig : '')}\n/>\n"],
    ["ModelDrawer", "const X = <IconButton\n  ariaLabelKey=\"modelService.copyModelId\"\n  dataAttributes={{ 'data-modeldrawer': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.copyModelId\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.copyModelId' ? labels.copyModelId : '')}\n/>\n"],
    ["ModelRow.testModel", "const X = <IconButton\n  ariaLabelKey=\"modelService.testModel\"\n  dataAttributes={{ 'data-modelrow.testmodel': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.testModel\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.testModel' ? labels.testModel : '')}\n/>\n"],
    ["ModelRow.editModel", "const X = <IconButton\n  ariaLabelKey=\"modelService.editModel\"\n  dataAttributes={{ 'data-modelrow.editmodel': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.editModel\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.editModel' ? labels.editModel : '')}\n/>\n"],
    ["ModelRow.removeModel", "const X = <IconButton\n  ariaLabelKey=\"modelService.removeModel\"\n  dataAttributes={{ 'data-modelrow.removemodel': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.removeModel\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.removeModel' ? labels.removeModel : '')}\n/>\n"],
    ["ModelsSection", "const X = <IconButton\n  ariaLabelKey=\"modelService.addModel\"\n  dataAttributes={{ 'data-modelssection': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.addModel\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.addModel' ? labels.addModel : '')}\n/>\n"],
    ["ProviderMoreMenu", "const X = <IconButton\n  ariaLabelKey=\"modelService.providerMoreActions\"\n  dataAttributes={{ 'data-providermoremenu': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.providerMoreActions\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.providerMoreActions' ? labels.more : '')}\n/>\n"],
    ["EndpointFields", "const X = <IconButton\n  ariaLabelKey=\"modelService.endpointDelete\"\n  dataAttributes={{ 'data-endpointfields': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.endpointDelete\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.endpointDelete' ? labels.deleteEndpoint : '')}\n/>\n"],
    ["ModelProviderApiKeyField", "const X = <IconButton\n  ariaLabelKey=\"modelService.showApiKey\"\n  dataAttributes={{ 'data-modelproviderapikeyfield': true }}\n  icon={Settings2}\n  onSelect={open}\n  size=\"sm\"\n  tooltipKey=\"modelService.showApiKey\"\n  variant=\"plain\"\n  resolveText={(key) => (key === 'modelService.showApiKey' ? labels.showApiKey : '')}\n/>\n"]
  ]

  it('catches the nine multiline shapes the six-line window used to miss', () => {
    const sources = MULTILINE_SENTINELS.map(([name, text]) => ({ path: `${name}.tsx`, text }))
    const caught = sentinelsIn(sources)
    expect(caught).toHaveLength(MULTILINE_SENTINELS.length)
    expect(caught.every((entry) => entry.shape === 'comparison')).toBe(true)
  })

  it('catches the three shapes and leaves a table lookup alone', () => {
    const comparison = { path: 'a.tsx', text: "const A = <IconButton resolveText={(key) => key === 'a.b' ? 'X' : ''} />\n" }
    const switching = { path: 'b.tsx', text: "const B = <IconButton resolveText={(key) => { switch (key) { case 'a.b': return 'X'; default: return '' } }} />\n" }
    const identity = { path: 'c.tsx', text: "const C = <IconButton resolveText={(key) => key} />\n" }
    const lookup = { path: 'd.tsx', text: "const D = <IconButton resolveText={(key) => map[key] ?? ''} />\n" }
    const resolver = { path: 'e.tsx', text: "const E = <IconButton resolveText={resolveProductTextKey} />\n" }

    expect(sentinelsIn([comparison]).map((entry) => entry.shape)).toEqual(['comparison'])
    expect(sentinelsIn([switching]).map((entry) => entry.shape)).toEqual(['switch'])
    expect(sentinelsIn([identity]).map((entry) => entry.shape)).toEqual(['identity'])
    expect(sentinelsIn([lookup])).toEqual([])
    expect(sentinelsIn([resolver])).toEqual([])
  })
})
