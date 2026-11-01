import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { isCanonicalSignalTime, isModuleSignal, type ModuleSignal } from '../../../contracts/moduleSignal'

/**
 * The renderer's door to the module signals the chips read.
 *
 * Same contract check as the IPC handler, so a shape one side accepts cannot become a chip with
 * half its numbers on the other. A signal that fails the check is dropped, never rendered partial:
 * a chip without its values is worse than no chip, because it still looks like a statement.
 */
export const moduleSignalClient = {
  async query(input: Readonly<{ asOf: string }>): Promise<readonly ModuleSignal[]> {
    try {
      if (!isCanonicalSignalTime(input.asOf)) return []
      const value = await window.platform?.products?.invoke(
        'market-intelligence',
        INTELLIGENCE_PUBLIC_QUERY_METHODS.queryModuleSignals,
        { asOf: input.asOf }
      )
      return Array.isArray(value) ? value.filter(entry => isModuleSignal(entry)) : []
    } catch {
      return []
    }
  }
}

export type ModuleSignalClient = typeof moduleSignalClient
