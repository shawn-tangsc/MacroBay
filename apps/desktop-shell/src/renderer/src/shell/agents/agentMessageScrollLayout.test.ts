import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

describe('agent message scroll layout', () => {
  it('keeps the message viewport as the only scrollable chat history container', () => {
    expect(readCssRule('.agent-chat-scroll')).toContain('overflow: hidden;')
    expect(readCssRule('.agent-chat-scroll')).not.toContain('overflow: auto;')
    expect(readCssRule('.agent-message-region-shell')).toContain('height: 100%;')
    expect(readCssRule('.agent-message-scroll-region')).toContain('height: 100%;')
    expect(readCssRule('.agent-message-scroll-region')).toContain('overflow: auto;')
  })
})

function readCssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))
  return match?.[0] ?? ''
}
