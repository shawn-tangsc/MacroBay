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
 * **今天还没有被证明有生产者的批准事件**——只减不增。
 *
 * 三条各有原因，都不是「懒得接」：
 * 1. `market-intelligence.source.consecutive-failed` / `.source.stale`：id 在提交处是**算出来的**
 *    （`SOURCE_ISSUE_EVENT_IDS[kind]`），静态读不出是哪一条。按契约 §12.1 这属于「无法判定」，
 *    改法是把两处改成字面量或常量表成员——归产品线，本笔不动。
 * 2. `market-intelligence.macro.event-landed`：**已接线**，但扫描器顺着 `buildMacroEventLandedRequest`
 *    没解析出 id（构建函数窗口里有第二个事件 id，按「不许挑一个」的规矩判了无法判定）。
 *    这是扫描器的缺口，不是产品没接；补扫描器时要先把这一行删掉，再看它是否转绿。
 *
 * 新增一行必须写清原因与归属；**不许用「加个豁免」把门禁按绿**。
 */
/**
 * **门禁解析不了的提交点**（按「无法判定＝未通过」处理，但先记在这里，只减不增）。
 *
 * 两处是产品线的写法问题：动态算出来的 id（`SOURCE_ISSUE_EVENT_IDS[kind]`、设置页里按类型拼的 id），
 * 按契约 §12.1 应改成字面量或常量表成员；一处是扫描器跟丢了构建函数（macro 那条）。
 * **谁改完就删对应行**，删掉后若它变成「已证明」，门禁会自己变绿；不许反过来加豁免。
 */
const KNOWN_UNRESOLVED = [
  'products/market-intelligence/desktop/pages/intelligence/MarketAnalysisSettingsDialog.tsx',
  'products/market-intelligence/service/intelligence/application/sourceIssueNotifier.ts',
  'products/market-intelligence/service/intelligence/signals/macroEventLandedNotifier.ts'
].sort()

const KNOWN_UNPROVEN = [
  'market-intelligence.macro.event-landed',
  'market-intelligence.source.consecutive-failed',
  'market-intelligence.source.stale'
].sort()

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

/** 事件 id 常量表：从定义处读一遍，不手抄第二份（手抄必然与定义漂移）。 */
function idConstants(): Record<string, string> {
  const map: Record<string, string> = {}
  const files = [
    'products/market-intelligence/contracts/notificationEventKeys.ts',
    'platform/notifications/contracts/platformNotificationEvents.ts'
  ]
  for (const relative of files) {
    const code = stripComments(readFileSync(join(root, relative), 'utf8'))
    for (const match of code.matchAll(/([A-Za-z_$][\w$]*):\s*'([a-z0-9-]+\.[a-z0-9.-]+)'/gu)) {
      const name = match[1]
      const id = match[2]
      if (name !== undefined && id !== undefined) map[name] = id
    }
  }
  return map
}

describe('生产者门禁：登记了就必须有人发', () => {
  it('批准表里每一条事件都有可证明的提交点，或已在已知未证清单里写明原因', () => {
    const result = evaluateProducerGate({
      approvedIds: Object.keys(NOTIFICATION_EVENT_POLICY),
      dormantIds: [],
      sources: sources(),
      idConstants: idConstants()
    })

    // 未证清单只减不增：新增一条就必须在这里写出原因与归属（见上面两段注释）。
    expect(result.missing).toEqual(KNOWN_UNPROVEN)
    // 解析不了的提交点同样点名：它们按「无法判定＝未通过」处理，不是通过。
    expect(result.unresolved.map((site) => site.path).sort()).toEqual(KNOWN_UNRESOLVED)
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
