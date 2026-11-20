import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { EventBusStoreState } from './eventBusStore'
import {
  canonicalEventBusJson,
  eventBusStateChecksum,
  eventBusStoreFormatPolicy,
  parseEventBusStoreState,
  serializeEventBusState
} from './eventBusStoreFormat'

/**
 * 闸门第一笔：**纯格式**。这里断的是「读到的字节是什么」，不接适配器、不接运行时。
 *
 * 最贵的那条判据在最下面：**坏文件不许被当成空文件**——今天丢数据就是从这里进的。
 * `event-bus-store-v0.json` 是真实旧形状的夹具（无 `formatVersion`、无 checksum），
 * 它的存在就是为了让「v0 被当空」这件事有人能发现。
 */
const fixtureRaw = readFileSync(new URL('./fixtures/event-bus-store-v0.json', import.meta.url), 'utf8')
const fixture = JSON.parse(fixtureRaw) as EventBusStoreState

/** 把 v1 内容解出来再改一处，模拟「文件被改了一个字节」。 */
function withTamperedPayload(): string {
  const serialized = JSON.parse(serializeEventBusState(fixture)) as Record<string, unknown>
  serialized.events = [{ ...(serialized.events as Record<string, unknown>[])[0], topic: 'tampered.topic' }, ...(serialized.events as Record<string, unknown>[]).slice(1)]
  return canonicalEventBusJson(serialized)
}

describe('event bus store format', () => {
  it('reads a legacy v0 file as unverified-legacy, with every row intact', () => {
    const result = parseEventBusStoreState(fixtureRaw)

    expect(result.integrity).toBe('unverified-legacy')
    if (result.integrity !== 'unverified-legacy') return
    // 条数与内容逐项一致：旧文件是合法数据，不许被归一成空数组，也不许被改写。
    expect(result.state).toEqual(fixture)
    expect(result.state.events.map((event) => event.eventId)).toEqual([
      'evt-2026-11-02-0001',
      'evt-2026-11-02-0002',
      'evt-2026-11-02-0003'
    ])
    expect(result.state.deliveries.map((delivery) => delivery.deliveryId)).toEqual(['dlv-0001', 'dlv-0002', 'dlv-0003'])
    expect(result.state.checkpoints.map((checkpoint) => checkpoint.consumerId)).toEqual([
      'market-intelligence.briefing',
      'market-intelligence.notification'
    ])
  })

  it('upgrades a v0 file by writing v1, without adding or dropping a single row', () => {
    const parsed = parseEventBusStoreState(fixtureRaw)
    if (parsed.integrity !== 'unverified-legacy') throw new Error('fixture must parse as legacy')

    const written = serializeEventBusState(parsed.state)
    const envelope = JSON.parse(written) as Record<string, unknown>
    expect(envelope.formatVersion).toBe(eventBusStoreFormatPolicy.currentFormatVersion)
    expect(typeof envelope.checksum).toBe('string')
    // payload 一行不差；升级只是把同一份状态按新格式落一次，不是回填。
    expect(envelope.events).toEqual(fixture.events)
    expect(envelope.deliveries).toEqual(fixture.deliveries)
    expect(envelope.checkpoints).toEqual(fixture.checkpoints)

    const reread = parseEventBusStoreState(written)
    expect(reread.integrity).toBe('ok')
    if (reread.integrity !== 'ok') return
    expect(reread.state).toEqual(fixture)
  })

  it('writes the same bytes twice, so a repeated save cannot churn the file', () => {
    // 幂等：同一份状态连写两次逐字节一致（键序固定、数组保序、校验和由 payload 派生）。
    expect(serializeEventBusState(fixture)).toBe(serializeEventBusState(fixture))
    // 读回来再写也不能变（v0→v1 升级只发生一次，不会因为又读了一次而再变形状）。
    const first = serializeEventBusState(fixture)
    const reread = parseEventBusStoreState(first)
    if (reread.integrity !== 'ok') throw new Error('v1 must parse')
    expect(serializeEventBusState(reread.state)).toBe(first)
  })

  it('rejects a future format instead of guessing how to read it', () => {
    const future = canonicalEventBusJson({ formatVersion: 2, events: [], deliveries: [], checkpoints: [] })
    expect(parseEventBusStoreState(future)).toEqual({ integrity: 'future-version', formatVersion: 2 })
  })

  it('calls a tampered v1 file checksum-mismatch, not ok', () => {
    expect(parseEventBusStoreState(withTamperedPayload())).toEqual({ integrity: 'corrupt', problem: 'checksum-mismatch' })
  })

  it('calls a truncated or malformed file corrupt, never empty', () => {
    const truncated = serializeEventBusState(fixture).slice(0, 40)
    expect(parseEventBusStoreState(truncated)).toEqual({ integrity: 'corrupt', problem: 'invalid-json' })
    expect(parseEventBusStoreState('{"events": [}')).toEqual({ integrity: 'corrupt', problem: 'invalid-json' })
  })

  it('calls a wrong top-level shape corrupt instead of normalising it into empty arrays', () => {
    const cases = [
      '[]',
      '"text"',
      canonicalEventBusJson({ events: 'nope', deliveries: [], checkpoints: [] }),
      canonicalEventBusJson({ events: [1, 2], deliveries: [], checkpoints: [] }),
      canonicalEventBusJson({ events: [{ id: 'ok' }], deliveries: [null], checkpoints: [] })
    ]
    for (const raw of cases) expect(parseEventBusStoreState(raw)).toEqual({ integrity: 'corrupt', problem: 'shape' })
    // 版本号本身也必须是整数；`"1"` 或 1.5 都不是「旧文件」，是不认识的形状。
    expect(parseEventBusStoreState(canonicalEventBusJson({ formatVersion: '1', events: [], deliveries: [], checkpoints: [] })))
      .toEqual({ integrity: 'corrupt', problem: 'shape' })
    expect(parseEventBusStoreState(canonicalEventBusJson({ formatVersion: 1.5, events: [], deliveries: [], checkpoints: [] })))
      .toEqual({ integrity: 'corrupt', problem: 'shape' })
  })

  it('reports a missing main file as empty (first install), which is a different answer from corrupt', () => {
    // `.next` 残留的判定与「不自动改名」在适配器那层；格式层只回答「给不到字节 = 主文件不存在」。
    expect(parseEventBusStoreState(undefined)).toEqual({ integrity: 'empty' })
    expect(parseEventBusStoreState('')).toEqual({ integrity: 'corrupt', problem: 'invalid-json' })
  })

  it('derives the checksum from the payload only, and the canonical form ignores key order', () => {
    const reordered = {
      checkpoints: fixture.checkpoints,
      deliveries: fixture.deliveries,
      events: fixture.events
    } as EventBusStoreState
    expect(eventBusStateChecksum(reordered)).toBe(eventBusStateChecksum(fixture))
  })
})
