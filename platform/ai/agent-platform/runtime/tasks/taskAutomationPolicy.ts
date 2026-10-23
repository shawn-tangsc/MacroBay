import type { TaskAutomationPolicyPreset } from './taskAutomationContracts'

export const taskMaxStartsPerAgentPerHour = 60

export type TaskAutomationPolicy = {
  maxActiveTasksPerAgent: number
  minimumRecurringIntervalMs: number
  maximumTimeoutMinutes: number
  maxChannelsPerTask: number
}

const policies: Record<TaskAutomationPolicyPreset, TaskAutomationPolicy> = {
  balanced: {
    maxActiveTasksPerAgent: 30,
    minimumRecurringIntervalMs: 5 * 60 * 1000,
    maximumTimeoutMinutes: 120,
    maxChannelsPerTask: 10
  },
  conservative: {
    maxActiveTasksPerAgent: 10,
    minimumRecurringIntervalMs: 15 * 60 * 1000,
    maximumTimeoutMinutes: 30,
    maxChannelsPerTask: 5
  }
}

export function getTaskAutomationPolicy(preset: TaskAutomationPolicyPreset): TaskAutomationPolicy {
  return policies[preset]
}

export function validateTaskAutomationLimits(
  policy: TaskAutomationPolicy,
  input: { activeTaskCount: number; timeoutMinutes: number }
): { ok: true } | { ok: false; code: 'task-policy-limit' } {
  return input.activeTaskCount >= policy.maxActiveTasksPerAgent ||
    !Number.isFinite(input.timeoutMinutes) ||
    !Number.isInteger(input.timeoutMinutes) ||
    input.timeoutMinutes < 1 ||
    input.timeoutMinutes > policy.maximumTimeoutMinutes
    ? { ok: false, code: 'task-policy-limit' }
    : { ok: true }
}
