---
name: intelligence-ops
description: 情报模块运维工序：先读后写、一次一改、凭据不经过模型
tools: [read]
capabilityFiles:
  - reference.md
  - playbook-source.md
  - playbook-calendar.md
  - playbook-translation.md
  - playbook-cross-asset.md
  - playbook-diagnostics.md
---

# 情报模块运维

这个 skill 只讲**工序**：什么时候读、什么时候写、写之前必须做什么、什么绝对不做。
工具清单与参数在 `reference.md`（自动生成，不要手改），分域步骤在对应 playbook。

## 怎么读

用本 skill 的文件读取工具，参数 `{"path": "reference.md"}` 或 `{"path": "playbook-source.md"}`。
进入某个域之前先读对应 playbook；不确定有哪些工具时先读 `reference.md`。

## 五条硬规则

1. **先读后写。** 改任何配置之前，先用只读工具复述现状：源是谁、当前值是什么、健康如何。
   不知道现状就不动手。
2. **一次一改。** 一次调用只做一个语义变更。不要在一次对话里把多个源、多个字段打包改掉；
   改完一个，回报，再问是否继续。
3. **凭据只交接。** 缺 API key 时只调用 `request_source_credential`，然后告诉用户去
   「设置 → 情报源」填写。绝不复述、猜测、要求用户把 key 发到对话里；用户主动贴了也不要
   转述或传给任何工具。
4. **改完必复述。** 每次写入后说明：改了什么、之前是什么、新的配置修订号（`revisionAfter`）。
   写入失败或用户拒绝时，明确说“没有做任何改动”。
5. **不制造结论。** 运维对话里不产出买卖建议、不预测行情；分析结论走分析链路，不在这里生成。

## 边界

- 破坏性操作（清库、重建索引、重放窗口、导出）不在工具里，遇到就明确拒绝并指引设置页。
- 不读用户持仓与自选明细；需要范围信息时用分析上下文里已冻结的事实。
- 不修改平台设置、模型供应商、其他模块。
- 只读工具不能触发分析；写入工具不能改写历史分析快照。

## 失败怎么处理

- `sensitive-output-blocked` / `sensitive-input-rejected`：停止，不要换参数重试，告诉用户这次调用被安全策略拦下了。
- `approval-denied`：用户拒绝，结束该动作，不要重复发起同一个写调用。
- `source-not-ready`：说明该源还没具备采集条件（缺凭据、待接入、被阻塞），给出下一步，不要绕过。
- `timeout` / `handler-error`：说明失败，给出可重试的动作；不要连续重试三次以上。

## 验收一句话

用户说“把 CoinGecko 那个源修一下”，你应该能：查现状 → 判断原因 → 缺凭据就交接、
配置错就改 → 测试连接 → 启用 → 跑一次 → 回报新状态与修订号。
