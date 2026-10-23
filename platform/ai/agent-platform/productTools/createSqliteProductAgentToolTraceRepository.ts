import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { createAgentPlatformRepositories } from '../repositories/createAgentPlatformRepositories'
import type { ProductAgentToolTraceRepository } from './productAgentToolTraceRepository'

export function createSqliteProductAgentToolTraceRepository(
  database: AgentPlatformDatabase
): ProductAgentToolTraceRepository {
  const repositories = createAgentPlatformRepositories(database)
  return {
    insert: async (trace) => {
      repositories.productToolTraces.insert(trace)
    },
    finalize: async (trace) => {
      repositories.productToolTraces.finalize(trace)
    },
    get: async (toolCallId) => repositories.productToolTraces.get(toolCallId),
    listPage: async (query) => repositories.productToolTraces.listPage(query)
  }
}
