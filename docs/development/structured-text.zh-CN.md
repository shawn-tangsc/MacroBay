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
  | { kind: 'paragraph'; runs: { text: string; bold: boolean }[] }
  | { kind: 'list'; items: { text: string; bold: boolean }[][] }
```

解析在主进程做，`StructuredText` 只把三种形状摆成语义化 DOM。**类型上没有「传一段 HTML」或
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
- **组件不决定宽度。** 宽度由容器给，页面把正文行宽限制在 480px；组件只保证自己不把容器撑宽。
- **组件不持有展开状态。** `maxNodes` 只是截断，不是开关；「展开全部 / 收起」归页面。

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
