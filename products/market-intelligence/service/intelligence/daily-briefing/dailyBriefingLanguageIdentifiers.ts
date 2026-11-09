import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { briefingDataFactIds } from './dailyBriefingDataSelection'
import { briefingTextLeaves } from './dailyBriefingTextScanner'

/**
 * 语言扫描的**登记表**（`04` §3.4.2）：哪些串是标识符、不是正文。
 *
 * 规矩只有一条：**这个串是不是我们自己在建文档时写进去的**。
 *
 * - `before` 是编辑前的（事实层）文档，模型一个字都没碰过；它里面已有的字符串都是我们的
 *   —— i18n 键（`labelKey`/`titleKey`）、闭集码（`category`/`reasonCode`/空态码）、读数、
 *   来源名。这是"登记事实"，不是"猜哪个字段安全"：字段名一改，它们照样在，行为不变。
 * - `after` 是应用编辑之后、要交给读者的文档。引用与审计是系统在这一步补的：`data:` 事实号、
 *   `news:`/`macro:` 引用、`query:` 引用号、`selectionAudit` 的 factId 与内部理由、
 *   provenance 里的版本与模型。它们同样是"我们写的"。
 * - **不在表里的串一律当正文扫**（fail closed）：模型新写的句子永远不在表里，所以扫得到。
 *
 * 注意这不是词汇白名单：表里只有我们自己写出的标识符与数据，没有一句"允许的措辞"。
 */
export function briefingLanguageIdentifiers(input: Readonly<{
  before: DailyBriefingDocument
  after: DailyBriefingDocument
}>): ReadonlySet<string> {
  const identifiers = new Set<string>()
  for (const leaf of briefingTextLeaves(input.before)) identifiers.add(leaf.text)
  for (const id of briefingDataFactIds(input.before)) identifiers.add(id)
  for (const id of briefingDataFactIds(input.after)) identifiers.add(id)
  const document = input.after
  for (const item of document.news.items) {
    identifiers.add(item.itemId)
    identifiers.add(`news:${item.itemId}`)
  }
  for (const item of document.news.macro) {
    identifiers.add(item.eventKey)
    identifiers.add(`macro:${item.eventKey}`)
  }
  for (const item of document.next.items) identifiers.add(item.eventKey)
  if (document.next.focus) identifiers.add(document.next.focus.eventKey)
  for (const id of document.conclusion?.synthesizedFrom ?? []) identifiers.add(id)
  for (const id of document.provenance.selectionAudit?.shown ?? []) identifiers.add(id)
  for (const entry of document.provenance.selectionAudit?.hidden ?? []) {
    identifiers.add(entry.factId)
    // 审计理由是我们写给人排查的短句，读者看不到；它不该由语言扫描来决定整版能不能出。
    identifiers.add(entry.reason)
  }
  for (const citation of document.citations) {
    identifiers.add(citation.refId)
    if (citation.sourceLabel) identifiers.add(citation.sourceLabel)
  }
  const meta = document.provenance.editorialMeta
  for (const value of [
    meta?.promptVersion, meta?.model, meta?.source, meta?.fallback,
    document.provenance.editorialFailure, document.provenance.editorialFailureDetail
  ]) {
    if (typeof value === 'string' && value.length > 0) identifiers.add(value)
  }
  return identifiers
}

/**
 * 逐字来自输入、允许保留原文的串：新闻标题与译文、来源名、事件名与国家名。
 *
 * 这是**来源数据**白名单（用户 2026-11-08 允许的那一类），不是词汇表：只放"这句话本来就长这样"
 * 的原文，模型自己写的句子不在其中。
 */
export function briefingLanguageSourceTexts(document: DailyBriefingDocument): readonly string[] {
  const texts: string[] = []
  for (const item of document.news.items) {
    texts.push(item.title)
    if (item.translatedTitle) texts.push(item.translatedTitle)
    texts.push(item.sourceName)
  }
  for (const item of document.news.macro) {
    texts.push(item.title)
    if (item.countryName) texts.push(item.countryName)
  }
  for (const item of document.next.items) texts.push(item.title)
  if (document.next.focus) texts.push(document.next.focus.title)
  return texts.filter((text) => text.trim().length > 0)
}
