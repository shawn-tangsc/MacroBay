import type { WebSearchProviderDriver } from '../WebSearchProviderDriver'
import { createProviderHttpStatusError, createWebSearchError } from '../../runtime/webSearchErrors'
import { validateRedirectTarget, validateWebFetchUrl } from '../../runtime/webSearchUrlSafety'

const maxBodyLength = 200_000
const maxRedirects = 5

export function createFetchWebSearchProvider(): WebSearchProviderDriver {
  return {
    providerId: 'fetch',
    async fetchUrls(url, config, signal) {
      const validated = validateWebFetchUrl(url)
      if (!validated.ok) {
        throw createWebSearchError(validated.code, validated.message)
      }

      const response = await fetchSafeUrlWithRedirects(validated.url, config.fetch, signal)
      if (!response.ok) {
        throw createProviderHttpStatusError('Fetch', response.status)
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/plain') && !contentType.includes('text/html')) {
        throw createWebSearchError('provider_response_invalid', 'Unsupported content type.')
      }

      const text = (await response.text()).slice(0, maxBodyLength)
      const result =
        contentType.includes('text/html') ? extractHtmlReadableText(text, validated.url.toString()) : extractPlainText(text, validated.url.toString())

      return {
        providerId: 'fetch',
        capability: 'fetchUrls',
        inputs: [url],
        results: [result]
      }
    }
  }
}

async function fetchSafeUrlWithRedirects(
  url: URL,
  platformFetch: typeof fetch,
  signal?: AbortSignal
): Promise<Response> {
  let currentUrl = url
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await platformFetch(currentUrl, { signal, redirect: 'manual' })
    if (!isRedirectStatus(response.status)) return response

    const location = response.headers.get('location')
    if (!location) {
      throw createWebSearchError('provider_response_invalid', 'Redirect response is missing a location header.')
    }

    const nextUrl = new URL(location, currentUrl)
    const validatedRedirect = await validateRedirectTarget(nextUrl.toString())
    if (!validatedRedirect.ok) {
      throw createWebSearchError(validatedRedirect.code, validatedRedirect.message)
    }
    currentUrl = validatedRedirect.url
  }

  throw createWebSearchError('provider_response_invalid', 'Too many redirects.')
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400
}

function extractHtmlReadableText(html: string, url: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const withoutTitle = html.replace(/<title[\s\S]*?<\/title>/gi, ' ')
  const withoutScripts = withoutTitle.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  const text = decodeHtml(withoutScripts.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  return {
    title: titleMatch ? decodeHtml(titleMatch[1]).trim() : url,
    url,
    content: text,
    sourceInput: url
  }
}

function extractPlainText(text: string, url: string) {
  return {
    title: url,
    url,
    content: text.trim(),
    sourceInput: url
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
