import type {
  NewsSentimentQuery,
  NewsSentimentSettings,
  NewsSentimentSettingsView
} from '../../../service/intelligence/schema/newsSentiment'
import type {
  NewsSentimentItemDetail,
  NewsSentimentView
} from '../../../service/intelligence/news-sentiment/newsSentimentQuery'

const PRODUCT_ID = 'market-intelligence'

export class NewsSentimentClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewsSentimentClientError'
  }
}

type Invoke = (method: string, payload?: unknown) => Promise<unknown>

function platformInvoke(method: string, payload?: unknown): Promise<unknown> {
  const products = window.platform?.products
  if (!products?.invoke) {
    return Promise.reject(new NewsSentimentClientError('Product IPC bridge is unavailable.'))
  }
  return products.invoke(PRODUCT_ID, method, payload)
}

export type NewsSentimentClient = Readonly<{
  query: (input: NewsSentimentQuery) => Promise<NewsSentimentView>
  getItem: (input: { itemId: string; asOf: string }) => Promise<NewsSentimentItemDetail | undefined>
  getSettings: () => Promise<NewsSentimentSettingsView>
  saveSettings: (patch: Partial<NewsSentimentSettings>) => Promise<NewsSentimentSettingsView>
  rescore: () => Promise<{ queued: boolean }>
  rebuild: () => Promise<{ queued: boolean }>
  translateBody: (itemId: string, force?: boolean) => Promise<{ state: 'translated' | 'off' | 'unavailable' | 'failed'; body?: string; errorCode?: string }>
}>

export function createNewsSentimentClient(invoke: Invoke = platformInvoke): NewsSentimentClient {
  const call = async <T>(method: string, payload?: unknown): Promise<T> => {
    try {
      return (await invoke(method, payload)) as T
    } catch (error) {
      if (error instanceof NewsSentimentClientError) throw error
      throw new NewsSentimentClientError(error instanceof Error ? error.message : 'News sentiment request failed.')
    }
  }

  return {
    query: (input) => call<NewsSentimentView>('intelligence.getNewsSentiment', input),
    getItem: (input) => call<NewsSentimentItemDetail | undefined>('intelligence.getNewsSentimentItem', input),
    getSettings: () => call<NewsSentimentSettingsView>('intelligence.getNewsSentimentSettings'),
    saveSettings: (patch) => call<NewsSentimentSettingsView>('intelligence.saveNewsSentimentSettings', patch),
    rescore: () => call<{ queued: boolean }>('intelligence.rescoreNewsSentiment')
  }
}

export const newsSentimentClient = createNewsSentimentClient()
