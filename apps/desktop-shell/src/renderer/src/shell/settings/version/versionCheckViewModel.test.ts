import { describe, expect, it } from 'vitest'

import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { describeVersionCheck, resolvePillLabel } from './versionCheckViewModel'

const available: UpdateCheckProjection = {
  state: 'available',
  currentVersion: '0.3.1',
  latestVersion: '0.4.0',
  checkedAt: '2026-11-03T00:10:00.000Z'
}
const upToDate: UpdateCheckProjection = {
  state: 'up-to-date',
  currentVersion: '0.3.1',
  latestVersion: '0.3.1',
  checkedAt: '2026-11-03T00:10:00.000Z'
}
const unavailable: UpdateCheckProjection = {
  state: 'unavailable',
  currentVersion: '0.3.1',
  checkedAt: '2026-11-03T00:10:00.000Z'
}
const idle: UpdateCheckProjection = { state: 'idle', currentVersion: '0.3.1' }

const base = { autoCheckEnabled: true, checking: false, justChecked: false, openFailed: false }

describe('the version row', () => {
  it('never shows a raw key when a pill key is missing', () => {
    // 缺键时回落一句通用文案；回落成键名（原来的 `?? key`）会让用户读到 `preferences.version.pill.xxx`。
    expect(resolvePillLabel({}, 'preferences.version.pill.available', '未知')).toBe('未知')
    expect(resolvePillLabel({ available: '有新版本' }, 'preferences.version.pill.available', '未知')).toBe('有新版本')
  })

  it('shows the three settled conclusions with one pill and one next action each', () => {
    expect(describeVersionCheck({ ...base, state: available })).toMatchObject({
      pill: 'available',
      pillTone: 'info',
      latestVersion: '0.4.0',
      action: 'update',
      // 有新版本时不配提示句（那句话已被删）。
      notice: null
    })
    expect(describeVersionCheck({ ...base, state: upToDate })).toMatchObject({
      pill: 'upToDate',
      pillTone: 'ok',
      action: 'check',
      notice: null
    })
    expect(describeVersionCheck({ ...base, state: unavailable })).toMatchObject({
      pill: 'unavailable',
      pillTone: 'warn',
      latestVersion: null,
      action: 'check',
      notice: 'unavailable'
    })
  })

  it('never says "up to date" when the check could not tell', () => {
    const view = describeVersionCheck({ ...base, state: unavailable })
    expect(view.pill).not.toBe('upToDate')
    // 「未知」不是「没有新版」：最新版本这一格只能是空的（显示为未知）。
    expect(view.latestVersion).toBeNull()
  })

  it('keeps the conclusion when opening the download page failed', () => {
    const view = describeVersionCheck({ ...base, state: available, openFailed: true })
    // 打不开浏览器是浏览器的事，不许把「有新版本 0.4.0」改写成「查不到」或「已是最新」。
    expect(view.pill).toBe('available')
    expect(view.latestVersion).toBe('0.4.0')
    expect(view.action).toBe('update')
    // 「有新版本」本身不配描述句（那句已删）；失败句是**加在下面**的一句，不是替换结论。
    expect(view.notice).toBeNull()
    expect(view.showOpenFailed).toBe(true)
  })

  it('counts a check in flight as its own state, with no second waiting area', () => {
    expect(describeVersionCheck({ ...base, state: idle, checking: true })).toMatchObject({
      pill: 'checking',
      pillTone: 'info',
      action: 'check',
      notice: null
    })
  })

  it('keeps the download entry when the switch is off but a newer version is known', () => {
    // 这条是死路的回归：关掉自动检查 → 手动查到 v0.4.0，却没有任何入口可去，功能就废了一半。
    // 原型的表里写着「开关已关 · 但已知有新版」：药丸仍是有新版本，右侧两个按钮都在。
    const view = describeVersionCheck({ ...base, state: available, autoCheckEnabled: false })
    expect(view).toMatchObject({
      pill: 'available',
      pillTone: 'info',
      latestVersion: '0.4.0',
      showAutoToggle: true,
      action: 'update',
      notice: null,
      // 描述位只放一句：结论句优先于「开关关着」，不再叠第二句。
      showAutoOffHint: false
    })
  })

  it('puts only one sentence in the description slot, whichever conclusion it is', () => {
    // 规则（需求 §3）：描述位只放一句，优先级 查不到的解释 > 开关关着 > 空。
    // 两句叠在一起会把「有新版本」那一档做成七态里最高的一档。
    expect(describeVersionCheck({ ...base, state: available, autoCheckEnabled: false }).showAutoOffHint).toBe(false)
    expect(describeVersionCheck({ ...base, state: unavailable, autoCheckEnabled: false }).showAutoOffHint).toBe(false)
    // 「已是最新」没有自己的解释句，这时才轮到「开关关着」。
    expect(describeVersionCheck({ ...base, state: upToDate, autoCheckEnabled: false }).showAutoOffHint).toBe(true)
  })

  it('still says "automatic checks are off" when nothing has been checked yet', () => {
    const view = describeVersionCheck({ ...base, state: idle, autoCheckEnabled: false })
    expect(view).toMatchObject({
      pill: 'autoOff',
      pillTone: 'muted',
      showAutoToggle: true,
      action: 'check',
      notice: 'autoOff'
    })
  })

  it('renames the button while cooling down, without renaming the action', () => {
    const view = describeVersionCheck({ ...base, state: available, justChecked: true })
    expect(view.checkLabel).toBe('justChecked')
    // 冷却只换按钮上的字，结论与按钮个数都不变。
    expect(view.pill).toBe('available')
    expect(view.action).toBe('update')
  })

  it('shows "not checked yet" as a checkable row, not as a disabled capability', () => {
    expect(describeVersionCheck({ ...base, state: idle })).toMatchObject({
      pill: 'notChecked',
      pillTone: 'muted',
      currentVersion: '0.3.1',
      latestVersion: null,
      showAutoToggle: true
    })
  })

  it('has no development variant left: a source run is an ordinary row', () => {
    // 11-03 起「开发态」不是一种投影状态了——开发版也能真查，所以只有一种画法。
    // 这条断言看着像废话，它守的是「别再造一个只有开发态才走的分支」：那类分支的结果
    // 就是「开发版里看不见、装好的包里第一次见」。
    expect(Object.keys(describeVersionCheck({ ...base, state: idle }))).not.toContain('development')
  })

  it('treats the first frame (no projection yet) as "not checked yet"', () => {
    expect(describeVersionCheck({ ...base, state: null })).toMatchObject({
      pill: 'notChecked',
      action: 'check'
    })
  })
})
