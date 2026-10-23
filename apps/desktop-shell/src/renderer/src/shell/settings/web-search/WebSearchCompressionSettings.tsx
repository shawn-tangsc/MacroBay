import { InputNumber, Select } from 'antd'

import type { WebSearchCompressionConfig } from '@platform/ai/web-search/contracts/webSearchContracts'
import type { PlatformText } from '../../../i18n/platformText'
import { WebSearchFormRow } from './WebSearchFormGrid'

type WebSearchCompressionSettingsProps = {
  labels: PlatformText['webSearch']
  value: WebSearchCompressionConfig
  onChange: (value: WebSearchCompressionConfig) => void
}

/** R4 + R7：压缩设置走统一三列网格，并给出一句「效果」预览。 */
export function WebSearchCompressionSettings({
  labels,
  value,
  onChange
}: WebSearchCompressionSettingsProps): React.ReactElement {
  const unit = value.cutoffUnit === 'char' ? labels.cutoffChars : labels.cutoffTokens

  return (
    <section className="web-search-settings-card">
      <div className="section-heading">
        <span>{labels.compression}</span>
      </div>
      <WebSearchFormRow label={labels.compressionMethod} hint={labels.compressionMethodHint}>
        <Select
          value={value.method}
          options={[
            { value: 'none', label: labels.compressionNone },
            { value: 'cutoff', label: labels.compressionCutoff },
            { value: 'rag', label: labels.compressionRagDeferred, disabled: true }
          ]}
          onChange={(method) => onChange({ ...value, method })}
        />
      </WebSearchFormRow>
      <WebSearchFormRow label={labels.cutoffLimit} hint={labels.cutoffLimitHint}>
        <div className="web-search-inline-control">
          <InputNumber
            className="web-search-input-narrow"
            min={1}
            max={20_000}
            value={value.cutoffLimit}
            onChange={(cutoffLimit) =>
              onChange({ ...value, cutoffLimit: typeof cutoffLimit === 'number' ? cutoffLimit : value.cutoffLimit })
            }
          />
          <Select
            className="web-search-unit-select"
            value={value.cutoffUnit}
            options={[
              { value: 'char', label: labels.cutoffChars },
              { value: 'token', label: labels.cutoffTokens }
            ]}
            onChange={(cutoffUnit) => onChange({ ...value, cutoffUnit })}
          />
        </div>
      </WebSearchFormRow>
      <WebSearchFormRow wide>
        <p className="web-search-effect">{labels.compressionEffect(value.cutoffLimit, unit)}</p>
      </WebSearchFormRow>
    </section>
  )
}
