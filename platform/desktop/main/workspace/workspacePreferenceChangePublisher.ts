import type { WorkspaceEvent, WorkspacePanelSnapshot } from '@platform/workspace/contracts'
import type { WorkspaceEventPublishInput } from './workspaceEventRouter'
import { ownsPanel } from './panelWorkspaceScopeProjection'
import { LANGUAGE_PATTERN, safePreference, safeTimeZone } from './panelWorkspacePayloadGuard'
import { fallbackTimeZone } from '@platform/settings/schema/appSettings'
import type { WorkspaceWindowRegistry } from './workspaceWindowRegistry'
import {
  deliverPendingPanelPreference,
  listPendingPanelTargets,
  type WorkspacePreferencePendingPanelTarget
} from './workspacePendingPanelPreference'

/** PLAT-31 的受众/投递实现已抽到 `workspacePendingPanelPreference.ts`；这里保持导入点稳定。 */
export { listPendingPanelTargets } from './workspacePendingPanelPreference'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5.1、PLAT-10 / PLAT-28 / PLAT-30 / PLAT-32(S1)。
 *
 * 偏好（语言/主题）变更的**受控转发** producer：`context.preferences` 是**窗口级**解析结果，平台没有设置
 * 变更广播通道 ⇒ 由**显式通知**（`app.ts` 的 `settingsUpdate` 成功路径一行
 * `panelWorkspaceForDisposal?.notifyPreferencesChanged()`）把「当前偏好 vs 上次已转发的偏好」交给本模块比对，
 * 漂移时用**既有** `snapshot` 词汇 + 既有归属投递通知已打开的页窗/面板窗；受控读取（`getHostContext`）
 * **不带副作用**（窗口那次读取只是拿值）。不新增通道/preload 方法/事件词汇；事件绝不承载偏好值。
 *
 * 语义（PLAT-30 抽取后逐字未改；PLAT-32/S1 只换了对账触发点）：
 *  - **先记录、后转发** ⇒ 每次真实变化恰一次转发（并发读取看不到漂移）；
 *  - 基线由 compose 在**注册通道时**读一次当前偏好建立（只记录、绝不转发）；基线读取失败时第一次显式
 *    通知即基线（fail-open 到基线，绝不静默地把读取当对账）；
 *  - 受众由 `router.publish` 的既有归属判定（含 `hostEpoch`）决定 ⇒ 主窗与无关窗 0 条、有界、无自持环；
 *  - 页窗事件带 **Tab runtime store 的真实 revision**（绝不用面板 store 的 revision 冒充）；
 *  - 面板窗事件**有意不带 revision**：由 router 注入的面板 store 真实 revision 提供（与页窗那一条对称）。
 */

/** 页窗受众的最小投影；未绑定 webContents（尚未挂载）⇒ 没有订阅 ⇒ 绝不猜测受众。 */
export type WorkspacePreferencePageTarget = { workspaceInstanceKey: string | null; webContentsId: number | null }
/** 面板窗受众的最小投影（`kind:'detached-panel'`）；未绑定 webContents 的宿主以 `null` 表达「还没有订阅」。 */
export type WorkspacePreferencePanelTarget = {
  workspaceInstanceKey: string | null
  panelInstanceKey: string | null
  webContentsId: number | null
}
/** 面板窗受众投影的权威输入 = 真实 `WorkspaceSnapshot.panels`（绝不接受 renderer 上报的形状）。 */
export type WorkspacePreferencePanelView = WorkspacePanelSnapshot

/**
 * 面板窗受众投影（纯函数，判据只来自共享 registry + **权威快照**）：
 * 未承载该面板（`ownsPanel` 为假：未提交的预留目标是源窗身份）、未绑定 webContents、登记已回收 —— 一律排除。
 */
export function listPanelWindowTargets(
  windowRegistry: WorkspaceWindowRegistry,
  panels: readonly WorkspacePreferencePanelView[]
): readonly WorkspacePreferencePanelTarget[] {
  return windowRegistry.listDetachedHosts().flatMap((record) => {
    // 未绑定 webContents 的预留目标在 store 里仍归属**源窗口**：面板级作用域会命中源窗（主窗）而不是目标窗
    // ⇒ 这里 fail closed 地排除（既不误投主窗，也不假装目标已跟随）；它与「端口是否已挂载」无关。
    if (record.webContentsId === null) return []
    const panel = record.panelInstanceKey === null
      ? undefined
      : panels.find((entry) => entry.panelInstanceKey === record.panelInstanceKey)
    if (panel === undefined || !ownsPanel(record, panel)) return []
    return [{
      workspaceInstanceKey: panel.workspaceInstanceKey,
      panelInstanceKey: panel.panelInstanceKey,
      webContentsId: record.webContentsId
    }]
  })
}

