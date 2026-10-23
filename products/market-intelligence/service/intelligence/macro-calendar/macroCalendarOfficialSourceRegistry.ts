import type { MacroCalendarProviderId } from './macroCalendarContracts'
import { zeroXRouterCalendarEvidenceAdmissionPolicy } from '../application/zeroXRouterSourcePolicy'

export type MacroCalendarDescriptorId =
  | 'macro-calendar-fed-schedule'
  | 'macro-calendar-fed-statement'
  | 'macro-calendar-fed-statement-history'
  | 'macro-calendar-bls-schedule'
  | 'macro-calendar-bls-values'
  | 'macro-calendar-bls-ics-manual'
  | 'macro-calendar-bea-schedule'
  | 'macro-calendar-bea-release-rss'

export type MacroCalendarOfficialSourceDescriptor = {
  descriptorId: MacroCalendarDescriptorId
  providerId: MacroCalendarProviderId
  sourceUrl: string
  payloadFormat: 'html' | 'json' | 'text'
  parserId: string
  eventFamilies: readonly string[]
  authMode: 'none' | 'optional-api-key' | 'required-api-key'
  pollEligibility: 'schedule' | 'release-window'
  evidenceLabel: 'schedule-html' | 'statement-text' | 'official-values-json' | 'manual-ics' | 'official-release-rss'
  accessMode: 'http' | 'manual-upload'
}

export type MacroCalendarEvidenceOnlySourceDescriptor = Omit<MacroCalendarOfficialSourceDescriptor, 'descriptorId' | 'providerId' | 'eventFamilies' | 'authMode' | 'pollEligibility' | 'evidenceLabel'> & {
  descriptorId: 'macro-calendar-0xrouter-economic-data' | 'macro-calendar-0xrouter-financial-events' | 'macro-calendar-0xrouter-central-bank-activities'
  providerId: 'macro-calendar-0xrouter'
  eventFamilies: readonly []
  authMode: 'required-api-key'
  pollEligibility: 'evidence-only'
  evidenceLabel: 'provider-calendar-json'
}

export type MacroCalendarEvidenceSourceDescriptor = MacroCalendarOfficialSourceDescriptor | MacroCalendarEvidenceOnlySourceDescriptor

