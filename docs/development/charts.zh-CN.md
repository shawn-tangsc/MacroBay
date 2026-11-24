[English](./charts.md) | [中文](./charts.zh-CN.md) | [← 文档](../README.zh-CN.md)

# 图表

连着三个缺陷出自同一个地方：图自己发明了别处已经定过的事。五条线各自用了没人两两核对过的
颜色，1.6px 上两条读成一条；每个轴刻度各印一遍时区，五格说同一件事、互相压字；读不到的窗口
被画成一张空图。这一页收的就是这三个缺陷缺的那几条规则，免得第四张图再找一遍。

下面每条都是代码现在就在做的事。偏离其中一条属于设计评审项，不是就地决定。

## 一套色板，一个 owner

五条线的颜色只在同一个块里定义：
`products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css`——深色默认值在
`:51-55`，浅色重映射在 `:root[data-theme='light'] .mi-crypto-dashboard` `:681-685`。

| token | 哪条线 | 深色 | 浅色 |
| --- | --- | --- | --- |
| `--mi-dashboard-chart-qqq` | 指数 | `#55d69b` | `#17835a` |
| `--mi-dashboard-chart-btc` | BTC | `#e5ae43` | `#6f3d10` |
| `--mi-dashboard-chart-eth` | ETH | `#b994ff` | `#6b45c4` |
| `--mi-dashboard-chart-dxy` | 美元 | `#7f9ec9` | `#3f6491` |
| `--mi-dashboard-chart-gold` | 黄金 / 3M | `#f2e3a0` | `#8a6d1f` |

图只负责说明「这条线是哪条」，颜色从 token 取，自己不写颜色。消费者可以改成本地名字
（`CrossAssetObservationPanel.css:33-37`），收益率曲线把期限映射到 token（`ustYieldCurve.css:108-112`）。

为什么必须一个 owner：浅色重映射是**对比度修复**，不是风格选择——深色那套值在白底上只有
1.29–2.75:1，cream 那条几乎看不见。因为改的是这一个块，所有用这套色板的图一起被修好；谁给某张
图单独开小灶，另外三张就会留在旧值上。

守卫是 `crossAssetChartPalette.test.ts`，它断言的是「分得清」，不是审美：

- 五条线任意两条必须满足：色相差 ≥ 18°、**或**明度差 ≥ 18 个百分点、**或**饱和度差 ≥ 25 个百分点
  （`palettePolicy`）；
- 浅色下每条线对真实的 `--surface` 至少 3:1——底色是从壳样式表读的，不是写死一块白；
- 3M 与 30Y 还要对比度相差 ≥ 1.7 倍：这两条在 1.6px 上靠明暗分开，不靠一个看不见的色相。

这些门禁**不覆盖**什么：`check:hex-color` 只匹配属性名正好是 `color:` 的声明
（`tools/danger-color-guard/dangerColorGuard.ts:69`），所以写在 `fill`、`stroke` 或自定义属性里的
十六进制色它看不见。这五个值的唯一守卫就是上面那条调色板用例。**十六进制门禁绿，不等于图的颜色
被查过。**

加第六条线＝在这里加第六个 token，并把两两断言的组合扩上。拿状态色（`--success`、`--danger`）
顶替是错的，而且是有意的：状态色回答「这个状态要求读者做什么」，线的颜色回答「这是哪一条」。

图内字号另有 owner：`--mi-chart-label-size: 9px`（`cryptoDashboard.css:44`）。轴标签、泳道标签、
标记牌都读这个 token，不写 `9px`（`PositioningPanel.css:64,81,96,100`；`ustYieldCurve.css:86`）。
这是全应用唯一低于正文档的字号，而且只存在一处——图内标签漂一个像素，就和轴对不齐。
调用点不再读 token 时，`PositioningPanel.test.tsx:670-673` 会红。

## 同起点就是同起点

