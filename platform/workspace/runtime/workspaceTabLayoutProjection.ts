import type {
  WorkspaceBounds,
  WorkspacePageRegistration,
  WorkspaceTabErrorCode,
  WorkspaceTabMode,
  WorkspaceTabRecentlyClosed,
  WorkspaceTabState
} from '../contracts'
import { WorkspaceTabPolicy } from '../policies'
import type { createWorkspacePageRegistry } from '../registry/workspacePageRegistry'

/**
 * Owner: platform/workspace/runtime（**PLAT-46** 行数抽取；原属 `workspaceTabStore.ts` 的内聚块）。
 *
 * 职责**单一**：v2 布局文档与 Tab runtime 记录之间的**纯投影**（含文档里 `detachedBounds` 字段的
 * 校验/观测匹配）——
 *  - `projectRestoredTabs`：文档 → runtime（按 order 排序、未注册页面/非法键/重复键局部剪枝、身份重生成、
 *    `detachedBounds` 逐条校验保留）；
 *  - `resolveRestoredActiveKey`：恢复后的活动项（显式请求且仍打开，否则第一个打开的 tab，绝不悬空）；
 *  - `projectLayoutTabs`：runtime → 单写载荷（打开项在前且顺序不变、关闭项按最近关闭优先、有界截断）；
 *  - `matchDetachedBounds`：Main 观察 → runtime 的 `detachedBounds` 匹配（身份/同值/畸形 fail closed）；
 *  - `usableBounds`：以上共用的 bounds 可用性判定（与 `persistence.isBounds` 同一口径）。
 *
 * 边界（抽取纪律）：**只有位置变了**——判据、剪枝计数、排序/截断规则、对象冻结姿态逐字未改；
 * 这里不持有 store 状态、不做 CAS/所有权判断、不写 revision（那些仍属 `workspaceTabStore.ts` 的权威），
 * 也不 import persistence（保持 `persistence → runtime` 的单向依赖）。回归：`workspaceTabStore.test.ts`、
 * `workspaceTabStoreDetachedBounds.test.ts`、`workspaceLayoutRestore.test.ts`、`restoreWorkspaceLayout.test.ts`。
 */

type PageRegistry = ReturnType<typeof createWorkspacePageRegistry>

/** 身份投影串里的非法控制字符（与 store 的 binding key 校验同一字符集口径）。 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u

/**
 * P2-04：v2 文档的 Tab 载荷（结构上与 `persistence/workspaceLayoutDocument.StoredTab` 一致，
 * 但 runtime 不 import persistence，保持分层方向：persistence → runtime 不反向依赖）。
 * Tab **不带 binding**：重启后由承载宿主重新补绑（`sessionReboundWithoutDuplicate`）。
 */
export type WorkspaceTabLayoutRecord = {
  workspaceInstanceKey: string
  pageId: string
  open: boolean
  order: number
  mode: WorkspaceTabMode
  detachedBounds?: WorkspaceBounds
}

/** 恢复是**一条 applied 布局命令**：CAS、身份重生成、剪裁计数全部如实回报。 */
export type WorkspaceTabRestoreResult = {
  status: 'applied' | 'rejected'
  snapshot: WorkspaceTabState
  errorCode?: WorkspaceTabErrorCode
  restoredTabs: number
  prunedTabs: number
}

/**
 * Tab runtime 记录的**布局投影面**（恢复产物 / 单写输入）。store 的完整记录在它之上再带会话内的
 * `bindingKey`；投影只读这里声明的字段，绝不碰绑定。
 */
export type WorkspaceTabLayoutRuntimeRecord = {
  workspaceInstanceKey: string
  pageId: string
  menuKey: string
  bindingPersistence: WorkspacePageRegistration['binding']['persistence']
  open: boolean
  mode: WorkspaceTabMode
  windowInstanceId: string
  hostEpoch: number
  /**
   * PLAT-04：用户调整过的页窗尺寸/位置（Main 侧权威观察，**不是** renderer 上报）。
   * 它随**逻辑实例**（`workspaceInstanceKey`）走，不随容器身份：回停靠/关闭/重启都不丢，
   * 再次分离时作为 `savedBounds` 交回共享宿主（策略只做工作区夹紧，绝不覆盖用户尺寸）。
   */
  detachedBounds?: WorkspaceBounds
}

