import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { isCanonicalSignalTime } from '../../../contracts/moduleSignal'
import { toModuleSignalRead, type ModuleSignalRead } from '../../../contracts/moduleSignalRead'

/**
 * The renderer's door to the module signals the chips read.
 *
 * It hands back a read, not an array: "we could not read" and "nothing happened" are different
 * facts, and the chip above this door says something different for each. The check is the same
 * `toModuleSignalRead` the IPC handler runs, so a shape one side accepts cannot become a chip with
 * half its numbers on the other, and a malformed entry is dropped and counted rather than hidden.
 */
export const moduleSignalClient = {
  async query(input: Readonly<{ asOf: string }>): Promise<ModuleSignalRead> {
    try {
      if (!isCanonicalSignalTime(input.asOf)) return { state: 'unavailable', failureCode: 'invalid-as-of' }
      // A missing bridge is a failed read, not a malformed answer: the two get different sentences
      // and only the first one is worth a retry.
      const products = window.platform?.products
      if (!products || typeof products.invoke !== 'function') return { state: 'unavailable', failureCode: 'query-failed' }
      const value = await products.invoke(
        'market-intelligence',
        INTELLIGENCE_PUBLIC_QUERY_METHODS.queryModuleSignals,
        { asOf: input.asOf }
      )
      return toModuleSignalRead(value)
    } catch {
      // A bridge that is missing or threw is a failed read, not an empty market.
      return { state: 'unavailable', failureCode: 'query-failed' }
    }
  }
}

export type ModuleSignalClient = typeof moduleSignalClient
