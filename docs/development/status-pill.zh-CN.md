[English](./status-pill.md) | [中文](./status-pill.zh-CN.md) | [← 文档目录](../README.zh-CN.md)

# 状态药丸

一个已经尘埃落定的状态——「已启用」「数据偏旧」「读取失败」「更新中」「未启用」——用
`@platform/ui/components/status-pill` 的 `StatusPill` 渲染。不要再手写 `<span class="…">` 小片。

组件存在的理由：同样三个词被画了五处、两套局部实现，每套自己的字号和颜色。现在只有一种 11px
字号、一套档位。

## 组件给什么

| 导出 | 用来做 |
| --- | --- |
| `StatusPill` | 一行状态字 + 一个辅助圆点。 |
| `STATUS_PILL_TONES` | 闭集：`['ok', 'warn', 'bad', 'info', 'muted']`。 |
| `StatusPillTone` | `'ok' \| 'warn' \| 'bad' \| 'info' \| 'muted'`。 |
| `StatusPillProps` | props 类型。 |

```tsx
import { StatusPill } from '@platform/ui/components/status-pill'
```

源码：`platform/ui/components/status-pill/`。界面规格：
`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html` ③。

### Props

| Prop | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `tone` | `'ok' \| 'warn' \| 'bad' \| 'info' \| 'muted'` | 是 | 这一档的语气；第六档编译不过。 |
| `labelKey` | `string` | 是 | 状态字的**键**。组件内零文案、不引 i18n。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的文案解析入口。 |

没有 `size`、没有 `className`、没有点击。规格只给 11px 一档且禁止 9px；第二档等于在调用点
自己发明一套字号。

### 五档

| `tone` | 含义 | token（圆点 + 描边） |
| --- | --- | --- |
| `ok` | 工作中、已启用、已保存 | `--success` |
| `warn` | 数据偏旧、降级、需要看一眼——**不是**错误 | `--caution` |
| `bad` | 失败 | `--danger` |
| `info` | 进行中，或中性提示 | `--accent` |
| `muted` | 关闭、暂停、未配置 | `--muted` |

**档位色落在圆点与描边上，字本身用 `--text-strong`。** 这是有意与「给字上色」不同：
`color: var(--danger)` 属于 `check:danger-color` 门禁只减不增的前景（深色下 3.25–3.94，正文门槛
4.5），而 11px 的药丸字就是正文。灰度下药丸仍然可读——字承担状态，圆点与描边只是加强。

## 组件自己守的规则

- **必须有字。** 圆点是 `aria-hidden` 的装饰；把颜色关掉不能把状态一起关掉。没有纯图标药丸，
  也没有「只有点」的变体。
- **一个药丸一个档位，一共五档。** 不接受通过 props 传自定义颜色。
- **是 `<span>`，不是按钮。** 药丸是状态不是动作：「点击刷新」这种动词属于按钮。把药丸做成可点，
  只会让那个错误看起来像是有意设计。
- **`warn` 与 `bad` 互不借 token**——偏旧不是失败。

## 调用点的规则

- **最多 6 个汉字 / 12 个英文字符。** 超长不缩字号、也不静默截断；把细节移到药丸旁边或把词缩短。
- **同一行不许两个同档药丸。** 一行只放它需要的状态，不按列凑。
- **药丸里不放动词。** 「刷新失败」是状态；「点击刷新」是控件。
- 状态字从键经 `resolveText` 出；药丸里永远不出现字面量句子。

## 怎么验用了它的页面

1. **灰度**：把页面转成灰度，每个药丸仍只靠字就能认出是哪一档。
2. **字号**：DevTools 读到 `font-size: 11px`、`line-height: 1.5`。
3. **颜色**：圆点与描边每档只引用一个 token；组件样式表里 0 个字面色值。
4. **结构**：`<span>`，没有 `<button>`、没有 `onClick`。