「这一窗涨了多少」这类图，每条线都归一到同一个锚点，而且 y 轴一定带 0：
`CrossAssetReturnChart.tsx:198` 画的是 `[max, 0, min]`，区间为零时收成 `[0]`。零轴不在轴上，
「开盘以来涨了」就读不出来，两条线看着平行也可能只是被裁掉了。

- 按窗口重算的值是**比值**，不是差值：`dailyBriefingSeries.ts:113-115` 除以锚点的 `1 + r/100`，
  `crossAssetWindowReturns.ts:72` 用 `(1 + 新) / (1 + 旧) - 1` 算窗口收益。两个百分数一减，
  数值一大就错。
- 还在形成的那一段画成尾巴并标注（`CrossAssetReturnChart.tsx:220`，`text.forming`），
  不当成已收盘的点。
- 点位图（如收益率曲线）不做同起点重算：它画的是水平，零轴在那里没有意义；色板照样适用。

## 轴用紧凑口径，完整时刻只留浮层

刻度用紧凑时钟：同显示日 `HH:mm`、跨日 `MM-DD HH:mm`、不带时区。函数是
`@platform/ui/time/shellTimeFormat` 的 `formatShellClock`，时区取 `useShellTimeZone()`——
`PositioningChart.tsx:104-107`、`CrossAssetReturnChart.tsx:96`。

完整时刻（带时区）只属于浮层（`PositioningChart.tsx:275`、`CrossAssetReturnChart.tsx:258`）。
轴回答「几点」，浮层回答「精确是哪一刻」。五格各印一遍 `GMT+8` 是同一件事说五遍，而且会互相压字。

- 刻度数是每张图固定的：资金费率五点（`positioningAxisTicks.ts:16-31`，`steps = 4`），
  同起点收益三点（`CrossAssetReturnChart.tsx:58`，`tickSlots: 3`）。改刻度数要在同一笔里重新看标签宽度。
- 端点标签要贴边、不许被裁：首格 `text-anchor: start`、末格 `end`、中间 `middle`
  （`PositioningChart.tsx:265-266`）；百分比定位的刻度用 translateX 补偿
  （`CrossAssetReturnChart.tsx:254`）。
- 刻度位置吸附到不超过半步的整单位，两个邻格才不会落在同一个标记上；没有单位放得下时保留真实位置
  （`positioningAxisTicks.ts:20-29`）。
- 数值轴文字用 `font-variant-numeric: tabular-nums`（`ustYieldCurve.css:86`）。
- 组件里手拼日期（`YYYY/M/D` 之类）是缺陷，哪怕在一种语言下看着对——一律走壳的格式化。

## 空段不是一件事

四种情况在屏幕上很像，画法必须不同。用同一个空数组表示全部，就是那个缺陷：把「读不到」报成
「没有」。

| 情况 | 画法 |
| --- | --- |
| 整块数据读不到 | `StateView` error + 重试，绝不画一张空图（`UstYieldCurveCard.tsx:84-92`） |
| 还没有数据，或不适用 | `StateView` empty + 平台原因，或卡片自己的那句空态句走原因槽（`UstYieldCurveCard.tsx:100`；`CapitalConditionsPanel.tsx:200-207`） |
| 源被关掉 / 读不到 | 这条线根本不进图例：不留灰线、不占位（`CrossAssetReturnChart.tsx:20-22`、`chartLinesHiddenBy`） |
| 正常显示的线，这一窗没有可比数据 | 不进图，图例说一句；原因在图标题 ⓘ 里（`linesWithoutComparableData`，`CrossAssetReturnChart.tsx:43-54`） |

最后一行是一个判据喂两处，刻意如此：图例那句话和 ⓘ 里的原因不可能对不上。

浮层里缺值是 `text.noData`（`CrossAssetReturnChart.tsx:263`），不是 `0`，也不是一个没有解释的横杠。
「这条线这一段没有」和「这个值读不到」是两种状态，文案要说是哪一种。

序列中间的断口就是断口。不许为把线画连续而插值：画出来的线是在断言「这中间有数据」。