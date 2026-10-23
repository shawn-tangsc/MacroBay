import type { Trigger } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskAutomationPolicy } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationPolicy'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { JobScheduleTriggerView } from '@platform/jobs'

import type { PlatformText } from '../../../i18n/platformText'

export type TaskAutomationLabels = PlatformText['taskAutomation']

export type PolicyFact = {
  key: 'concurrency' | 'minInterval' | 'timeout'
  label: string
  value: string
}

/** 只做展示格式化：时间戳为空/不可解析时返回 null，调用方渲染本地化的「—」。 */
export function formatTimestamp(iso: string | null, language: AppLanguage, timeZone?: string): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat(language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {})
  }).format(new Date(ms))
}

/** 间隔调度按最大整数单位展示（小时 > 分钟 > 秒），保留真实数值不做四舍五入。 */
export function formatIntervalSchedule(intervalMs: number, labels: TaskAutomationLabels): string {
  if (Number.isFinite(intervalMs) && intervalMs > 0 && intervalMs % 3_600_000 === 0) {
    return labels.schedule.everyHours(intervalMs / 3_600_000)
  }
  if (Number.isFinite(intervalMs) && intervalMs > 0 && intervalMs % 60_000 === 0) {
    return labels.schedule.everyMinutes(intervalMs / 60_000)
  }
  return labels.schedule.everySeconds(Math.max(1, Math.round(intervalMs / 1_000)))
}

export function formatTaskSchedule(
  trigger: Trigger,
  labels: TaskAutomationLabels,
  language: AppLanguage,
  timeZone?: string
): string {
  if (trigger.kind === 'interval') return formatIntervalSchedule(trigger.ms, labels)
  if (trigger.kind === 'once') {
    const at = formatTimestamp(new Date(trigger.at).toISOString(), language, timeZone) ?? labels.emptyValue
    return labels.schedule.onceAt(at)
  }
  const expression = labels.schedule.cron(trigger.expr)
  return trigger.timezone ? `${expression} · ${trigger.timezone}` : expression
}

export function formatJobSchedule(
  trigger: JobScheduleTriggerView,
  labels: TaskAutomationLabels,
  language: AppLanguage,
  timeZone?: string
): string {
  if (trigger.kind === 'interval') return formatIntervalSchedule(trigger.intervalMs, labels)
  if (trigger.kind === 'cron') {
    const expression = labels.schedule.cron(trigger.expression)
    return trigger.timezone ? `${expression} · ${trigger.timezone}` : expression
  }
  if (trigger.kind === 'event') return labels.schedule.event(trigger.topic)
  if (trigger.kind === 'startup') return labels.schedule.startup
  return labels.schedule.manual
}

/**
 * 执行策略的三个具体数字。数值全部来自 `taskAutomationPolicy.ts` 的真实 preset
 * （经 `getTaskAutomationPolicy` 返回的 policy 对象），不在这里推断或补默认值。
 */
export function buildPolicyFacts(
  policy: TaskAutomationPolicy,
  labels: TaskAutomationLabels,
  _language: AppLanguage
): PolicyFact[] {
  return [
    {
      key: 'concurrency',
      label: labels.policyConcurrencyLimit,
      value: labels.policyConcurrencyValue(policy.maxActiveTasksPerAgent)
    },
    {
      key: 'minInterval',
      label: labels.policyMinInterval,
      value: formatIntervalSchedule(policy.minimumRecurringIntervalMs, labels)
    },
    {
      key: 'timeout',
      label: labels.policyTimeout,
      value: labels.policyTimeoutValue(policy.maximumTimeoutMinutes)
    }
  ]
}