export const macroCalendarOfficialSourceRegistry: readonly MacroCalendarOfficialSourceDescriptor[] = [
  { descriptorId: 'macro-calendar-fed-schedule', providerId: 'macro-calendar-fed', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', payloadFormat: 'html', parserId: 'fed-fomc-calendar-v1', eventFamilies: ['fomc'], authMode: 'none', pollEligibility: 'schedule', evidenceLabel: 'schedule-html', accessMode: 'http' },
  { descriptorId: 'macro-calendar-fed-statement', providerId: 'macro-calendar-fed', sourceUrl: 'https://www.federalreserve.gov/feeds/press_all.xml', payloadFormat: 'text', parserId: 'fed-fomc-statement-v1', eventFamilies: ['fomc'], authMode: 'none', pollEligibility: 'release-window', evidenceLabel: 'statement-text', accessMode: 'http' },
  { descriptorId: 'macro-calendar-fed-statement-history', providerId: 'macro-calendar-fed', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', payloadFormat: 'html', parserId: 'fed-fomc-statement-history-v1', eventFamilies: ['fomc'], authMode: 'none', pollEligibility: 'release-window', evidenceLabel: 'statement-text', accessMode: 'http' },
  { descriptorId: 'macro-calendar-bls-schedule', providerId: 'macro-calendar-bls', sourceUrl: 'https://www.bls.gov/schedule/news_release/', payloadFormat: 'html', parserId: 'bls-release-calendar-v1', eventFamilies: ['cpi', 'core-cpi', 'employment-situation'], authMode: 'none', pollEligibility: 'schedule', evidenceLabel: 'schedule-html', accessMode: 'http' },
  { descriptorId: 'macro-calendar-bls-values', providerId: 'macro-calendar-bls', sourceUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/', payloadFormat: 'json', parserId: 'bls-calendar-values-v1', eventFamilies: ['cpi', 'core-cpi', 'employment-situation'], authMode: 'optional-api-key', pollEligibility: 'release-window', evidenceLabel: 'official-values-json', accessMode: 'http' },
  { descriptorId: 'macro-calendar-bls-ics-manual', providerId: 'macro-calendar-bls', sourceUrl: 'https://www.bls.gov/schedule/news_release/bls.ics', payloadFormat: 'text', parserId: 'bls-manual-ics-v1', eventFamilies: ['consumer-price-index', 'employment-situation'], authMode: 'none', pollEligibility: 'schedule', evidenceLabel: 'manual-ics', accessMode: 'manual-upload' },
  { descriptorId: 'macro-calendar-bea-schedule', providerId: 'macro-calendar-bea', sourceUrl: 'https://www.bea.gov/news/schedule', payloadFormat: 'html', parserId: 'bea-release-calendar-v1', eventFamilies: ['pce', 'core-pce', 'gdp'], authMode: 'none', pollEligibility: 'schedule', evidenceLabel: 'schedule-html', accessMode: 'http' },
  { descriptorId: 'macro-calendar-bea-release-rss', providerId: 'macro-calendar-bea', sourceUrl: 'https://apps.bea.gov/rss/rss.xml', payloadFormat: 'text', parserId: 'bea-official-release-rss-v1', eventFamilies: ['pce', 'core-pce', 'gdp'], authMode: 'none', pollEligibility: 'release-window', evidenceLabel: 'official-release-rss', accessMode: 'http' }
]

export const zeroXRouterCalendarEvidenceDescriptors: readonly MacroCalendarEvidenceOnlySourceDescriptor[] = [
  { descriptorId: 'macro-calendar-0xrouter-economic-data', providerId: 'macro-calendar-0xrouter', sourceUrl: `${zeroXRouterCalendarEvidenceAdmissionPolicy.baseUrl}/${zeroXRouterCalendarEvidenceAdmissionPolicy.paths['macro-calendar-0xrouter-economic-data']}`, payloadFormat: 'json', parserId: '0xrouter-calendar-evidence-only-v1', eventFamilies: [], authMode: 'required-api-key', pollEligibility: 'evidence-only', evidenceLabel: 'provider-calendar-json', accessMode: 'http' },
  { descriptorId: 'macro-calendar-0xrouter-financial-events', providerId: 'macro-calendar-0xrouter', sourceUrl: `${zeroXRouterCalendarEvidenceAdmissionPolicy.baseUrl}/${zeroXRouterCalendarEvidenceAdmissionPolicy.paths['macro-calendar-0xrouter-financial-events']}`, payloadFormat: 'json', parserId: '0xrouter-calendar-evidence-only-v1', eventFamilies: [], authMode: 'required-api-key', pollEligibility: 'evidence-only', evidenceLabel: 'provider-calendar-json', accessMode: 'http' },
  { descriptorId: 'macro-calendar-0xrouter-central-bank-activities', providerId: 'macro-calendar-0xrouter', sourceUrl: `${zeroXRouterCalendarEvidenceAdmissionPolicy.baseUrl}/${zeroXRouterCalendarEvidenceAdmissionPolicy.paths['macro-calendar-0xrouter-central-bank-activities']}`, payloadFormat: 'json', parserId: '0xrouter-calendar-evidence-only-v1', eventFamilies: [], authMode: 'required-api-key', pollEligibility: 'evidence-only', evidenceLabel: 'provider-calendar-json', accessMode: 'http' }
]

const macroCalendarEvidenceSourceRegistry: readonly MacroCalendarEvidenceSourceDescriptor[] = [
  ...macroCalendarOfficialSourceRegistry,
  ...zeroXRouterCalendarEvidenceDescriptors
]

export function getMacroCalendarOfficialSourceDescriptor(descriptorId: string): MacroCalendarOfficialSourceDescriptor | undefined {
  return macroCalendarOfficialSourceRegistry.find((descriptor) => descriptor.descriptorId === descriptorId)
}

export function getMacroCalendarEvidenceSourceDescriptor(descriptorId: string): MacroCalendarEvidenceSourceDescriptor | undefined {
  return macroCalendarEvidenceSourceRegistry.find((descriptor) => descriptor.descriptorId === descriptorId)
}

export function isFixedMacroCalendarDescriptor(descriptor: MacroCalendarOfficialSourceDescriptor): boolean {
  const fixed = getMacroCalendarOfficialSourceDescriptor(descriptor.descriptorId)
  return Boolean(fixed && fixed.sourceUrl === descriptor.sourceUrl && fixed.providerId === descriptor.providerId &&
    fixed.payloadFormat === descriptor.payloadFormat && fixed.parserId === descriptor.parserId &&
    fixed.authMode === descriptor.authMode && fixed.pollEligibility === descriptor.pollEligibility &&
    fixed.evidenceLabel === descriptor.evidenceLabel && fixed.accessMode === descriptor.accessMode &&
    fixed.eventFamilies.length === descriptor.eventFamilies.length &&
    fixed.eventFamilies.every((family, index) => family === descriptor.eventFamilies[index]))
}

export function isFixedMacroCalendarEvidenceDescriptor(descriptor: MacroCalendarEvidenceSourceDescriptor): boolean {
  const fixed = getMacroCalendarEvidenceSourceDescriptor(descriptor.descriptorId)
  return Boolean(fixed && fixed.providerId === descriptor.providerId && fixed.sourceUrl === descriptor.sourceUrl &&
    fixed.payloadFormat === descriptor.payloadFormat && fixed.parserId === descriptor.parserId &&
    fixed.authMode === descriptor.authMode && fixed.pollEligibility === descriptor.pollEligibility &&
    fixed.evidenceLabel === descriptor.evidenceLabel && fixed.accessMode === descriptor.accessMode &&
    fixed.eventFamilies.length === descriptor.eventFamilies.length && fixed.eventFamilies.every((family, index) => family === descriptor.eventFamilies[index]))
}
