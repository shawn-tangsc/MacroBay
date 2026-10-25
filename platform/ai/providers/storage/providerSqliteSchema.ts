import type { DatabaseSync } from 'node:sqlite'

/**
 * PLAT-72：模型供应商库的 SQLite schema（`<userData>/platform/model-providers.sqlite`）。
 *
 * 为什么是 SQLite：供应商 + 模型 + 密钥引用原先整份 JSON 读写，任何一次预设合并都要重写整文件，
 * 且"字段所有权"散落在多个 merge 函数里。改成行级存储后，单条 provider/model 的写入互不影响，
 * 预设合并只发生在内存层（`normalizeProviderState`），磁盘不再需要"整份重写才安全"。
 *
 * 沿用仓库既有 `node:sqlite`（agents.sqlite / assistants.sqlite / jobs.sqlite 同款），不引入新依赖。
 *
 * 口径：
 *  - `endpoints_json` 是**聊天端点的事实源**（有序清单，`[0]` = 默认端点）；
 *    `image_endpoints_json` 单独放图片端点（不是聊天协议）；
 *  - `is_system` 不落库：系统供应商身份永远由当前预设清单决定（PLAT-66）；
 *  - 密钥只存 `ref` + 掩码 `preview`，明文仍在 vault（`platform/secrets`）；
 *  - `model_provider_meta` 记录 seed / 健康状态；`model_provider_migrations` 记录 schema 版本。
 */
type ProviderSqliteMigration = {
  id: string
  /** 纯 DDL 用字符串；需要对已存在库做条件判断时用函数。 */
  up: string | ((connection: DatabaseSync) => void)
}

