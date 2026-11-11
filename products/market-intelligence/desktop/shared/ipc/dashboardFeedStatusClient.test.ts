import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDashboardFeedStatusClient } from './dashboardFeedStatusClient'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('dashboardFeedStatusClient 的诊断码', () => {
  it('IPC 抛错 → reason ipc-failed（只给诊断，不当状态词）', async () => {
    const client = createDashboardFeedStatusClient(async () => { throw new Error('no-handler') })
    expect(await client.query()).toEqual({ state: 'unavailable', reason: 'ipc-failed' })
  })

  it('返回形状过不了解析 → reason parse-failed', async () => {
    const client = createDashboardFeedStatusClient(async () => ({ state: 'available', sources: 'nope' }))
    expect(await client.query()).toEqual({ state: 'unavailable', reason: 'parse-failed' })
  })

  it('主进程标出的 notes-unreadable 原样带出来', async () => {
    const client = createDashboardFeedStatusClient(async () => ({ state: 'unavailable', reason: 'notes-unreadable' }))
    expect(await client.query()).toEqual({ state: 'unavailable', reason: 'notes-unreadable' })
  })

  it('渲染层不拿 reason 做判定或显示（只允许出现在客户端与契约里）', () => {
    for (const path of [
      'products/market-intelligence/desktop/pages/intelligence/CryptoIntelligenceDashboard.tsx',
      'products/market-intelligence/desktop/pages/intelligence/useDashboardFeedStatus.ts',
      'products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.tsx'
    ]) {
      expect(source(path), path).not.toMatch(/\.reason\b/)
      expect(source(path), path).not.toContain('notes-unreadable')
    }
  })
})
