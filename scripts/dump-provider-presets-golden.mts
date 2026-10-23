/**
 * PLAT-72 阶段 0：把**当前** `createSystemProviderPresets()` 的全量输出落成 golden fixture。
 *
 * 用途：预设配置简化（删除 protocol / anthropicBaseUrl / extraEndpoints / chatProtocol /
 * apiVersion，改成 protocols + endpointOverrides + 代码派生）属于纯数据结构重写，风险是
 * "61 家里漏改/改错一家而没人发现"。golden 快照把重构前的逐字段输出钉死，重构后
 * `providerPresets.golden.test.ts` 逐字段对比 ⇒ 任何行为差异立刻 RED。
 *
 * 只应在**有意改变预设行为**时重新生成，并在提交说明里写清哪几家、为什么：
 *   pnpm exec tsx scripts/dump-provider-presets-golden.mts
 *
 * 快照是 canonical JSON（`JSON.stringify` 会丢掉 undefined 字段），语义正好等于
 * "这些预设会被持久化成的形状"，与运行期读回后的比较口径一致。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { createSystemProviderPresets } from '../platform/ai/providers/providerPresets'

const target = resolve(process.cwd(), 'platform/ai/providers/__fixtures__/providerPresets.golden.json')
const presets = createSystemProviderPresets()
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify(presets, null, 2)}\n`, 'utf8')

const modelCount = presets.reduce((total, provider) => total + provider.models.length, 0)
process.stdout.write(`wrote ${target}\nproviders=${presets.length} models=${modelCount}\n`)
