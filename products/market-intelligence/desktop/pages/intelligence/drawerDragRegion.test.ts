import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const shellCss = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

describe('market-intelligence drawer drag regions', () => {
  it('marks every portaled antd drawer surface no-drag, not just the source drawer', () => {
    for (const selector of ['.ant-drawer-content-wrapper', '.ant-drawer-header', '.ant-drawer-close']) {
      const rule = shellCss.slice(shellCss.indexOf(selector))
      expect(rule.slice(0, 400)).toContain('-webkit-app-region: no-drag;')
    }
  })
})
