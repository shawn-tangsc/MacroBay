import type { AgentPlatformMigration } from '../createAgentPlatformDatabase'

/**
 * 投递审计带一句通道自己的说明。
 *
 * 为什么加列而不是把说明塞进 `code`：`code` 是闭集（面板按它翻译），塞进去就变成两种编码挤一列；
 * 而「发送失败」最需要的那句话（`Bad Request: chat not found` 之类）本来就是自由文本。
 * 只存脱敏截断后的一行，不含 token、不含 URL。
 */
export const channelDeliveryAuditDetail: AgentPlatformMigration[] = [
  {
    id: '0051_channel_delivery_audit_detail',
    up: `
      alter table channel_delivery_audits add column detail text;
    `
  }
]
