import { useState } from 'react'
import { Activity } from 'lucide-react'
import { Alert, Button, Drawer, Select } from 'antd'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import type { ConnectionCheckApiKeyOption } from './modelProviderConnectionCheck'
import {
  buildProviderRuntimeCheckDisplay,
  type ProviderRuntimeCheckDisplayLabels
} from './providerRuntimeCheckDisplay'
import { isNetworkProviderRuntimeCheckReason } from './providerRuntimeCheckReason'
import {
  ProviderConnectionCheckEnvironmentBlock,
  type ProviderConnectionCheckEnvironment
} from './ProviderConnectionCheckEnvironmentBlock'

export type ProviderConnectionCheckResult = {
  ok: boolean
  message: string
  report?: ProviderRuntimeCheckReport
}

type ProviderConnectionCheckLabels = {
  title: string
  model: string
  apiKey: string
  cancel: string
  start: string
  noModels: string
  noApiKeys: string
  /** PLAT-61：抽屉顶部状态条（启用状态 + 就地启用）。 */
  providerStatus: string
  statusEnabled: string
  statusDisabled: string
  enableProvider: string
  detailPrefix: string
  environment: string
  proxy: string
  proxyDirect: string
  proxySystem: string
  proxyCustom: string
  targetHost: string
  networkDiagnosis: string
  networkDiagnosisNone: string
  proxyNote: string
  networkFailureHint: (mode: string) => string
  customProxyFailureHint: (host: string) => string
  openProxySettings: string
  gatewayDisabledHint: string
  enableModelGateway: string
  retry: string
  runtimeLanes: ProviderRuntimeCheckDisplayLabels
}

type ProviderConnectionCheckDrawerProps = {
  open: boolean
  models: ModelDefinition[]
  apiKeyOptions: ConnectionCheckApiKeyOption[]
  selectedModelId: string
  selectedApiKeyOptionId: string
  isSubmitting: boolean
  result: ProviderConnectionCheckResult | null
  labels: ProviderConnectionCheckLabels
  /** 当前供应商启用状态（诊断可用性：先告诉用户「是不是根本没启用」）。 */
  providerEnabled: boolean
  providerName: string
  hasApiKey: boolean
  environment: ProviderConnectionCheckEnvironment
  onEnableProvider: () => void
  /** 「去设置代理」：只跳转（不就地改设置）。 */
  onOpenProxySettings: () => void
  /** 「开启网关」：复用既有 setModelGatewayEnabled，成功后自动重跑检查。 */
  onEnableModelGateway: () => void
  onClose: () => void
  onModelChange: (modelId: string) => void
  onApiKeyOptionChange: (optionId: string) => void
  onStart: () => void
}

