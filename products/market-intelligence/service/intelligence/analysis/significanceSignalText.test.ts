import { expect, it } from 'vitest'
import { describeSignificanceSignal, describeSignificanceSignals } from './significanceSignalText'
import type { SignificanceSignal } from './significanceChangeMatcher'

const signal = (overrides: Partial<SignificanceSignal> = {}): SignificanceSignal => ({
  kind: 'actual-changed', eventKey: 'US.CPI.RELEASE.2026-M09', titleKey: 'cpi', metric: 'actual', importance: 'high',
  previousValue: '3.1%', value: '3.2%', ...overrides
})

it('names the event and the metric instead of the machine keys', () => {
  const text = describeSignificanceSignal(signal())
  expect(text).toContain('消费者物价指数（CPI）')
  expect(text).toContain('实际值')
  expect(text).toContain('3.1%')
  expect(text).toContain('3.2%')
  // No raw identifiers may reach a published conclusion.
  for (const raw of ['cpi', 'actual-changed', 'US.CPI.RELEASE.2026-M09', 'consensus']) expect(text).not.toContain(raw)
})

it('renders a consensus change through the readable metric name', () => {
  expect(describeSignificanceSignal(signal({ kind: 'consensus-changed', metric: 'consensus' }))).toContain('市场预期')
})

it('renders an addition without inventing a previous value', () => {
  const text = describeSignificanceSignal(signal({ kind: 'event-added', metric: 'event-name', previousValue: null, value: 'cpi' }))
  expect(text).toContain('新增')
  expect(text).not.toContain('null')
})

it('falls back to the key when a name is unknown, and lists in order', () => {
  const unknown = describeSignificanceSignal(signal({ titleKey: 'brand-new-indicator' }))
  expect(unknown).toContain('brand-new-indicator')
  expect(describeSignificanceSignals([signal(), signal({ kind: 'previous-revised', metric: 'previous' })]))
    .toEqual([describeSignificanceSignal(signal()), describeSignificanceSignal(signal({ kind: 'previous-revised', metric: 'previous' }))])
  expect(describeSignificanceSignals([])).toEqual([])
})

it('says a provider surprise is a provider observation, never an official value', () => {
  const text = describeSignificanceSignal(signal({ kind: 'provider-surprise', titleKey: '9月核心生产者物价指数(年率)', value: '5.0%', previousValue: null, expectedValue: '4.4%' }))
  // 实际值与预期都要在句子里：只说实际值等于没说出意外在哪。
  expect(text).toContain('5.0%')
  expect(text).toContain('4.4%')
  // 事实与文案都不得把它说成官方来源（设计 146 §4 第 3 条）。
  expect(text).toContain('provider')
  expect(text).toContain('未验证')
  for (const raw of ['provider-surprise', 'market-observation', 'actual', 'consensus']) expect(text).not.toContain(raw)
})

it('does not invent an expectation when the provider published none', () => {
  const text = describeSignificanceSignal(signal({ kind: 'provider-surprise', titleKey: '某指标', value: '5.0%', previousValue: null, expectedValue: null }))
  expect(text).toContain('5.0%')
  expect(text).not.toContain('null')
})
