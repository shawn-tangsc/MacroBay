/**
 * 凭据字段的**唯一模型**：字段清单来自适配器描述符（`credentialFields`），这里不写任何平台名。
 *
 * 为什么单独成模块：以前新建/编辑弹层只有一个写死的 `bot_token` 输入框，于是 Slack（两把 token）、
 * QQ 与飞书（两组凭据）在界面上根本没有入口——读者能建频道却填不了凭据。字段清单本来就在
 * 描述符里，界面只是没读它。
 *
 * 两条语义：
 * - **新建**：描述符里的每一项都是必填；缺一项就不许提交，并指出缺的是哪一项；
 * - **编辑/轮换**：留空＝保持原值（旧值不可读，界面不能拿掩码回填），只填一项也是**一次有效保存**。
 */
export type CredentialFieldKey = 'bot_token' | 'app_token' | 'app_id' | 'client_secret' | 'app_secret'

export type CredentialWriteIntent = 'create' | 'edit'

export function credentialPayload(
  fields: readonly string[],
  values: Readonly<Record<string, string>>,
  intent: CredentialWriteIntent
): { payload: Record<string, string>; missing: string[] } {
  const payload: Record<string, string> = {}
  const missing: string[] = []
  for (const field of fields) {
    const value = (values[field] ?? '').trim()
    if (value.length === 0) {
      if (intent === 'create') missing.push(field)
      continue
    }
    payload[field] = value
  }
  return { payload, missing }
}
