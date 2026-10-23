import { describe, expect, it } from 'vitest'

import { readSourceAreaSize } from './workspaceSourceArea'

/**
 * Owner: platform/desktop/main/workspace（P2-14 focused）。回归：本文件。
 * 源区域读取必须是**受控且 fail closed** 的：任何一环缺失/畸形/窗口已销毁一律 `undefined`
 * （调用方回退策略默认尺寸），绝不把 0/NaN/字符串当尺寸，也绝不因此抛错打断分离事务。
 */

function event(sender: unknown): unknown {
  return { sender }
}

function senderWith(bounds: unknown, options: { destroyed?: boolean } = {}): unknown {
  return {
    isDestroyed: () => options.destroyed === true,
    getOwnerBrowserWindow: () => ({ getContentBounds: () => bounds })
  }
}

describe('readSourceAreaSize', () => {
  it('从 sender 的真实窗口内容区读出 DIP 尺寸并取整', () => {
    expect(readSourceAreaSize(event(senderWith({ x: 0, y: 0, width: 1512.4, height: 949.6 }))))
      .toEqual({ width: 1512, height: 950 })
  })

  it('窗口已销毁 / 没有 owner window / 没有 getContentBounds 一律 undefined（绝不猜）', () => {
    expect(readSourceAreaSize(event(senderWith({ width: 1512, height: 950 }, { destroyed: true })))).toBeUndefined()
    expect(readSourceAreaSize(event({ isDestroyed: () => false }))).toBeUndefined()
    expect(readSourceAreaSize(event({ isDestroyed: () => false, getOwnerBrowserWindow: () => null }))).toBeUndefined()
    expect(readSourceAreaSize(event({ isDestroyed: () => false, getOwnerBrowserWindow: () => ({}) }))).toBeUndefined()
  })

  it('畸形尺寸（0/负数/NaN/字符串/缺失）一律 undefined', () => {
    for (const bounds of [
      { width: 0, height: 950 }, { width: 1512, height: -1 }, { width: Number.NaN, height: 950 },
      { width: '1512', height: 950 }, { height: 950 }, { width: 1512 }, {}, null
    ]) {
      expect(readSourceAreaSize(event(senderWith(bounds)))).toBeUndefined()
    }
  })

  it('缺 sender / sender 非对象 / 读取过程抛错时返回 undefined，绝不冒泡', () => {
    expect(readSourceAreaSize(undefined)).toBeUndefined()
    expect(readSourceAreaSize({})).toBeUndefined()
    expect(readSourceAreaSize(event('not-an-object'))).toBeUndefined()
    expect(readSourceAreaSize(event({
      isDestroyed: () => false,
      getOwnerBrowserWindow: () => { throw new Error('renderer-gone') }
    }))).toBeUndefined()
  })
})
