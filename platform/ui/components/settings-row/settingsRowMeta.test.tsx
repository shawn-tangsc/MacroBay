// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SettingsRow } from './SettingsRow'
import { SettingField } from '../../../../products/market-intelligence/desktop/shared/settings/SettingField'

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

  it('allows only one call site for the shape switches (copyAs / labelAs / switchSize), so settings rows do not split into two visual families', () => {
    const files = execFileSync('git', ['ls-files', '*.tsx', '*.ts'], { encoding: 'utf8' })
      .split('\n').filter((p) => p !== '' && !p.includes('.test.') && !p.endsWith('SettingsRow.tsx') && !p.endsWith('SettingField.tsx'))
    const callSites = files.filter((file) => {
      if (!existsSync(file)) return false
      const source = readFileSync(file, 'utf8')
      return /\b(?:copyAs|labelAs|switchSize)\s*=/.test(source)
    })
    expect(callSites.length).toBeLessThanOrEqual(1)
  })
})

describe('the third shape switch: the switch size', () => {
  const descriptor = {
    key: 'setting:probe.switch', menu: 'sources', surfaces: ['settings'], level: 'product',
    field: { kind: 'switch' }, read: { command: 'x', select: () => true },
    write: { kind: 'value', command: 'x', toPayload: () => ({}) }, availability: 'live'
  } as never

  it('keeps the default size when switchSize is not passed', () => {
    const html = renderToStaticMarkup(createElement(SettingField, {
      descriptor, view: {}, value: true, rowClassName: 'row', copyClassName: 'copy',
      resolveText: () => '', resolveOptionLabel: () => ''
    } as never))
    expect(html).not.toContain('ant-switch-small')
  })

  it('renders the small switch only when the caller asks for it', () => {
    const html = renderToStaticMarkup(createElement(SettingField, {
      descriptor, view: {}, value: true, rowClassName: 'row', copyClassName: 'copy',
      switchSize: 'small', resolveText: () => '', resolveOptionLabel: () => ''
    } as never))
    expect(html).toContain('ant-switch-small')
  })
})
