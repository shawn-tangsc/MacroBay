/**
 * 生产者门禁（契约 §12.1）：批准表里的每一条事件，代码里必须有人真的提交它。
 *
 * 它要防的是今晚反复出现的那一类：**声明齐、批准齐、文案齐、测试齐，就是没人发**。
 * 靠人盘点能发现一次，发现不了下一次。
 *
 * 两条纪律写进用例本身：
 * - **剥注释再扫**（前两次假通过的守卫都是被注释里的示例串骗过去的）；
 * - **解析不到就报「无法判定」并算未通过**，不许沉默地算过——沉默通过比没有门禁更糟，
 *   它会给「已经接好了」发一张假证书。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NOTIFICATION_EVENT_POLICY } from '../contracts/notificationEventPolicy'
import {
  evaluateProducerGate,
  stripComments,
  type ProducerGateSource
} from './producerGateScan'

const root = join(__dirname, '..', '..', '..')

/**
 * **还没有被证明有生产者的批准事件**与**解析不了的提交点**——两份都必须为空，且只减不增。
 *
 * 加一行要满足三条（Chief 2026-11-06 定）：① 写明**谁修**、**退出条件**、**什么条件下删掉这行**；
 * ② **要 Chief 同意**，不许实现时自己加（与基线只减不增同理）；③ 总数只能减——本文件末尾那条
 * 条数断言会盯着，加一行就红。
 *
 * 清空的经过（说明这两份清单不是永久豁免）：
 * - `source.consecutive-failed` / `.source.stale`：提交处是封闭表查表（`SOURCE_ISSUE_EVENT_IDS[kind]`），
 *   表里每个值都在目录里 ⇒ 扫描器展开成该表的值集合，可证明。**没有让产品把 id 写成两处字面量**。
 * - `macro.event-landed`：构建函数窗口里混进第二个事件 id；改成「只认流进 `eventTypeId` 的那一处」后解析到了。
 * - 设置页那处「无法判定」其实是对话框自己的 `submit()` 保存函数（空实参），不是通知提交，已按非提交点跳过。
 */
const KNOWN_UNPROVEN: string[] = []
const KNOWN_UNRESOLVED: string[] = []

function sources(): ProducerGateSource[] {
  const found: ProducerGateSource[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'out') continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.(ts|tsx|mts)$/u.test(entry) || /\.test\.(ts|tsx|mts)$/u.test(entry)) continue
      // 扫描器自己的正则里有 `submit(` 的样例文本：读它会把门禁自己当成生产者。
      if (path.endsWith('producerGateScan.ts')) continue
      found.push({ path: path.slice(root.length + 1), content: readFileSync(path, 'utf8') })
    }
  }
  walk(join(root, 'platform'))
  walk(join(root, 'products'))
  return found
}

/**
 * 事件常量表：「常量名 → 事件 id」。
 *
 * **从门禁本来就在扫的这批源码里现算**，不认识任何产品路径、也不额外读产品文件：谁把常量定义在
 * 哪个文件里，平台不需要知道。
 *
 * 只收**批准表里有的 id**：源码里还有大量长得像事件 id 的键（文案键、指标名），把它们收进来会让
 * 「同一段构建函数里出现两个 id ⇒ 无法判定」误伤真实提交点。常量表的用途只有一处——把
 * `SOME_TABLE.name` 解析成受管事件，别的 id 本来就不该参与。
 */
/**
 * 常量名 → 事件 id 的准入集**来自声明期，不来自批准表**。
 *
 * 曾经只收平台批准表的 key：批准值一搬进产品声明，这些 id 就从集合里消失，提交点写的是
 * `EVENT_IDS.xxx` 这种常量成员 → 映射查不到 → 判成「没有提交点」。门禁**少报**时是绿的，
 * 所以这条必须跟着搬迁同笔改。
 */
