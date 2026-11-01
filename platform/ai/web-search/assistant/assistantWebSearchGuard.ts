import { guardExternalContent, type ExternalContentMetadata } from '../../agent-platform/channels/ExternalContentGuard'
import type { AssistantWebSearchModelSource } from './assistantWebSearchTools'

export type WebSourceProvenance = {
  origin: 'search' | 'fetch'
  providerId?: string
}

/**
 * The model reads retrieved pages as material it may quote, so the text it receives has to say
 * where it came from. This runs on the copy that is serialized into the tool result only: the
 * caller keeps the raw sources for the source cards, otherwise the interface would render the
 * boundary notice and the warning line as if they were part of the page.
 *
 * Titles are short and cannot carry a boundary block, so they get the light form; the page body
 * gets the full one.
 */
export function guardWebSearchSourcesForModel(
  sources: readonly AssistantWebSearchModelSource[],
  provenance: WebSourceProvenance
): AssistantWebSearchModelSource[] {
  return sources.map((source) => {
    const metadata: ExternalContentMetadata = {
      kind: 'web',
      origin: provenance.origin,
      url: source.url,
      ...(provenance.providerId ? { providerId: provenance.providerId } : {})
    }
    return {
      ...source,
      title: guardExternalContent(source.title, metadata, 'light').guardedText,
      content: guardExternalContent(source.content, metadata).guardedText
    }
  })
}
