import { describe, expect, it } from 'vitest'

import { allSources, getSource } from '../../../service/intelligence/application/providerRegistry'
import { resolveFactSource } from '../../../contracts/factSources'
import { DASHBOARD_SOURCE_MODULES } from './dashboardSourceModules'

/**
 * 看板每个格声明的源，必须在来源注册表里、并且**供给看板**（`panels` 含 `'dashboard'`）。
 *
 * 为什么单独一条：`sourceRegistryConsistency` 管的是三份注册表互指，不看「这一格挂的源能不能看板供数」。
 * 2026-11-12 政策路径的第二格（美联储日程）就是这么发现能挂的——它已经声明 `purposes` 含 dashboard；
 * 反过来若有人把一个只声明 `calendar` 的源挂到看板格上，这一条必须红。
 */
describe('every dashboard cell names a source the registry feeds to the dashboard panel', () => {
  it('resolves every cell source, and each one supplies the dashboard panel', () => {
    const offenders: string[] = []
    for (const module of DASHBOARD_SOURCE_MODULES) {
      for (const cell of module.cells) {
        const source = getSource(cell.sourceId)
        if (source === undefined) {
          offenders.push(`${module.id}:${cell.cellKey} → ${cell.sourceId} (不在注册表里)`)
          continue
        }
        if (!source.panels.includes('dashboard')) {
          offenders.push(`${module.id}:${cell.cellKey} → ${cell.sourceId} (panels=${source.panels.join('|')}，不含 dashboard)`)
        }
      }
    }
    // 先钉数量（零个）再比内容：这一条要能在「新挂一个只供日历的源」时红。
    expect(offenders).toHaveLength(0)
    expect(offenders).toEqual([])
  })
})

describe('the ETF cell asks for a fact instead of naming a supplier', () => {
  const capitalCell = DASHBOARD_SOURCE_MODULES
    .find((module) => module.id === 'capital')!
    .cells.find((cell) => cell.cellKey === 'etf')!

  it('keeps the reader-facing key fixed and declares the fact', () => {
    // 键是读者设置的主键：换源不许换格，否则读者对 capital:etf 的开关会失效。
    expect(capitalCell.cellKey).toBe('etf')
    expect(capitalCell.fact).toBe('etf-net-flow')
  })

  it('takes the supplier from the resolver, so a second source needs no edit here', () => {
    const fromRegistry = allSources().map((source) => ({
      sourceId: source.sourceId, provides: source.provides, enabled: true, jobRegistered: true, readiness: source.readiness
    }))
    expect(resolveFactSource({ factId: capitalCell.fact!, sources: fromRegistry }))
      .toEqual({ kind: 'resolved', sourceId: 'cryptoetf-etf-flows' })
  })
})
