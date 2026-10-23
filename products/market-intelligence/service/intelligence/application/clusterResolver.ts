import type { IntelligenceEventCluster, IntelligenceItem } from '../schema/intelligenceRecord'

export type ClusterCandidate = {
  sourceId: string
  sourceGroup: string
  clusterType: IntelligenceEventCluster['clusterType']
  clusterKey: string
  title: string
  publishedAt?: string
  detectedAt: string
  entities: string[]
  itemId: string
  trustLevel: 'high' | 'medium' | 'low'
}

export type ClusterResolverInput = {
  candidate: ClusterCandidate
  existingClusters: IntelligenceEventCluster[]
  existingItems: IntelligenceItem[]
}

export type ClusterResolverResult = {
  cluster: IntelligenceEventCluster
  created: boolean
}

const EXCHANGE_GROUPS = new Set(['exchange-announcement', 'exchange-status'])
const CROSS_SOURCE_CLUSTER_TYPES = new Set(['macro-event', 'regulatory-event', 'news-event'])

export function resolveCluster(input: ClusterResolverInput): ClusterResolverResult {
  const { candidate, existingClusters, existingItems } = input

  const sameKey = existingClusters.find((cluster) => cluster.clusterKey === candidate.clusterKey)
  if (sameKey) {
    return {
      cluster: updateCluster(sameKey, candidate),
      created: false
    }
  }

  if (EXCHANGE_GROUPS.has(candidate.sourceGroup)) {
    return {
      cluster: createCluster(candidate),
      created: true
    }
  }

  if (!CROSS_SOURCE_CLUSTER_TYPES.has(candidate.clusterType)) {
    return {
      cluster: createCluster(candidate),
      created: true
    }
  }

  const crossSourceMatch = existingClusters.find((cluster) =>
    canCrossSourceCluster(cluster, candidate, existingItems)
  )

  if (crossSourceMatch) {
    return {
      cluster: updateCluster(crossSourceMatch, candidate),
      created: false
    }
  }

  return {
    cluster: createCluster(candidate),
    created: true
  }
}

function canCrossSourceCluster(
  cluster: IntelligenceEventCluster,
  candidate: ClusterCandidate,
  items: IntelligenceItem[]
): boolean {
  if (!CROSS_SOURCE_CLUSTER_TYPES.has(cluster.clusterType)) return false
  if (cluster.clusterType !== candidate.clusterType) return false

  const clusterItems = items.filter((item) => item.clusterId === cluster.clusterId)
  const clusterEntities = new Set(
    clusterItems.flatMap((item) => parseJsonArray(item.entitiesJson))
  )
  const entityOverlap = candidate.entities.some((entity) => clusterEntities.has(entity))
  if (!entityOverlap) return false

  const clusterTime = new Date(cluster.lastPublishedAt ?? cluster.lastDetectedAt).getTime()
  const candidateTime = new Date(candidate.publishedAt ?? candidate.detectedAt).getTime()
  if (Math.abs(candidateTime - clusterTime) > 60 * 60 * 1000) return false

  return titleSimilarity(cluster.title, candidate.title) >= 0.5
}

function createCluster(candidate: ClusterCandidate): IntelligenceEventCluster {
  return {
    clusterId: `cluster-${candidate.clusterKey}`,
    clusterKey: candidate.clusterKey,
    clusterType: candidate.clusterType,
    title: candidate.title,
    primaryItemId: candidate.itemId,
    primarySourceId: candidate.sourceId,
    status: 'open',
    firstPublishedAt: candidate.publishedAt,
    lastPublishedAt: candidate.publishedAt,
    lastDetectedAt: candidate.detectedAt,
    clusterVersion: 'v1'
  }
}

function updateCluster(cluster: IntelligenceEventCluster, candidate: ClusterCandidate): IntelligenceEventCluster {
  return {
    ...cluster,
    title: cluster.title || candidate.title,
    lastPublishedAt: candidate.publishedAt ?? cluster.lastPublishedAt,
    lastDetectedAt: candidate.detectedAt,
    status: cluster.status === 'resolved' ? 'updated' : cluster.status,
    relatedSourceIdsJson: mergeUniqueJson(cluster.relatedSourceIdsJson, candidate.sourceId)
  }
}

function mergeUniqueJson(existingJson: string | undefined, value: string): string | undefined {
  const values = new Set(parseJsonArray(existingJson))
  values.add(value)
  return JSON.stringify([...values])
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function titleSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left)
  const rightTokens = tokenize(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size)
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  )
}

export function buildStatuspageClusterKey(vendorIncidentId: string): string {
  return `statuspage:${vendorIncidentId}`
}

export function buildExchangeAnnouncementClusterKey(sourceId: string, canonicalKey: string): string {
  return `exchange:${sourceId}:${canonicalKey}`
}
