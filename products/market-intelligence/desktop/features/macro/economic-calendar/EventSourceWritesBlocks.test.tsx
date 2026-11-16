// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import { EventSourceWritesBlocks } from './EventSourceWritesBlocks'

/**
 * #47 的判据：**同一期、两个来源，各一块**（帝国大厦那期：narwhal 待补值/预期 10，
 * 0xrouter 已发布/预期 18/实际 7.8），不许拼成一条；没给的格子写「源未给出」，不写「没有」。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
const scoped = (node: React.ReactElement): React.ReactElement => <ShellTimeZoneProvider timeZone="UTC">{node}</ShellTimeZoneProvider>

it('shows one block per source and keeps their values apart', async () => {
  const rows = [
    { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-16T21:49:41.793Z',
      status: 'backfilling', consensus: '10', actual: null, previous: '25.5', identityKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' },
    { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-16T13:30:00.000Z',
      status: 'published', consensus: '18.0', actual: '7.8', previous: '25.5', identityKey: '["214790",79095]' }
  ]
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<EventSourceWritesBlocks rows={rows} text={text} />)))
    const blocks = [...host.querySelectorAll('[data-source-block]')]
    expect(blocks).toHaveLength(2)
    // 各自带自己的状态与记录类型：市场来源只有「当前观测」，不许写成写入记录。
    expect(blocks[0]!.textContent).toContain('narwhal')
    expect(blocks[0]!.textContent).toContain('待补值')
    expect(blocks[0]!.textContent).toContain('当前观测')
    expect(blocks[1]!.textContent).toContain('0xrouter')
    expect(blocks[1]!.textContent).toContain('数据已获取')
    // 值不许串台：narwhal 没有实际值就写「源未给出」，0xrouter 的 7.8 只在它自己那块里。
    expect(blocks[0]!.querySelector('[data-write-actual]')?.textContent).toContain('源未给出')
    expect(blocks[0]!.textContent).not.toContain('7.8')
    expect(blocks[1]!.querySelector('[data-write-actual]')?.textContent).toContain('7.8')
    expect(blocks[0]!.querySelector('[data-write-consensus]')?.textContent).toContain('10')
    expect(blocks[1]!.querySelector('[data-write-consensus]')?.textContent).toContain('18.0')
  } finally { await act(async () => root.unmount()) }
})

it('labels a provider that does have revision writes as write records', async () => {
  const rows = [
    { source: 'revision' as const, providerId: 'macro-calendar-bls', observedAt: '2026-10-28',
      status: 'scheduled', consensus: null, actual: null, previous: null, identityKey: 'US.FOMC.2026-10-28' }
  ]
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<EventSourceWritesBlocks rows={rows} text={text} />)))
    const block = host.querySelector('[data-source-block]')!
    expect(block.textContent).toContain('写入记录')
    expect(block.textContent).not.toContain('当前观测')
    // 三个值都没有：逐格写「源未给出」。
    expect(block.querySelectorAll('[data-write-consensus], [data-write-actual], [data-write-previous]'))
      .toHaveLength(3)
    expect(block.textContent?.match(/源未给出/gu)?.length).toBe(3)
  } finally { await act(async () => root.unmount()) }
})

/**
 * #40 的范围（Chief 2026-11-17 定）：**两侧都有值且不相等 → 并列 + 标记，不挑一个、不判对错**。
 * 一侧没给不算冲突；写法不同但数值相同也不算（`0.7` 与 `0.7%` 是同一个数）。
 */
it('lists disagreeing fields side by side with the source name, and never picks one', async () => {
  const rows = [
    { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-16T21:49:41.793Z',
      status: 'backfilling', consensus: '10', actual: null, previous: '25.5', identityKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL',
      periodKey: '2026-11' },
    { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-16T13:30:00.000Z',
      status: 'published', consensus: '18.0', actual: '7.8', previous: '25.5', identityKey: '["214790",79095]',
      periodKey: '2026-11-16T13:30' }
  ]
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<EventSourceWritesBlocks rows={rows} text={text} />)))
    const conflicts = [...host.querySelectorAll('[data-conflict-field]')]
    // 只有预期不一致：实际只有一家给（缺失不是冲突），前值两源相同。
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.getAttribute('data-conflict-field')).toBe('consensus')
    // 两个值都在，各带来源名，**不挑一个**。
    expect(conflicts[0]!.textContent).toContain('narwhal 10')
    expect(conflicts[0]!.textContent).toContain('0xrouter 18.0')
    expect(conflicts[0]!.textContent).toContain('预期多源不一致')
  } finally { await act(async () => root.unmount()) }
})

