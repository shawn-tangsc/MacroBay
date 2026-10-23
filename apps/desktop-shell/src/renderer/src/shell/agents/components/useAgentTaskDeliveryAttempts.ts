import { useEffect, useRef, useState } from 'react'

import type { TaskDeliveryAttemptEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

import { getTaskDeliveryAttemptsViaApi, retryTaskDeliveryViaApi } from '../agentTaskDataApi'

export function shouldApplyDeliveryAttemptResponse(input: {
  latestRequestId: number
  responseRequestId: number
  latestRunLogId: string | null
  responseRunLogId: string
}): boolean {
  return input.latestRequestId === input.responseRequestId && input.latestRunLogId === input.responseRunLogId
}

export function useAgentTaskDeliveryAttempts(input: {
  agentId: string
  runLogId: string | null
}): {
  attempts: TaskDeliveryAttemptEntity[]
  total: number
  loadMore: () => Promise<void>
  retry: (attemptId: string) => Promise<{ delivered: number; failed: number; skipped: number; unknown: number } | null>
} {
  const [attempts, setAttempts] = useState<TaskDeliveryAttemptEntity[]>([])
  const [total, setTotal] = useState(0)
  const requestId = useRef(0)
  const latestRunLogId = useRef<string | null>(input.runLogId)

  async function load(offset: number, replace: boolean): Promise<void> {
    const runLogId = input.runLogId
    if (!runLogId) return
    const currentRequestId = ++requestId.current
    const page = await getTaskDeliveryAttemptsViaApi(window.platform, input.agentId, runLogId, { limit: 20, offset })
    if (!shouldApplyDeliveryAttemptResponse({
      latestRequestId: requestId.current,
      responseRequestId: currentRequestId,
      latestRunLogId: latestRunLogId.current,
      responseRunLogId: runLogId
    })) return
    setAttempts((current) => replace ? page.attempts : [...current, ...page.attempts])
    setTotal(page.total)
  }

  useEffect(() => {
    requestId.current += 1
    latestRunLogId.current = input.runLogId
    if (!input.runLogId) {
      setAttempts([])
      setTotal(0)
      return
    }
    void load(0, true).catch(() => {
      if (latestRunLogId.current !== input.runLogId) return
      setAttempts([])
      setTotal(0)
    })
  }, [input.agentId, input.runLogId])

  return {
    attempts,
    total,
    loadMore: () => load(attempts.length, false),
    retry: async (attemptId) => {
      if (!input.runLogId) return null
      const summary = await retryTaskDeliveryViaApi(window.platform, input.agentId, input.runLogId, attemptId)
      await load(0, true)
      return summary
    }
  }
}
