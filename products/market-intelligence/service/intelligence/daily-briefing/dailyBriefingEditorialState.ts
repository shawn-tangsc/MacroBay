import {
  dailyBriefingPolicy,
  type DailyBriefingDocument
} from '../../../contracts/dailyBriefing'

/**
 * 编辑侧的 provenance：这份文档由哪个模型写、编辑那一步有没有失败，以及一份存下来的文档
 * 是否还属于当前策略。
 *
 * 抽在这里是因为它们全是**纯文档变换**：生成流程只决定「什么时候套用」，不决定「文档怎么说自己
 * 是怎么写出来的」。放在服务里会让一段两百多行的运行流程和三个单行断言混在一起，改哪一半都要
 * 先读另一半。
 */

/**
 * The model the agent session actually ran. `editorialMeta` is what a reader (and the history
 * rail) can audit, so it names the concrete `providerId:modelId` rather than "agent-session", and
 * carries the fallback reason when the stored custom choice was not callable.
 */
export function withEditorialModel(
  document: DailyBriefingDocument,
  model: Readonly<{ providerId: string; modelId: string; source: 'default' | 'custom'; fallback?: 'custom-unavailable' }>
): DailyBriefingDocument {
  const meta = document.provenance.editorialMeta
  return Object.freeze({
    ...document,
    provenance: Object.freeze({
      ...document.provenance,
      editorialMeta: Object.freeze({
        promptVersion: meta?.promptVersion ?? 'daily-briefing.agent.v2',
        model: `${model.providerId}:${model.modelId}`,
        source: model.source,
        ...(model.fallback ? { fallback: model.fallback } : {})
      })
    })
  })
}

export function markEditorialFailure(
  document: DailyBriefingDocument,
  failureCode: string,
  failureDetail?: string,
  sessionId?: string
): DailyBriefingDocument {
  return Object.freeze({
    ...document,
    provenance: Object.freeze({
      ...document.provenance,
      ...(sessionId ? { aiSessionId: sessionId } : {}),
      editorialFailure: failureCode,
      ...(failureDetail ? { editorialFailureDetail: failureDetail } : {})
    })
  })
}

export function isCurrent(document: DailyBriefingDocument): boolean {
  return document.schemaVersion === dailyBriefingPolicy.schemaVersion && document.policyVersion === dailyBriefingPolicy.policyVersion
}
