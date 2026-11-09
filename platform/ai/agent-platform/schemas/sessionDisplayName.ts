/**
 * 会话在界面上该显示成什么名字；`null` 表示**这条会话没有名字可显示**，由调用方给中性文案。
 *
 * 名字是建会话时落成的快照，但**身份不是名字**：自动会话最初直接把运行 id 写进了 `name`
 * （`c874bd2` 起、`4495b0f` 才改成模块名），那批行至今还存着 `mi-ar-<uuid>`；列表照 `name`
 * 原样渲染，读者就看到我们的账本编号。展示层一律经过这里。
 *
 * 判据是**结构相等**，不是前缀或正则：名字去空白后为空，或恰好等于这条会话自己的身份字段
 * （`id` / `originRef` / `traceId`），就不算名字。编号的形状以后变了，这条判据仍然成立。
 */
export function displaySessionName(
  session: Readonly<{ name?: string | null; id?: string; originRef?: string; traceId?: string }>
): string | null {
  const name = session.name?.trim() ?? ''
  if (name === '') return null
  const identities = [session.originRef, session.traceId, session.id]
  return identities.some((identity) => (identity?.trim() ?? '') === name) ? null : name
}