function declaredEventIds(list: readonly ProducerGateSource[]): Set<string> {
  const ids = new Set(Object.keys(NOTIFICATION_EVENT_POLICY))
  for (const source of list) {
    const code = stripComments(source.content)
    for (const match of code.matchAll(/(?:notificationEvent|declaration)\(\s*'([a-z0-9-]+\.[a-z0-9.-]+)'/gu)) {
      const id = match[1]
      if (id !== undefined) ids.add(id)
    }
  }
  return ids
}

function idConstants(list: readonly ProducerGateSource[]): Record<string, string> {
  const approved = declaredEventIds(list)
  const map: Record<string, string> = {}
  for (const source of list) {
    const code = stripComments(source.content)
    for (const match of code.matchAll(/([A-Za-z_$][\w$]*):\s*'([a-z0-9-]+\.[a-z0-9.-]+)'/gu)) {
      const name = match[1]
      const id = match[2]
      if (name !== undefined && id !== undefined && approved.has(id)) map[name] = id
    }
  }
  return map
}

describe('生产者门禁：登记了就必须有人发', () => {
  it('resolves event constants from declarations, not from product source files', () => {
    // 空集会让下面那条门禁「因为没有解析到提交点而空过」——这正是今晚抓过的坑，先在这里拦住。
    const constants = idConstants(sources())
    expect(Object.keys(constants).length).toBeGreaterThan(0)
    expect(Object.values(constants).some((id) => id.startsWith('platform.'))).toBe(true)
  })

  it('批准表里每一条事件都有可证明的提交点，或已在已知未证清单里写明原因', () => {
    const scanned = sources()
    const result = evaluateProducerGate({
      approvedIds: Object.keys(NOTIFICATION_EVENT_POLICY),
      dormantIds: [],
      sources: scanned,
      idConstants: idConstants(scanned)
    })

    // 未证清单只减不增：新增一条就必须在这里写出原因与归属（见上面注释）。
    expect(result.missing).toEqual(KNOWN_UNPROVEN)
    // 解析不了的提交点同样算未通过：今天为零，出现就红。
    expect(result.unresolved.map((site) => site.path).sort()).toEqual(KNOWN_UNRESOLVED)
    // 两份清单的总条数只能减——加一行就红，不允许自己给自己开豁免。
    expect(KNOWN_UNPROVEN.length + KNOWN_UNRESOLVED.length).toBe(0)
    // 门禁必须真的抓到过东西——一上来全绿说明它没在看代码。
    expect(result.produced.length).toBeGreaterThan(0)
  })
})

describe('门禁自己的有效性（契约 §12.2）', () => {
  const evaluate = (content: string, idConstants: Record<string, string> = {}) =>
    evaluateProducerGate({
      approvedIds: ['platform.job.failed-terminal', 'platform.job.repeated-failed'],
      dormantIds: [],
      sources: [{ path: 'x.ts', content }],
      idConstants
    })

  it('中间段叫 notification 的合法事件 id 必须能解析出提交点', () => {
    // 文案键以 `notification.` 开头；事件 id 只是**中间**含这个词。用 `includes` 会把后者误伤。
    const result = evaluateProducerGate({ approvedIds: ['platform.notification.self-test'], dormantIds: [], sources: [{ path: 'x.ts', content: "submit({ eventTypeId: 'platform.notification.self-test' })" }], idConstants: {} })
    expect(result.produced).toEqual(['platform.notification.self-test'])
    expect(result.missing).toEqual([])
  })

  it('文案键仍然不是事件 id：`notification.` 开头的串一律不算', () => {
    const result = evaluateProducerGate({ approvedIds: ['platform.job.failed-terminal'], dormantIds: [], sources: [{ path: 'x.ts', content: "submit({ titleKey: 'notification.event.platform.job.failed-terminal.title' })" }], idConstants: {} })
    expect(result.produced).toEqual([])
    expect(result.missing).toEqual(['platform.job.failed-terminal'])
  })

  it('认字面量：注释里的同一个串不算（先剥注释）', () => {
    const code = `
      // submit({ eventTypeId: 'platform.job.repeated-failed' })
      submit({ eventTypeId: 'platform.job.failed-terminal' })
    `
    const result = evaluate(code)
    expect(result.produced).toEqual(['platform.job.failed-terminal'])
    // 只写在注释里的那条**不能**被算成生产者：这正是前两次假通过的形状。
    expect(result.missing).toEqual(['platform.job.repeated-failed'])
  })

  it('认常量表成员：`EVENT_IDS.xxx` 解析成事件 id', () => {
    const result = evaluate("submit({ eventTypeId: EVENT_IDS.failedTerminal })", {
      failedTerminal: 'platform.job.failed-terminal'
    })
    expect(result.produced).toEqual(['platform.job.failed-terminal'])
  })

  it('顺着「先赋给变量再提交」的构建函数找到 id（这条路径曾因一个写错的单词边界而静默失效）', () => {
    // 复现的是实测形状：`const request = buildX(); submit(request)`。门禁靠 followBuilders 读
    // 构建函数体里的 `eventTypeId:` 那一处才能解析；那里如果写的不是单词边界，这条路径**不报错、
    // 只是永远解析不到**——静默失效的门禁比没有更糟，所以这里钉住它能红。
    const result = evaluate(`
      const FAILURE_EVENT_ID = 'platform.job.failed-terminal'
      function buildFailureRequest() { return { eventTypeId: FAILURE_EVENT_ID } }
      const request = buildFailureRequest()
      submit(request)
    `)
    expect(result.produced).toEqual(['platform.job.failed-terminal'])
    expect(result.unresolved).toEqual([])
  })

  it('解析不到的写法报「无法判定」，不算通过', () => {
    const result = evaluate('submit(pickRequest(kind))')
    expect(result.produced).toEqual([])
    expect(result.unresolved).toHaveLength(1)
    expect(result.missing).toContain('platform.job.failed-terminal')
  })

  it('声明了休眠却有提交点：自相矛盾也要报（否则休眠就是万能后门）', () => {
    const result = evaluateProducerGate({
      approvedIds: ['platform.job.failed-terminal'],
      dormantIds: ['platform.job.failed-terminal'],
      sources: [{ path: 'x.ts', content: "submit({ eventTypeId: 'platform.job.failed-terminal' })" }],
      idConstants: {}
    })
    expect(result.dormantButProduced).toEqual(['platform.job.failed-terminal'])
  })
})
