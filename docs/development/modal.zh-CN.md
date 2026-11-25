[English](./modal.md) | [中文](./modal.zh-CN.md) | [← 文档](../README.md)

# 弹窗

带表单或长内容的模态弹窗渲染 `@platform/ui/components/modal` 的 `Modal`。确认框（一句话 + 一个
危险按钮）归 `confirmAction`，不是这个组件。

宽度是闭集，不是数字：`compact` 420 / `standard` 520 / `expanded` 720 / `maximum` 860 / `full` 1280。
名字故意既不用 `StateSize` 的密度词、也不用 `Drawer` 的宽度词——那两套都会让写错的赋值编译通过。
调用点盘点在 `docs-private/05-desktop/ui-audit/modal-call-site-requirements-2026-11-02.md`。

关闭弹窗可能丢掉读者输入时，关闭行为是一张矩阵而不是一句话：见[关闭一个装着未保存输入的容器](unsaved-changes.zh-CN.md)。

## 组件

| 导出 | 用途 |
| --- | --- |
| `Modal` | 一只弹窗：标题或读屏名、页脚槽、正文。 |
| `ModalProps` | props 类型。 |
| `MODAL_WIDTHS` | 闭集：`['compact', 'standard', 'expanded', 'maximum', 'full']`。 |
| `ModalWidth` | 同样五个词。 |
| `MODAL_CLOSE_KEY` | `ui.modal.close`：关闭键的平台读屏名。 |

```tsx
import { Modal } from '@platform/ui/components/modal'
```

源码：`platform/ui/components/modal/`。**基础：包 antd `Modal`。** 遮罩、焦点陷阱、滚动锁、
Esc、焦点回位都由它提供，组件不写第二套。

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `open` | `boolean` | 是 | 是否显示。 |
| `width` | `ModalWidth` | 是 | `compact` 420、`standard` 520、`expanded` 720、`maximum` 860、`full` 1280。不给默认值：每次调用回答一次。 |
| `onClose` | `() => void` | 是 | 遮罩点击、Esc 与关闭键共用。 |
| `titleKey` | `string` | 二选一 | 可见标题，**收键**。不收句子。 |
| `titleParams` | `Readonly<Record<string, string>>` | 否 | 填标题模板 `{name}` 的值，**只收已格式化好的字符串**（`3 条`、`10–2`）；缺参数原样保留 `{name}`。 |
| `ariaLabelKey` | `string` | 二选一 | 没有可见标题时必填。类型上互斥：两样都不给就没有可访问名。 |
| `footer` | `ReactNode` | 否 | 动作区。**不传即整块不渲染**——组件不内置保存/取消，按钮归调用方。 |
| `children` | `ReactNode` | 是 | 正文。加载、空态在正文里用 `LoadingState` / `StateView`。 |
| `className` | `string` | 否 | 自己的类名，给测试与旧类名用；不能用来定宽。 |
| `align` | `'top' \| 'center'` | 否，默认 `top` | 两种形态，不是一个开关：任务在顶部，或居中。 |
| `layer` | `'base' \| 'over-drawer'` | 否，默认 `base` | 普通层，或压在抽屉之上。z-index 数字收在组件内部。 |
| `destroyOnHidden` | `boolean` | 否 | 关闭后卸载正文。传了才原样交给 antd；调用点不许再写自己的 `{open && …}` 等价物。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的解析器。未知键按约定返回空串；组件不回退键名。 |

### 宽表

表塞不下时，先回答一个问题、再谈别的：**`full` 装不装得下内容自己的宽度预算？** 要算，别看——
三个数很容易算错：

- **该档的真实宽度**：`full` 是 1280，但 antd 用 `calc(100vw - 32px)` 封顶，1280 窗口下实得
  **1248**（要真吃到 1280，窗口得 ≥1312）；
- **内容要多少**：列宽（只在一处声明成常量）加单元格内距；
- **还剩多少**：该档宽度 − 48（弹窗内距）− 16（纵向滚动条）。

够用就用 `full`，横滚交给内容自己：比弹窗宽的表在**自己的容器里**滚（表格外层 `overflow: auto`），
不是把弹窗撑宽。今天九列长指标码加整条 URL 装得下：960 + 144 = 1104，可用 1184。

`full` 都装不下，那是一次**规格变更**：加档要改闭集、`docs/ui-rules` 与像素表，同一笔提交。
用别的路伸手拿宽度是契约违规，不是变通：

- 产品与壳层 CSS 不许给 `.ant-modal` 写 `width`——已知例外只允许记在
  `scripts/migration-debt/modal-width.json` 里，而且那份清单只减不增；
- `max-width` 用主题 token 可以：它只能把弹窗收窄，永远不能把档位放宽；
- 给档位宽度加 `!important`，就是当初造出那条欠账的写法。

### 组件替调用点定的事

- **关闭键。** 由组件渲染，名字来自组件自己的文案表（`ui.modal.close`，“关闭弹窗” /
  “Close dialog”）。它**不经过** `resolveText`：那条路遇到未知键返回空串，按钮就会没有名字。
  与 `Drawer` 同一条规则。
- **无标题也有名字。** 传 `ariaLabelKey` 时，名字做成视觉隐藏的标题、标题栏整块藏掉；读屏听到的
  是自己的名字，不是一个没有名字的「对话框」。
- **没有默认页脚。** antd 在不传 `footer` 时会画自己的「确定/取消」；组件传 `null`，所以「不要页脚」
  就是真的没有。
- **两种对齐，没有 `centered` 布尔。** `align` 是闭集；`top` 与 antd 默认一致，`center` 是模型服务
  那一族。它们是两种形态，不是一个开关。
- **层级是词，不是数字。** `layer: 'over-drawer'` 把弹窗抬到抽屉之上；具体 z-index 只放在组件的
  一张表里，调用点不传数字。
- **运行时数据的标题走 `titleParams`。** 技能名、模板名是键里 `{name}` 的参数值，不是交给组件的
  一句话。
- **内容何时存在是生命周期开关，不是长相。** `destroyOnHidden` 决定关闭后正文是否卸载；原样透传，
  调用点不许用 `{open && <Form />}` 冒充——那会让第一次打开与第二次打开拿到不同的表单状态。

### 动效

按 `docs-private/05-desktop/ui-audit/ui-motion-spec-2026-11-02.md`，弹窗进场是透明度加 4px 上移，
不做缩放。动效覆盖随弹窗规格一起落；在那之前沿用 antd 默认，档位工作也还没开始。

### 迁移说明

现有 15 个弹窗用过 420 / 460 / 520 / 680 / 720 / 860。`460` 并进 `standard` 520，`680` 并进
`expanded` 720，没有任何一处变窄。15 个里有两处是确认框，归 `confirmAction`；模型检测那处自绘
两行标题先记显式例外。