export function createWorkspacePreferenceChangePublisher(options: {
  listPageWindows: () => readonly WorkspacePreferencePageTarget[]
  /** Tab 链路的真实 revision（绝不用面板 store 的 revision 冒充）。 */
  getTabRevision: () => number
  publish: (input: WorkspaceEventPublishInput) => unknown
  /** 面板窗受众投影；缺省（未接线）⇒ 面板窗 0 条，绝不猜测受众。 */
  listPanelWindows?: () => readonly WorkspacePreferencePanelTarget[]
  /**
   * **PLAT-31**：准备期面板目标窗的**定向**受众（按 registry，缺省 ⇒ 0 条）。
   * 与 `listPanelWindows` 互斥；它**不**经过 `router.publish`，因此绝不会因「面板此刻仍归属主窗」误投主窗。
   */
  listPendingPanelWindows?: () => readonly WorkspacePreferencePendingPanelTarget[]
  /**
   * 定向投递端口（真机＝`sendToHost(webContentsId, event)`）。缺省 ⇒ 不投递（绝不假装已通知）。
   * 事件形状仍是既有 `snapshot` 词汇、只带面板级 scope 与**面板 store 真实 revision**。
   */
  sendDirected?: (webContentsId: number, event: WorkspaceEvent) => unknown
  /** 面板 store 的真实 revision（定向投递用；缺省回落到 Tab revision，绝不伪造）。 */
  getPanelRevision?: () => number
}) {
  let forwarded: { language: string; theme: string; timeZone: string } | null = null
  return Object.freeze({
    /** 记录本次受控读取的偏好，并在**真实漂移**时转发一次；返回是否转发（便于取证「一次切换恰一次」）。 */
    reconcile(next: { language: string; theme: string; timeZone: string }): boolean {
      const previous = forwarded
      forwarded = next
      if (previous === null) return false
      if (previous.language === next.language && previous.theme === next.theme && previous.timeZone === next.timeZone) return false
      const layoutRevision = options.getTabRevision()
      // 同一时刻每个作用域恰一条（受众数绝不放大投递数）：未绑定 webContents / 空键的宿主没有订阅
      const pageScopes = new Set<string>()
      for (const target of options.listPageWindows()) {
        if (target.workspaceInstanceKey === null || target.webContentsId === null) continue
        pageScopes.add(target.workspaceInstanceKey)
      }
      for (const workspaceInstanceKey of pageScopes) {
        try {
          options.publish({ type: 'snapshot', scope: { workspaceInstanceKey }, layoutRevision })
        } catch { /* 通知失败绝不影响本次受控读取的结论 */ }
      }
      const panelScopes = new Set<string>()
      for (const target of options.listPanelWindows?.() ?? []) {
        const { workspaceInstanceKey, panelInstanceKey } = target
        if (workspaceInstanceKey === null || panelInstanceKey === null || target.webContentsId === null) continue
        panelScopes.add(JSON.stringify([workspaceInstanceKey, panelInstanceKey]))
      }
      for (const key of panelScopes) {
        const [workspaceInstanceKey, panelInstanceKey] = JSON.parse(key) as [string, string]
        try {
          // 面板级作用域 ⇒ 命中判定逐字复用既有 router（主窗与无关窗 0 条）；revision 由 router 注入的面板 store 值
          options.publish({ type: 'snapshot', scope: { workspaceInstanceKey, panelInstanceKey } })
        } catch { /* 通知失败绝不影响本次受控读取的结论 */ }
      }
      // PLAT-31：准备期目标窗的定向投递（同一窗口至多一条、只读事件、不碰相位；实现在独立模块）
      deliverPendingPanelPreference({
        targets: options.listPendingPanelWindows?.() ?? [],
        layoutRevision: options.getPanelRevision?.() ?? layoutRevision,
        ...(options.sendDirected === undefined ? {} : { sendDirected: options.sendDirected })
      })
      return true
    }
  })
}

/** 偏好 producer 的事件词汇自证：只使用既有 `WorkspaceEvent['type']`（不新增词汇）。 */
export type WorkspacePreferenceForwardedEventType = Extract<WorkspaceEvent['type'], 'snapshot'>

/** 受控偏好来源（与 `getHostContext` 同源，由 `app.ts` 注入 settings store 的只读投影）。 */
export type WorkspacePreferenceSource = {
  getLanguage: () => string | Promise<string>
  getTheme: () => string | Promise<string>
  getTimeZone: () => string | Promise<string>
}

