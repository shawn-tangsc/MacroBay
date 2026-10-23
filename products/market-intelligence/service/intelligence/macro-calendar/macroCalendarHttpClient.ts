import { getPlatformFetch } from '@platform/network/platformFetch'

import type { DashboardSourceConnectionResult, MacroCalendarSettingsProviderId } from '../../../contracts/macro/economicCalendarQueryContracts'
import { getMacroCalendarOfficialSourceDescriptor, type MacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { macroCalendarTransportPolicy } from './macroCalendarPolicy'
import { buildBlsObservedValuesRequest } from './bls-observations/blsObservedValuesRequest'

export type MacroCalendarHttpResult =
  | { ok: true; descriptorId: string; status: number; acceptedBytes: number; body: string; contentType: string }
  | { ok: false; descriptorId: string; status?: number; failureCode: 'descriptor-not-allowed' | 'credential-required' | 'run-time-invalid' | 'network-request-failed' | 'request-timeout' | 'redirect-rejected' | 'response-body-too-large' | 'http-response-not-success' }


export const fedFomcStatementTransportPolicy = Object.freeze({
  descriptorId: 'macro-calendar-fed-statement-body',
  hostname: 'www.federalreserve.gov',
  statementPath: /^\/newsevents\/pressreleases\/monetary\d{8}a\.htm$/,
  contentLengthPattern: /^(?:0|[1-9][0-9]*)$/,
  requestMethod: 'GET' as const,
  redirectMode: macroCalendarTransportPolicy.redirectMode,
  maximumBytes: macroCalendarTransportPolicy.responseAcceptedMaxBytes
})

export const beaOfficialReleaseTransportPolicy = Object.freeze({
  rssDescriptorId: 'macro-calendar-bea-release-rss',
  pageDescriptorId: 'macro-calendar-bea-release-page',
  rssUrl: 'https://apps.bea.gov/rss/rss.xml',
  requestMethod: 'GET' as const,
  requestTimeoutMs: 15_000,
  maximumBytes: 256 * 1024,
  redirectMode: 'error' as RequestRedirect,
  rssMimeEssences: ['text/xml', 'application/rss+xml', 'application/xml'],
  pageMimeEssence: 'text/html',
  pageUrlPattern: /^https:\/\/www\.bea\.gov\/news\/\d{4}\/[a-z0-9-]+$/
})

export const macroCalendarConnectionTestPolicy = {
  providerIds: ['macro-calendar-fed', 'macro-calendar-bea'],
  fedDescriptorId: 'macro-calendar-fed-schedule',
  responseAcceptedMaxBytes: macroCalendarTransportPolicy.responseAcceptedMaxBytes,
  requestTimeoutMs: macroCalendarTransportPolicy.requestTimeoutMs,
  redirectMode: macroCalendarTransportPolicy.redirectMode
} as const

export function createMacroCalendarHttpClient(): {
  request: (descriptor: MacroCalendarOfficialSourceDescriptor, runAt: string, signal?: AbortSignal) => Promise<MacroCalendarHttpResult>
  requestFomcStatement: (officialStatementUrl: string, signal?: AbortSignal) => Promise<MacroCalendarHttpResult>
  requestBeaOfficialReleaseRss: (signal?: AbortSignal) => Promise<MacroCalendarHttpResult>
  requestBeaOfficialReleasePage: (officialReleaseUrl: string, signal?: AbortSignal) => Promise<MacroCalendarHttpResult>
  testProviderConnection: (providerId: unknown) => Promise<DashboardSourceConnectionResult>
} {
  return {
    request: (descriptor, runAt, signal) => requestDescriptor(descriptor, runAt, signal),
    requestFomcStatement: (officialStatementUrl, signal) => requestFomcStatement(officialStatementUrl, signal),
    requestBeaOfficialReleaseRss: (signal) => requestBeaOfficialRelease(beaOfficialReleaseTransportPolicy.rssDescriptorId, beaOfficialReleaseTransportPolicy.rssUrl, beaOfficialReleaseTransportPolicy.rssMimeEssences, signal),
    requestBeaOfficialReleasePage: (officialReleaseUrl, signal) => requestBeaOfficialReleasePage(officialReleaseUrl, signal),
    testProviderConnection: (providerId) => testProviderConnection(providerId)
  }
}

async function requestBeaOfficialReleasePage(officialReleaseUrl: string, signal?: AbortSignal): Promise<MacroCalendarHttpResult> {
  if (!beaOfficialReleaseTransportPolicy.pageUrlPattern.test(officialReleaseUrl)) {
    return { ok: false, descriptorId: beaOfficialReleaseTransportPolicy.pageDescriptorId, failureCode: 'descriptor-not-allowed' }
  }
  return requestBeaOfficialRelease(beaOfficialReleaseTransportPolicy.pageDescriptorId, officialReleaseUrl, [beaOfficialReleaseTransportPolicy.pageMimeEssence], signal)
}

async function requestBeaOfficialRelease(descriptorId: string, sourceUrl: string, acceptedMimeEssences: readonly string[], parentSignal?: AbortSignal): Promise<MacroCalendarHttpResult> {
  if (parentSignal?.aborted) return { ok: false, descriptorId, failureCode: 'network-request-failed' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), beaOfficialReleaseTransportPolicy.requestTimeoutMs)
  const abort = () => controller.abort()
  parentSignal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await getPlatformFetch()(sourceUrl, { method: beaOfficialReleaseTransportPolicy.requestMethod, signal: controller.signal, redirect: beaOfficialReleaseTransportPolicy.redirectMode })
    if (response.status >= 300 && response.status < 400) return { ok: false, descriptorId, status: response.status, failureCode: 'redirect-rejected' }
    if (response.status < 200 || response.status >= 300) return { ok: false, descriptorId, status: response.status, failureCode: 'http-response-not-success' }
    if (!hasAcceptedBeaContentLength(response.headers)) return { ok: false, descriptorId, failureCode: 'response-body-too-large' }
    const contentType = response.headers.get('content-type') ?? ''
    if (!acceptedMimeEssences.includes(mimeEssence(contentType))) return { ok: false, descriptorId, failureCode: 'http-response-not-success' }
    const body = await readBoundedBeaOfficialReleaseBody(response.body)
    return body
      ? { ok: true, descriptorId, status: response.status, acceptedBytes: body.acceptedBytes, body: body.value, contentType }
      : { ok: false, descriptorId, failureCode: 'response-body-too-large' }
  } catch {
    return { ok: false, descriptorId, failureCode: controller.signal.aborted && !parentSignal?.aborted ? 'request-timeout' : 'network-request-failed' }
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', abort)
  }
}