it('does not call a formatting difference a conflict', async () => {
  const rows = [
    { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-09T00:00:00.000Z',
      status: 'published', consensus: null, actual: '0.7', previous: '0.6', identityKey: 'US.WHOLESALE_INVENTORIES.SA.MOM',
      periodKey: '2026-09' },
    { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-09T00:00:00.000Z',
      status: 'published', consensus: null, actual: '0.7%', previous: '0.6%', identityKey: 'US.WHOLESALE_INVENTORIES.SA.MOM',
      periodKey: '2026-09' }
  ]
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<EventSourceWritesBlocks rows={rows} text={text} />)))
    expect(host.querySelector('[data-source-conflicts]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})

/**
 * **跨月不许并成「不一致」**（Chief 2026-11-17）：消费信贷那组 narwhal 记 9 月、0xrouter 记 10 月，
 * 两个 4.35 倍的数比的是两个不同的月。期次不同只说明「另一家记的是哪一期」，不标冲突；
 * 期次缺失（读口还没给）时**一个冲突都不报**——宁可这一版不显示标记，也不能造假事实。
 */
it('never calls two different periods a conflict', async () => {
  const rows = [
    { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-06T00:00:00.000Z',
      status: 'published', consensus: null, actual: '6.4', previous: '1.9',
      identityKey: 'US.CONSUMER_CREDIT.SA.CHANGE', periodKey: '2026-09' },
    { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-06T00:00:00.000Z',
      status: 'published', consensus: '12.0', actual: '27.84', previous: '8.280',
      identityKey: 'US.CONSUMER_CREDIT.SA.CHANGE', periodKey: '2026-10' }
  ]
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<EventSourceWritesBlocks rows={rows} text={text} />)))
    expect(host.querySelector('[data-source-conflicts]')).toBeNull()
    // 但要说清另一家记的是哪一期，读者才不会以为两家报的是同一个月。
    expect(host.querySelector('[data-other-period]')?.textContent).toContain('2026-10')
  } finally { await act(async () => root.unmount()) }
})

it('reports no conflict at all when the read port gives no period', async () => {
  const rows = [
    { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-06T00:00:00.000Z',
      status: 'published', consensus: '10', actual: null, previous: null, identityKey: 'US.CONSUMER_CREDIT.SA.CHANGE' },
    { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-06T00:00:00.000Z',
      status: 'published', consensus: '18', actual: null, previous: null, identityKey: 'US.CONSUMER_CREDIT.SA.CHANGE' }
  ]
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<EventSourceWritesBlocks rows={rows} text={text} />)))
    expect(host.querySelector('[data-source-conflicts]')).toBeNull()
    expect(host.querySelector('[data-other-period]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})

/**
 * 量纲不明的值不比（#57：我们存的是展示串不是数）。`0.0K` 与 `0` 在数值上能读成一样、在事实上
 * 可能是两种量纲；`isZeroValue` 那个静默 bug 就是「拿展示串当数」的直接代价，这里不重犯。
 */
it('skips the comparison when a value carries a scale suffix', async () => {
  const rows = [
    { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-03T00:00:00.000Z',
      status: 'published', consensus: '0.0K', actual: null, previous: null,
      identityKey: 'US.JOLTS_OPENINGS.SA.COUNT', periodKey: '2026-09' },
    { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-03T00:00:00.000Z',
      status: 'published', consensus: '0', actual: null, previous: null,
      identityKey: 'US.JOLTS_OPENINGS.SA.COUNT', periodKey: '2026-09' }
  ]
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<EventSourceWritesBlocks rows={rows} text={text} />)))
    // 两个值照常显示在两块里，但不戴「不一致」的帽子。
    expect(host.querySelector('[data-source-conflicts]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})