/**
 * PLAT-04：页窗 bounds 的**可用性判定**（与 `persistence.isBounds` 同一口径）。
 * 任何非有限/非正尺寸一律视为「没有有效 bounds」⇒ 调用方回落到策略默认并在工作区内夹紧，绝不猜、绝不透传 NaN。
 */
export function usableBounds(value: WorkspaceBounds | undefined): WorkspaceBounds | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  const { x, y, width, height } = value
  if (![x, y, width, height].every((metric) => typeof metric === 'number' && Number.isFinite(metric))) return undefined
  const rounded = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
  if (rounded.width <= 0 || rounded.height <= 0) return undefined
  return rounded
}

function sameBounds(left: WorkspaceBounds, right: WorkspaceBounds): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}

/** `matchDetachedBounds` 的受控结论：ignored 时如实给出原因；applied 时交回待写回的记录与规范化值。 */
export type WorkspaceTabDetachedBoundsMatch =
  | { status: 'ignored'; reason: 'unknown-identity' | 'malformed-bounds' | 'unchanged'; tab: WorkspaceTabLayoutRuntimeRecord | null }
  | { status: 'applied'; tab: WorkspaceTabLayoutRuntimeRecord; bounds: WorkspaceBounds }

/**
 * PLAT-04：Main 侧（共享宿主）观察到的页窗 bounds 的**受控匹配**（纯函数；写回与 revision 仍属 store）。
 *
 * 语义（逐条 fail closed）：
 *  - 只接受「当前正 detached、且 `windowInstanceId` + `hostEpoch` 逐字一致」的实例：未知窗口 /
 *    陈旧 epoch / 已回停靠 / 已关闭一律 `ignored`，绝不把外来尺寸写到别的实例上；
 *  - 畸形 bounds（NaN / Infinity / 负数 / 0 / 非对象）一律 `ignored`（回落策略默认，绝不透传）；
 *  - **同值不抬 revision**：拖拽静止或合并窗口内的重复值绝不产生写风暴（每次真实变化才推进一次，
 *    由 compose 接到既有的单写 + 合并落盘路径）；
 *  - 它**不是**布局管理权：不改变 `open`/`mode`/`binding`，也绝不因此重开已关闭的 Tab。
 */
export function matchDetachedBounds(input: {
  tabs: readonly WorkspaceTabLayoutRuntimeRecord[]
  windowInstanceId: string
  hostEpoch: number
  bounds: WorkspaceBounds
}): WorkspaceTabDetachedBoundsMatch {
  const bounds = usableBounds(input.bounds)
  if (bounds === undefined) return { status: 'ignored', reason: 'malformed-bounds', tab: null }
  const tab = input.tabs.find((entry) => entry.mode === 'detached'
    && entry.windowInstanceId === input.windowInstanceId && entry.hostEpoch === input.hostEpoch)
  if (tab === undefined) return { status: 'ignored', reason: 'unknown-identity', tab: null }
  if (tab.detachedBounds !== undefined && sameBounds(tab.detachedBounds, bounds)) {
    return { status: 'ignored', reason: 'unchanged', tab }
  }
  return { status: 'applied', tab, bounds }
}

/**
 * P2-04：从 v2 文档投影出 runtime Tab 记录（**纯函数**：不读也不写 store 状态）。 *
 * 语义逐条保留（原 `_restoreTabs` 的文档解析段）：
 *  - 按 `order` 排序后逐条判定；未注册页面 / 非法键 / 重复键 / 非法 `order` / 非布尔 `open`
 *    只剪掉该条并计数，绝不让整份布局失效；
 *  - 身份（`windowInstanceId`/`hostEpoch`）**一律重新生成**，绝不从磁盘接受窗口身份（§7：快照不得保存身份）；
 *  - PLAT-04：`detachedBounds` 是**布局数据**（不是容器身份）：逐条校验后保留，降级为 main 也不丢用户尺寸。
 */
