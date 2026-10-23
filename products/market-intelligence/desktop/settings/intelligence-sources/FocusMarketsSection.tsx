import { useState } from 'react'
import { Checkbox, Button } from 'antd'
import { SlidersHorizontal } from 'lucide-react'

import type { IntelligenceFocusMarket } from '../../../service/intelligence/schema/intelligenceSource'

export function FocusMarketsSection(props: {
  defaultFocusMarkets: IntelligenceFocusMarket[]
  enabledFocusMarkets: IntelligenceFocusMarket[]
  saving: boolean
  labels: {
    title: string
    description: string
    defaultSummary: string
    customize: string
    customizeDone: string
    markets: Record<IntelligenceFocusMarket, string>
    saving: string
  }
  groupLabels: {
    globalMacro: string
    digitalAssets: string
  }
  onChange: (enabledFocusMarkets: IntelligenceFocusMarket[]) => void
}): React.ReactElement {
  const [customizing, setCustomizing] = useState(false)
  const enabled = new Set(props.enabledFocusMarkets)
  const activeMarketIds: IntelligenceFocusMarket[] = ['global-macro', 'digital-assets']
  const sourceDefaultMarketIds = props.defaultFocusMarkets.filter((marketId) => activeMarketIds.includes(marketId))
  const selectedActiveMarketIds = sourceDefaultMarketIds.length > 0 ? sourceDefaultMarketIds : activeMarketIds
  const groups: Array<{
    id: 'globalMacro' | 'digitalAssets'
    marketIds: IntelligenceFocusMarket[]
  }> = [
    { id: 'globalMacro', marketIds: ['global-macro'] },
    { id: 'digitalAssets', marketIds: ['digital-assets'] }
  ]

  return (
    <section className="intelligence-section intelligence-focus-markets-section">
      <div className="intelligence-section-header">
        <div className="intelligence-section-title">{props.labels.title}</div>
        {props.saving ? <small className="intelligence-section-status">{props.labels.saving}</small> : null}
      </div>
      <p className="intelligence-source-note">{props.labels.description}</p>
      <div className="intelligence-focus-market-summary">
        <div className="intelligence-focus-market-defaults">
          <span className="intelligence-focus-market-default-label">{props.labels.defaultSummary}</span>
          <span className="intelligence-focus-market-chip-list">
            {selectedActiveMarketIds.map((marketId) => (
              <span key={marketId} className="intelligence-focus-market-chip">
                {props.labels.markets[marketId]}
              </span>
            ))}
          </span>
        </div>
        <Button
          className="ant-secondary-button"
          size="small"
          icon={<SlidersHorizontal size={14} />}
          onClick={() => setCustomizing((current) => !current)}
        >
          {customizing ? props.labels.customizeDone : props.labels.customize}
        </Button>
      </div>
      {customizing ? (
        <div className="intelligence-focus-market-groups">
          {groups.map((group) => (
            <div key={group.id} className="intelligence-focus-market-group">
              <div className="intelligence-focus-market-group-title">{props.groupLabels[group.id]}</div>
              <div className="intelligence-focus-market-grid">
                {group.marketIds.map((marketId) => {
                  return (
                    <label key={marketId} className="intelligence-focus-market-tile">
                      <Checkbox
                        checked={enabled.has(marketId)}
                        disabled={props.saving}
                        onChange={(event) => {
                          const next = new Set(activeMarketIds.filter((activeMarketId) => enabled.has(activeMarketId)))
                          if (event.target.checked) {
                            next.add(marketId)
                          } else {
                            next.delete(marketId)
                          }
                          props.onChange([...next])
                        }}
                      />
                      <span className="intelligence-focus-market-copy">
                        <strong>{props.labels.markets[marketId]}</strong>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
