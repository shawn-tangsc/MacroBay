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

/**
 * 这一行常显的四态（产品 §3.7）：未配置 / 已保存待验证 / 失败带原因 / 本次会话内通过。
 *
 * 刷新后回到「已保存待验证」是准确的：`lastValidatedAt` 重启后会退回保存密钥的时间
 * （`intelligenceCredentialStore.ts:119`），所以这里**不写「上次验证于」**——那会在从未验证过
 * 的情况下显示验证过。
 */
export type VerificationLineTone = 'info' | 'success' | 'error'

export function credentialVerificationLine(input: Readonly<{
  show: boolean
  resolveText: (key: string) => string
  /** `undefined` = 凭据状态还没读回来：先不画，免得先说「没配」再说「已保存」。 */
  hasCredential: boolean | undefined
  feedback: ConnectionFeedback | undefined
}>): Readonly<{ message: string; tone: VerificationLineTone }> | undefined {
  const { show, resolveText, hasCredential, feedback } = input
  /* Only the provider that declares "this build only verifies the key" gets this line. One marker,
     two consequences; no `providerId` special case inside a shared component. */
  if (!show || hasCredential === undefined) return undefined
  if (!hasCredential) {
    return { message: resolveText('settings.intelligenceSources.syncRun.failureCodes.credential-missing'), tone: 'info' }
  }
  if (feedback?.kind === 'succeeded') {
    return { message: resolveText('settings.intelligenceSources.credentialVerification.succeeded'), tone: 'success' }
  }
  if (feedback?.kind === 'failed') {
    const reason = failureSentenceOf(resolveText, feedback.failureCode)
      ?? resolveText('settings.intelligenceSources.connectionFailed')
    return {
      message: resolveText('settings.intelligenceSources.credentialVerification.failed').replace('{reason}', reason),
      tone: 'error'
    }
  }
  return { message: resolveText('settings.intelligenceSources.credentialVerification.savedUnverified'), tone: 'info' }
}

export function failureSentenceOf(
  resolveText: (key: string) => string,
  code: string | undefined
): string | undefined {
  if (code === undefined) return undefined
  const sentence = resolveText(`settings.intelligenceSources.syncRun.failureCodes.${code}`)
  return sentence === '' ? undefined : sentence
}
