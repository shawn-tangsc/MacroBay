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
