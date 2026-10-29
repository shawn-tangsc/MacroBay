import { getIntelligenceModule } from '../intelligenceModule'
import type {
  NewsSentimentInput,
  NewsSentimentItemInput,
  ReadHandlerDeps
} from './readHandlerContracts'

export async function handleQueryNewsSentiment(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const parsed = (input ?? {}) as NewsSentimentInput
  const query = getIntelligenceModule(deps.jobRuntime).newsSentiment.query
  if (!query) {
    return {
      state: 'unavailable',
      asOf: parsed.asOf,
      window: parsed.window,
      items: [],
      caveats: ['news-sentiment-unavailable']
    }
  }
  return query.query(parsed as never)
}

export async function handleGetNewsSentimentItem(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { itemId, asOf } = (input ?? {}) as NewsSentimentItemInput
  const query = getIntelligenceModule(deps.jobRuntime).newsSentiment.query
  if (!query) return { state: 'unavailable', itemId }
  const item = await query.getItem({ itemId, asOf })
  return item ? { state: 'available', item } : { state: 'unavailable', itemId }
}
