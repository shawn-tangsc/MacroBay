import { platformText } from '../i18n/platformText'

/**
 * PLAT-61/66：连接检查抽屉测试共用的 i18n 文案（从测试文件抽出，避免重复并让各测试文件 <300 行）。
 */
const models = platformText['en-US'].models

export const connectionCheckDrawerLabels = {
  title: models.connectionCheckTitle,
  model: models.connectionCheckModel,
  apiKey: models.connectionCheckApiKey,
  cancel: models.cancel,
  start: models.connectionCheckStart,
  noModels: models.noChatModelForConnectionCheck,
  noApiKeys: models.connectionNeedsConfig,
  providerStatus: models.connectionCheckProviderStatus,
  statusEnabled: models.connectionCheckStatusEnabled,
  statusDisabled: models.connectionCheckStatusDisabled,
  enableProvider: models.connectionCheckEnableProvider,
  detailPrefix: models.connectionCheckDetailPrefix,
  environment: models.connectionCheckEnvironment,
  proxy: models.connectionCheckProxy,
  proxyDirect: models.connectionCheckProxyDirect,
  proxySystem: models.connectionCheckProxySystem,
  proxyCustom: models.connectionCheckProxyCustom,
  targetHost: models.connectionCheckTargetHost,
  networkDiagnosis: models.connectionCheckNetworkDiagnosis,
  networkDiagnosisNone: models.connectionCheckNetworkDiagnosisNone,
  proxyNote: models.connectionCheckProxyNote,
  networkFailureHint: models.connectionCheckNetworkFailureHint,
  customProxyFailureHint: models.connectionCheckCustomProxyFailureHint,
  gatewayDisabledHint: models.connectionCheckGatewayDisabledHint,
  enableModelGateway: models.connectionCheckEnableModelGateway,
  retry: models.retry,
  openProxySettings: models.connectionCheckOpenProxySettings,
  runtimeLanes: {
    ordinaryChat: models.connectionCheckOrdinaryChat,
    direct: models.connectionCheckDirect,
    gateway: models.connectionCheckGateway,
    final: models.connectionCheckFinal,
    ready: models.connectionCheckAgentReady,
    notReady: models.connectionCheckAgentNotReady,
    checking: models.connectionCheckStart,
    mixed: models.connectionCheckAgentMixed,
    reasons: models,
    detailPrefix: models.connectionCheckDetailPrefix,
    irrelevantHint: models.connectionCheckIrrelevantHint,
    gatewayDisabledHint: models.connectionCheckGatewayDisabledHint
  }
}
