import { ProductToolGuardError, type ToolCallContext } from './capabilityTypes'
import type { CrossAssetOps } from './operationFacades'
import type { WriteHandlerDeps } from './writeAudit'
import { runAuditedWrite } from './writeAudit'
import { readCrossAssetSnapshot } from './writeState'

const CROSS_ASSET_CAPABILITY = { id: 'configure_cross_asset_interface', domain: 'cross-asset' } as const

type CrossAssetAction = 'acquire' | 'renew' | 'release' | 'refresh' | 'test-interface' | 'cancel-test'

type CrossAssetInput = {
  action: CrossAssetAction
  leaseId?: string
}

export async function handleConfigureCrossAssetInterface(
  input: unknown,
  deps: WriteHandlerDeps,
  context: ToolCallContext
): Promise<unknown> {
  const value = input as CrossAssetInput
  const leaseId = value.leaseId

  return runAuditedWrite({
    deps,
    context,
    capability: CROSS_ASSET_CAPABILITY,
    action: value.action,
    ...(typeof leaseId === 'string' && leaseId.length > 0 ? { target: leaseId } : {}),
    read: () => readCrossAssetSnapshot(deps),
    execute: async () => ({ ...(await executeCrossAssetAction(deps.crossAssetOps, value)) })
  })
}

async function executeCrossAssetAction(
  ops: CrossAssetOps,
  value: CrossAssetInput
): Promise<Record<string, unknown>> {
  switch (value.action) {
    case 'acquire':
      return { ...(await ops.acquire()) }
    case 'renew':
      return { ...(await ops.renew(requireLeaseId(value))) }
    case 'release':
      return { ...(await ops.release(requireLeaseId(value))) }
    case 'refresh':
      return { ...(await ops.refresh(requireLeaseId(value))) }
    case 'test-interface':
      return { ...(await ops.testInterface()) }
    case 'cancel-test':
      return { ...(await ops.cancelInterfaceTest()) }
  }
}

function requireLeaseId(value: CrossAssetInput): string {
  if (typeof value.leaseId !== 'string' || value.leaseId.length === 0) {
    throw new ProductToolGuardError('missing-property', 'Missing required parameter: leaseId.')
  }
  return value.leaseId
}
