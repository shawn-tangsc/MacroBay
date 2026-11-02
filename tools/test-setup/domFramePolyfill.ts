/**
 * 测试环境的动画帧补齐。
 *
 * 组件基座（antd 的样式注入）在渲染后会排一次 `requestAnimationFrame`。node 环境里没有它，
 * 于是「换基座」这件事会崩在这一句上，而不是崩在业务断言上——报出来是 `requestAnimationFrame
 * is not defined`，看起来像组件坏了。七条线换基座时会撞同一面墙，所以只在这一处补：
 * 各线自己补一份，就会多出七种写法，而这个文件本来就该只有一份。
 *
 * 规则：**只补缺的**。环境自己已经有（happy-dom / jsdom / 浏览器）就一个字节都不动，
 * 否则会把真实实现的时序换成 setTimeout，让别人的用例变成另一种行为。
 */

export type AnimationFrameScope = {
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
  setTimeout: (handler: () => void, timeout?: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/** 补齐后返回 true；环境本来就有则返回 false（一个字节都不动）。 */
export function ensureAnimationFrame(scope: AnimationFrameScope): boolean {
  if (typeof scope.requestAnimationFrame === 'function' && typeof scope.cancelAnimationFrame === 'function') {
    return false
  }
  const pending = new Map<number, unknown>()
  let nextHandle = 1
  scope.requestAnimationFrame = (callback) => {
    const handle = nextHandle
    nextHandle += 1
    pending.set(handle, scope.setTimeout(() => {
      pending.delete(handle)
      callback(Date.now())
    }, 0))
    return handle
  }
  scope.cancelAnimationFrame = (handle) => {
    if (!pending.has(handle)) return
    const timer = pending.get(handle)
    pending.delete(handle)
    scope.clearTimeout(timer)
  }
  return true
}

// 断言文件也会 import 这个模块，但只有在它作为 setup 被加载时才有全局副作用可言；
// 环境已有实现时这里是空操作，所以重复加载无害。
ensureAnimationFrame(globalThis as unknown as AnimationFrameScope)
