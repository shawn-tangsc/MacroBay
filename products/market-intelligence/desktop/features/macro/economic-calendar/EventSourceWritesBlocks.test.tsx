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
