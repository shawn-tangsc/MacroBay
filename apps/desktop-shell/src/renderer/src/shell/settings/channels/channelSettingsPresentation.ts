import type {
  ChannelManagementCatalogEntry,
  ChannelManagementSafeView
} from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import type { StatusPillTone } from '@platform/ui/components/status-pill'

import { platformText } from '../../../i18n/platformText'

/**
 * 通道设置页的呈现层：类型、档位表、文案键表与两处纯函数。
 *
 * 抽出来的理由只有一条：页面本身已经顶到 500 行硬线。这里放的是**不碰状态与副作用**的东西——
 * 数据值到档位/文案键的穷举表、把目录项翻成人话的函数、凭据状态的标签。页面里的读态与空态判据
 * 一条没动，尤其「一个通道都没有」与「有通道但没选中」仍然是两个码、两个动作。
 */
export type ChannelWorkspace = { type: 'system' } | { type: 'user'; workspaceId: string }
export type ChannelPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export type Channel = {
  id: string
  type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'
  name: string
  agentId: string
  state: 'credential-missing' | 'configuration-ready' | 'disabled' | 'deleting' | 'runtime-ready'
  credential: {
    status: 'configured' | 'missing' | 'unavailable'
    hasCredential: boolean
    /** 主进程算好的掩码（头尾各几位 + 省略号）；渲染层只显示，不拿完整值再切。 */
    maskedFields?: Readonly<Record<string, string>>
    /** 凭据修订号：只用来显示「第 N 次保存」，不是时间。 */
    revision?: number | null
  }
  /** 系统默认目录或读者指定的工作区；老视图没有这一项时按系统默认处理。 */
  workspace?: ChannelWorkspace
  /** `null` = 继承助手；不落 `'default'`。老视图缺这一项时同样按「继承」处理。 */
  permissionMode?: ChannelPermissionMode | null
  /** 空数组 = 允许所有会话（本版接口尚未生效，界面先只读回显）。 */
  allowedChatIds?: readonly string[]
}

export type Conversation = { id: string; kind: string; targetEnabled: boolean }
export type RuntimeStatus = { channelId: string; generation: number; lifecycle: string; updatedAt: string | null }
export type Candidate = { id: string; kind: 'direct' | 'group' | 'channel'; displayLabel: string | null; firstSeenAt: string; lastSeenAt: string; hitCount: number; status: 'pending' | 'allowed' | 'ignored' }
export type Policy = { id: string; subjectType: 'user' | 'conversation'; conversationKind: string | null }
export type Agent = { id: string; name: string }
export type Catalog = { type: string; status: 'planned' | 'blocked' | 'supported'; reason: string; implemented: boolean }

/** 目录状态 → 档位：按数据值查表，穷举闭集；多一个取值就编译不过，没有兜底档。 */
export const catalogTone: Record<Catalog['status'], StatusPillTone> = {
  supported: 'ok',
  planned: 'muted',
  blocked: 'bad'
}

/**
 * 目录状态 → 文案键：**字面量键只写这一处**。
 *
 * 原来这里用 `` `channelCatalogStatus.${entry.status}` `` 拼键，`StatusPill` 的调用点守卫立刻报红——
 * 它只认看得见的字符串，拼出来的键既校验不到形状，也校验不到存在。拼键换成「数据值 → 字面量键」
 * 的表，和 `catalogTone` 同一形状：闭集里多一个取值就编译不过，没有兜底。
 */
export const catalogStatusKey: Record<Catalog['status'], string> = {
  planned: 'channelCatalogStatus.planned',
  blocked: 'channelCatalogStatus.blocked',
  supported: 'channelCatalogStatus.supported'
}

/** 通道运行态 → 档位：`runtime-ready` 才是在跑，其余都是「还没起来」。 */
export const runtimeTone = (state: Channel['state']): StatusPillTone => (state === 'runtime-ready' ? 'ok' : 'muted')

