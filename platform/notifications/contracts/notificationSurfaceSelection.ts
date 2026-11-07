/**
 * 事件级表面选择（契约 §5.5 的第三层）：**读者能选的面，只能是批准表批过的**。
 *
 * 三层是「与」不是三个开关：批准表＝上限、两个总开关＝总闸、这一份选择＝最后一道，且**只能收窄**。
 * 投递由平台判、两个总开关也在平台，所以这一层**存在平台**（一份 JSON，和记录同一处）；
 * 产品只读它去算交集，不另存——两处各存一份必现「页面勾了、推送没按它走」。
 *
 * **按组存**：同一件事的两条通知（例如日历「开始前」与「发生后」）共用**一份**选择，
 * 组键由批准行上的 `surfaceGroup` 给出。用一份而不是两份，是因为读者不会想为同一件事勾两次；
 * 而可用面取两条批准表的**交集**——并集会让读者勾了「应用内提示」，结果一条闪了、一条没闪，
 * 那就是假配置（一个开关看着管两件事，实际只管一件）。
 *
 * **读的时候两条的值不一致 → 按「都关」保守处理并留痕**：历史数据或半次写入都会长成这样，
 * 宁可少发一条，也不要一半生效却看着正常。
 */
import type { NotificationEventCatalogEntry, NotificationEventPolicy } from './notificationEventCatalog'

/** 可以逐事件选的三面。`popup` 不在这里：它不受读者逐事件控制（契约 §5.1）。 */
export const SELECTABLE_SURFACES = ['channel', 'toast', 'desktop'] as const

export type SelectableSurface = (typeof SELECTABLE_SURFACES)[number]

/** 一份选择：缺省（不在对象里）＝「读者没表过态」，按批准表允许的来；`false` 才是明确的收窄。 */
export type NotificationSurfaceSelection = Readonly<Partial<Record<SelectableSurface, boolean>>>

export type SurfaceResolution = {
  /** 这一条实际允许的面（已按上限夹紧）。缺省项不在里面。 */
  selection: NotificationSurfaceSelection
  /**
   * 同一组里两条的存量值不一致（历史数据 / 半次写入）。为真时 `selection` 已经把三面全部关掉，
   * 调用方**必须**记一行诊断——否则「都关」看起来就像读者自己关的。
   */
  conflict: boolean
}

function isSelectable(surface: string): surface is SelectableSurface {
  return (SELECTABLE_SURFACES as readonly string[]).includes(surface)
}

/** 批准表那一行允许选的面。 */
function availableOf(entry: NotificationEventCatalogEntry): SelectableSurface[] {
  return SELECTABLE_SURFACES.filter((surface) => entry.approvedDisruptionLevels.includes(surface))
}

/** 把一份选择夹到允许范围内：没批的面即使存了 `true` 也落不下来（越权不许被数据带进来）。 */
function clamp(value: NotificationSurfaceSelection | undefined, available: readonly SelectableSurface[]): NotificationSurfaceSelection {
  const out: Partial<Record<SelectableSurface, boolean>> = {}
  for (const surface of available) {
    const chosen = value?.[surface]
    // 缺省＝允许（读者还没表过态）；只有明确的 `false` 才收窄。
    out[surface] = chosen !== false
  }
  return Object.freeze(out)
}

function allOff(available: readonly SelectableSurface[]): NotificationSurfaceSelection {
  const out: Partial<Record<SelectableSurface, boolean>> = {}
  for (const surface of available) out[surface] = false
  return Object.freeze(out)
}

function sameSelection(a: NotificationSurfaceSelection | undefined, b: NotificationSurfaceSelection | undefined): boolean {
  return SELECTABLE_SURFACES.every((surface) => (a?.[surface] !== false) === (b?.[surface] !== false))
}

/**
 * 解这一条通知实际能用哪些面。
 *
 * 三种输入形状：有组键（按组存）、没有组键（按事件存）、以及同一组里还留着各存一份的历史数据。
 * 最后一种只要两条不一致就**都关 + `conflict: true`**——这是「宁可少发，也不要一半生效」。
 */
export function resolveSurfaceSelection(input: {
  entry: NotificationEventCatalogEntry
  /** 目录（用来把同一组的两条都找出来，算交集与冲突）。 */
  list: () => readonly NotificationEventCatalogEntry[]
  selections: Readonly<Record<string, NotificationSurfaceSelection>>
}): SurfaceResolution {
  const group = input.entry.surfaceGroup
  if (group === undefined) {
    return { selection: clamp(input.selections[input.entry.id], availableOf(input.entry)), conflict: false }
  }

  const members = input.list().filter((candidate) => candidate.surfaceGroup === group)
  // 交集：只有**每一条**都批的面才出现（并集会让一个勾只对一条生效）。
  const available = SELECTABLE_SURFACES.filter((surface) =>
    members.every((member) => member.approvedDisruptionLevels.includes(surface))
  )

  const stored = input.selections[group]
  if (stored !== undefined) return { selection: clamp(stored, available), conflict: false }

  const perEvent = members
    .map((member) => input.selections[member.id])
    .filter((value): value is NotificationSurfaceSelection => value !== undefined)
  if (perEvent.length === 0) return { selection: clamp(undefined, available), conflict: false }
  if (perEvent.every((value) => sameSelection(value, perEvent[0]))) {
    return { selection: clamp(perEvent[0], available), conflict: false }
  }
  return { selection: allOff(available), conflict: true }
}

/**
 * 同一个组里，各成员批的**可逐事件选的面**不一致的组。
 *
 * 为什么要有这个函数：组选择的可用面取交集，**只改其中一行，交集就变**——勾了「应用内提示」，
 * 结果一条闪、一条没闪，页面看起来一切正常。这条判据必须在批准表进代码那一刻就能红，
 * 而不是等有人真机上发现「怎么只闪一条」。
 *
 * 返回组与它的成员 id（不返回差异细节：差异用两行的档位原文一比就看得见）。
 */
export function surfaceGroupMismatches(
  policy: NotificationEventPolicy
): { group: string; ids: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const [id, row] of Object.entries(policy)) {
    if (row.surfaceGroup === undefined) continue
    groups.set(row.surfaceGroup, [...(groups.get(row.surfaceGroup) ?? []), id])
  }
  const mismatched: { group: string; ids: string[] }[] = []
  for (const [group, ids] of groups) {
    const shapes = new Set(ids.map((id) => SELECTABLE_SURFACES.filter((surface) => policy[id]!.approvedDisruptionLevels.includes(surface)).join(',')))
    if (shapes.size > 1) mismatched.push({ group, ids })
  }
  return mismatched
}

/** 组里全部成员（按目录顺序）。写入口用它校验「一个面是不是每一行都批了」。 */
export function surfaceGroupMembers(
  group: string,
  list: () => readonly NotificationEventCatalogEntry[]
): readonly NotificationEventCatalogEntry[] {
  return list().filter((entry) => entry.surfaceGroup === group)
}

/** 这个面在整组里是否都批了。写入口用它挡越权（没批的面不许被写进选择）。 */
export function isSurfaceAvailable(
  surface: string,
  members: readonly NotificationEventCatalogEntry[]
): surface is SelectableSurface {
  return isSelectable(surface) && members.length > 0 && members.every((member) => member.approvedDisruptionLevels.includes(surface))
}
