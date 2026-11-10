// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SettingsRow } from './SettingsRow'

describe('the optional meta slot and the two DOM-shape switches', () => {
  it('keeps today\'s default markup when neither switch is passed', () => {
    const html = renderToStaticMarkup(createElement(SettingsRow, {
      copyClassName: 'copy', label: 'Name', rowClassName: 'row'
    }, createElement('button', null, 'x')))
    expect(html).toBe('<div class="row"><span class="copy">Name</span><button>x</button></div>')
  })

  it('renders the copy element and the label element the caller asked for, with the meta on the first line', () => {
    const html = renderToStaticMarkup(createElement(SettingsRow, {
      copyClassName: 'copy', copyAs: 'div', label: 'Name', labelAs: 'strong',
      meta: createElement('span', { className: 'pill' }, 'ok'), rowClassName: 'row'
    }, createElement('button', null, 'x')))
    expect(html).toBe('<div class="row"><div class="copy"><strong>Name</strong><span class="pill">ok</span></div><button>x</button></div>')
  })

  it('allows only one call site for the shape switches, so settings rows do not split into two visual families', () => {
    const files = execFileSync('git', ['ls-files', '*.tsx', '*.ts'], { encoding: 'utf8' })
      .split('\n').filter((p) => p !== '' && !p.includes('.test.') && !p.endsWith('SettingsRow.tsx') && !p.endsWith('SettingField.tsx'))
    const callSites = files.filter((file) => {
      if (!existsSync(file)) return false
      const source = readFileSync(file, 'utf8')
      return /\b(?:copyAs|labelAs)\s*=/.test(source)
    })
    expect(callSites.length).toBeLessThanOrEqual(1)
  })
})
