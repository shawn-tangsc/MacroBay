import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { IntelligenceSourceHeader } from './IntelligenceSourceHeader'

const detail = {
  definition: { displayName: 'DeFiLlama Stablecoins', adapterType: 'rest-api-poller', executionMode: 'polling', readiness: 'live' },
  profile: {}, runtimeConfig: {}, health: {}
} as never
const labels = { runNow: 'Run now', refreshHealth: 'Refresh health', replay: 'Replay', adapter: 'Adapter', executionMode: 'Mode', sources: {}, adapters: {}, executionModes: {} } as never

describe('IntelligenceSourceHeader', () => {
  it('does not render a replay action when the selected source has no replay capability', () => {
    const markup = renderToStaticMarkup(<IntelligenceSourceHeader detail={detail} labels={labels} running={false} replaying={false} showReplay={false} onRunNow={vi.fn()} onRefreshHealth={vi.fn()} onReplay={vi.fn()} />)

    expect(markup).not.toContain('Replay')
  })

  it('keeps replay available for a generic source', () => {
    const markup = renderToStaticMarkup(<IntelligenceSourceHeader detail={detail} labels={labels} running={false} replaying={false} showReplay onRunNow={vi.fn()} onRefreshHealth={vi.fn()} onReplay={vi.fn()} />)

    expect(markup).toContain('Replay')
  })
})