/** A blocked adapter must say what it is missing, not only that it is blocked. */
export function catalogReason(
  entry: Catalog,
  labels: { channelCatalogReason: Record<'supported' | 'planned' | 'blockedImplemented' | 'blockedUnimplemented', string> }
): string {
  if (entry.status === 'supported') return labels.channelCatalogReason.supported
  if (entry.status === 'planned') return labels.channelCatalogReason.planned
  return entry.implemented
    ? labels.channelCatalogReason.blockedImplemented
    : labels.channelCatalogReason.blockedUnimplemented
}

export function credentialStatusLabel(
  status: Channel['credential']['status'],
  labels: typeof platformText['en-US']['settings']
): string {
  if (status === 'configured') return labels.channelCredentialConfigured
  if (status === 'unavailable') return labels.channelCredentialUnavailable
  return labels.channelCredentialMissing
}

/**
 * 失败码的**两张闭集**。两处都按「码 → 大白话」走同一张文案表，闭集外也有一句实话，
 * 原始码永不上屏——上一版只映射了自检的 5 个码，别的码全落进「原因没有上报」，
 * 用户看到的就是「失败了但不知道为什么」。
 */

/** 启用/自检这条路上的码（`reason` 与 `code` 合起来）。 */
export const CHANNEL_ENABLE_FAILURE_REASONS = [
  'telegram-credential-missing',
  'telegram-provider-rejected',
  'telegram-conflict',
  'telegram-network-unavailable',
  'telegram-proxy-unavailable',
  'telegram-rate-limited',
  'channel-credential-missing',
  'channel-agent-missing',
  'adapter-not-supported',
  'adapter-runtime-start-failed',
  'channel-not-found'
] as const

/** 新建/编辑/删除/启停这条路上的码（`ChannelManagementCode` 里用户能看到的那些）。 */
export const CHANNEL_MUTATION_FAILURE_REASONS = [
  'channel-agent-missing',
  'channel-credential-invalid',
  'channel-credential-missing',
  'channel-credential-unavailable',
  'channel-delete-pending',
  'channel-management-metadata-failed',
  'channel-not-found',
  'channel-policy-invalid',
  'adapter-not-supported'
] as const

export type ChannelEnableFailureReason = (typeof CHANNEL_ENABLE_FAILURE_REASONS)[number]
export type ChannelMutationFailureReason = (typeof CHANNEL_MUTATION_FAILURE_REASONS)[number]

type FailureLabels = Pick<
  typeof platformText['en-US']['settings'],
  'channelFailureReason' | 'channelFailureReasonUnknown' | 'channelOperationFailedUnknown'
>

/**
 * 码 → 人话；表里没有就 `null`，由调用方决定用哪句兜底。
 *
 * 为什么不让这个函数自己挑兜底句：启用那一路要写「没有通过检查」，新建那一路要写
 * 「这次没有成功」——同一件事两种语境，硬塞成一句必然有一边别扭。
 */
export function channelFailureReason(code: string | null | undefined, labels: FailureLabels): string | null {
  if (typeof code !== 'string' || code === '') return null
  return Object.prototype.hasOwnProperty.call(labels.channelFailureReason, code)
    ? labels.channelFailureReason[code]
    : null
}

/**
 * `requestEnable` 的返回值 → 行内那句话；`null` 表示这次确实开成了。
 *
 * 两个字段都要认：自检失败带 `reason`，而「凭据没存 / 频道不在了 / 运行时没起来」只带 `code`。
 * 只读 `reason` 就会把后三种当成「没有原因」——那正是用户看到的「原因没有上报」。
 * 拿不到返回值（`undefined`）也算没开成：开关回弹却一句话不写，比说实话更糟。
 */
