[English](./modal.md) | [中文](./modal.zh-CN.md) | [← 文档](../README.md)

# 弹窗

带表单或长内容的模态弹窗渲染 `@platform/ui/components/modal` 的 `Modal`。确认框（一句话 + 一个
危险按钮）归 `confirmAction`，不是这个组件。

宽度是闭集，不是数字：`compact` 420 / `standard` 520 / `expanded` 720 / `maximum` 860。
名字故意既不用 `StateSize` 的密度词、也不用 `Drawer` 的宽度词——那两套都会让写错的赋值编译通过。
调用点盘点在 `docs-private/05-desktop/ui-audit/modal-call-site-requirements-2026-11-02.md`。

## 组件

| 导出 | 用途 |
| --- | --- |
| `Modal` | 一只弹窗：标题或读屏名、页脚槽、正文。 |
| `ModalProps` | props 类型。 |
| `MODAL_WIDTHS` | 闭集：`['compact', 'standard', 'expanded', 'maximum']`。 |
| `ModalWidth` | 同样四个词。 |
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
| `width` | `ModalWidth` | 是 | `compact` 420、`standard` 520、`expanded` 720、`maximum` 860。不给默认值：每次调用回答一次。 |
| `onClose` | `() => void` | 是 | 遮罩点击、Esc 与关闭键共用。 |
| `titleKey` | `string` | 二选一 | 可见标题，**收键**。不收句子。 |
| `titleParams` | `Readonly<Record<string, string>>` | 否 | 填标题模板 `{name}` 的值，**只收已格式化好的字符串**（`3 条`、`10–2`）；缺参数原样保留 `{name}`。 |
| `ariaLabelKey` | `string` | 二选一 | 没有可见标题时必填。类型上互斥：两样都不给就没有可访问名。 |
| `footer` | `ReactNode` | 否 | 动作区。**不传即整块不渲染**——组件不内置保存/取消，按钮归调用方。 |
| `children` | `ReactNode` | 是 | 正文。加载、空态在正文里用 `LoadingState` / `StateView`。 |
| `className` | `string` | 否 | 自己的类名，给测试与旧类名用；不能用来定宽。 |
| `align` | `'top' \| 'center'` | 否，默认 `top` | 两种形态，不是一个开关：任务在顶部，或居中。 |
| `layer` | `'base' \| 'over-drawer'` | 否，默认 `base` | 普通层，或压在抽屉之上。z-index 数字收在组件内部。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的解析器。未知键按约定返回空串；组件不回退键名。 |

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

### 动效

按 `docs-private/05-desktop/ui-audit/ui-motion-spec-2026-11-02.md`，弹窗进场是透明度加 4px 上移，
不做缩放。动效覆盖随弹窗规格一起落；在那之前沿用 antd 默认，档位工作也还没开始。

### 迁移说明

现有 15 个弹窗用过 420 / 460 / 520 / 680 / 720 / 860。`460` 并进 `standard` 520，`680` 并进
`expanded` 720，没有任何一处变窄。15 个里有两处是确认框，归 `confirmAction`；模型检测那处自绘
两行标题先记显式例外。
