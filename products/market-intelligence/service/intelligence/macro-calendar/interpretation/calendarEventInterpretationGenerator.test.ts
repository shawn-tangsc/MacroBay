import { DatabaseSync } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'

import { buildCalendarInterpretationEnvelope } from './calendarEventInterpretationEnvelope'
import { createCalendarInterpretationGenerator } from './calendarEventInterpretationGenerator'
import { readCalendarInterpretation } from './calendarEventInterpretationStore'
import { migrateMacroCalendarSchema } from '../macroCalendarSchema'

/**
 * 生成路径（R36 #34 第二半）：什么时候调模型、什么时候不调、失败落什么。
 *
 * 判据全是「调用了几次模型」和「库里写了什么」，不看返回文案的措辞——措辞是模型的事。
 */
const now = '2026-11-13T14:00:00.000Z'

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrateMacroCalendarSchema(db as never, (sql) => db.exec(sql))
  return db
}

const facts = {
  eventKey: 'US.CPI.RELEASE.2026-M10', title: '美国 10 月 CPI 年率', country: 'US', importance: 'high' as const,
  periodKey: '2026-M10', scheduledDate: '2026-11-13', actual: '3.2%', previous: '3.0%', consensus: '3.1%', source: 'BLS'
}
const values = { actual: '3.2%', consensus: '3.1%', previous: '3.0%' }
const GOOD_TEXT = '美国 10 月 CPI 年率 3.2%，高于预期的 3.1%，也高于前值 3.0%。通胀仍有粘性，下一步看核心分项。'

/** 默认「模型」：只复述信封里的值——用来证明同一份数据第二次不再调它。 */
function echoEnvelope(request: { messages: readonly { role: string; content: string }[] }): string {
  const envelope = JSON.parse(request.messages[1]!.content) as {
    event: { title: string; period: string }
    values: { actual?: string; previous?: string; consensus?: string }
  }
  return `${envelope.event.title}：实际值 ${envelope.values.actual ?? '未给出'}，预期 ${envelope.values.consensus ?? '未给出'}，前值 ${envelope.values.previous ?? '未给出'}。下一期继续看同一分项的方向。`
}

function harness(invokeImpl: (request: { taskId: string; messages: readonly { role: string; content: string }[] }) => Promise<unknown>) {
  let calls = 0
  const db = database()
  const generator = createCalendarInterpretationGenerator({
    database: db,
    now: () => now,
    invoke: async (request) => {
      calls += 1
      return await invokeImpl(request) as never
    }
  })
  const generate = (overrides: Partial<Parameters<typeof generator.generate>[0]> = {}) => generator.generate({
    eventKey: facts.eventKey, importance: 'high', locale: 'zh-CN', values,
    buildEnvelope: () => buildCalendarInterpretationEnvelope({ event: facts, history: [] }),
    trigger: 'request', ...overrides
  })
  return { db, generate, calls: () => calls }
}

const ok = (text: string) => async () => ({
  ok: true as const, output: { text }, providerId: 'p', modelId: 'm',
  trace: { taskId: 't', providerId: 'p', modelId: 'm', durationMs: 1 }
})

describe('calendarEventInterpretation: 生成与复用', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => { h = harness(async (request) => ({
    ok: true as const, output: { text: echoEnvelope(request) }, providerId: 'p', modelId: 'm',
    trace: { taskId: 't', providerId: 'p', modelId: 'm', durationMs: 1 }
  })) })

  it('高档生成一次并落库；同一份数据再要一次不重新调模型', async () => {
    const first = await h.generate()
    expect(first.state).toBe('ready')
    expect(h.calls()).toBe(1)
    const second = await h.generate()
    expect(second).toMatchObject({ state: 'ready', cached: true })
    expect(h.calls()).toBe(1)
  })

  it('中档点开也生成一次并落库（第二次仍不调模型）', async () => {
    expect((await h.generate({ importance: 'medium' })).state).toBe('ready')
    expect((await h.generate({ importance: 'medium' })).state).toBe('ready')
    expect(h.calls()).toBe(1)
  })

  it('低档与未分级：不生成、不落行、不调模型（这条红了就是预算被绕过）', async () => {
    expect(await h.generate({ importance: 'low' })).toEqual({ state: 'not-applicable' })
    expect(await h.generate({ importance: undefined })).toEqual({ state: 'not-applicable' })
    expect(h.calls()).toBe(0)
    expect(readCalendarInterpretation(h.db, { eventKey: facts.eventKey, dataKey: 'anything', locale: 'zh-CN' })).toBeUndefined()
  })

  it('数据变了就是另一份数据：重新生成，旧行留着作审计', async () => {
    await h.generate()
    const changed = await h.generate({ values: { actual: '3.4%', consensus: '3.1%', previous: '3.0%' },
      buildEnvelope: () => buildCalendarInterpretationEnvelope({ event: { ...facts, actual: '3.4%' }, history: [] }) })
    expect(changed.state).toBe('ready')
    expect(h.calls()).toBe(2)
  })

  it('中文与英文各一份行：语言变了重新生成，不把中文端给英文读者', async () => {
    await h.generate({ locale: 'zh-CN' })
    await h.generate({ locale: 'en-US' })
    expect(h.calls()).toBe(2)
  })
})

describe('calendarEventInterpretation: 失败与重试', () => {
  it('模型失败：落失败标记；自动路径不重试，读者要求重试才再调一次', async () => {
    let calls = 0
    const h = harness(async () => {
      calls += 1
      return { ok: false as const, errorCode: 'timeout', trace: { taskId: 't', durationMs: 1 } }
    })
    expect(await h.generate()).toEqual({ state: 'failed', failureCode: 'timeout' })
    expect(calls).toBe(1)
    // 高档的后台补生成（auto）碰到失败就停：不然每个周期都会重烧一次。
    expect(await h.generate({ trigger: 'auto' })).toEqual({ state: 'failed', failureCode: 'timeout' })
    expect(calls).toBe(1)
    // 读者点重试：再试一次。
    expect(await h.generate({ trigger: 'request' })).toEqual({ state: 'failed', failureCode: 'timeout' })
    expect(calls).toBe(2)
  })

  it('输出引用了信封外的数字：按 fact-mismatch 落失败，不把编的数给读者', async () => {
    const h = harness(ok('CPI 年率 3.2%，折年率 4.4%，明显偏高。'))
    expect(await h.generate()).toEqual({ state: 'failed', failureCode: 'fact-mismatch' })
    const row = readCalendarInterpretation(h.db, {
      eventKey: facts.eventKey,
      dataKey: (await import('./calendarEventInterpretationPolicy')).calendarInterpretationDataKey(values),
      locale: 'zh-CN'
    })
    expect(row?.state).toBe('failed')
    expect(row?.text).toBeUndefined()
  })

  it('输出太短：invalid-output，不落 ready', async () => {
    const h = harness(ok('3.2%'))
    expect(await h.generate()).toEqual({ state: 'failed', failureCode: 'invalid-output' })
  })

  it('模型没就绪：model-unavailable（不是 provider-error，读者的下一步不一样）', async () => {
    const h = harness(async () => ({ ok: false as const, errorCode: 'missing-api-key', trace: { taskId: 't', durationMs: 1 } }))
    expect(await h.generate()).toEqual({ state: 'failed', failureCode: 'model-unavailable' })
  })
})