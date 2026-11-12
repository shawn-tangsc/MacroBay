/**
 * 「测试连接」的结果 → 屏幕上那一句。
 *
 * 四种失败必须在界面上分得开（密钥不对 / 额度 / 网络 / 形状），所以结果里保留 `failureCode`，
 * 由文案表 `failureCodes` 给句子。认不出的码退回通用失败句——**不回退成码名**，读屏用户不该
 * 听到内部代号，也不该为没人发的码留一条死文案。
 */
export type ConnectionFeedback =
  | Readonly<{ kind: 'succeeded' }>
  | Readonly<{ kind: 'unsupported' }>
  | Readonly<{ kind: 'failed'; failureCode?: string }>

export function failureSentenceOf(
  resolveText: (key: string) => string,
  code: string | undefined
): string | undefined {
  if (code === undefined) return undefined
  const sentence = resolveText(`settings.intelligenceSources.failureCodes.${code}`)
  return sentence === '' ? undefined : sentence
}
