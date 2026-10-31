import { redactText } from '../../../secrets/redaction/redactText'

export type SanitizedChannelOutput = {
  text: string
  redacted: boolean
}

/**
 * 频道外发的最后一跳：返回形状归频道所有，模式表与替换逻辑只有 `platform/secrets/redaction` 一份。
 */
export function sanitizeChannelOutput(text: string): SanitizedChannelOutput {
  return redactText(text)
}
