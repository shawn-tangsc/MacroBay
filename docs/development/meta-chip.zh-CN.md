[English](./meta-chip.md) | [中文](./meta-chip.zh-CN.md) | [← 文档](../README.md)

# 分类标签

**分类名词**（宏观、利率、美股、加密、协议名、工具名）渲染 `@platform/ui/components/meta-chip`
的 `MetaChip`。**状态词**（已启用、数据偏旧、读取失败）是 `StatusPill`；**计数**是
`CountBadge`；**操作后的一句话**是 `Toast`。

两件长得像，但不能互换：区别不在颜色，在**有没有圆点**和**胶囊还是直角**。去掉颜色之后仍然能分。

## 组件

| 导出 | 用途 |
| --- | --- |
| `MetaChip` | 一枚分类标签：收键，句子由调用方解析。 |
| `MetaChipProps` | props 类型。 |

```tsx
import { MetaChip } from '@platform/ui/components/meta-chip'

<MetaChip labelKey="macro.rates" resolveText={t} />
```

源码：`platform/ui/components/meta-chip/`。**基础：自实现。** antd 没有「中性、不可点」的分类标签：
`Tag` 是一个带颜色预设、关闭叉和另一套尺寸词汇的标签家族，而这里是**一个 18px 的中性 span**。外观
定义在原型 `docs-private/05-desktop/ui-audit/prototypes/2026-11-02-toast-metachip.html` ②。

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `labelKey` | `string` | 是 | 分类名，**收键**。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的解析器。未知键返回空串；组件不回退键名。 |

刻意**没有** `tone`、`color`、`icon`、`onClick`、`onSelect`、`disabled`、`children`、`size`。
分类不靠色相区分（靠文字）；会响应点击的标签是按钮——用 `IconButton`/`Button`；筛选是
`Segmented`。

### 调用点要守的

- **长度**：≤8 个汉字 / 16 个字符。超了说明它是句子，不是分类；组件不截断、不换行。
- **一行最多五枚**，超出换行；不许折叠成「+3」。
- **间距 6、垂直居中**：放在 flex 行里，`gap: 6px` + `align-items: center`。与 `StatusPill` 并排
  （18 与 20.5 高）按中线对齐，顶部对齐会让两排字错位。
- **标签不放 tooltip**：文字放不下说明标签选错了，该用正文或说明，不要拿悬浮提示补救。
- **每枚都有键**。组件内零文案、零 i18n。
- **不拿它当状态或计数**。状态用 `StatusPill`、计数用 `CountBadge`；「已译/未译」与情绪方向
  各有专用标签，都不是分类。
