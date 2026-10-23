import { describe, expect, it } from 'vitest'
import { allocateWidthBudget, applyWidthBudget, buildWorkspaceGridTracks, clampPanelSize, derivePanelPresentation, panelSizeBounds, resolveEmbeddedSize, resolveNarrowRegion, resolveRegionSize, WorkspaceNarrowPriority, WorkspaceUiPolicy, WorkspaceWidthBudgetPriority } from './workspacePresentation'
describe('WorkspaceUiPolicy', () => {
  it.each(['docked-right', 'docked-bottom'] as const)('computes exact %s boundary without changing mode', (mode) => {
    const input = { mode, contentWidth: 804, contentHeight: 454, pageMinSize: { width: 500, height: 300 }, panelMinSize: { width: 300, height: 150 } }
    expect(derivePanelPresentation(input)).toEqual({ mode, presentation: 'normal' })
    expect(derivePanelPresentation({ ...input, contentWidth: 803, contentHeight: 453 }).presentation).toBe('overlay')
    expect(derivePanelPresentation({ ...input, contentWidth: 499, contentHeight: 299 }).presentation).toBe('exclusive')
  })
  it('clamps to page minimum, not panel minimum or an arbitrary maximum', () => {
    expect(clampPanelSize('docked-right', { width: 9000, height: 200 }, { width: 2000, height: 900 }, { width: 200, height: 150 }, { width: 500, height: 300 }).width).toBe(1496)
    expect(WorkspaceUiPolicy).toMatchObject({ titleHeight: 32, splitterSize: 4, splitterHitSize: 8, keyboardStep: 16 })
  })
  it('derives every dock bound from pageMinSize and keeps no anonymous maximum', () => {
    const pageMinSize = { width: 500, height: 300 }
    const panelMinSize = { width: 200, height: 150 }
    expect(panelSizeBounds('right', { width: 1200, height: 900 }, pageMinSize, panelMinSize).max.width).toBe(696)
    expect(panelSizeBounds('bottom', { width: 1200, height: 900 }, pageMinSize, panelMinSize).max.height).toBe(596)
    // 页面变大时上限随之变大：证明没有写死的 960/720 匿名上限。
    expect(panelSizeBounds('right', { width: 2000, height: 900 }, pageMinSize, panelMinSize).max.width).toBe(1496)
    expect(panelSizeBounds('bottom', { width: 1200, height: 1400 }, pageMinSize, panelMinSize).max.height).toBe(1096)
    expect(Object.keys(WorkspaceUiPolicy)).toEqual(['titleHeight', 'splitterSize', 'splitterHitSize', 'keyboardStep'])
  })
  it('emits one grid template that carries page, embedded, right and bottom together', () => {
    expect(buildWorkspaceGridTracks({ embeddedWidth: 0, rightWidth: 300, bottomHeight: 220 }))
      .toEqual({ columns: '0px minmax(0, 1fr) 300px', rows: 'minmax(0, 1fr) 220px', areas: '"embedded page right" "embedded bottom right"' })
    expect(buildWorkspaceGridTracks({ embeddedWidth: 240, rightWidth: 0, bottomHeight: 0 }).columns).toBe('240px minmax(0, 1fr) 0px')
  })
  it('treats embedded as a width axis so it degrades instead of squeezing the page', () => {
    const input = { mode: 'embedded' as const, contentWidth: 704, contentHeight: 900, pageMinSize: { width: 500, height: 300 }, panelMinSize: { width: 200, height: 150 } }
    expect(derivePanelPresentation(input)).toEqual({ mode: 'embedded', presentation: 'normal' })
    expect(derivePanelPresentation({ ...input, contentWidth: 703 }).presentation).toBe('overlay')
    expect(derivePanelPresentation({ ...input, contentWidth: 499 }).presentation).toBe('exclusive')
    // 高度与 embedded 无关：不会被纵向尺寸误判
    expect(derivePanelPresentation({ ...input, contentHeight: 100 }).presentation).toBe('normal')
  })
  it('derives the embedded width from the page boundary plus registration sizes only', () => {
    const registration = { minSize: { width: 200, height: 150 }, preferredSize: { width: 300, height: 220 } }
    expect(resolveEmbeddedSize(registration, { width: 1200, height: 900 }, { width: 500, height: 300 })).toEqual({ width: 300, height: 900 })
    // 上限随页面收紧，但绝不返回负数或 0：最小值由注册 minSize 兜底，布局降级交给 presentation。
    expect(resolveEmbeddedSize(registration, { width: 650, height: 900 }, { width: 500, height: 300 }).width).toBe(200)
    expect(resolveEmbeddedSize({ minSize: registration.minSize, preferredSize: { width: 1280, height: 220 } }, { width: 300, height: 900 }, { width: 500, height: 300 }).width).toBe(200)
    expect(WorkspaceNarrowPriority).toEqual(['right', 'bottom', 'embedded'])
  })
  it('resolves the presented narrow region from authoritative narrowness plus one named transient state', () => {
    const narrowRegions = ['right', 'embedded'] as const
    expect(resolveNarrowRegion({ dismissed: false, pinnedRegion: null, narrowRegions })).toBe('right')
    expect(resolveNarrowRegion({ dismissed: false, pinnedRegion: 'embedded', narrowRegions })).toBe('embedded')
    // 陈旧 pin：该区域已不窄屏时被忽略，不会把旧区域「复活」
    expect(resolveNarrowRegion({ dismissed: false, pinnedRegion: 'bottom', narrowRegions })).toBe('right')
    // 返回页面优先于 pin；无窄屏区域时返回 null（页面独占）
    expect(resolveNarrowRegion({ dismissed: true, pinnedRegion: 'embedded', narrowRegions })).toBeNull()
    expect(resolveNarrowRegion({ dismissed: false, pinnedRegion: null, narrowRegions: [] })).toBeNull()
  })
  it('shares one width budget across width axis regions so the page always keeps pageMinSize', () => {
    const requests = [
      { region: 'embedded' as const, minWidth: 320, desiredWidth: 480 },
      { region: 'right' as const, minWidth: 320, desiredWidth: 480 }
    ]
    const pageMinSize = { width: 500, height: 300 }
    expect(WorkspaceWidthBudgetPriority).toEqual(['embedded', 'right'])
    expect(allocateWidthBudget({ requests, pageSize: { width: 1200, height: 900 }, pageMinSize }))
      .toEqual({ widths: { embedded: 380, right: 320 }, degraded: [] })
    // 900 - 500 = 400 放不下两个 320 的最小宽度 → 最低优先级区域降级，页面仍拿到 500
    expect(allocateWidthBudget({ requests, pageSize: { width: 900, height: 900 }, pageMinSize }))
      .toEqual({ widths: { embedded: 400 }, degraded: ['right'] })
    // 连最高优先级的最小宽度都放不下 → 两个区域一起降级，绝不返回负宽度
    expect(allocateWidthBudget({ requests, pageSize: { width: 600, height: 900 }, pageMinSize }))
      .toEqual({ widths: {}, degraded: ['embedded', 'right'] })
    // 单区域时联合预算不改变既有单区域上限行为
    expect(allocateWidthBudget({ requests: [requests[1]], pageSize: { width: 1200, height: 900 }, pageMinSize }))
      .toEqual({ widths: { right: 480 }, degraded: [] })
  })
  it('applies the joint budget to panels and degrades the losing region to overlay', () => {
    const panels = [
      { region: 'embedded' as const, open: true, axisPresentation: 'normal' as const, minWidth: 320, desiredSize: { width: 480, height: 360 }, occupying: true },
      { region: 'right' as const, open: true, axisPresentation: 'normal' as const, minWidth: 320, desiredSize: { width: 480, height: 360 }, occupying: true }
    ]
    const pageMinSize = { width: 500, height: 300 }
    expect(applyWidthBudget({ panels, pageSize: { width: 1200, height: 900 }, pageMinSize })).toEqual([
      { presentation: 'normal', size: { width: 380, height: 360 } },
      { presentation: 'normal', size: { width: 320, height: 360 } }
    ])
    expect(applyWidthBudget({ panels, pageSize: { width: 900, height: 900 }, pageMinSize })).toEqual([
      { presentation: 'normal', size: { width: 400, height: 360 } },
      { presentation: 'overlay', size: { width: 480, height: 360 } }
    ])
    // R7：已关闭的面板不产生请求，也不消耗其它区域的预算
    const closedEmbedded = { ...panels[0], open: false, occupying: false }
    expect(applyWidthBudget({ panels: [closedEmbedded, panels[1]], pageSize: { width: 1200, height: 900 }, pageMinSize })).toEqual([
      { presentation: 'normal', size: { width: 480, height: 360 } },
      { presentation: 'normal', size: { width: 480, height: 360 } }
    ])
    // 900 - 500 = 400 全部给唯一的占用者（不降级）；单区域上限的收窄发生在 resolveRegionSize
    expect(applyWidthBudget({ panels: [closedEmbedded, panels[1]], pageSize: { width: 900, height: 900 }, pageMinSize })).toEqual([
      { presentation: 'normal', size: { width: 480, height: 360 } },
      { presentation: 'normal', size: { width: 400, height: 360 } }
    ])
  })
  it('resolves every region size through one derivation entry point', () => {
    const registration = { minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 } }
    const pageMinSize = { width: 500, height: 300 }
    expect(resolveRegionSize('embedded', registration, undefined, { width: 1200, height: 900 }, pageMinSize)).toEqual({ width: 480, height: 900 })
    expect(resolveRegionSize('right', registration, { width: 380, height: 900 }, { width: 1200, height: 900 }, pageMinSize)).toEqual({ width: 380, height: 900 })
    expect(resolveRegionSize('bottom', registration, undefined, { width: 1200, height: 900 }, pageMinSize)).toEqual({ width: 1200, height: 360 })
    // 提交尺寸超出单区域上限时被夹住：页面高度不会被压破 pageMinSize.height
    expect(resolveRegionSize('bottom', registration, { width: 1200, height: 5000 }, { width: 1200, height: 900 }, pageMinSize).height).toBe(596)
  })
})
