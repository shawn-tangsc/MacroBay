import { readJsonFileRecovering, readJsonFileRecoveringSync, writeJsonFileAtomicallySync } from '@platform/storage/jsonFileStorage'

import type { IntelligenceAssessment } from '../schema/intelligenceAssessment'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import type {
  IntelligenceEventCluster,
  IntelligenceItem,
  IntelligenceItemRevision
} from '../schema/intelligenceRecord'
import type {
  IntelligenceSentimentAggregate,
  SentimentSignalInput
} from '../schema/intelligenceSentiment'

export type IntelligencePipelineSnapshot = {
  items: IntelligenceItem[]
  clusters: IntelligenceEventCluster[]
  revisions: IntelligenceItemRevision[]
  assessments: IntelligenceAssessment[]
  sentimentSignals: SentimentSignalInput[]
  sentimentAggregates: IntelligenceSentimentAggregate[]
  metricEvents: MetricIntelligenceEvent[]
  impacts: IntelligenceImpact[]
  updatedAt: string
}

export type IntelligencePipelineStateStorage = {
  read: () => Promise<IntelligencePipelineSnapshot>
  write: (snapshot: IntelligencePipelineSnapshot) => Promise<void>
}

export function createEmptyIntelligencePipelineSnapshot(): IntelligencePipelineSnapshot {
  return {
    items: [],
    clusters: [],
    revisions: [],
    assessments: [],
    sentimentSignals: [],
    sentimentAggregates: [],
    metricEvents: [],
    impacts: [],
    updatedAt: new Date().toISOString()
  }
}

export function createInMemoryIntelligencePipelineStateStorage(
  initial: IntelligencePipelineSnapshot = createEmptyIntelligencePipelineSnapshot()
): IntelligencePipelineStateStorage {
  let snapshot = initial
  return {
    async read() {
      return cloneSnapshot(snapshot)
    },
    async write(next) {
      snapshot = cloneSnapshot(next)
    }
  }
}

export function createIntelligencePipelineJsonStorage(filePath: string): IntelligencePipelineStateStorage {
  return {
    async read() {
      const parsed = await readJsonFileRecovering(filePath)
      return parsed === undefined ? createEmptyIntelligencePipelineSnapshot() : normalizeIntelligencePipelineSnapshot(parsed)
    },
    async write(snapshot) {
      writeJsonFileAtomicallySync(filePath, snapshot)
    }
  }
}

export function readIntelligencePipelineSnapshotSync(filePath: string): IntelligencePipelineSnapshot {
  const parsed = readJsonFileRecoveringSync(filePath)
  return parsed === undefined ? createEmptyIntelligencePipelineSnapshot() : normalizeIntelligencePipelineSnapshot(parsed)
}

export function normalizeIntelligencePipelineSnapshot(value: unknown): IntelligencePipelineSnapshot {
  if (!value || typeof value !== 'object') return createEmptyIntelligencePipelineSnapshot()
  const candidate = value as Partial<IntelligencePipelineSnapshot>
  return {
    items: Array.isArray(candidate.items) ? candidate.items.filter(Boolean) as IntelligenceItem[] : [],
    clusters: Array.isArray(candidate.clusters) ? candidate.clusters.filter(Boolean) as IntelligenceEventCluster[] : [],
    revisions: Array.isArray(candidate.revisions) ? candidate.revisions.filter(Boolean) as IntelligenceItemRevision[] : [],
    assessments: Array.isArray(candidate.assessments) ? candidate.assessments.filter(Boolean) as IntelligenceAssessment[] : [],
    sentimentSignals: Array.isArray(candidate.sentimentSignals)
      ? candidate.sentimentSignals.filter(Boolean) as SentimentSignalInput[]
      : [],
    sentimentAggregates: Array.isArray(candidate.sentimentAggregates)
      ? candidate.sentimentAggregates.filter(Boolean) as IntelligenceSentimentAggregate[]
      : [],
    metricEvents: Array.isArray(candidate.metricEvents)
      ? candidate.metricEvents.filter(Boolean) as MetricIntelligenceEvent[]
      : [],
    impacts: Array.isArray(candidate.impacts) ? candidate.impacts.filter(Boolean) as IntelligenceImpact[] : [],
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString()
  }
}

function cloneSnapshot(snapshot: IntelligencePipelineSnapshot): IntelligencePipelineSnapshot {
  return {
    items: [...snapshot.items],
    clusters: [...snapshot.clusters],
    revisions: [...snapshot.revisions],
    assessments: [...snapshot.assessments],
    sentimentSignals: [...snapshot.sentimentSignals],
    sentimentAggregates: [...snapshot.sentimentAggregates],
    metricEvents: [...snapshot.metricEvents],
    impacts: [...snapshot.impacts],
    updatedAt: snapshot.updatedAt
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