function hasAcceptedBeaContentLength(headers: Headers): boolean {
  const contentLength = headers.get('content-length')
  if (contentLength === null) return true
  return /^(?:0|[1-9][0-9]*)$/.test(contentLength) && Number(contentLength) <= beaOfficialReleaseTransportPolicy.maximumBytes
}

async function readBoundedBeaOfficialReleaseBody(body: ReadableStream<Uint8Array> | null): Promise<{ value: string; acceptedBytes: number } | undefined> {
  if (!body) return undefined
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let acceptedBytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) continue
      acceptedBytes += next.value.byteLength
      if (acceptedBytes > beaOfficialReleaseTransportPolicy.maximumBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(next.value)
    }
  } catch {
    return undefined
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(acceptedBytes)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { value: new TextDecoder().decode(bytes), acceptedBytes }
}

function mimeEssence(contentType: string): string { return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '' }

async function requestFomcStatement(officialStatementUrl: string, parentSignal?: AbortSignal): Promise<MacroCalendarHttpResult> {
  const descriptorId = fedFomcStatementTransportPolicy.descriptorId
  if (!isOfficialFomcStatementUrl(officialStatementUrl)) return { ok: false, descriptorId, failureCode: 'descriptor-not-allowed' }
  if (parentSignal?.aborted) return { ok: false, descriptorId, failureCode: 'network-request-failed' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), macroCalendarTransportPolicy.requestTimeoutMs)
  const abort = () => controller.abort()
  parentSignal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await getPlatformFetch()(officialStatementUrl, {
      method: fedFomcStatementTransportPolicy.requestMethod,
      signal: controller.signal,
      redirect: fedFomcStatementTransportPolicy.redirectMode
    })
    if (response.status >= 300 && response.status < 400) return { ok: false, descriptorId, status: response.status, failureCode: 'redirect-rejected' }
    if (response.status < 200 || response.status >= 300) return { ok: false, descriptorId, status: response.status, failureCode: 'http-response-not-success' }
    if (!hasAcceptedFomcStatementContentLength(response.headers)) {
      await discardFomcStatementBody(response.body)
      return { ok: false, descriptorId, failureCode: 'response-body-too-large' }
    }
    const body = await readBoundedFomcStatementBody(response.body)
    return body
      ? { ok: true, descriptorId, status: response.status, acceptedBytes: body.acceptedBytes, body: body.value, contentType: response.headers.get('content-type') ?? '' }
      : { ok: false, descriptorId, failureCode: 'response-body-too-large' }
  } catch {
    return { ok: false, descriptorId, failureCode: controller.signal.aborted && !parentSignal?.aborted ? 'request-timeout' : 'network-request-failed' }
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', abort)
  }
}

