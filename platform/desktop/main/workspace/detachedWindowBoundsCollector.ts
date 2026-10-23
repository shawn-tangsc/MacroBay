import type { WorkspaceBounds } from '@platform/workspace/contracts'
// PLAT-04：采集侧的合并窗口**沿用既有的落盘合并策略**（同一个具名常量，绝不另写匿名阈值）。
import { WorkspaceWritePolicy } from '@platform/workspace/persistence/panelLayoutDocument'

/**
 * Owner: platform/desktop/main/workspace（PLAT-04，PM 授权新增文件：从 `panelDetachedWindowHost.ts` 抽出）。
 *
 * **受控 bounds 采集**：把「页窗真实窗口的 resize/move」变成**有界、可去重、带注册表身份**的观察事件。
 * 它是宿主的一块**独立职责**，因此单独成模块（宿主只做接线，不再承载合并/去重/定时器细节）：
 *
 *  - 身份：只有先 `rememberIdentity({windowInstanceId, hostEpoch})` 的窗口才可能产生观察值，
 *    事件始终带该身份 ⇒ 消费方（`.tabs.*` runtime）可据此 fail closed，绝不会把尺寸写到别的实例上；
 *  - 校验：非有限/非正尺寸一律丢弃（fail closed，消费方回落到策略默认并在工作区内夹紧）；
 *  - 合并：每窗口至多一个定时器（合并窗口＝`WorkspaceWritePolicy.boundsMergeMs`），只保留**最新一份**；
 *    同值不交付（拖拽静止绝不叫醒消费方）；**绝不轮询、绝不每像素交付**；
 *  - barrier：`release()`（窗口销毁）与 `flush()`（退出/显式 flush）都**先交付 pending 再清理**，
 *    因此「最后一次 resize」绝不丢在 shutdown barrier 之后；
 *  - 有界：pending 与定时器都是每窗口 0/1；退订/清身份后不再受理任何迟到广播（幂等）。
 *
 * 本模块不做持久化决策、不碰 registry/store/相位，也不 import electron（保持可单测）。
 */

/** 交付给消费方的观察值（带**注册表身份**）。 */
export type DetachedWindowBoundsEvent = { windowInstanceId: string; hostEpoch: number; bounds: WorkspaceBounds }

/** 窗口句柄侧的可选端口（生产实现＝工厂对 `resize`/`move` 的广播）。缺失即「无法主动感知」，绝不轮询、绝不猜。 */
export type DetachedWindowBoundsPort = {
  onBoundsChanged?: (listener: (bounds: WorkspaceBounds) => void) => () => void
}

export type DetachedWindowBoundsCollector = ReturnType<typeof createDetachedWindowBoundsCollector>

