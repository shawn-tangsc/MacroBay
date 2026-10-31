/**
 * 没有 tokenizer 时的保守估算。中文约 1 字 1 token，其余语言约 3–4 字符 1 token。
 *
 * 两个系数是**导出常量**而不是散在函数里的魔数：估算必须偏大（宁可少留历史也不要撞窗口），
 * 而「偏大」这件事只能靠断言常量来证明，靠读代码证明不了。
 */
export const CJK_TOKENS_PER_CHAR = 1
export const OTHER_TOKENS_PER_CHAR = 1 / 3

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(CJK_PATTERN) ?? []).length
  const otherCount = text.length - cjkCount
  return Math.ceil(cjkCount * CJK_TOKENS_PER_CHAR + otherCount * OTHER_TOKENS_PER_CHAR)
}
