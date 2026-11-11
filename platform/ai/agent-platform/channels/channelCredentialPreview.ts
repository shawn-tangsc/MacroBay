/**
 * 凭据头尾掩码（需求：列表行要能看出「改成功了没有」）。
 *
 * 三条边界：
 * - **只在主进程算**：解出明文 → 切片 → 掩码，渲染层只收 `6050…xAA` 这种已截断串；
 * - **只给头尾**：头 4、尾 3，中间一个 `…`；没有完整值、没有复制入口、没有展开；
 * - **只在这一处出现**：日志、审计、错误提示里一律不许出现这个串。
 *
 * 为什么单独一个函数：掩码规则必须只有一份，界面与测试都读它；散在调用点就会出现
 * 「一处头 4 尾 3、一处头 6 尾 4」，用户看到的两个串对不上，反而更怀疑。
 */
import type { AgentChannelType } from '../schemas/channelSchemas'

import { channelAdapterDescriptor } from './channelAdapterDescriptors'
import { channelAdapterKeyForType } from './ChannelManagementPredicates'

export const CREDENTIAL_MASK_HEAD = 4
export const CREDENTIAL_MASK_TAIL = 3

export function maskCredentialValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  // 太短的值露头尾等于露全文：只留尾三位。
  if (trimmed.length <= CREDENTIAL_MASK_HEAD + CREDENTIAL_MASK_TAIL) return `…${trimmed.slice(-CREDENTIAL_MASK_TAIL)}`
  return `${trimmed.slice(0, CREDENTIAL_MASK_HEAD)}…${trimmed.slice(-CREDENTIAL_MASK_TAIL)}`
}

/**
 * 这个适配器存的是哪些字段：**只认描述符**（`credentialFields`），顺序即展示顺序。
 *
 * 以前这里另抄了一份按平台的表——两份清单一起漂移过一次（界面只显示 bot_token）。
 * 描述符是唯一出处：新增平台只改描述符，掩码、界面、提交三处自动跟上。
 */
export function credentialFieldsFor(type: string): readonly string[] {
  const key = channelAdapterKeyForType(type as AgentChannelType)
  return channelAdapterDescriptor(key).credentialFields
}

export type ChannelCredentialPreviews = Readonly<Record<string, string>>

/**
 * 读一次凭据并产出掩码表。解不开（vault 不可用、字段缺失）就跳过那个字段——
 * 少一格比给一个错的头尾更好，后者会让用户以为 token 变了。
 */
export async function readCredentialPreviews(
  vault: { get: (ref: string) => Promise<Record<string, string> | null> },
  input: { type: string; ref: string; secret?: Record<string, string> | null }
): Promise<ChannelCredentialPreviews> {
  const fields = credentialFieldsFor(input.type)
  if (fields.length === 0) return {}
  const secret = input.secret ?? await vault.get(input.ref).catch(() => null)
  if (!secret) return {}
  const previews: Record<string, string> = {}
  for (const field of fields) {
    const value = secret[field]
    if (typeof value === 'string' && value.trim().length > 0) previews[field] = maskCredentialValue(value)
  }
  return previews
}
