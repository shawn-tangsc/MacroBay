/**
 * 打开一版日报的编辑会话（E9）：先选中那条会话，再切到智能体对话页。
 *
 * 返回 `false` 表示**会话已经不在了**（选中被拒）——那时不跳转，行上就地一句「这条会话已经不在了」
 * （产品 §8 第 6 条）。选中与切换分开处理：选中失败是"会话没了"，而页面切换本身没有可失败的动作，
 * 把它混进同一个 `catch` 会让"页面切换"这种不可能失败的事替"会话没了"背锅。
 */
export async function openBriefingSession(input: Readonly<{
  sessionId: string
  selectSession: (sessionId: string) => Promise<unknown>
  navigate: () => void
}>): Promise<boolean> {
  let selected: unknown
  try {
    selected = await input.selectSession(input.sessionId)
  } catch {
    return false
  }
  // **按返回值判断，不按有没有抛**：选中一个不存在的 id 时，存储返回的是原状态（没有任何异常），
  // 只 catch 异常就会把读者导航进一个没选中任何会话的页面。`activeSessionId` 就是那条会话才算成功；
  // 返回形状读不出（空、null、没有这个字段）一律当没打开——宁可说"会话不在了"，也不把人送进空页。
  if (!isRecord(selected) || selected.activeSessionId !== input.sessionId) return false
  input.navigate()
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