/** 偏好跟随的接线输入：受众投影判据只来自共享 registry + **权威快照**（绝不接受 renderer 上报形状）。 */
export type WorkspacePreferenceFollowInput = {
  preferences: WorkspacePreferenceSource
  windowRegistry: WorkspaceWindowRegistry
  runtimeStore: {
    getSnapshot: () => {
      panels: readonly WorkspacePreferencePanelView[]
      /** 面板 store 的真实 revision（PLAT-31 定向投递用；`createPanelWorkspaceStore` 的快照天然带它）。 */
      layoutRevision?: number
    }
  }
  /** Tab runtime store（页窗那一条的 revision 必须来自它，绝不用面板 store 的 revision 冒充）。 */
  tabStore: { getSnapshot: () => { layoutRevision: number } }
  publish: (input: WorkspaceEventPublishInput) => unknown
  /** **PLAT-31**：准备期定向受众投影；缺省 ⇒ 0 条（绝不猜测）。 */
  listPendingPanelWindows?: () => readonly WorkspacePreferencePendingPanelTarget[]
  /** **PLAT-31**：定向投递端口（真机＝`sendToHost`）；缺省 ⇒ 不投递。 */
  sendDirected?: (webContentsId: number, event: WorkspaceEvent) => unknown
}

/**
 * PLAT-32（S1）：把「**显式通知** ⇒ 对账 ⇒ 定向投递」收敛成**一个**入口（`app.ts` 的 `settingsUpdate`
 * 成功路径调用 `notify()` 一行）。受控读取（`getHostContext`）不参与对账 —— 读是纯读。
 *
 *  - **基线**：`ensureBaseline()` 在**注册通道时**（建窗之前）读一次当前偏好，只记录、绝不转发 ⇒ 与旧口径
 *    一致（窗口自己那次读取就是基线值）；读取失败保持未基线（fail-open 到基线，绝不静默把读取当对账）。
 *  - **顺序**：基线与每次通知走同一条串行队列 ⇒ 乱序/并发都不会丢掉一次真实切换，也不会放大投递。
 *  - **口径**：漂移判定用与 `getHostContext` 同一 `safePreference` 解析，窗口看到的偏好就是被比对的偏好。
 *  - **错误路径显式**：`notify()` 绝不 reject（设置写入的结果绝不能被一次通知失败改写），只返回是否转发。
 *  - 既有 `reconcile` 逐字保留（单测与直接调用不受影响），事件词汇/受众/有界性判据不变。
 */
export function createWorkspacePreferenceFollow(input: WorkspacePreferenceFollowInput) {
  const publisher = createWorkspacePreferenceChangePublisher({
    listPageWindows: () => input.windowRegistry.listDetachedTabs(),
    getTabRevision: () => input.tabStore.getSnapshot().layoutRevision,
    listPanelWindows: () => listPanelWindowTargets(input.windowRegistry, input.runtimeStore.getSnapshot().panels),
    // PLAT-31：准备期（in-flight transfer）目标窗按 registry 定向投递；不经过 router 的归属判定。
    listPendingPanelWindows: () => input.listPendingPanelWindows?.()
      ?? listPendingPanelTargets(input.windowRegistry, input.runtimeStore.getSnapshot()),
    ...(input.sendDirected === undefined ? {} : { sendDirected: input.sendDirected }),
    getPanelRevision: () => input.runtimeStore.getSnapshot().layoutRevision ?? input.tabStore.getSnapshot().layoutRevision,
    publish: input.publish
  })
  let queue: Promise<unknown> = Promise.resolve()
  let baseline: Promise<void> | null = null
  const enqueue = (step: () => Promise<boolean>): Promise<boolean> => {
    const run = queue.then(step, step)
    queue = run.then(() => undefined, () => undefined)
    return run
  }
  const read = (): Promise<{ language: string; theme: string; timeZone: string }> =>
    Promise.all([input.preferences.getLanguage(), input.preferences.getTheme(), input.preferences.getTimeZone()])
      .then(([language, theme, timeZone]) => ({
        language: safePreference(language, 'en-US', LANGUAGE_PATTERN),
        theme: safePreference(theme, 'system'),
        timeZone: safeTimeZone(timeZone, fallbackTimeZone)
      }))
  return Object.freeze({
    /** 既有对账出口（逐字不变）：显式给出本次偏好，真实漂移才转发一次并返回 true。 */
    reconcile: publisher.reconcile,
    /** 基线只读一次（幂等）；失败绝不阻断启动，也绝不把这次读取当成对账。 */
    ensureBaseline(): Promise<void> {
      baseline ??= enqueue(async () => {
        try { publisher.reconcile(await read()) } catch { /* 基线读取失败不阻断启动 */ }
        return false
      }).then(() => undefined)
      return baseline
    },
    /** 唯一对账入口（真机由 `app.ts` 的 settingsUpdate 调用）；返回是否真实转发。 */
    notify(): Promise<boolean> {
      return enqueue(async () => {
        try { return publisher.reconcile(await read()) } catch { return false }
      })
    }
  })
}
