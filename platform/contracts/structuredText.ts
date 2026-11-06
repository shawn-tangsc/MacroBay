/**
 * 「结构化文本」的节点契约（归属 `platform/contracts`）。
 *
 * 为什么住在 contracts 而不是组件目录：渲染它的 UI 组件在**渲染层**，产出它的解析器在**主进程**
 * （更新说明、发布记录都从远端来）。类型若住在组件里，主进程服务就得 import 渲染层——服务顺着界面长，
 * 方向是反的。所以契约单独一处，**两边都从这里取**：解析器产出它，组件只负责摆成语义化 DOM。
 *
 * 边界（安全性质，不是风格）：
 * - 输入是**封闭结构**：没有任何「原始 HTML / 原始 Markdown / 链接 / 图片」的字段。解析在主进程做，
 *   渲染层拿不到原文——远端文字只能决定内容，不能决定界面渲染什么；
 * - `bold` 与 `code` 各自只有真假两态：每多一个标记，就多一个远端能控制的东西；
 * - `code.lines` 是**逐行原样**的文本：里面的 `-`、`**`、`<img>` 都只是字符，只有换行结构被保留。
 *
 * 加一种节点是**安全决定**，不是排版决定：现在允许的是四种（`section` / `paragraph` / `list` / `code`），
 * 组件侧有一条以「新节点种类是安全决定」命名的用例守着它。
 */

/** 行内片段：有字、可加粗、可标记为行内代码。 */
export type StructuredTextRun = {
  text: string
  bold: boolean
  /** 行内代码：只换字体，仍是纯文本——不可点、不是链接、不解析任何标记。 */
  code?: boolean
}

export type StructuredTextNode =
  | { kind: 'section'; title: string }
  | { kind: 'paragraph'; runs: readonly StructuredTextRun[] }
  | { kind: 'list'; items: readonly (readonly StructuredTextRun[])[] }
  | { kind: 'code'; lines: readonly string[] }
