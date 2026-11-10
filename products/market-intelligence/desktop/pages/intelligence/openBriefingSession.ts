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
  try {
    await input.selectSession(input.sessionId)
  } catch {
    return false
  }
  input.navigate()
  return true
}
