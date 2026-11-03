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
export const CREDENTIAL_MASK_HEAD = 4
export const CREDENTIAL_MASK_TAIL = 3

export function maskCredentialValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  // 太短的值露头尾等于露全文：只留尾三位。
  if (trimmed.length <= CREDENTIAL_MASK_HEAD + CREDENTIAL_MASK_TAIL) return `…${trimmed.slice(-CREDENTIAL_MASK_TAIL)}`
  return `${trimmed.slice(0, CREDENTIAL_MASK_HEAD)}…${trimmed.slice(-CREDENTIAL_MASK_TAIL)}`
}

/** 每个适配器存的是哪些字段：与凭据交接时的形状一致，顺序即展示顺序。 */
export const channelCredentialFields: Readonly<Record<string, readonly string[]>> = Object.freeze({
  telegram: ['bot_token'],
  slack: ['bot_token', 'app_token'],
  lark: ['app_id', 'app_secret'],
  feishu: ['app_id', 'app_secret'],
  qq: ['app_id', 'client_secret'],
  discord: ['bot_token'],
  wechat: []
})

export type ChannelCredentialPreviews = Readonly<Record<string, string>>

/**
 * 读一次凭据并产出掩码表。解不开（vault 不可用、字段缺失）就跳过那个字段——
 * 少一格比给一个错的头尾更好，后者会让用户以为 token 变了。
 */
export async function readCredentialPreviews(
  vault: { get: (ref: string) => Promise<Record<string, string> | null> },
  input: { type: string; ref: string; secret?: Record<string, string> | null }
): Promise<ChannelCredentialPreviews> {
  const fields = channelCredentialFields[input.type] ?? []
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