export function enableFailureSentence(
  result: { ok?: boolean; code?: string; reason?: string } | null | undefined,
  labels: FailureLabels
): string | null {
  if (result?.ok === true) return null
  const code = typeof result?.reason === 'string' && result.reason !== '' ? result.reason : result?.code
  return channelFailureReason(code, labels) ?? labels.channelFailureReasonUnknown
}

/**
 * 新建/编辑/删除这类操作的返回值 → 错误那句；`null` 表示成功。
 *
 * **`ok` 必须显式判**：这些接口失败时是正常返回 `{ ok: false, code }`，不抛错；不看 `ok`
 * 就会把「建好了但没拿到」当成「操作失败」，用户再点一次就多出一条频道——库里那 8 条重复
 * 频道就是这么来的。所以这里也接受「没有 ok 字段」，但那种情况一律按失败说。
 */
export function mutationFailureSentence(
  result: { ok?: boolean; code?: string } | null | undefined,
  labels: FailureLabels
): string | null {
  if (result?.ok === true) return null
  return channelFailureReason(result?.code, labels) ?? labels.channelOperationFailedUnknown
}

/**
 * 主进程的安全视图 → 这一屏的形状。**不做 `as` 转换**：范围相反的 `as` 编译器不拦
 * （`ChannelManagementSafeView` 多出的字段被 `as` 直接抹掉，少一个字段也没人红），
 * 而逐字段映射时，字段改名或消失都会在编译期报出来。
 */
export function toChannel(view: ChannelManagementSafeView): Channel {
  return {
    id: view.id,
    type: view.type,
    name: view.name,
    agentId: view.agentId,
    state: view.state,
    credential: {
      status: view.credential.status,
      hasCredential: view.credential.hasCredential,
      maskedFields: view.credential.maskedFields,
      revision: view.credential.revision
    },
    workspace: view.workspace,
    permissionMode: view.permissionMode,
    allowedChatIds: view.allowedChatIds
  }
}

/** 目录项 → 这一屏的目录形状（同上：逐字段，不 `as`）。 */
export function toCatalog(entry: ChannelManagementCatalogEntry): Catalog {
  return {
    type: entry.type,
    status: entry.status,
    reason: entry.reason,
    implemented: entry.implemented
  }
}

/**
 * `agents.listAgents` 的返回值收窄。这个口子还没被标上类型，所以这里**逐字段验**而不是
 * `as`——`as` 会把「字段没了」变成运行时的 `undefined`，编译期一声不响（那次重复频道的根因）。
 * 读不出代理列表时返回空数组，让「没有可选助手」如实显示，而不是把形状不明的数据画出来。
 */
export function readAgents(value: unknown): Agent[] {
  if (typeof value !== 'object' || value === null) return []
  // 只把 `unknown` 变成可按下标读的桶，再逐个字段验类型：这不是给返回值「宣布形状」，
  // 恰恰相反——少一个字段就在这一步被丢掉，而不是变成运行时的 undefined。
  const bucket = value as Record<string, unknown>
  const agents = bucket.agents
  if (!Array.isArray(agents)) return []
  return agents.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const fields = entry as Record<string, unknown>
    const id = fields.id
    const name = fields.name
    return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : []
  })
}

/**
 * `agents.getState()` 里的工作区列表 → 下拉能用的选项。
 *
 * 只收 `type === 'user'`：系统默认目录不是「一条工作区」，它由「不使用工作目录」表达。
 * 字段照样逐个验（那个口子还没标类型），少一个字段就丢掉这一条，而不是把 undefined 画进下拉。
 */
export function readWorkspaces(value: unknown): { id: string; name: string; path: string }[] {
  if (typeof value !== 'object' || value === null) return []
  const bucket = value as Record<string, unknown>
  const list = bucket.workspaces
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const fields = entry as Record<string, unknown>
    const { id, name, path, type } = fields
    if (type !== 'user') return []
    return typeof id === 'string' && typeof name === 'string' && typeof path === 'string'
      ? [{ id, name, path }]
      : []
  })
}
