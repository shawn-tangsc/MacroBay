import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8')
const [dark, light = ''] = css.split(':root[data-theme="light"]')

describe('UI token file', () => {
  it('defines --caution with the one agreed value in both theme blocks', () => {
    expect(dark).toMatch(/--caution:\s*#c48a1a;/)
    expect(light).toMatch(/--caution:\s*#a2691a;/)
  })

  it('defines the three metric sizes in both theme blocks', () => {
    for (const block of [dark, light]) {
      expect(block).toMatch(/--font-metric-sm:\s*24px;/)
      expect(block).toMatch(/--font-metric-md:\s*30px;/)
      expect(block).toMatch(/--font-metric-lg:\s*42px;/)
    }
  })

  it('keeps --warning as an alias of --caution, not a second yellow', () => {
    expect(dark).toMatch(/--warning:\s*var\(--caution\);/)
    expect(light).toMatch(/--warning:\s*var\(--caution\);/)
    expect(css).not.toMatch(/--warning:\s*#/)
  })

  it('has no colour fallback at the call site', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/var\([^)]*,\s*#/)
  })
})
