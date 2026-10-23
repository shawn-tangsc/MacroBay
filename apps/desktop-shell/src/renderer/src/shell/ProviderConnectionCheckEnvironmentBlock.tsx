import { useState } from 'react'

import type { ProxyMode } from '@platform/settings/schema/appSettings'

import { sanitizeProxyAddressForDisplay } from './proxyAddressDisplay'

/**
 * PLAT-61：连接检查抽屉底部的**只读环境块**。
 *
 * 说明「浏览器能打开 ≠ 应用能连」：应用请求走平台代理。网络类失败时按代理模式给可操作提示
 * （非 custom ⇒ 引导去设置代理；custom ⇒ 提示该代理仍失败、可能按域名分流）。
 * 只展示 host:port，绝不展示代理账号密码。
 */
export type ProviderConnectionCheckEnvironment = {
  proxyMode: ProxyMode
  proxyUrl: string
  targetHost: string
}

export type ProviderConnectionCheckEnvironmentLabels = {
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
}

type ProviderConnectionCheckEnvironmentBlockProps = {
  labels: ProviderConnectionCheckEnvironmentLabels
  environment: ProviderConnectionCheckEnvironment
  /** 已归类的网络类失败（本地化后的句子）；空数组 = 无网络类失败。 */
  networkDiagnoses: readonly string[]
  onOpenProxySettings: () => void
}

export function ProviderConnectionCheckEnvironmentBlock({
  labels,
  environment,
  networkDiagnoses,
  onOpenProxySettings
}: ProviderConnectionCheckEnvironmentBlockProps): React.ReactElement {
  const [diagnosisOpen, setDiagnosisOpen] = useState(false)
  const proxyAddress = formatProxyAddress(environment)
  const proxyModeLabel = environment.proxyMode === 'none'
    ? labels.proxyDirect
    : environment.proxyMode === 'system'
      ? labels.proxySystem
      : `${labels.proxyCustom}${proxyAddress === null ? '' : ` ${proxyAddress}`}`
  const hasNetworkFailure = networkDiagnoses.length > 0
  const showProxyHint = environment.proxyMode !== 'custom' && hasNetworkFailure
  const showCustomProxyHint = environment.proxyMode === 'custom' && hasNetworkFailure

  return (
    <section className="connection-check-environment" data-connection-check-environment>
      <strong>{labels.environment}</strong>
      <div className="connection-check-env-row" data-env-proxy>
        <span>{labels.proxy}</span>
        <span data-env-proxy-mode={environment.proxyMode}>{proxyModeLabel}</span>
      </div>
      <div className="connection-check-env-row" data-env-host>
        <span>{labels.targetHost}</span>
        <span>{environment.targetHost || '—'}</span>
      </div>
      <button
        type="button"
        className="connection-check-env-diagnosis"
        data-env-diagnosis
        aria-expanded={diagnosisOpen}
        onClick={() => setDiagnosisOpen((current) => !current)}>
        {labels.networkDiagnosis}
      </button>
      {diagnosisOpen ? (
        <p className="connection-check-env-diagnosis-result" data-env-diagnosis-result>
          {hasNetworkFailure ? networkDiagnoses.join(' · ') : labels.networkDiagnosisNone}
        </p>
      ) : null}
      {showProxyHint ? (
        <div className="connection-check-env-hint" data-env-proxy-hint>
          <p>{labels.networkFailureHint(proxyModeLabel)}</p>
          <button type="button" className="connection-check-env-action" data-env-open-proxy onClick={onOpenProxySettings}>
            {labels.openProxySettings}
          </button>
        </div>
      ) : null}
      {showCustomProxyHint ? (
        <div className="connection-check-env-hint" data-env-custom-proxy-hint>
          <p>{labels.customProxyFailureHint(environment.targetHost || '—')}</p>
        </div>
      ) : null}
      <p className="connection-check-env-note" data-env-note>{labels.proxyNote}</p>
    </section>
  )
}

/** 只展示 host（含端口）；账号密码/查询串一律丢弃。 */
function formatProxyAddress(environment: ProviderConnectionCheckEnvironment): string | null {
  if (environment.proxyMode !== 'custom') return null
  return sanitizeProxyAddressForDisplay(environment.proxyUrl)
}