const migrations: ReadonlyArray<ProviderSqliteMigration> = Object.freeze([
  {
    id: '0001_model_provider_store',
    up: `
      create table if not exists model_providers (
        id text primary key,
        name text not null,
        enabled integer not null,
        base_url text not null,
        endpoints_json text not null default '[]',
        removed_endpoint_protocols_json text,
        image_endpoints_json text,
        websites_json text,
        custom_headers_json text,
        default_chat_model_id text,
        removed_preset_model_ids_json text not null default '[]',
        sort_index integer not null default 0,
        updated_at text not null
      );

      create index if not exists idx_model_providers_order
        on model_providers(sort_index, id);

      create table if not exists model_models (
        provider_id text not null,
        model_id text not null,
        name text not null,
        group_name text,
        capabilities_json text not null,
        chat_protocol text,
        supported_protocols_json text,
        declared_protocols_json text,
        probed_protocols_json text,
        messages_support text,
        responses_support text,
        declaration_source text,
        probe_status text,
        probe_reason text,
        protocol_probed_at text,
        context_length integer,
        max_completion_tokens integer,
        pricing_json text,
        preset_model integer not null default 0,
        preset_stale integer not null default 0,
        provider_declared integer not null default 0,
        sort_index integer not null default 0,
        primary key (provider_id, model_id),
        foreign key (provider_id) references model_providers(id) on delete cascade
      );

      create index if not exists idx_model_models_order
        on model_models(provider_id, sort_index, model_id);

      create table if not exists model_provider_secrets (
        provider_id text primary key,
        ref text not null,
        preview text,
        updated_at text not null,
        foreign key (provider_id) references model_providers(id) on delete cascade
      );

      create table if not exists model_provider_secret_orphans (
        provider_id text not null,
        ref text not null,
        created_at text not null,
        primary key (provider_id, ref)
      );

      create table if not exists model_provider_meta (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );
    `
  },
  {
    // PLAT-72：`apiVersion` 没有任何消费者，域字段与列一起删除（阶段 1/2 建过库的实例也要收敛）。
    id: '0002_model_provider_drop_api_version',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(model_providers)').all() as unknown as Array<{ name?: string }>
      if (!columns.some((column) => column.name === 'api_version')) return
      connection.exec('alter table model_providers drop column api_version;')
    }
  },
  {
    // PLAT-82：模型级「协议支持集合」「Responses 支持」「声明来源」三列。
    // 新库由 0001 直接建出来；已建库逐列判断后 ALTER（三列互相独立）。
    id: '0004_model_declaration_columns',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(model_models)').all() as unknown as Array<{ name?: string }>
      const has = (name: string): boolean => columns.some((column) => column.name === name)
      if (!has('supported_protocols_json')) {
        connection.exec('alter table model_models add column supported_protocols_json text;')
      }
      if (!has('responses_support')) {
        connection.exec('alter table model_models add column responses_support text;')
      }
      if (!has('declaration_source')) {
        connection.exec('alter table model_models add column declaration_source text;')
      }
      if (!has('declared_protocols_json')) {
        connection.exec('alter table model_models add column declared_protocols_json text;')
      }
    }
  },
  {
    /**
     * 端点收敛：`protocols_json` / `protocol_overrides_json` / `default_chat_protocol`
     * （以及历史 `anthropic_base_url`）整体换成 `endpoints_json` + `image_endpoints_json`。
     *
     * **不写旧数据读取分支**：用户已清空本地供应商库，旧列直接丢弃；已建库逐列判断后
     * ALTER（新库由 0001 直接建出新形状）。
     */
    id: '0005_model_provider_endpoints_columns',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(model_providers)').all() as unknown as Array<{ name?: string }>
      const has = (name: string): boolean => columns.some((column) => column.name === name)
      if (!has('endpoints_json')) {
        connection.exec("alter table model_providers add column endpoints_json text not null default '[]';")
      }
      if (!has('image_endpoints_json')) {
        connection.exec('alter table model_providers add column image_endpoints_json text;')
      }
      for (const legacy of ['protocols_json', 'protocol_overrides_json', 'default_chat_protocol', 'anthropic_base_url']) {
        if (!has(legacy)) continue
        connection.exec(`alter table model_providers drop column ${legacy};`)
      }
    }
  },
  {
    // PLAT-82：检测证据列（实测通过的协议）。新库由 0001 直接建出；已建库 ALTER。
    id: '0007_model_probed_protocols_column',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(model_models)').all() as unknown as Array<{ name?: string }>
      if (columns.some((column) => column.name === 'probed_protocols_json')) return
      connection.exec('alter table model_models add column probed_protocols_json text;')
    }
  },
  {
    // PLAT-82 后续：`declared_protocols_json` 是在 0004 **已经发布之后**才加进 0004 的，
    // 所以已建库不会重跑 0004、也就永久缺这一列（表现：启动时写库抛 provider-secret-metadata-write-failed）。
    // 迁移一旦发布就不可改，只能补一条新的。新库仍由 0001 直接建出。
    id: '0006_model_declared_protocols_column',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(model_models)').all() as unknown as Array<{ name?: string }>
      if (columns.some((column) => column.name === 'declared_protocols_json')) return
      connection.exec('alter table model_models add column declared_protocols_json text;')
    }
  },
  {
    /**
     * 端点墓碑列：用户**手动删除**过的端点协议（预设合并时跳过，避免删掉的端点复活）。
     * 新库由 0001 直接建出；已建库 ALTER。**不回填**：null 即"没有墓碑"（老库本来就是旧语义）。
     */
    id: '0008_model_provider_removed_endpoint_protocols_column',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(model_providers)').all() as unknown as Array<{ name?: string }>
      if (columns.some((column) => column.name === 'removed_endpoint_protocols_json')) return
      connection.exec('alter table model_providers add column removed_endpoint_protocols_json text;')
    }
  },
  {
    /**
     * 模型可用性结论列：最近一次联通性检测的 `ok` / `failed` + 时间 + 配置指纹。
     *
     * 新库同样走这条 ALTER（0001 是已发布的迁移，不再改动）。旧的 `probe_status`
     * 三列仍是历史协议探测列，不复用、不回填。
     */
    id: '0009_model_availability_column',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(model_models)').all() as unknown as Array<{ name?: string }>
      if (columns.some((column) => column.name === 'availability_json')) return
      connection.exec('alter table model_models add column availability_json text;')
    }
  }
])

export function applyProviderSqliteMigrations(connection: DatabaseSync): void {
  connection.exec(`
    create table if not exists model_provider_migrations (
      id text primary key,
      applied_at text not null
    );
  `)

  for (const migration of migrations) {
    const applied = connection
      .prepare('select id from model_provider_migrations where id = ?')
      .get(migration.id) as { id?: string } | undefined
    if (applied?.id) continue

    connection.exec('begin')
    try {
      if (typeof migration.up === 'string') connection.exec(migration.up)
      else migration.up(connection)
      connection
        .prepare('insert into model_provider_migrations (id, applied_at) values (?, ?)')
        .run(migration.id, new Date().toISOString())
      connection.exec('commit')
    } catch (error) {
      connection.exec('rollback')
      throw error
    }
  }
}
