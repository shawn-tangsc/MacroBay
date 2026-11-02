import type { ReactElement, ReactNode } from 'react'

import type { StructuredTextNode, StructuredTextRun } from '@platform/contracts/structuredText'

import './structuredText.css'

/**
 * 受控结构的文本展示（「结构化文本」，**不是富文本渲染器**）。
 *
 * 为什么不是富文本：发布记录来自远端。一旦远端文字能决定我们渲染什么（HTML、原始 Markdown、URL 协议），
 * 就等于**别人能控制我们的界面**。所以输入被压成三种封闭节点，解析在主进程做，这里只负责把三种节点
 * 摆成语义化 DOM。类型上就没有「传一段 HTML」这个口子——这是设计，不是遗漏。
 *
 * 写进结构与守卫、不靠评审：
 * - **不收 HTML、不收原始 Markdown 字符串**；组件内**不引任何 Markdown 库**；
 * - **没有 `dangerouslySetInnerHTML`**，所有文字都当纯文本渲染（`<img onerror>` 只会显示成那几个字符）；
 * - **链接永远只是文字**：不生成 `<a>`、不产生 `href`、点了什么也不会打开——地址出现在句子里是内容，
 *   不是可点的东西；
 * - 文本可换行：长单词、长网址用 `overflow-wrap: anywhere` 断行，**不许出横向滚动条**；
 * - **组件不决定宽度**，也不持有展开状态：宽度由容器给，展开/收起由页面控制（`maxNodes` 只是截断，
 *   不是一个开关）。
 */

// 类型从契约取，**不在组件里留第二份定义**：解析器与渲染层共用同一份形状，谁也不许各自长一个别名。
export type { StructuredTextNode, StructuredTextRun } from '@platform/contracts/structuredText'

export type StructuredTextProps = {
  nodes: readonly StructuredTextNode[]
  /**
   * 只渲染前 N 个节点。用于「展开全部 / 收起」的**页面侧**实现：
   * 组件自己不记状态，页面把 N 从 8 改到全部即可。省略即全部渲染。
   */
  maxNodes?: number
  /** 额外的类名：只用来让页面给容器定宽/间距，组件不读它做布局判断。 */
  className?: string
}

function renderRuns(runs: readonly StructuredTextRun[]): ReactNode {
  return runs.map((run, index) => {
    // 行内代码同样走 React 的文本节点：`<b>` 只会是那三个字符，不会变成元素。
    const content = run.code === true ? <code className="structured-text__inline-code">{run.text}</code> : run.text
    return run.bold ? <strong key={index}>{content}</strong> : <span key={index}>{content}</span>
  })
}

export function StructuredText({ nodes, maxNodes, className }: StructuredTextProps): ReactElement {
  const visible = maxNodes === undefined ? nodes : nodes.slice(0, Math.max(0, maxNodes))
  return (
    <div className={['structured-text', className].filter(Boolean).join(' ')} data-structured-text>
      {visible.map((node, index) => {
        if (node.kind === 'section') {
          // 页面拥有 h1/h2；正文里的小节标题从 h3 起，避免把文档大纲打乱。
          return (
            <h3 className="structured-text__section" key={index}>
              {node.title}
            </h3>
          )
        }
        if (node.kind === 'paragraph') {
          return (
            <p className="structured-text__paragraph" key={index}>
              {renderRuns(node.runs)}
            </p>
          )
        }
        if (node.kind === 'code') {
          // 一个 `<pre><code>`，内容是 `lines.join('\n')` 的**纯文本**：换行结构保留，标记不解释。
          // 不渲染成 HTML、不逐行包 `<span>`（那会给出一个「这行有样式」的入口），也没有复制按钮。
          return (
            <pre className="structured-text__code" key={index}>
              <code>{node.lines.join('\n')}</code>
            </pre>
          )
        }
        return (
          <ul className="structured-text__list" key={index}>
            {node.items.map((item, itemIndex) => (
              <li className="structured-text__item" key={itemIndex}>
                {renderRuns(item)}
              </li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}
