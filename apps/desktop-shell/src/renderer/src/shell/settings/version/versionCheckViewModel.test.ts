import { describe, expect, it } from 'vitest'

import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { describeVersionCheck } from './versionCheckViewModel'

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
  lastSuccessAt: null
}
const idle: UpdateCheckProjection = { state: 'idle', currentVersion: '0.3.1' }

const base = { autoCheckEnabled: true, checking: false, justChecked: false, openFailed: false }

describe('the version row', () => {
  it('shows the three settled conclusions with one pill and one next action each', () => {
    expect(describeVersionCheck({ ...base, state: available })).toMatchObject({
      pill: 'available',
      pillTone: 'info',
      latestVersion: '0.4.0',
      showDownloadButton: true,
      notice: 'available'
    })
    expect(describeVersionCheck({ ...base, state: upToDate })).toMatchObject({
      pill: 'upToDate',
      pillTone: 'ok',
      showDownloadButton: false,
      notice: null
    })
    expect(describeVersionCheck({ ...base, state: unavailable })).toMatchObject({
      pill: 'unavailable',
      pillTone: 'warn',
      latestVersion: null,
      showDownloadButton: false,
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
    expect(view.showDownloadButton).toBe(true)
    // 结论那一句还在，失败句是**加在下面**的一句，不是替换。
    expect(view.notice).toBe('available')
    expect(view.showOpenFailed).toBe(true)
  })

  it('counts a check in flight as its own state, with no second waiting area', () => {
    expect(describeVersionCheck({ ...base, state: idle, checking: true })).toMatchObject({
      pill: 'checking',
      pillTone: 'info',
      showDownloadButton: false,
      notice: null
    })
  })

  it('degrades to "automatic checks are off" but keeps the manual button', () => {
    const view = describeVersionCheck({ ...base, state: available, autoCheckEnabled: false })
    expect(view).toMatchObject({
      pill: 'autoOff',
      pillTone: 'muted',
      showCheckButton: true,
      showAutoToggle: true,
      showDownloadButton: false,
      notice: 'autoOff',
      showOpenFailed: false
    })
  })

  it('renames the button while cooling down, without renaming the action', () => {
    const view = describeVersionCheck({ ...base, state: available, justChecked: true })
    expect(view.checkLabel).toBe('justChecked')
    // 冷却只换按钮上的字，结论与按钮个数都不变。
    expect(view.pill).toBe('available')
    expect(view.showDownloadButton).toBe(true)
  })

  it('shows "not checked yet" as a checkable row, not as a disabled capability', () => {
    expect(describeVersionCheck({ ...base, state: idle })).toMatchObject({
      pill: 'notChecked',
      pillTone: 'muted',
      currentVersion: '0.3.1',
      latestVersion: null,
      showCheckButton: true,
      showAutoToggle: true
    })
  })

  it('strips the whole row down in development, so it cannot look like "not checked yet"', () => {
    const development = describeVersionCheck({ ...base, state: { state: 'development' } })
    const notChecked = describeVersionCheck({ ...base, state: idle })

    expect(development).toEqual({
      development: true,
      pill: null,
      pillTone: 'muted',
      currentVersion: null,
      latestVersion: null,
      showCheckButton: false,
      showAutoToggle: false,
      showDownloadButton: false,
      checkLabel: 'check',
      notice: null,
      showOpenFailed: false
    })
    // 两者必须一眼分得开：一个有药丸有按钮，一个什么都没有。
    expect(notChecked.pill).not.toBeNull()
    expect(notChecked.showCheckButton).toBe(true)
  })

  it('treats the first frame (no projection yet) as "not checked yet"', () => {
    expect(describeVersionCheck({ ...base, state: null })).toMatchObject({
      pill: 'notChecked',
      showCheckButton: true
    })
  })
})
