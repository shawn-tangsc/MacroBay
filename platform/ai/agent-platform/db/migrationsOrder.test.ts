import { describe, expect, it } from 'vitest'

import { migrations } from './createAgentPlatformDatabase'

/**
 * 迁移顺序的守卫：「id 唯一 + **新加的**迁移编号必须大于历史最大值（当前 53）」。
 *
 * 为什么不要求整表严格递增：数组里有 **6 处历史逆序**（`0002_agent_product_tool_provider`
 * 排在 0010 之后；0029/0030 倒置；0040–0044 倒序插入；0048–0050 的 agent 三条排在
 * channel 0053 之后）和 **2 组编号撞车**（两条 0002；0048/0049/0050 各被 channel 与 agent
 * 两族共用）。那是历史事实：`agent_platform_migrations` 里记的就是 id 字符串，**改号会让老库
 * 把已执行的迁移再跑一遍**，整表重排又会改变全新库的建库顺序——风险远大于收益，所以不重排、
 * 不改号，只保证「以后不再往已应用区间里插队」。
 *
 * 「新加」用「不在基线集合里」判，不拿顺序判：顺序本身不可信（见上），id 才可信。
 */
const KNOWN_HISTORY: ReadonlySet<string> = new Set([
  "0001_agent_platform_core",
  "0002_agent_platform_state_entries",
  "0003_agent_task_read_models",
  "0004_agent_channel_read_models",
  "0005_agent_workspace_query_indexes",
  "0006_agent_active_selection_table",
  "0007_agent_mcp_read_models",
  "0008_agent_skill_read_models",
  "0009_agent_task_automation_full_experience",
  "0010_agent_task_automation_history_read_models",
  "0002_agent_product_tool_provider",
  "0011_channel_secure_migration",
  "0012_channel_reliable_inbound",
  "0013_channel_unified_delivery",
  "0014_channel_management_workspace",
  "0015_channel_management_delete_isolation",
  "0016_telegram_release_a_runtime",
  "0017_telegram_lifecycle_owners",
  "0018_channel_management_operation_owners",
  "0019_channel_management_vault_compensation",
  "0020_channel_management_mutation_epochs",
  "0021_channel_adapter_evidence_ledger",
  "0022_slack_release_b_runtime",
  "0023_lark_release_c_runtime",
  "0024_qq_release_d_runtime",
  "0025_discord_release_e_runtime",
  "0026_wechat_release_f_enrollment",
  "0027_channel_adapter_support",
  "0028_channel_conversation_session_integrity",
  "0030_channel_dispatch_runs",
  "0029_channel_inbound_candidates",
  "0031_channel_delivery_retry",
  "0032_channel_adapter_key_projection",
  "0033_channel_legacy_quarantine",
  "0034_channel_canonical_shadow",
  "0036_drop_legacy_channel_tables",
  "0038_channel_bridge_compat",
  "0039_channel_canonical_final",
  "0044_require_daily_brief_session_tools",
  "0042_unbind_daily_brief_editor_model",
  "0041_clear_daily_brief_websearch_block",
  "0040_dedupe_product_tool_bindings",
  "0043_agent_session_allowed_tools",
  "0045_daily_brief_editor_effort_low",
  "0046_drop_agent_session_messages_fts",
  "0047_agent_session_origin",
  "0048_channel_settings_overrides",
  "0049_channel_allowed_chat_ids_repair",
  "0050_channel_management_recovery_attempts",
  "0051_channel_delivery_audit_detail",
  "0052_channel_conversation_session_title",
  "0053_channel_dispatch_failure_reason",
  "0048_agent_session_origin_ref",
  "0049_agent_session_message_owner_boot_id",
  "0050_agent_session_origin_state"
])

/** 历史最大值：老库已经应用到 0053。新迁移编号必须严格大于它。 */
const HISTORICAL_MAX_PREFIX = 53

const numberOf = (id: string): number => Number.parseInt(id.slice(0, 4), 10)

describe('agent platform migration ids', () => {
  it('are unique', () => {
    const ids = migrations.map((migration) => migration.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('only adds ids above the historical maximum', () => {
    const offenders = migrations
      .map((migration) => migration.id)
      .filter((id) => !KNOWN_HISTORY.has(id) && numberOf(id) <= HISTORICAL_MAX_PREFIX)
    // 老库已应用到 0053；新迁移若用 <=0053 的编号，就是往已应用区间里插队。
    expect(offenders, '新迁移编号必须大于 ' + HISTORICAL_MAX_PREFIX).toEqual([])
  })
})
