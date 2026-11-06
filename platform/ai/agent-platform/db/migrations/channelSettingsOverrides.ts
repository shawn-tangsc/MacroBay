import type { DatabaseSync } from 'node:sqlite'

import type { AgentPlatformMigration } from '../createAgentPlatformDatabase'

/**
 * 频道级三项覆盖（工作目录 / 允许的会话 ID / 权限模式）的两条迁移。
 *
 * 为什么独立成文件：`createAgentPlatformDatabase.ts` 命中「只减不增」的体积基线，
 * 每加一条迁移都会把它顶出上限。迁移本身是声明式数据，搬出来不影响执行顺序——
 * 这里导出的数组由主文件追加在末尾，编号排序与原来一致。
 *
 * 0048 先建列（当时列名是 allowed_chat_ids_json），0049 负责把已跑过 0048 的老库补到
 * 现在的列名 active_chat_ids_json。**0048 一个字都不改**：改历史迁移会让已经执行过它的库
 * 永远对不上，只能靠新迁移补齐。
 */
export const channelSettingsOverrides: AgentPlatformMigration[] = [
  {
    id: '0048_channel_settings_overrides',
    up: `
      -- 频道级三项覆盖（需求 v7）：工作目录、允许的会话 ID、权限模式。
      -- 0004 那版读模型表曾有这三列，0011 换成正典表时丢了；现在补回同一张表，
      -- 管理服务写、旧读模型读同一行——不另开第二处存储。
      -- 允许列表为空存 null（＝允许所有）；权限模式 null＝继承助手，不是 'default'。
      alter table agent_channels add column workspace_json text;
      alter table agent_channels add column active_chat_ids_json text;
      alter table agent_channels add column permission_mode text;
    `
  },
  {
    id: '0049_channel_allowed_chat_ids_repair',
    up: (connection) => {
      // 0048 在落地前被本地改过一次列名：先按 allowed_chat_ids_json 跑过、库已记 0048 执行过，
      // 随后代码改成 active_chat_ids_json 才提交。于是老库里 0048 永远不再跑，列名对不上，
      // 启动读 channel 时直接 no such column。这里只做「补到当前列名」，不改 0048 一个字。
      const columns = connection.prepare('pragma table_info(agent_channels)').all() as Array<{ name: string }>
      const has = (name: string): boolean => columns.some((column) => column.name === name)

      if (!has('active_chat_ids_json')) {
        if (has('allowed_chat_ids_json')) {
          connection.exec('alter table agent_channels rename column allowed_chat_ids_json to active_chat_ids_json')
        } else {
          connection.exec('alter table agent_channels add column active_chat_ids_json text')
        }
      }
      if (!has('workspace_json')) connection.exec('alter table agent_channels add column workspace_json text')
      if (!has('permission_mode')) connection.exec('alter table agent_channels add column permission_mode text')
    }
  }
]
