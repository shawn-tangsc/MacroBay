import type { BriefingIssue } from './dailyBriefingIssues'
import { briefingIssueTemplateCodes } from './dailyBriefingIssues'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 一份**读不懂**的文档，本身也是一条缺口（`02` v2.129 G5 ②）。
 *
 * 文档的形状本机不认时，没有文档可解析，`briefingIssues` 一条也产不出来——于是页面只能报"失败"。
 * 这条由页面自己造：它说的是"这一版没有被渲染"这个事实，带原因，进右列留痕，不折叠成"读不到"。
 * 模板名与原因码仍取自 `dailyBriefingIssues` 那一处映射，不在这里另写一份。
 *
 * `at` 留空：读不懂，就没有可信的观测时刻；编一个时间等于在说一件不知道的事。
 */
export function briefingDocumentInvalidIssue(text: DailyBriefingText): BriefingIssue {
  return Object.freeze({
    id: 'system:document-invalid',
    severity: 'blocking' as const,
    category: 'system' as const,
    code: briefingIssueTemplateCodes['document-invalid'],
    template: 'document-invalid' as const,
    source: text.limits.sources.system,
    at: '',
    title: text.limits.system.documentInvalid,
    advice: text.limits.advice.rereadEdition
  })
}
