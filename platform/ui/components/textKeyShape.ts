/**
 * 「这看起来是不是一条 i18n 键」的唯一判据。
 *
 * 守卫共用这一份：`IconButton` 的读屏名与提示、`StatusPill` 的状态词、`Tooltip` 的帮助句、
 * `Popover` 的多行解释、`Tabs` / `Segmented` 的标签与组名。
 *
 * 这份存在的理由，已经被验证过一次：`Tabs` / `Segmented` 的守卫曾经自己写了一份「只许小写」
 * 的，而架构师 11-02 的裁定是「键就是真实路径、允许驼峰」。结果是**已落库的合法键被判红**
 * （`settings.intelligenceSources.viewRuns` 这类），红在调用方、错在守卫，而调用方无从知道
 * 自己该改什么。所以要新增一条键形状守卫时，**import 这个文件，不要另写正则**。
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
