const REDACTED = '[REDACTED]'

/**
 * 全平台唯一的凭据模式表：频道外发（`sanitizeChannelOutput`）与日志落盘（`app.log`）都读这一份。
 * 迁移自 `platform/ai/agent-platform/channels/OutputSanitizer.ts`，模式、顺序、flags 原样保留；
 * 要加模式只在这里加，任何调用方都不许自带「补充模式」。
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'pem-private-key',
    re: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g
  },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: 'aws-secret-key',
    re: /(?<=aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+=]{40}/gi
  },
  { name: 'bearer-token', re: /Bearer\s+[A-Za-z0-9_\-.~+/]+=*(?:\s|$)/g },
  {
    name: 'key-value-secret',
    re: /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|password|passwd|token|access[_-]?token|client[_-]?secret)\s*[=:]\s*['"]?([^\s'"]{16,})['"]?/gi
  },
  { name: 'github-pat', re: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  {
    name: 'ssh-key-content',
    re: /\bAAAA(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{100,}={0,2}\b/g
  }
]

export type RedactedText = {
  text: string
  redacted: boolean
}

/** 把命中的凭据替换成 `[REDACTED]`，并报告这次是否真的改写过文本。 */
export function redactText(text: string): RedactedText {
  let result = text
  let redacted = false

  for (const { re } of SECRET_PATTERNS) {
    re.lastIndex = 0
    if (!re.test(result)) {
      continue
    }
    re.lastIndex = 0
    result = result.replace(re, REDACTED)
    redacted = true
  }

  return {
    text: result,
    redacted
  }
}
