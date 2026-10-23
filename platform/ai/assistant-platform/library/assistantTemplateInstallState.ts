import { createHash } from 'node:crypto'

export function hashAssistantPrompt(prompt: string): string {
  return createHash('sha256').update(prompt.trim(), 'utf8').digest('hex')
}
