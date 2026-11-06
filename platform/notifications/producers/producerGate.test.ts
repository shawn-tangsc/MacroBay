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
