[English](./structured-text.md) | [中文](./structured-text.zh-CN.md) | [← 文档](../README.md)

# 结构化文本

远端长文——发布记录、更新日志、关于我们——用 `@platform/ui/components/structured-text` 渲染。
它**不是富文本渲染器**，这一点就是它的全部设计。

## 输入为什么是封闭结构

这些文字来自服务端。一旦远端文字能决定我们渲染什么，写它的人就决定了我们的界面长什么样。
所以组件只接受三种节点，别的一概不收：

```ts
type StructuredTextNode =
  | { kind: 'section'; title: string }
  | { kind: 'paragraph'; runs: StructuredTextRun[] }
  | { kind: 'list'; items: StructuredTextRun[][] }
  | { kind: 'code'; lines: string[] }        // 整块代码，逐行原样显示

type StructuredTextRun = { text: string; bold: boolean; code?: boolean }
```

节点类型住在 **`platform/contracts/structuredText.ts`**，不在这个组件里：解析在主进程，必须能只依赖形状、
不依赖渲染层。组件 re-export 它们，调用点只 import 一处，**组件自己不留第二份定义**。
`StructuredText` 只把这些形状摆成语义化 DOM。**类型上没有「传一段 HTML」或
「传一段 Markdown」的口子**——这是设计，不是遗漏。

## 规则，以及每一条为什么存在

- **组件内没有 `dangerouslySetInnerHTML`，不引任何 Markdown 库。** 所有字符串都按纯文本渲染：
  `<img src=x onerror=…>` 会原样显示成那几个字符，不会变成元素。
- **链接永远不是链接。** 不生成 `<a>`、不产生 `href`、点了什么也不会打开。句子里的地址是内容，
  不是可点的东西；让它可点，等于把「指向哪里」交给了远端。
- **语义化输出、不加多余 aria。** 小节用 `<h3>`（`h1`/`h2` 归页面，正文不许重排文档大纲）、
  段落用 `<p>`、列表用 `<ul>` / `<li>`。没有 `role`、没有 `aria-*`：这是普通文档内容，不是地标。
- **长串断行，不许撑破页面。** `overflow-wrap: anywhere`：300 字符的连续串（网址、哈希、base64 片段）
  会折行；刻意不用 `break-all`，那会把英文单词拦腰截断。
- **代码块是文字，不是标记。** `lines` 拼进一个 `<pre><code>`：`-` 仍是连字符（不是列表）、`**` 仍是两个星号
  （不是加粗）、`<img …>` 仍是几个字符。不逐行包元素、不加语言标签、不做复制按钮——多一样就多一个
  「将来远端能驱动它」的入口。
- **代码换行，不横向滚动。** `white-space: pre-wrap` + `overflow-wrap: anywhere`，并**刻意不写 `overflow-x`**：
  长命令行必须折行。视觉值（内边距、圆角、边框、混合底色）沿用仓里既有的消息代码块，避免长出第二套观感；
  唯一的刻意差异就是换行这条。
- **行内 `code` 只换字体。** 不是链接、不可点、不可聚焦。
- **组件不决定宽度。** 宽度由容器给，页面把正文行宽限制在 480px；组件只保证自己不把容器撑宽。
- **组件不持有展开状态。** `maxNodes` 只是截断，不是开关；「展开全部 / 收起」归页面。

## 明确不做

- **表格。** 发布说明里表格很少，而表格要好看（列宽、对齐、窄窗口）是另一摊工作——做到一半反而会挤掉它本该支撑的正文。
  真需要时，它作为**自己的节点种类**进来，并带上自己的窄窗口规则，而不是在这里开一个逃生口。
- **HTML 与 Markdown 输入。** 这不是能力不足，是边界：解析在主进程做。
- **链接、图片、语法高亮、复制按钮。** 每一样都会让远端文字或远端数据决定我们界面的某一件事。

## 用法

```tsx
<StructuredText nodes={releaseNotes} />              // 全部节点
<StructuredText nodes={releaseNotes} maxNodes={8} /> // 页面控制「展开全部」
```

## 测试能证明什么、不能证明什么

`StructuredText.test.tsx` 直接证明了安全那一半，因为它本来就是 DOM 形状的：敌意片段变成文字、
网址产生 0 个 `<a>` 且没有 `href`、三种节点对应三种标签、包内没有任何 HTML 出口或 Markdown 解析器。

在无布局的 DOM 里做不到的两件事，它明确不假装做到：折行判的是**规则**（`overflow-wrap: anywhere`），
不是量 `scrollWidth`；宽度判的是 CSS 里没有写死宽度。真机上 300 字符连续串的
`scrollWidth === clientWidth` 用 CDP 探针测，和证据一起报，不写进单测冒充。
