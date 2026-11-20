import { describe, expect, it } from 'vitest'

import {
  containsPoint, pickReadoutWidth, placeReadout, READOUT_MARGIN, READOUT_OFFSET,
  READOUT_TIP_MIN_WIDTH, READOUT_TIP_WIDTH, type ReadoutRect
} from './readoutPlacement'

const stage = { width: 480, height: 240 }
const tip = { width: 168, height: 152 }
const pointerAt = (x: number, y: number) => ({ x, y })

const inside = (rect: ReadoutRect): boolean =>
  rect.left >= READOUT_MARGIN && rect.top >= READOUT_MARGIN
  && rect.left + rect.width <= stage.width - READOUT_MARGIN
  && rect.top + rect.height <= stage.height - READOUT_MARGIN

describe('readout placement', () => {
  it('flips to the left when the right side does not fit, and keeps the 10px gap', () => {
    const pointer = pointerAt(470, 120)
    const rect = placeReadout({ stage, tip, point: pointer, pointer })
    expect(inside(rect)).toBe(true)
    expect(containsPoint(rect, pointer)).toBe(false)
    expect(rect.left + rect.width).toBeLessThanOrEqual(pointer.x - READOUT_OFFSET + 1)
  })

  it('stays on the right at the left edge, and never reaches back over the cursor', () => {
    const pointer = pointerAt(10, 120)
    const rect = placeReadout({ stage, tip, point: pointer, pointer })
    expect(inside(rect)).toBe(true)
    expect(rect.left).toBeGreaterThanOrEqual(pointer.x + READOUT_OFFSET)
  })

  it('flips below when the top edge has no room', () => {
    const pointer = pointerAt(240, 6)
    const rect = placeReadout({ stage, tip, point: pointer, pointer })
    expect(inside(rect)).toBe(true)
    expect(containsPoint(rect, pointer)).toBe(false)
    expect(rect.top).toBeGreaterThanOrEqual(pointer.y)
  })

  it('flips above when the pointer is at the bottom edge', () => {
    const pointer = pointerAt(240, 236)
    const rect = placeReadout({ stage, tip, point: pointer, pointer })
    expect(inside(rect)).toBe(true)
    expect(containsPoint(rect, pointer)).toBe(false)
    expect(rect.top + rect.height).toBeLessThanOrEqual(pointer.y)
  })

  it('stays inside when the pointer sits 10px above the bottom edge', () => {
    const pointer = pointerAt(240, 230)
    const rect = placeReadout({ stage, tip, point: pointer, pointer })
    expect(inside(rect)).toBe(true)
    expect(containsPoint(rect, pointer)).toBe(false)
  })

  it('stays inside a narrow stage; clearing the cursor is best-effort when the panel fills it', () => {
    const narrow = { width: 300, height: 200 }
    for (const pointer of [pointerAt(6, 6), pointerAt(150, 100), pointerAt(294, 194)]) {
      const rect = placeReadout({ stage: narrow, tip, point: pointer, pointer })
      // 硬约束：整块在图内（宁可压点，也不许被裁）。
      expect(rect.left).toBeGreaterThanOrEqual(READOUT_MARGIN)
      expect(rect.left + rect.width).toBeLessThanOrEqual(narrow.width - READOUT_MARGIN)
      expect(rect.top).toBeGreaterThanOrEqual(READOUT_MARGIN)
      expect(rect.top + rect.height).toBeLessThanOrEqual(narrow.height - READOUT_MARGIN)
    }
    // 只在几何上有解的两处要求避开光标：面板 168×152、图 300×200，中间那一点无论放哪都盖住它。
    expect(containsPoint(placeReadout({ stage: narrow, tip, point: pointerAt(6, 6), pointer: pointerAt(6, 6) }), pointerAt(6, 6))).toBe(false)
    expect(containsPoint(placeReadout({ stage: narrow, tip, point: pointerAt(294, 194), pointer: pointerAt(294, 194) }), pointerAt(294, 194))).toBe(false)
  })

  it('centres over the selected point in keyboard mode, with no cursor to follow', () => {
    const rect = placeReadout({ stage, tip, point: { x: 240, y: 200 } })
    expect(inside(rect)).toBe(true)
    // 居中：面板中心落在选中点的竖线上（容差 1px 的取整）。
    expect(Math.abs(rect.left + rect.width / 2 - 240)).toBeLessThanOrEqual(1)
    expect(rect.top + rect.height).toBeLessThanOrEqual(200)
  })
})

describe('readout width degradation', () => {
  it('stays at the normal width while one side fits', () => {
    expect(pickReadoutWidth({ stageWidth: 490, pointerX: 245 })).toBe(READOUT_TIP_WIDTH)
    // 340 宽、中间那个点：右侧 150+8+168=326 ≤ 336，放得下，不收窄。
    expect(pickReadoutWidth({ stageWidth: 340, pointerX: 150 })).toBe(READOUT_TIP_WIDTH)
  })

  it('narrows to the floor only when neither side fits the normal width', () => {
    // 300 宽：中间那个点，右侧 158+168 越界、左侧 -26 越界 → 收到 132。
    expect(pickReadoutWidth({ stageWidth: 300, pointerX: 150 })).toBe(READOUT_TIP_MIN_WIDTH)
    // 同样 300 宽，靠左的点右侧放得下 168，就不该收窄。
    expect(pickReadoutWidth({ stageWidth: 300, pointerX: 20 })).toBe(READOUT_TIP_WIDTH)
  })

  it('never asks for more width than the stage can hold', () => {
    for (const stageWidth of [120, 200, 300, 490]) {
      expect(pickReadoutWidth({ stageWidth })).toBeLessThanOrEqual(Math.max(READOUT_TIP_MIN_WIDTH, stageWidth - 8))
    }
    // 键盘模式没有光标，用常规宽度（除非图比它窄）。
    expect(pickReadoutWidth({ stageWidth: 490 })).toBe(READOUT_TIP_WIDTH)
  })
})

describe('short stage', () => {
  it('clamps every pointer position inside a 160px-tall stage with a 152px-tall panel', () => {
    const shortStage = { width: 480, height: 160 }
    const tallTip = { width: 168, height: 152 }
    for (const y of [0, 8, 40, 80, 120, 160]) {
      const pointer = pointerAt(240, y)
      const rect = placeReadout({ stage: shortStage, tip: tallTip, point: pointer, pointer })
      expect(rect.top).toBeGreaterThanOrEqual(READOUT_MARGIN)
      expect(rect.top + rect.height).toBeLessThanOrEqual(shortStage.height - READOUT_MARGIN)
    }
  })
})