async function testProviderConnection(providerId: unknown): Promise<DashboardSourceConnectionResult> {
  const provider = safeConnectionProviderId(providerId)
  if (!provider) return responseUnavailable()
  if (provider === 'macro-calendar-bea') return requestConnection(beaOfficialReleaseTransportPolicy.rssUrl, (body, contentType) => body.length > 0 && beaOfficialReleaseTransportPolicy.rssMimeEssences.includes(mimeEssence(contentType)))
  const descriptor = getMacroCalendarOfficialSourceDescriptor(macroCalendarConnectionTestPolicy.fedDescriptorId)
  return descriptor && descriptor.providerId === provider
    ? requestConnection(descriptor.sourceUrl, isNonEmptyHtmlBody)
    : responseUnavailable()
}

async function requestConnection(url: string, isExpectedEnvelope: (body: string, contentType: string) => boolean): Promise<DashboardSourceConnectionResult> {
  const controller = new AbortController()
  let timedOut = false
  let responseReceived = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, macroCalendarConnectionTestPolicy.requestTimeoutMs)
  try {
    const response = await getPlatformFetch()(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: macroCalendarConnectionTestPolicy.redirectMode
    })
    responseReceived = true
    const status = response.status
    if (!Number.isInteger(status) || status < 200 || status >= 300) return responseUnavailable()
    const declaredBytes = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredBytes) && declaredBytes > macroCalendarConnectionTestPolicy.responseAcceptedMaxBytes) return responseUnavailable()
    const body = await response.text()
    if (typeof body !== 'string' || new TextEncoder().encode(body).byteLength > macroCalendarConnectionTestPolicy.responseAcceptedMaxBytes) return responseUnavailable()
    const contentType = response.headers.get('content-type') ?? ''
    return isExpectedEnvelope(body, contentType) ? { state: 'succeeded' } : responseUnavailable()
  } catch {
    return timedOut ? requestTimeout() : responseReceived ? responseUnavailable() : transportUnavailable()
  } finally {
    clearTimeout(timeout)
  }
}


async function requestDescriptor(descriptor: MacroCalendarOfficialSourceDescriptor, runAt: string, parentSignal?: AbortSignal): Promise<MacroCalendarHttpResult> {
  const fixed = resolveFixedDescriptor(descriptor)
  if (!fixed) return { ok: false, descriptorId: descriptorId(descriptor), failureCode: 'descriptor-not-allowed' }
  if (fixed.accessMode !== 'http') return { ok: false, descriptorId: fixed.descriptorId, failureCode: 'descriptor-not-allowed' }
  if (fixed.authMode === 'required-api-key') return { ok: false, descriptorId: fixed.descriptorId, failureCode: 'credential-required' }
  if (!isCanonicalUtcMillis(runAt)) return { ok: false, descriptorId: fixed.descriptorId, failureCode: 'run-time-invalid' }
  const command = descriptorCommand(fixed, runAt)
  if (!command) return { ok: false, descriptorId: fixed.descriptorId, failureCode: 'run-time-invalid' }
  if (parentSignal?.aborted) return { ok: false, descriptorId: fixed.descriptorId, failureCode: 'network-request-failed' }
  const fetchImplementation = getPlatformFetch()
  for (let attempt = 1; attempt <= macroCalendarTransportPolicy.maxAttempts; attempt += 1) {
    if (parentSignal?.aborted) return { ok: false, descriptorId: fixed.descriptorId, failureCode: 'network-request-failed' }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), macroCalendarTransportPolicy.requestTimeoutMs)
    const abort = () => controller.abort()
    parentSignal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetchImplementation(fixed.sourceUrl, {
        ...command,
        signal: controller.signal,
        redirect: macroCalendarTransportPolicy.redirectMode
      })
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > macroCalendarTransportPolicy.responseAcceptedMaxBytes) return tooLarge(fixed)
      if (response.status >= 300 && response.status < 400) return { ok: false, descriptorId: fixed.descriptorId, status: response.status, failureCode: 'redirect-rejected' }
      if (macroCalendarTransportPolicy.retryableHttpStatuses.includes(response.status as never) && attempt < macroCalendarTransportPolicy.maxAttempts) continue
      if (response.status < 200 || response.status >= 300) return { ok: false, descriptorId: fixed.descriptorId, status: response.status, failureCode: 'http-response-not-success' }
      const body = await response.text()
      const acceptedBytes = new TextEncoder().encode(body).byteLength
      if (acceptedBytes > macroCalendarTransportPolicy.responseAcceptedMaxBytes) return tooLarge(fixed)
      return { ok: true, descriptorId: fixed.descriptorId, status: response.status, acceptedBytes, body, contentType: response.headers.get('content-type') ?? '' }
    } catch (error) {
      const failureCode = controller.signal.aborted && !parentSignal?.aborted ? 'request-timeout' : 'network-request-failed'
      if (attempt === macroCalendarTransportPolicy.maxAttempts || parentSignal?.aborted) return { ok: false, descriptorId: fixed.descriptorId, failureCode }
    } finally {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abort)
    }
  }
  return { ok: false, descriptorId: fixed.descriptorId, failureCode: 'network-request-failed' }
}

