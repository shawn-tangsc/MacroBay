import { RefreshCw, Play, RotateCcw } from 'lucide-react'
import { Button } from 'antd'

import type { SafeIntelligenceSourceDetailView } from '../../../service/intelligence/schema/intelligenceSourcesContracts'
import type { IntelligenceSourcesText } from '../../shared/i18n/productText'
import {
  intelligenceAdapterLabel,
  intelligenceExecutionModeLabel,
  intelligenceSourceDisplayName
} from './intelligenceSourceDisplay'

export function IntelligenceSourceHeader(props: {
  detail: SafeIntelligenceSourceDetailView
  labels: {
    runNow: string
    refreshHealth: string
    replay: string
    adapter: string
    executionMode: string
    sources: IntelligenceSourcesText['sources']
    adapters: IntelligenceSourcesText['adapters']
    executionModes: IntelligenceSourcesText['executionModes']
  }
  running: boolean
  replaying: boolean
  runNowDisabled?: boolean
  replayDisabled?: boolean
  showReplay?: boolean
  runNowHighlighted?: boolean
  onRunNow: () => void
  onRefreshHealth: () => void
  onReplay: () => void
}): React.ReactElement {
  const { detail } = props
  const displayName = intelligenceSourceDisplayName(detail.definition, props.labels)
  const readiness = detail.definition.readiness ?? 'live'
  return (
    <div className="intelligence-source-header">
      <span className="intelligence-source-avatar" data-size="large" data-readiness={readiness} aria-hidden="true">
        {displayName.slice(0, 1).toUpperCase()}
      </span>
      <div className="intelligence-source-header-copy">
        <strong>{displayName}</strong>
        <div className="intelligence-source-header-meta">
          <span className="intelligence-source-meta-pill">
            {props.labels.adapter}: {intelligenceAdapterLabel(detail.definition.adapterType, props.labels)}
          </span>
          <span className="intelligence-source-meta-pill">
            {props.labels.executionMode}: {intelligenceExecutionModeLabel(detail.definition.executionMode, props.labels)}
          </span>
        </div>
      </div>
      <div className="intelligence-actions">
        <Button
          className={`ant-secondary-button${props.runNowHighlighted ? ' intelligence-run-now-highlight' : ''}`}
          size="small"
          icon={<Play size={14} />}
          loading={props.running}
          disabled={props.runNowDisabled}
          onClick={props.onRunNow}
        >
          {props.labels.runNow}
        </Button>
        <Button className="ant-secondary-button" size="small" icon={<RefreshCw size={14} />} onClick={props.onRefreshHealth}>
          {props.labels.refreshHealth}
        </Button>
        {props.showReplay !== false ? <Button
          className="ant-secondary-button"
          size="small"
          icon={<RotateCcw size={14} />}
          loading={props.replaying}
          disabled={props.replayDisabled}
          onClick={props.onReplay}
        >
          {props.labels.replay}
        </Button> : null}
      </div>
    </div>
  )
}