export function projectRestoredTabs(input: {
  records: readonly WorkspaceTabLayoutRecord[]
  pageRegistry: PageRegistry
  createId: (prefix?: string) => string
  mainWindowInstanceId: string
  mainHostEpoch: number
}): { restored: WorkspaceTabLayoutRuntimeRecord[]; prunedTabs: number } {
  const ordered = [...input.records].sort((left, right) => left.order - right.order)
  const restored: WorkspaceTabLayoutRuntimeRecord[] = []
  const seen = new Set<string>()
  let prunedTabs = 0
  for (const entry of ordered) {
    const registration = input.pageRegistry.get(entry.pageId)
    const key = entry.workspaceInstanceKey
    const keyOk = typeof key === 'string' && key.length > 0 && key.length <= WorkspaceTabPolicy.maxTabKeyLength
      && !CONTROL_CHARACTER_PATTERN.test(key)
    const orderOk = typeof entry.order === 'number' && Number.isSafeInteger(entry.order) && entry.order >= 0
    if (registration === undefined || !keyOk || !orderOk || typeof entry.open !== 'boolean' || seen.has(key)) {
      prunedTabs += 1
      continue
    }
    seen.add(key)
    const detached = entry.mode === 'detached'
    // PLAT-04：纵深防御——文档校验已保证形状，这里再校验一次；畸形只丢尺寸，Tab 本身照常恢复
    const detachedBounds = usableBounds(entry.detachedBounds)
    restored.push({
      workspaceInstanceKey: key, pageId: entry.pageId, menuKey: registration.menuKey,
      bindingPersistence: registration.binding.persistence,
      open: entry.open, mode: detached ? 'detached' : 'main',
      windowInstanceId: detached ? input.createId('window') : input.mainWindowInstanceId,
      hostEpoch: detached ? input.mainHostEpoch + 1 : input.mainHostEpoch,
      ...(detachedBounds === undefined ? {} : { detachedBounds })
    })
  }
  return { restored, prunedTabs }
}

/** 恢复后的活动项：只认文档里显式请求且**仍打开**的项；否则回退到第一个打开的 tab（绝不悬空）。 */
export function resolveRestoredActiveKey(
  restored: readonly WorkspaceTabLayoutRuntimeRecord[],
  requested: string | null
): string | null {
  return restored.find((tab) => tab.workspaceInstanceKey === requested && tab.open)?.workspaceInstanceKey
    ?? restored.find((tab) => tab.open)?.workspaceInstanceKey
    ?? null
}

/**
 * P2-04：v2 单写出口的 Tab 载荷（有界，**纯函数**）：打开的 tab 全部保留且顺序不变，然后是关闭记录
 * （最近关闭优先，其余按 tab 顺序），总量不超过 `maxTabs`；被截掉的关闭记录如实计数。
 * 绝不逐出已打开的实例（§8）。PLAT-04：`detachedBounds` 随载荷落盘（有值才出现，逐字保留），
 * 因此「用户调过尺寸 → 重启 → 再次分离」能回到同一尺寸。
 */
export function projectLayoutTabs(input: {
  tabs: readonly WorkspaceTabLayoutRuntimeRecord[]
  recentlyClosed: readonly WorkspaceTabRecentlyClosed[]
  maxTabs: number
}): { tabs: readonly WorkspaceTabLayoutRecord[]; droppedTabs: number } {
  const { tabs, recentlyClosed } = input
  const closedRank = new Map(recentlyClosed.map((entry, index) => [entry.workspaceInstanceKey, index]))
  const open = tabs.filter((tab) => tab.open)
  const closed = tabs.filter((tab) => !tab.open).sort((left, right) => {
    const leftRank = closedRank.get(left.workspaceInstanceKey) ?? Number.MAX_SAFE_INTEGER
    const rightRank = closedRank.get(right.workspaceInstanceKey) ?? Number.MAX_SAFE_INTEGER
    return leftRank === rightRank ? tabs.indexOf(left) - tabs.indexOf(right) : leftRank - rightRank
  })
  const candidates = [...open, ...closed]
  const kept = candidates.slice(0, input.maxTabs)
  return {
    tabs: Object.freeze(kept.map((tab, index) => Object.freeze({
      workspaceInstanceKey: tab.workspaceInstanceKey, pageId: tab.pageId,
      open: tab.open, order: index, mode: tab.mode,
      ...(tab.detachedBounds === undefined ? {} : { detachedBounds: Object.freeze({ ...tab.detachedBounds }) })
    }))),
    droppedTabs: candidates.length - kept.length
  }
}