export function createDetachedWindowBoundsCollector(options: {
  /** 宿主既有的定时器端口语义：返回取消函数；返回 `null` 表示**调度不可用**。 */
  timers: { schedule: (delayMs: number, run: () => void) => (() => void) | null }
  /** 合并窗口（测试接缝）；缺省＝`WorkspaceWritePolicy.boundsMergeMs`。 */
  mergeMs?: number
  /** 退出期闸门：为真时不再受理新的原生广播（pending 仍可由 `flush()`/`release()` 交出）。 */
  isSuspended?: () => boolean
  /** 消费方异常的有界诊断出口（只上报，绝不改变窗口语义）。 */
  onConsumerFailure?: (error: unknown) => void
}) {
  const mergeMs = options.mergeMs ?? WorkspaceWritePolicy.boundsMergeMs
  const listeners = new Set<(event: DetachedWindowBoundsEvent) => void>()
  const identities = new Map<string, number>()
  const unsubscribes = new Map<string, () => void>()
  const pending = new Map<string, WorkspaceBounds>()
  const timers = new Map<string, () => void>()
  const delivered = new Map<string, WorkspaceBounds>()

  /** 可用性判定：非有限/非正尺寸一律「没有有效 bounds」⇒ 丢弃。 */
  const usable = (value: unknown): WorkspaceBounds | undefined => {
    if (typeof value !== 'object' || value === null) return undefined
    const { x, y, width, height } = value as Partial<WorkspaceBounds>
    if (![x, y, width, height].every((metric) => typeof metric === 'number' && Number.isFinite(metric))) return undefined
    const rounded = { x: Math.round(x as number), y: Math.round(y as number), width: Math.round(width as number), height: Math.round(height as number) }
    return rounded.width > 0 && rounded.height > 0 ? rounded : undefined
  }
  const same = (left: WorkspaceBounds, right: WorkspaceBounds): boolean =>
    left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height

  /** 消费方异常绝不冒泡回 Electron 事件派发，也不影响其它订阅者。 */
  const notify = (event: DetachedWindowBoundsEvent): void => {
    for (const listener of [...listeners]) {
      try { listener(event) } catch (error) { options.onConsumerFailure?.(error) }
    }
  }

  /** 立即交付某窗口的 pending（若有）。幂等：没有 pending 时什么都不做，绝不重复交付同一个值。 */
  const deliver = (windowInstanceId: string): void => {
    const cancel = timers.get(windowInstanceId)
    if (cancel !== undefined) {
      timers.delete(windowInstanceId)
      try { cancel() } catch { /* 取消失败只影响该次合并，绝不影响已成立的结论 */ }
    }
    const bounds = pending.get(windowInstanceId)
    if (bounds === undefined) return
    pending.delete(windowInstanceId)
    const hostEpoch = identities.get(windowInstanceId)
    if (hostEpoch === undefined) return
    delivered.set(windowInstanceId, bounds)
    notify({ windowInstanceId, hostEpoch, bounds })
  }

  /** 原生广播入口：闸门 → 校验 → 身份 → 去重 → 合并（每窗口至多一个定时器）→ 到点交付。 */
  const observe = (windowInstanceId: string, rawBounds: unknown): void => {
    if (options.isSuspended?.() === true) return
    const bounds = usable(rawBounds)
    if (bounds === undefined) return
    if (!identities.has(windowInstanceId)) return
    const known = pending.get(windowInstanceId) ?? delivered.get(windowInstanceId)
    if (known !== undefined && same(known, bounds)) return
    pending.set(windowInstanceId, bounds)
    if (timers.has(windowInstanceId)) return
    const cancel = options.timers.schedule(mergeMs, () => { timers.delete(windowInstanceId); deliver(windowInstanceId) })
    // 定时器端口不可用 ⇒ 立即交付（宁可多交付一次，绝不丢用户尺寸）
    if (cancel === null) { deliver(windowInstanceId); return }
    timers.set(windowInstanceId, cancel)
  }

  return Object.freeze({
    /** 预分配成功后的身份登记：bounds 只认这个身份（未登记的窗口广播一律被忽略）。 */
    rememberIdentity(input: { windowInstanceId: string; hostEpoch: number }): void {
      identities.set(input.windowInstanceId, input.hostEpoch)
    },

    /** 建窗即订阅（端口缺失或抛错即静默降级为「不采集」，绝不阻断建窗）。退订失败只影响该次释放。 */
    subscribe(input: { windowInstanceId: string; handle: DetachedWindowBoundsPort }): void {
      if (typeof input.handle.onBoundsChanged !== 'function') return
      let unsubscribe: (() => void) | null = null
      try { unsubscribe = input.handle.onBoundsChanged((bounds) => observe(input.windowInstanceId, bounds)) } catch { return }
      if (typeof unsubscribe === 'function') unsubscribes.set(input.windowInstanceId, unsubscribe)
    },

    /**
     * 释放某窗口：**先交付 pending**（窗口尚在，值有效；「关窗/退出前最后一次尺寸」因此不丢），
     * 再退订、清定时器与身份。幂等：重复释放无害（身份已清 ⇒ 后续广播一律被忽略）。
     */
    release(windowInstanceId: string): void {
      deliver(windowInstanceId)
      const unsubscribe = unsubscribes.get(windowInstanceId)
      if (unsubscribe !== undefined) {
        unsubscribes.delete(windowInstanceId)
        try { unsubscribe() } catch { /* 退订异常只影响该次释放 */ }
      }
      const cancel = timers.get(windowInstanceId)
      if (cancel !== undefined) {
        timers.delete(windowInstanceId)
        try { cancel() } catch { /* 同上 */ }
      }
      pending.delete(windowInstanceId)
      delivered.delete(windowInstanceId)
      identities.delete(windowInstanceId)
    },

    /** 交付全部窗口的 pending（退出/显式 flush barrier；幂等）。 */
    flush(): void {
      for (const windowInstanceId of [...pending.keys()]) deliver(windowInstanceId)
    },

    /** 安装消费方订阅（返回退订）。交付事件带注册表身份与**已去重、已合并**的 bounds。 */
    subscribeConsumer(listener: (event: DetachedWindowBoundsEvent) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  })
}
