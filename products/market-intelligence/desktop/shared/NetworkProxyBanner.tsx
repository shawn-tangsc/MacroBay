import { Alert, Button } from 'antd'
import { Settings2 } from 'lucide-react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from './i18n/productText'

/**
 * Explains a network-layer refusal for a source whose API host is edge-blocked, and hands the reader
 * the one setting that can fix it: the platform proxy. Shared by the provider pane and the market
 * calendar page, because both read the same blocked host through the same proxy.
 *
 * Callers decide when it is honest to show: a rejected credential must never send anyone here.
 */
export function NetworkProxyBanner({ onOpenProxySettings }: { onOpenProxySettings: () => void }): React.ReactElement {
  const text = productText[useShellLanguage()].settings.intelligenceSources.proxyNotice
  return <div className="mi-network-proxy-banner" data-network-proxy-banner>
    <Alert
      type="warning"
      showIcon
      message={text.title}
      description={text.body}
      action={<Button size="small" icon={<Settings2 size={12} />} onClick={onOpenProxySettings} data-network-proxy-settings>{text.action}</Button>}
    />
  </div>
}
