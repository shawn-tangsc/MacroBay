import { Alert, Button } from 'antd'
import { Settings2 } from 'lucide-react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from './i18n/productText'

/**
 * Explains a network-layer requirement for a source whose API host is edge-blocked, and hands the
 * reader the one setting that can fix it: the platform proxy. Shared by the provider pane and the
 * market calendar page, because both read the same blocked host through the same proxy.
 *
 * It is a requirement, not a verdict, so the provider pane shows it **before** anyone presses
 * 「测试连接」; a transport-level refusal only swaps the wording (`tone`). It is an antd `Alert`
 * on purpose: that is the one banner style both macOS and Windows already render identically, so
 * no product stylesheet has to describe it twice.
 *
 * Callers decide when it is honest to show at all: a rejected credential must never send anyone here.
 */
export function NetworkProxyBanner({ tone = 'requires', configured = false, onOpenProxySettings }: {
  tone?: 'requires' | 'failed'
  /**
   * 读者已经配好了自定义代理。此时「去配一个代理」不再是题目：失败档改成「配好了但这次没连上」，
   * 不再让他去打开 VPN（`MI-11-R196`）。未配置时行为与原来一致。
   */
  configured?: boolean
  onOpenProxySettings: () => void
}): React.ReactElement {
  const text = productText[useShellLanguage()].settings.intelligenceSources.proxyNotice
  const failedTitle = configured ? text.configuredFailedTitle : text.failedTitle
  const failedBody = configured ? text.configuredFailedBody : text.body
  // 动作跟着状态走：已配好却失败时再给「去设置代理」等于让他重新填一遍。
  const actionLabel = tone === 'failed' && configured ? text.configuredFailedAction : text.action
  return <div className="mi-network-proxy-banner" data-network-proxy-banner data-tone={tone} data-proxy-configured={configured ? 'yes' : 'no'}>
    <Alert
      type="warning"
      showIcon
      message={tone === 'failed' ? failedTitle : text.title}
      description={tone === 'failed' ? failedBody : text.body}
      action={<Button size="small" icon={<Settings2 size={12} />} onClick={onOpenProxySettings} data-network-proxy-settings>{actionLabel}</Button>}
    />
  </div>
}
