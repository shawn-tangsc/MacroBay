import { useEffect, useRef, useState } from 'react'
import type { createCrossAssetObservationClient } from '../../../shared/ipc/crossAssetObservationClient'
import type { CrossAssetCommandResult, CrossAssetId } from '../../../../contracts/crossAssetObservationContracts'

export type CrossAssetConnectionText = { market: string; pending: string; passed: string; partial: string; failed: string; busy: string; limited: string; unavailable: string; rest: string; ws: string; assets: Record<CrossAssetId, string>; visibility: string }
export function CrossAssetConnectionTest({ client, requestId, text, onPendingChange }: {
  client: Pick<ReturnType<typeof createCrossAssetObservationClient>, 'testInterface' | 'cancelInterfaceTest'>
  requestId: number; text: CrossAssetConnectionText; onPendingChange?: (pending: boolean) => void
}): React.ReactElement {
  const [result, setResult] = useState<CrossAssetCommandResult>()
  const [pending, setPending] = useState(false)
  const started = useRef(false)
  useEffect(() => { onPendingChange?.(pending); return () => onPendingChange?.(false) }, [pending, onPendingChange])
  useEffect(() => () => { if (started.current) void client.cancelInterfaceTest().catch(() => undefined) }, [client])
  useEffect(() => {
    if (!requestId) return
    let current = true
    started.current = true; setPending(true)
    void client.testInterface().then(result => { if (current) setResult(result) }, () => { if (current) setResult({ state: 'unavailable' }) })
      .finally(() => { if (current) setPending(false) })
    return () => { current = false }
  }, [client, requestId])
  const status = result && ['passed', 'partial', 'failed', 'busy', 'limited'].includes(result.state) ? result.state as 'passed' | 'partial' | 'failed' | 'busy' | 'limited' : 'unavailable'
  return <div data-cross-asset-connection-result aria-live="polite"><small>{text.visibility}</small>
    {requestId > 0 ? <><p>{text.market} · {pending ? text.pending : text[status]}</p>
      {result && 'assets' in result ? <div>{(['index', 'btc', 'eth'] as const).map(asset => <p key={asset} data-connection-asset={asset}>{text.assets[asset]} · {text.rest}: {result.assets[asset].rest ? text.passed : text.failed} · {text.ws}: {result.assets[asset].ws ? text.passed : text.failed}</p>)}</div> : null}</> : null}
  </div>
}
