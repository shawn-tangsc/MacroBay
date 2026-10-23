import {
  fearGreedSnapshotPolicy,
  isCanonicalFearGreedSnapshotTime,
  isFearGreedSnapshotScore,
  resolveFearGreedSnapshotBucket
} from '../../../contracts/intelligenceQueryContracts'
import { dashboardEconomicCalendarSourcePolicy } from './dashboardEconomicCalendarModel'

export const dashboardFearGreedPresentationPolicy = {
  timezone: 'UTC',
  sourceStates: ['loading', 'available', 'empty', 'unavailable'],
  renderFields: ['score', 'bucket', 'observedAt']
} as const

export const FearGreedGaugePresentationPolicy = {
  arcDegrees: 180,
  svgViewBox: '0 0 120 68',
  trackPath: 'M 12 60 A 48 48 0 0 1 108 60',
  bucketTones: {
    'extreme-fear': 'extreme-fear',
    fear: 'fear',
    neutral: 'neutral',
    greed: 'greed',
    'extreme-greed': 'extreme-greed'
  },
  arcSegments: [
    { tone: 'extreme-fear', path: 'M 12 60 A 48 48 0 0 1 21.17 31.79' },
    { tone: 'fear', path: 'M 21.17 31.79 A 48 48 0 0 1 45.17 14.35' },
    { tone: 'neutral', path: 'M 45.17 14.35 A 48 48 0 0 1 74.83 14.35' },
    { tone: 'greed', path: 'M 74.83 14.35 A 48 48 0 0 1 98.83 31.79' },
    { tone: 'extreme-greed', path: 'M 98.83 31.79 A 48 48 0 0 1 108 60' }
  ],
  needleDegrees: (score: number): number => -90 + score / 100 * 180
} as const

export const dashboardRealSourcePolicy = [
  dashboardEconomicCalendarSourcePolicy,
  {
    sourceId: 'fear-greed',
    sourceStates: dashboardFearGreedPresentationPolicy.sourceStates,
    actions: ['manage-intelligence-sources']
  },
  {
    sourceId: 'binance-futures-positioning',
    sourceStates: dashboardFearGreedPresentationPolicy.sourceStates,
    actions: ['manage-intelligence-sources']
  }
] as const

export type DashboardFearGreedState =
  | { state: 'loading' }
  | { state: 'available'; score: number; bucket: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed'; observedAt: string }
  | { state: 'empty' }
  | { state: 'unavailable' }

export type DashboardRealSource = (typeof dashboardRealSourcePolicy)[number]

export function projectDashboardFearGreedSnapshot(value: unknown, asOf: string): DashboardFearGreedState {
  try {
    if (!isCanonicalFearGreedSnapshotTime(asOf)) return { state: 'unavailable' }
    if (isExactRecord(value, ['state', 'asOf', 'score', 'bucket', 'observedAt']) && value.state === 'available' &&
      value.asOf === asOf && isFearGreedSnapshotScore(value.score) && isCanonicalFearGreedSnapshotTime(value.observedAt) && value.observedAt <= asOf) {
      const bucket = resolveFearGreedSnapshotBucket(value.score)
      if (bucket && value.bucket === bucket) return { state: 'available', score: value.score, bucket, observedAt: value.observedAt }
    }
    if (isExactRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === asOf) return { state: 'empty' }
    if (isExactRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === fearGreedSnapshotPolicy.unavailableFailureCode) return { state: 'unavailable' }
    return { state: 'unavailable' }
  } catch {
    return { state: 'unavailable' }
  }
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
  const names = Object.getOwnPropertyNames(value)
  return names.length === fields.length && fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}
