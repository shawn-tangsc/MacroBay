import { resolveCustomProxyRules } from '@platform/network/proxyConfig'
import { readProxyRejectionReason } from '@platform/network/proxySettingsGuard'
import type { PlatformText } from '../i18n/platformText'

/**
 * 保存被拒时把人话还给用户：主进程只抛「前缀 + 原因码」，句子在这里拼，
 * 保证同一个原因在设置页只有一种说法。
 */
export function proxyRejectionNotice(
  error: unknown,
  labels: PlatformText['preferences']
): string | null {
  switch (readProxyRejectionReason(error)) {
    case 'empty':
      return labels.proxyRejectedEmpty
    case 'unsupported-protocol':
      return labels.proxyRejectedUnsupportedProtocol
    case 'unparsable':
      return labels.proxyRejectedUnparsable
    case 'bypass-rule-unsupported':
      return labels.proxyRejectedBypassRule
    default:
      return null
  }
}

/** 只写了 `host:port` 时主进程按 socks5 解释，界面必须把这句解释显示出来。 */
export function proxyAddressUsesImplicitSocks5(proxyUrl: string): boolean {
  const resolution = resolveCustomProxyRules(proxyUrl)
  return resolution.ok && resolution.protocolWasImplicit
}
