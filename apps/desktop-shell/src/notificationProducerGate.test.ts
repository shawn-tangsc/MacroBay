/**
 * 生产者门禁（契约 §12.1）：签过批准的事件，代码里必须有人真的提交它。
 *
 * 它要防的是今晚反复出现的那一类：**声明齐、批准齐、文案齐、测试齐，就是没人发**。
 * 靠人盘点能发现一次，发现不了下一次。
 *
 * 两条纪律写进用例本身：
 * - **剥注释再扫**（前两次假通过的守卫都是被注释里的示例串骗过去的）；
 * - **解析不到就报「无法判定」并算未通过**，不许沉默地算过——沉默通过比没有门禁更糟，
 *   它会给「已经接好了」发一张假证书。
 *
 * **为什么放在 `apps/desktop-shell/src`（b3-1 从 platform 搬来）**：门禁的范围是「平台 + 产品」整棵树，
 * 而「全部已批准事件」现在只能从各来源自己的批准合成——平台不许 import 产品代码（契约 N1）。
 * 这里是装配根那一侧（`src/main.ts` 同样 import `@products/generated`），才可能一处覆盖两边。
 * 搬过来只换「批准从哪来」与文件位置，**断言与期望值逐字未改**。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { productManifests } from '@products/generated/productManifests'
import { mergeApprovalView } from '@platform/notifications/contracts/notificationApprovalView'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import {
  evaluateProducerGate,
  stripComments,
  type ProducerGateSource
} from '@platform/notifications/producers/producerGateScan'

const root = join(__dirname, '..', '..', '..')

/** 「全部已批准事件」= 合并批准视图（唯一实现）：平台一份 + 每个产品自己一份。 */
const approvedIds = Object.keys(mergeApprovalView([
  { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
  ...productManifests.map((manifest) => ({
    productId: manifest.id,
    events: manifest.notificationEvents ?? [],
    ...(manifest.notificationApproval === undefined ? {} : { approval: manifest.notificationApproval })
  }))
]))

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
 * 常量名 → 事件 id 的准入集**只来自声明期**（b3-1：不再拿批准表当种子）。
 *
 * 判据：源码里 `notificationEvent('…')` / `declaration('…')` 的实参就是受管事件的登记处。
 * 源码里还有大量长得像事件 id 的键（文案键、指标名），只收登记过的那批，才不会让
 * 「同一段构建函数里出现两个 id ⇒ 无法判定」误伤真实提交点。常量表的用途只有一处——把
 * `SOME_TABLE.name` 解析成受管事件，别的 id 本来就不该参与。
 *
 * 种子曾经是那张批准表的 key：批准值一搬进产品声明，这些 id 就从集合里消失，提交点写
 * `EVENT_IDS.xxx` 这种常量成员 → 映射查不到 → 判成「没有提交点」。门禁**少报时是绿的**，
 * 所以种子必须去掉、只认声明——这条有反向实测钉住（摘掉一条声明的解析，门禁必须红）。
 */
function declaredEventIds(list: readonly ProducerGateSource[]): Set<string> {
  const ids = new Set<string>()
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

  it('每一条签过批准的事件都有可证明的提交点，或已在已知未证清单里写明原因', () => {
    const scanned = sources()
    const result = evaluateProducerGate({
      approvedIds,
      dormantIds: [],
      sources: scanned,
      idConstants: idConstants(scanned),
      admittedIds: [...declaredEventIds(scanned)]
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

  it('常量成员只有被声明过才算提交点（形状像不算）', () => {
    // 源码里有个错误码，形状和事件 id 一样、也走常量表成员。它没有在任何声明里出现过，
    // 所以**不能**被算成生产点：门禁「少报」时是绿的，比红更危险。这条用例在准入集被放宽成
    // 「只要长得像就收」时会变红——它钉的是判据，不是当前实现。
    const content = `
      const ERROR_CODES = { rateLimited: 'sample.error.rate-limited' }
      submit({ eventTypeId: ERROR_CODES.rateLimited })
    `
    const scanned = [{ path: 'x.ts', content }]
    const result = evaluateProducerGate({
      approvedIds: ['sample.error.rate-limited'],
      dormantIds: [],
      sources: scanned,
      idConstants: idConstants(scanned),
      admittedIds: [...declaredEventIds(scanned)]
    })

    expect(result.produced).toEqual([])
    expect(result.missing).toEqual(['sample.error.rate-limited'])
  })

  it('同一个串一旦被声明，同一个提交点就能解析（准入集来自声明，不是形状）', () => {
    const scanned = [
      { path: 'declaration.ts', content: "declaration('sample.error.rate-limited', {})" },
      {
        path: 'x.ts',
        content: `
          const ERROR_CODES = { rateLimited: 'sample.error.rate-limited' }
          submit({ eventTypeId: ERROR_CODES.rateLimited })
        `
      }
    ]
    const result = evaluateProducerGate({
      approvedIds: ['sample.error.rate-limited'],
      dormantIds: [],
      sources: scanned,
      idConstants: idConstants(scanned),
      admittedIds: [...declaredEventIds(scanned)]
    })

    expect(result.produced).toEqual(['sample.error.rate-limited'])
    expect(result.missing).toEqual([])
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