function resolveFixedDescriptor(descriptor: MacroCalendarOfficialSourceDescriptor): MacroCalendarOfficialSourceDescriptor | undefined {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) || !Array.isArray(descriptor.eventFamilies)) return undefined
  if (typeof descriptor.descriptorId !== 'string') return undefined
  const fixed = getMacroCalendarOfficialSourceDescriptor(descriptor.descriptorId)
  return fixed && fixed.descriptorId === descriptor.descriptorId &&
    fixed.providerId === descriptor.providerId && fixed.sourceUrl === descriptor.sourceUrl &&
    fixed.payloadFormat === descriptor.payloadFormat && fixed.parserId === descriptor.parserId &&
    fixed.authMode === descriptor.authMode && fixed.pollEligibility === descriptor.pollEligibility &&
    fixed.evidenceLabel === descriptor.evidenceLabel && fixed.accessMode === descriptor.accessMode &&
    sameEventFamilies(fixed.eventFamilies, descriptor.eventFamilies)
    ? fixed
    : undefined
}

function sameEventFamilies(fixed: readonly string[], candidate: readonly string[]): boolean {
  return fixed.length === candidate.length && fixed.every((family, index) => family === candidate[index])
}

function descriptorId(descriptor: MacroCalendarOfficialSourceDescriptor): string {
  return typeof descriptor?.descriptorId === 'string' ? descriptor.descriptorId : 'unknown-descriptor'
}

function isOfficialFomcStatementUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === fedFomcStatementTransportPolicy.hostname && !url.username && !url.password &&
      !url.port && !url.search && !url.hash && fedFomcStatementTransportPolicy.statementPath.test(url.pathname)
  } catch {
    return false
  }
}

function hasAcceptedFomcStatementContentLength(headers: Headers): boolean {
  const value = headers.get('content-length')
  return value === null || (fedFomcStatementTransportPolicy.contentLengthPattern.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= fedFomcStatementTransportPolicy.maximumBytes)
}

async function readBoundedFomcStatementBody(body: ReadableStream<Uint8Array> | null): Promise<{ value: string; acceptedBytes: number } | undefined> {
  if (!body) return undefined
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let acceptedBytes = 0
  let accepted = false
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!(next.value instanceof Uint8Array)) return undefined
      acceptedBytes += next.value.byteLength
      if (acceptedBytes > fedFomcStatementTransportPolicy.maximumBytes) return undefined
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(acceptedBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    accepted = true
    return { value: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), acceptedBytes }
  } finally {
    if (!accepted) await discardFomcStatementReader(reader)
    try { reader.releaseLock() } catch { /* Safe reader cleanup. */ }
  }
}

async function discardFomcStatementReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { await reader.cancel() } catch { /* Safe body discard. */ }
}

async function discardFomcStatementBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try { await body?.cancel() } catch { /* Safe body discard. */ }
}

function descriptorCommand(descriptor: MacroCalendarOfficialSourceDescriptor, runAt: string): { method: 'GET' } | { method: 'POST'; headers: { 'Content-Type': 'application/json' }; body: string } | undefined {
  if (descriptor.descriptorId !== 'macro-calendar-bls-values') return { method: 'GET' }
  const body = buildBlsObservedValuesRequest(runAt)
  return body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body } : undefined
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function tooLarge(descriptor: MacroCalendarOfficialSourceDescriptor): MacroCalendarHttpResult {
  return { ok: false, descriptorId: descriptor.descriptorId, failureCode: 'response-body-too-large' }
}

function safeConnectionProviderId(value: unknown): MacroCalendarSettingsProviderId | undefined {
  return typeof value === 'string' && macroCalendarConnectionTestPolicy.providerIds.includes(value as MacroCalendarSettingsProviderId)
    ? value as MacroCalendarSettingsProviderId
    : undefined
}
function isNonEmptyHtmlBody(value: string): boolean {
  const body = value.trim().toLowerCase()
  return body.length > 0 && (body.startsWith('<!doctype html') || body.startsWith('<html'))
}
function transportUnavailable(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'transport-unavailable' } }
function requestTimeout(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'request-timeout' } }
function responseUnavailable(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'response-unavailable' } }
