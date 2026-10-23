import { describe, expect, it } from 'vitest'

import { normalizeDetachedBounds, type WorkspaceDisplayInfo } from './workspaceWindowBounds'

/**
 * Owner: platform/desktop/main/workspace。回归 P1-04 bounds 行为：
 * DIP + 当前 workArea 校正、显示器提示只作提示、不可校正才失败（走回退链）。
 */

const primary = display('primary', { x: 0, y: 0, width: 1920, height: 1040 })
const secondary = display('secondary', { x: 1920, y: 0, width: 1280, height: 1024 })
const fallbackSize = { width: 480, height: 360 }

function display(id: string, workArea: WorkspaceDisplayInfo['workArea']): WorkspaceDisplayInfo {
  return { id, workArea, scaleFactor: 2 }
}

describe('normalizeDetachedBounds', () => {
  it('keeps a detached window fully inside the hinted display work area', () => {
    expect(normalizeDetachedBounds({
      bounds: { x: 2000, y: 100, width: 900, height: 600 },
      displays: [primary, secondary],
      displayHintId: 'secondary',
      fallbackSize
    })).toEqual({ status: 'ok', bounds: { x: 2000, y: 100, width: 900, height: 600 } })
  })

  it('corrects a fully off-screen window instead of failing', () => {
    // 与任何显示器都不相交时回到约定目标（displays[0]，即主显示器），并夹到完全可见
    expect(normalizeDetachedBounds({
      bounds: { x: 4000, y: -50, width: 600, height: 400 },
      displays: [primary, secondary],
      displayHintId: null,
      fallbackSize
    })).toEqual({ status: 'ok', bounds: { x: 1320, y: 0, width: 600, height: 400 } })
    // 与副显示器相交时留在副显示器上
    expect(normalizeDetachedBounds({
      bounds: { x: 3000, y: 100, width: 600, height: 400 },
      displays: [primary, secondary],
      displayHintId: null,
      fallbackSize
    })).toEqual({ status: 'ok', bounds: { x: 2600, y: 100, width: 600, height: 400 } })
  })

  it('treats a stale display hint as a hint only and falls back to the intersecting display', () => {
    expect(normalizeDetachedBounds({
      bounds: { x: 100, y: 100, width: 500, height: 400 },
      displays: [primary, secondary],
      displayHintId: 'unplugged-display',
      fallbackSize
    })).toEqual({ status: 'ok', bounds: { x: 100, y: 100, width: 500, height: 400 } })
  })

  it('shrinks a window larger than the work area so it stays fully visible', () => {
    expect(normalizeDetachedBounds({
      bounds: { x: 10, y: 10, width: 5000, height: 4000 },
      displays: [primary],
      displayHintId: 'primary',
      fallbackSize
    })).toEqual({ status: 'ok', bounds: { x: 0, y: 0, width: 1920, height: 1040 } })
  })

  it('centers the first detach from the registration size instead of inventing a default', () => {
    expect(normalizeDetachedBounds({ bounds: undefined, displays: [primary], displayHintId: null, fallbackSize }))
      .toEqual({ status: 'ok', bounds: { x: 720, y: 340, width: 480, height: 360 } })
  })

  it('fails with screen-unavailable when no usable display exists', () => {
    expect(normalizeDetachedBounds({ bounds: undefined, displays: [], displayHintId: null, fallbackSize }))
      .toEqual({ status: 'failed', reason: 'screen-unavailable' })
    expect(normalizeDetachedBounds({
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      displays: [display('degenerate', { x: 0, y: 0, width: 0, height: 0 })],
      displayHintId: null,
      fallbackSize
    })).toEqual({ status: 'failed', reason: 'screen-unavailable' })
  })

  it('corrects non-finite positions instead of handing NaN to the window factory', () => {
    expect(normalizeDetachedBounds({ bounds: { x: Number.NaN, y: 0, width: 480, height: 360 }, displays: [primary], displayHintId: null, fallbackSize }))
      .toEqual({ status: 'ok', bounds: { x: 720, y: 340, width: 480, height: 360 } })
    expect(normalizeDetachedBounds({ bounds: { x: 0, y: Number.POSITIVE_INFINITY, width: 480, height: 360 }, displays: [primary], displayHintId: null, fallbackSize }))
      .toEqual({ status: 'ok', bounds: { x: 720, y: 340, width: 480, height: 360 } })
    expect(normalizeDetachedBounds({ bounds: { x: -500, y: -100, width: 480, height: 360 }, displays: [primary], displayHintId: null, fallbackSize }))
      .toEqual({ status: 'ok', bounds: { x: 0, y: 0, width: 480, height: 360 } })
    expect(normalizeDetachedBounds({ bounds: { x: 5000, y: 5000, width: 480, height: 360 }, displays: [primary], displayHintId: null, fallbackSize }))
      .toEqual({ status: 'ok', bounds: { x: 1440, y: 680, width: 480, height: 360 } })
  })

  it('fails with bounds-invalid when the size is not a positive finite number', () => {
    expect(normalizeDetachedBounds({
      bounds: { x: 0, y: 0, width: Number.NaN, height: 300 },
      displays: [primary],
      displayHintId: null,
      fallbackSize
    })).toEqual({ status: 'failed', reason: 'bounds-invalid' })
    expect(normalizeDetachedBounds({
      bounds: { x: 0, y: 0, width: -10, height: 300 },
      displays: [primary],
      displayHintId: null,
      fallbackSize
    })).toEqual({ status: 'failed', reason: 'bounds-invalid' })
    expect(normalizeDetachedBounds({
      bounds: undefined,
      displays: [primary],
      displayHintId: null,
      fallbackSize: { width: 0, height: 360 }
    })).toEqual({ status: 'failed', reason: 'bounds-invalid' })
  })
})
