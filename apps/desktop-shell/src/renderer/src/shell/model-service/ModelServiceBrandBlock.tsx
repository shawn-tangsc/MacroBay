import { Activity, ExternalLink, Lock } from 'lucide-react'
import { Switch } from 'antd'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { providerCategoryOf } from '@platform/ai/providers/providerPresets'
import { resolveProviderVisual } from '@platform/ui/icons/modelProviderVisuals'

import type { PlatformText } from '../../i18n/platformText'
import { VisualIdentityAvatar } from '../VisualIdentityAvatar'
import { resolveProviderDisplayName } from './providerDisplayName'
import { ModelServiceProviderMoreMenu } from './ModelServiceProviderMoreMenu'

/**
 * PLAT-61 / PLAT-81：右栏品牌块 —— **压成一行**（≤48px）。
 *
 * `[24px logo] 名称 / 一行 meta  ······  [连接检查] [供应商控制台] [⋯] [启用开关]`
 *
 * - 连接检查抽屉的唯一入口是这里的「连接检查」胶囊（API Key 区的行内「检测」按钮已删除）；
 *
 * - meta = `host · 分类`；模型数量在下方的「模型 N」里、可达性有独立的「需代理」徽章，
 *   都不在这里重复（原来这一行写 `host · 分类 · N 个模型 · 可达性`，同一屏出现两遍）；
 * - 删除供应商等次要/危险操作收进 `⋯`（见 `ModelServiceProviderMoreMenu`）；
 * - 启用开关是唯一开关（原来在标题行，现在与品牌信息同一行，避免右侧出现两次开关）；
 * - 产品决定（2026-10-18）：**不展示「文档」按钮**。
 */
type ModelServiceBrandBlockProps = {
  labels: PlatformText['models']
  provider: SafeModelProvider
  /** 未归档的模型数（与模型区计数同口径，由页面算好）。 */
  /** 「已保存」闪现提示；null = 不显示。 */
  savedHint: string | null
  /** 供应商控制台/官网链接（缺省时按钮不渲染）。 */
  consoleUrl?: string
  /** 标题行外链（控制台地址缺失时仍可用 apiKey 链接）。 */
  titleLink?: string
  enabled: boolean
  enabledPending: boolean
  onToggleEnabled: (next: boolean) => void
  /** PLAT-62：由页面算好（proxy + 中文界面），组件不读全局语言。 */
  showMainlandProxyNotice: boolean
  /** PLAT-61：连接检查抽屉的唯一入口（行内「检测」按钮已删除）。 */
  onOpenConnectionCheck: () => void
  onOpenExternal: (url: string) => void
  onRemoveProvider: () => void
  removeProviderDisabled: boolean
}

export function resolveProviderHost(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).host
  } catch {
    return trimmed.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? trimmed
  }
}

export function ModelServiceBrandBlock({
  labels,
  provider,
  savedHint,
  consoleUrl,
  titleLink,
  enabled,
  enabledPending,
  onToggleEnabled,
  showMainlandProxyNotice,
  onOpenConnectionCheck,
  onOpenExternal,
  onRemoveProvider,
  removeProviderDisabled
}: ModelServiceBrandBlockProps): React.ReactElement {
  const host = resolveProviderHost(provider.baseUrl) || labels.endpointNotSet
  const category = labels.providerCategories[providerCategoryOf(provider.id)]
  const meta = labels.providerMetaLine(host, category)

  return (
    <div className="model-service-brand" data-model-service-brand>
      <VisualIdentityAvatar visual={resolveProviderVisual(provider.id, provider.name)} size={24} />
      <div className="model-service-brand-info">
        <div className="model-service-brand-headline">
          <h1 className="model-service-title" data-provider-name>
            {resolveProviderDisplayName(labels, provider)}
          </h1>
          {titleLink ? (
            <button
              type="button"
              className="model-service-title-link"
              data-provider-title-link
              title={labels.providerConsole}
              aria-label={labels.providerConsole}
              onClick={() => onOpenExternal(titleLink)}>
              <ExternalLink size={12} />
            </button>
          ) : null}
          {savedHint ? (
            <span className="model-service-saved-hint" data-provider-saved-hint role="status">
              {savedHint}
            </span>
          ) : null}
        </div>
        <div className="model-service-brand-meta">
          <span className="model-service-brand-source" data-provider-source title={meta}>
            {meta}
          </span>
          {showMainlandProxyNotice ? (
            <span
              className="model-service-brand-notice"
              data-mainland-proxy-notice
              title={labels.mainlandProxyNotice}>
              <Lock size={11} aria-hidden="true" />
              {labels.reachabilityProxy}
            </span>
          ) : null}
        </div>
      </div>
      <span className="model-service-brand-spacer" />
      <button
        type="button"
        className="model-service-pill"
        data-provider-connection-check
        onClick={onOpenConnectionCheck}>
        <Activity size={13} aria-hidden="true" />
        {labels.connectionCheckTitle}
      </button>
      {consoleUrl ? (
        <button
          type="button"
          className="model-service-pill"
          data-provider-console
          onClick={() => onOpenExternal(consoleUrl)}>
          <ExternalLink size={13} aria-hidden="true" />
          {labels.providerConsole}
        </button>
      ) : null}
      <ModelServiceProviderMoreMenu
        labels={labels}
        isSystem={provider.isSystem === true}
        disabled={removeProviderDisabled}
        onRemove={onRemoveProvider}
      />
      <span data-provider-switch title={labels.enableSwitchTitle}>
        <Switch
          size="small"
          checked={enabled}
          loading={enabledPending}
          disabled={enabledPending}
          aria-label={labels.enableSwitchTitle}
          onChange={onToggleEnabled}
        />
      </span>
    </div>
  )
}
