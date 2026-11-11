import { describe, expect, it } from 'vitest'

import { decideCellRead, dashboardCellId } from './dashboardCellEnabled'

/**
 * 一处读点的四种结局。三句显示文案与它们一一对应，混一句就是把「没选」「源停用」「暂时读不到」
 * 说成同一件事——读者据此决定去设置还是在等。
 */
describe('decideCellRead', () => {
  const usd = { moduleId: 'quotes', cellKey: 'usd' }
  const enabledSources = {
    'realmarketapi-market': { enabled: true, hasCredential: true, requiresCredential: true },
    'twelve-data-market': { enabled: true, hasCredential: true, requiresCredential: true }
  }

  it('does not read a cell the reader switched off', () => {
    const decision = decideCellRead({
      ...usd,
      cells: { [dashboardCellId('quotes', 'usd')]: false },
      selections: {},
      sources: enabledSources
    })
    expect(decision).toEqual({ kind: 'not-enabled' })
  })

  it('reads the default primary source when no source was chosen explicitly', () => {
    const decision = decideCellRead({ ...usd, cells: {}, selections: {}, sources: enabledSources })
    expect(decision).toEqual({ kind: 'read', sourceId: 'realmarketapi-market', explicit: false })
  })

  it('reads exactly the source the reader chose, and marks it explicit', () => {
    const decision = decideCellRead({
      ...usd,
      cells: {},
      selections: { [dashboardCellId('quotes', 'usd')]: 'twelve-data-market' },
      sources: enabledSources
    })
    expect(decision).toEqual({ kind: 'read', sourceId: 'twelve-data-market', explicit: true })
  })

  it('says the cell is not enabled when the chosen source is switched off', () => {
    const decision = decideCellRead({
      ...usd,
      cells: {},
      selections: { [dashboardCellId('quotes', 'usd')]: 'twelve-data-market' },
      sources: {
        'realmarketapi-market': { enabled: true, hasCredential: true, requiresCredential: true },
        'twelve-data-market': { enabled: false, hasCredential: true, requiresCredential: true }
      }
    })
    expect(decision).toEqual({
      kind: 'source-disabled', sourceId: 'twelve-data-market', hasCredential: true, requiresCredential: true
    })
  })

  it('keeps “turned off” and “never configured” apart through hasCredential', () => {
    // 读者关掉的源与从没配过 Key 的源，卡片的句子和动作不同；决策层把凭据事实一起带出去，
    // 渲染层不必再读一次源表，也不会把两者压成一句。
    const decision = decideCellRead({
      ...usd,
      cells: {},
      selections: {},
      sources: {
        'realmarketapi-market': { enabled: false, hasCredential: false, requiresCredential: true },
        'twelve-data-market': { enabled: true, hasCredential: true, requiresCredential: true }
      }
    })
    expect(decision).toEqual({
      kind: 'source-disabled', sourceId: 'realmarketapi-market', hasCredential: false, requiresCredential: true
    })
  })

  it('treats an unreadable source table as unknown instead of assuming enabled', () => {
    expect(decideCellRead({ ...usd, cells: {}, selections: {}, sources: undefined }))
      .toEqual({ kind: 'source-unknown', sourceId: 'realmarketapi-market' })
    // 表读到了、但这个源不在表里：同样是未知，不是「启用」。
    expect(decideCellRead({ ...usd, cells: {}, selections: {}, sources: {} }))
      .toEqual({ kind: 'source-unknown', sourceId: 'realmarketapi-market' })
  })

  it('keeps the default primary when a stored choice names a source outside the cell', () => {
    // 存库里残留了一个不在这格范围内的源：不拿它去读，也不当成停用——按默认主源走。
    const decision = decideCellRead({
      ...usd,
      cells: {},
      selections: { [dashboardCellId('quotes', 'usd')]: 'some-removed-source' },
      sources: enabledSources
    })
    expect(decision).toEqual({ kind: 'read', sourceId: 'realmarketapi-market', explicit: false })
  })
})
