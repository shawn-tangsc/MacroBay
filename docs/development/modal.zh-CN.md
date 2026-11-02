[English](./modal.md) | [中文](./modal.zh-CN.md) | [← 文档](../README.md)

# 弹窗

带表单或长内容的模态弹窗渲染 `@platform/ui/components/modal` 的 `Modal`。确认框（一句话 + 一个
危险按钮）归 `confirmAction`，不是这个组件。

**状态：骨架——还不能接调用点。** 宽度档位、`centered`、层级、运行时数据标题都还没有定；调用点
盘点和待裁决的问题在
`docs-private/05-desktop/ui-audit/modal-call-site-requirements-2026-11-02.md`。定稿前不要迁移：
没有宽度档位时，弹窗会悄悄沿用 antd 的 520。

## 组件

| 导出 | 用途 |
| --- | --- |
| `Modal` | 一只弹窗：标题或读屏名、页脚槽、正文。 |
| `ModalProps` | props 类型。 |
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
| `onClose` | `() => void` | 是 | 遮罩点击、Esc 与关闭键共用。 |
| `titleKey` | `string` | 二选一 | 可见标题，**收键**。不收句子。 |
| `ariaLabelKey` | `string` | 二选一 | 没有可见标题时必填。类型上互斥：两样都不给就没有可访问名。 |
| `footer` | `ReactNode` | 否 | 动作区。**不传即整块不渲染**——组件不内置保存/取消，按钮归调用方。 |
| `children` | `ReactNode` | 是 | 正文。加载、空态在正文里用 `LoadingState` / `StateView`。 |
| `className` | `string` | 否 | 自己的类名，给测试与旧类名用；不能用来定宽。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的解析器。未知键按约定返回空串；组件不回退键名。 |

### 组件替调用点定的事

- **关闭键。** 由组件渲染，名字来自组件自己的文案表（`ui.modal.close`，“关闭弹窗” /
  “Close dialog”）。它**不经过** `resolveText`：那条路遇到未知键返回空串，按钮就会没有名字。
  与 `Drawer` 同一条规则。
- **无标题也有名字。** 传 `ariaLabelKey` 时，名字做成视觉隐藏的标题、标题栏整块藏掉；读屏听到的
  是自己的名字，不是一个没有名字的「对话框」。
- **没有默认页脚。** antd 在不传 `footer` 时会画自己的「确定/取消」；组件传 `null`，所以「不要页脚」
  就是真的没有。

### 动效

按 `docs-private/05-desktop/ui-audit/ui-motion-spec-2026-11-02.md`，弹窗进场是透明度加 4px 上移，
不做缩放。动效覆盖随弹窗规格一起落；在那之前沿用 antd 默认，档位工作也还没开始。

### 还没定的

宽度档位、`centered`、要压在抽屉上的弹窗用哪一档层级、以及运行时数据的标题（技能名这类）。
契约给出形状之前，不要在这里或调用点自己加。
