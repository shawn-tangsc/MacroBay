import type { ProductIpcRegistrar } from '../../../../../platform/desktop/ipc/productIpcRegistry'
import type { createCrossAssetRuntime } from './crossAssetRuntime'
import type { createCrossAssetSnapshotQuery } from './crossAssetSnapshotQuery'
import type { createCrossAssetSourceConfiguration } from './crossAssetSourceConfiguration'
import { crossAssetMethods, parseCrossAssetInput, parseCrossAssetSnapshot, parseCrossAssetCommandResult } from '../../../contracts/crossAssetObservationContracts'

export function registerCrossAssetIpc(register: ProductIpcRegistrar, deps: {
  runtime?: ReturnType<typeof createCrossAssetRuntime>; query?: ReturnType<typeof createCrossAssetSnapshotQuery>
  configuration: ReturnType<typeof createCrossAssetSourceConfiguration>; now: () => number
}) {
  for (const [key, method] of Object.entries(crossAssetMethods)) {
    register('market-intelligence', method, async payload => {
      try {
        const input = parseCrossAssetInput(method, payload, deps.now())
        if (!input) return { state: 'invalid-request' }
        if (key === 'getSourceConfiguration') return parseCrossAssetCommandResult(key, await deps.configuration.read(), deps.now()) ?? { state: 'unavailable' }
        if (!deps.runtime || !deps.query) return { state: 'unavailable' }
        let output: unknown
        if (key === 'query') {
          if (!('range' in input)) return { state: 'invalid-request' }
          return parseCrossAssetSnapshot(deps.query.query(input as { range: '1h' | '24h' | '7d'; asOf?: string })) ?? { state: 'unavailable' }
        }
        if (key === 'acquire') output = await deps.runtime.acquire()
        else if (key === 'testInterface') output = await deps.runtime.testInterface()
        else if (key === 'cancelInterfaceTest') output = await deps.runtime.cancelInterfaceTest()
        else {
          if (!('leaseId' in input) || typeof input.leaseId !== 'string') return { state: 'invalid-request' }
          if (key === 'renew') output = await deps.runtime.renew(input.leaseId)
          else if (key === 'release') output = await deps.runtime.release(input.leaseId)
          else output = await deps.runtime.refresh(input.leaseId)
        }
        return parseCrossAssetCommandResult(key, output, deps.now()) ?? { state: 'unavailable' }
      } catch { return { state: 'unavailable' } }
    })
  }
}
