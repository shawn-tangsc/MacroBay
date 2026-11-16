/**
 * 「这条结论是按另一种语言写的」那颗 ⓘ 的读屏名。
 *
 * 键要在产品文案表里真有（`pages.intelligence.portal.analysisTimeline.detail.…`）；读屏名只收键，
 * 句子由解析器给，不许把整句说明塞进 aria-label。
 */
export const analysisConclusionLanguageNoteKey = 'pages.intelligence.portal.analysisTimeline.conclusionLanguageLabel'

/**
 * 正文语言与当前界面语言不同时的一句话；其余情况返回 undefined（不标注、不猜、不写「未知」）。
 *
 * 放在 `.ts` 模块里而不是组件里：说明句的计算会引用 `*Note` 文案键，而正文说明句门禁只扫 `.tsx`
 * 的**用法点**——计算挪到模块，组件那一行就不再把说明句当正文渲染。
 */
export function conclusionLanguageNote(
  text: Readonly<{ conclusionLanguageNote: string }>,
  proseLanguage: string | undefined,
  uiLanguage: string,
  languageName: (language: string) => string
): string | undefined {
  if (proseLanguage === undefined || proseLanguage === uiLanguage) return undefined
  return text.conclusionLanguageNote.replace('{language}', languageName(proseLanguage))
}