export function ProviderConnectionCheckDrawer({
  open,
  models,
  apiKeyOptions,
  selectedModelId,
  selectedApiKeyOptionId,
  isSubmitting,
  result,
  labels,
  providerEnabled,
  providerName,
  hasApiKey,
  environment,
  onEnableProvider,
  onOpenProxySettings,
  onEnableModelGateway,
  onClose,
  onModelChange,
  onApiKeyOptionChange,
  onStart
}: ProviderConnectionCheckDrawerProps): React.ReactElement {
  const hasModels = models.length > 0
  const hasApiKeys = apiKeyOptions.length > 0
  const [diagnosisOpen, setDiagnosisOpen] = useState(false)
  const display = result?.report
    ? buildProviderRuntimeCheckDisplay(result.report, labels.runtimeLanes, { providerEnabled, hasApiKey })
    : null
  const networkDiagnoses = display
    ? [...new Set(display.lanes
        .filter((lane) => isNetworkProviderRuntimeCheckReason(lane.reasonCode) && lane.reason !== null)
        .map((lane) => lane.reason as string))]
    : []
  // 网络类失败 ⇒ 按代理模式给可操作提示（不改默认值、不就地改设置）。

  return (
    <Drawer
      className="model-drawer connection-check-drawer"
      title={labels.title}
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      footer={
        <div className="drawer-actions drawer-actions-split">
          <Button className="ant-secondary-button" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button
            className="ant-primary-button"
            icon={<Activity size={14} />}
            loading={isSubmitting}
            disabled={!hasModels || !hasApiKeys || isSubmitting}
            onClick={onStart}>
            {labels.start}
          </Button>
        </div>
      }>
      <div className="connection-check-form">
        <div
          className={providerEnabled ? 'connection-check-provider-status enabled' : 'connection-check-provider-status'}
          data-connection-check-provider-status
          data-provider-enabled={providerEnabled ? 'true' : 'false'}>
          <span className="connection-check-provider-status-copy">
            <span>{labels.providerStatus} · {providerName}</span>
            <strong>{providerEnabled ? labels.statusEnabled : labels.statusDisabled}</strong>
          </span>
          {providerEnabled ? null : (
            <button
              type="button"
              className="connection-check-enable-provider"
              data-connection-check-enable
              disabled={isSubmitting}
              onClick={onEnableProvider}>
              {labels.enableProvider}
            </button>
          )}
        </div>

        <label className="drawer-form-field">
          <span>{labels.model}</span>
          {hasModels ? (
            <Select
              value={selectedModelId}
              onChange={onModelChange}
              options={models.map((model) => ({
                value: model.id,
                label: (
                  <span className="connection-check-option">
                    <strong>{model.name}</strong>
                    <small>{model.id}</small>
                  </span>
                )
              }))}
            />
          ) : (
            <div className="connection-check-empty">{labels.noModels}</div>
          )}
        </label>

        <label className="drawer-form-field">
          <span>{labels.apiKey}</span>
          {hasApiKeys ? (
            <Select
              value={selectedApiKeyOptionId}
              onChange={onApiKeyOptionChange}
              options={apiKeyOptions.map((option) => ({
                value: option.id,
                label: <span className="connection-check-secret">{option.label}</span>
              }))}
            />
          ) : (
            <div className="connection-check-empty">{labels.noApiKeys}</div>
          )}
        </label>

        {display ? (
          <div className="connection-check-runtime-report" data-testid="provider-runtime-check-report">
            <Alert
              className="connection-check-result"
              type={display.overallTone === 'success' ? 'success' : display.overallTone === 'warning' ? 'warning' : 'error'}
              message={display.overallMessage}
              showIcon
            />
            <div className="connection-check-runtime-lanes">
              {display.lanes.map((lane) => (
                <div
                  key={lane.key}
                  className={`connection-check-runtime-lane tone-${lane.tone}`}
                  data-runtime-lane={lane.key}>
                  <strong>{lane.title}</strong>
                  <span className="connection-check-lane-reason" data-lane-reason>
                    {lane.reason ?? lane.summary}
                  </span>
                  {lane.detail !== null ? (
                    <small className="connection-check-lane-detail" data-lane-detail>
                      {labels.detailPrefix}
                      {lane.detail}
                    </small>
                  ) : null}
                  {lane.hint !== null ? (
                    <small className="connection-check-lane-hint" data-lane-hint>
                      {lane.hint}
                    </small>
                  ) : null}
                  {lane.action === 'enable-gateway' ? (
                    <button
                      type="button"
                      className="connection-check-lane-action"
                      data-enable-model-gateway
                      disabled={isSubmitting}
                      onClick={onEnableModelGateway}>
                      {labels.enableModelGateway}
                    </button>
                  ) : null}
                  {lane.action === 'retry' ? (
                    <button
                      type="button"
                      className="connection-check-lane-action"
                      data-retry-runtime-check
                      disabled={isSubmitting}
                      onClick={onStart}>
                      {labels.retry}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : result ? (
          <Alert
            className="connection-check-result"
            type={result.ok ? 'success' : 'error'}
            message={result.message}
            showIcon
          />
        ) : null}

        <ProviderConnectionCheckEnvironmentBlock
          labels={labels}
          environment={environment}
          networkDiagnoses={networkDiagnoses}
          onOpenProxySettings={onOpenProxySettings}
        />
      </div>
    </Drawer>
  )
}
