import { expect, it } from 'vitest'

import { assertNoSerializedValueObjects, restoreAndReportBriefingDisplayValues, restoreBriefingDisplayValues, serializedDisplayValueHits, toDisplayString, toDisplayText } from './briefingDisplayValue'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

it('拒绝把值对象序列化进展示字段，并指出事件与字段', () => {
  // 线上文档的真实路径是 `news.macro[]`，不是某个顶层数组；递归扫整份文档才能抓到它。
  const broken = { news: { macro: [{ eventKey: 'evt-1', title: 'x', actual: '4.6%', previous: '{"displayValue":"4.7%"}', consensus: '4.7%' }] } }
  expect(() => assertNoSerializedValueObjects(broken)).toThrow('briefing-display-value-not-localized:evt-1:previous')
  // 正常文档与正文里出现同字样的句子都不受影响：只扫展示字段。
  expect(() => assertNoSerializedValueObjects({ news: { macro: [{ eventKey: 'evt-2', actual: '4.6%', previous: '4.7%' }] }, sections: [{ body: '正文里提到 {"displayValue": 极不可能' }] })).not.toThrow()
})

it('读侧只还原单键 displayValue，其它原样返回', () => {
  expect(toDisplayString('{"displayValue":"4.7%"}')).toBe('4.7%')
  expect(toDisplayString('{"displayValue":"4.7%","extra":1}')).toBe('{"displayValue":"4.7%","extra":1}')
  expect(toDisplayString('{"other":"4.7%"}')).toBe('{"other":"4.7%"}')
  expect(toDisplayString('4.7%')).toBe('4.7%')
  expect(toDisplayString(undefined)).toBeUndefined()
})

it('生成侧只有一个出口：值对象进 packet 前变成普通字符串，非字符串返回 undefined', () => {
  expect(toDisplayText('{"displayValue":"4.7%"}')).toBe('4.7%')
  expect(toDisplayText('4.7%')).toBe('4.7%')
  expect(toDisplayText({ displayValue: '4.7%' })).toBeUndefined()
  expect(toDisplayText(undefined)).toBeUndefined()
})

it('读口只还原宏观事件的三个展示字段，其它字段与多键串原样', () => {
  const broken = {
    schemaVersion: 1,
    news: {
      items: [],
      macro: [
        { eventKey: 'evt-1', title: '至9月三个月ILO失业率', previous: '{"displayValue":"4.7%"}', actual: '4.6%', consensus: '4.7%', why: 'why' },
        { eventKey: 'evt-2', title: 'x', previous: '{"displayValue":"1%","extra":1}' }
      ],
      notes: {}
    }
  } as unknown as DailyBriefingDocument
  const restored = restoreBriefingDisplayValues(broken)
  expect(restored.news.macro[0]?.previous).toBe('4.7%')
  expect(restored.news.macro[0]?.actual).toBe('4.6%')
  expect(restored.news.macro[0]?.why).toBe('why')
  // 多键不猜：原样留着（那段串不是值对象的序列化）。
  expect(restored.news.macro[1]?.previous).toBe('{"displayValue":"1%","extra":1}')
  // 库里那份不改：还原返回同一份对象时也必须是原引用（干净文档不产生新对象）。
  expect((broken as unknown as { news: { macro: { previous: string }[] } }).news.macro[0]!.previous).toBe('{"displayValue":"4.7%"}')
  expect(restoreBriefingDisplayValues({ ...broken, news: { ...broken.news, macro: [{ eventKey: 'clean', previous: '4.7%' }] } } as unknown as DailyBriefingDocument))
    .toBeDefined()
})

it('读口还原时留下一条计数：按字符串形状认，干净文档一条都不打', () => {
  // 产品经理 2026-11-18：读侧静默还原会让这个错永远看不见——所以还原的同时必须能数出「哪一行、
  // 哪个字段」。判据是**字符串形状**（能解析成单键 displayValue 的文本），不是「值是对象」。
  const broken = {
    schemaVersion: 1,
    news: {
      items: [],
      macro: [{ eventKey: 'evt-1', title: 'x', previous: '{"displayValue":"4.7%"}', actual: '4.6%', consensus: '4.7%' }],
      notes: {}
    }
  } as unknown as DailyBriefingDocument

  expect(serializedDisplayValueHits(broken)).toEqual([{ event: 'evt-1', field: 'previous', restored: true }])

  const logged: string[] = []
  const original = console.log
  console.log = (line: string) => { logged.push(String(line)) }
  try {
    const restored = restoreAndReportBriefingDisplayValues(broken)
    expect(restored.news.macro[0]?.previous).toBe('4.7%')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('[daily-briefing.values]')
    expect(logged[0]).toContain('"restored":1')
    expect(logged[0]).toContain('"kept":0')
    expect(logged[0]).toContain('evt-1:previous')
    // 不写值本身：诊断只留定位信息，别把读者看到的内容再抄一遍到日志里。
    expect(logged[0]).not.toContain('4.7%')
  } finally {
    console.log = original
  }

  // 解析出来是对象、但不是单键 displayValue：**不还原**，但必须继续计数（否则界面上的 JSON 看不见）。
  const multiKey = {
    ...broken,
    news: { ...broken.news, macro: [{ eventKey: 'evt-3', previous: '{"displayValue":"1%","extra":1}' }] }
  } as unknown as DailyBriefingDocument
  expect(serializedDisplayValueHits(multiKey)).toEqual([{ event: 'evt-3', field: 'previous', restored: false }])
  const keptLog: string[] = []
  const originalKept = console.log
  console.log = (line: string) => { keptLog.push(String(line)) }
  try {
    expect(restoreAndReportBriefingDisplayValues(multiKey).news.macro[0]?.previous).toBe('{"displayValue":"1%","extra":1}')
    expect(keptLog[0]).toContain('"kept":1')
    expect(keptLog[0]).toContain('evt-3:previous:kept')
  } finally {
    console.log = originalKept
  }

  // 干净文档：不打日志，返回原引用。
  const clean = { ...broken, news: { ...broken.news, macro: [{ eventKey: 'evt-2', previous: '4.7%' }] } } as unknown as DailyBriefingDocument
  expect(serializedDisplayValueHits(clean)).toEqual([])
  const quiet: string[] = []
  const originalQuiet = console.log
  console.log = (line: string) => { quiet.push(String(line)) }
  try {
    expect(restoreAndReportBriefingDisplayValues(clean)).toBe(clean)
    expect(quiet).toEqual([])
  } finally {
    console.log = originalQuiet
  }
})
