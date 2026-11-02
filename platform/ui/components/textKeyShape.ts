/**
 * 「这看起来是不是一条 i18n 键」的唯一判据。
 *
 * 三条守卫共用这一份：`IconButton` 的读屏名与提示、`StatusPill` 的状态词、`Tooltip` 的帮助句。
 * 三处各写一个正则，迟早出现两套标准——同一个键在一处通过、在另一处报红，产品线于是开始
 * 猜「到底按哪套写」。
 *
 * 判据只有三条：**点分、无空白、无中文**。
 * - **允许驼峰**：键是文案表的路径，不是标识符规范。产品键本来就长成
 *   `pages.intelligence.portal.analysisWorkspace.newChatAction`，为了过守卫再翻一套 kebab 名，
 *   等于同一句话两个名字——那正是要被清掉的东西（架构师 2026-11-02 裁定）。
 * - **不判「键在不在表里」**：产品自有 i18n 表是合法来源，在不在那张表里由产品自己的用例保证，
 *   组件侧枚举不出来。
 * - **不判「是不是字面量」**：正则看不进变量，传参交给类型。
 *   一句话分工：**静态守卫管能看见的字符串，类型系统管看不见的传参。**
 */
export const TEXT_KEY_SHAPE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+(-[A-Za-z0-9]+)*)+$/

/** 供守卫与用例共用；写成函数是为了让反向用例读起来是「判一个值」，不是「跑一个正则」。 */
export function looksLikeTextKey(value: string): boolean {
  return TEXT_KEY_SHAPE.test(value)
}
