import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { isCanonicalSignalTime } from '../../../contracts/moduleSignal'
import { isModuleSignalRead, toModuleSignalRead, type ModuleSignalRead } from '../../../contracts/moduleSignalRead'

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
      // The handler answers with a read, not with bare entries: it already decided between
      // "nothing happened" and "we could not read this", and its failure code is the one the
      // reader is owed. Wrapping that answer again reads an object as a list of entries, which
      // drops everything and reports `contract-invalid` on every read — the reader then sees
      // "the format does not match" on a healthy card.
      if (isModuleSignalRead(value)) return value
      // Raw entries are the older bridge's answer (and a test's): keep reading them, so this
      // client still works against a handler that has not been migrated.
      return toModuleSignalRead(value)
    } catch {
      // A bridge that is missing or threw is a failed read, not an empty market.
      return { state: 'unavailable', failureCode: 'query-failed' }
    }
  }
}

export type ModuleSignalClient = typeof moduleSignalClient
