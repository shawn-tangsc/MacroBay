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
export function NetworkProxyBanner({ tone = 'requires', onOpenProxySettings }: {
  tone?: 'requires' | 'failed'
  onOpenProxySettings: () => void
}): React.ReactElement {
  const text = productText[useShellLanguage()].settings.intelligenceSources.proxyNotice
  return <div className="mi-network-proxy-banner" data-network-proxy-banner data-tone={tone}>
    <Alert
      type="warning"
      showIcon
      message={tone === 'failed' ? text.failedTitle : text.title}
      description={text.body}
      action={<Button size="small" icon={<Settings2 size={12} />} onClick={onOpenProxySettings} data-network-proxy-settings>{text.action}</Button>}
    />
  </div>
}
