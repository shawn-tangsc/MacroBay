// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { SourceConfigSurface, type SourceConfigSurfaceProps } from './SourceConfigSurface'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * C4：设置页与日历面板是**同一份配置面**。
 *
 * 两个宿主交同一份事实（同一个源），渲染出的字段与状态必须**逐项相同**：
 * 行、药丸、四格、采集策略、立即运行、行尾动作，顺序也相同。
 * 这里把「设置页形态」与「日历形态」各渲染一次，按 DOM 顺序取签名对比——
 * 少了 `policy` 或改了顺序，这条当场红。
 */
const settingsText = productText['zh-CN'].settings.intelligenceSources

let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function source(overrides: Partial<SourceView> = {}): SourceView {
  const enabled = overrides.enabled ?? true
  const unavailable = overrides.unavailable !== undefined
  return {
    sourceId: 'macro-calendar-bls', providerId: 'bls', displayName: 'BLS official schedule',
    agents: ['crypto'], panels: ['economic-calendar'], visibility: 'visible', collection: 'provider',
    kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true }, readiness: 'live',
    enabled, healthState: enabled ? (unavailable ? 'off' : 'healthy') : 'off', healthMarker: unavailable ? 'ring' : 'none',
    ...overrides
  }
}

function provider(view: SourceView): ProviderView {
  return { providerId: 'bls', displayName: 'Bureau of Labor Statistics (BLS)', category: 'macro', credential: 'none', healthMarker: 'none', sources: [view] }
}

function baseProps(view: SourceView): SourceConfigSurfaceProps {
  const profiles = {
    [view.sourceId]: {
      profileId: `profile-${view.sourceId}`, sourceId: view.sourceId, enabled: view.enabled,
      collectionPreset: 'balanced' as const, includeInSentiment: false, scopePolicy: 'all' as const,
      rawArchiveEnabled: false, retentionMode: 'balanced' as const, autoReplayAfterParserUpgrade: false,
      updatedAt: '2026-11-01T00:00:00.000Z'
    }
  }
  return {
    text: settingsText,
    provider: provider(view),
    policy: { labels: settingsText.collectionPolicy, onChange: () => {}, profiles, supportsSentimentById: {} },
    supportsRunNowById: { [view.sourceId]: true },
    onToggleSource: async () => true,
    onRunNow: async () => ({ kind: 'succeeded' as const, notice: '采集成功。' }),
    showSourceDetails: true
  }
}

/** 宿主差异只在「谁提供回调/翻译」，事实与文案完全相同。 */
function settingsHost(view: SourceView): SourceConfigSurfaceProps {
  return { ...baseProps(view), onDraftChange: () => {}, onChanged: () => {} }
}

function calendarHost(view: SourceView): SourceConfigSurfaceProps {
  return {
    ...baseProps(view),
    // 日历宿主没有草稿回调和 onChanged，但**字段一个不少**：这是 C4 的判据。
    onToggleSource: async () => true
  }
}

async function signature(props: SourceConfigSurfaceProps): Promise<string[]> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children: createElement(SourceConfigSurface, props) }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const rows = [...container.querySelectorAll<HTMLElement>('.source-provider-detail__row, .intelligence-health-item, .collapsible-group')]
  return rows.map((node) => node.textContent ?? '')
}

describe('the settings page and the calendar panel render the same configuration', () => {
  it('matches field for field and state for state on an unavailable source', async () => {
    const view = source({
      unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z', decidedAt: '2026-11-08' }
    })
    const fromSettings = await signature(settingsHost(view))
    await act(async () => root?.unmount()); root = null
    const fromCalendar = await signature(calendarHost(view))
    expect(fromCalendar).toEqual(fromSettings)
    // 两处都必须有策略组、四格与运行入口——「逐项一致」不是「两边都少同一项」。
    expect(fromSettings.join('\n')).toContain(settingsText.collectionPolicy.title)
    expect(fromSettings.join('\n')).toContain(settingsText.health.todayReading)
    // 不可用源没有「立即运行」按钮，但第四格必须给出原因——不是两边都少同一项。
    expect(fromSettings.join('\n')).toContain(settingsText.health.runNow.unavailable)
  })

  it('matches field for field and state for state on a healthy source', async () => {
    const view = source()
    const fromSettings = await signature(settingsHost(view))
    await act(async () => root?.unmount()); root = null
    const fromCalendar = await signature(calendarHost(view))
    expect(fromCalendar).toEqual(fromSettings)
    expect(fromSettings.join('\n')).toContain(settingsText.collectionPolicy.title)
    expect(fromSettings.join('\n')).toContain(settingsText.health.runAction.run)
  })
})
