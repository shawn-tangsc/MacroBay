/**
 * 一段文字是不是这一期要的语言（`02` `A0.9` v2.148）。
 *
 * 判的是**整段**，不是逐词：英文版次里出现一整段中文，读者会认定「英文版是假的」；反向同理。
 * 专有名词、代码、机构缩写不算整段——一段里连着两个以上汉字、且汉字到 4 个，才算中文段落，
 * 所以「美联储」（3 个）这种名字不会触发，但「资金流印证」这种短句会。中文版次反过来：
 * 整段没有汉字、且至少三个拉丁词、长度过 15，才算一段英文。
 *
 * 只有一处实现：构造文档时的「不该进英文版的中文」与校验时的「这一笔写出来的语言对不对」
 * 都读这一个函数，别在两处各写一套阈值。
 */
export type BriefingProseLocale = 'zh-CN' | 'en-US'

const CJK_RUN = /[\u3400-\u9fff]{2,}/
const CJK_ALL = /[\u3400-\u9fff]/g
const LATIN_WORD = /[A-Za-z]{3,}/g

export function proseLanguageBreach(text: string, locale: BriefingProseLocale): boolean {
  const value = text.trim()
  if (value.length === 0) return false
  const cjk = (value.match(CJK_ALL) ?? []).length
  if (locale === 'en-US') return CJK_RUN.test(value) && cjk >= 4
  return cjk === 0 && value.length >= 15 && (value.match(LATIN_WORD) ?? []).length >= 3
}
