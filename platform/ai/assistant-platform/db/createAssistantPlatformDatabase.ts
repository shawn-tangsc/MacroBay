import { DatabaseSync } from 'node:sqlite'

type AssistantPlatformMigration = {
  id: string
  up: string
}

const migrations: AssistantPlatformMigration[] = [
  {
    id: '0001_assistant_platform_core',
    up: `
      create table if not exists assistant_entities (
        id text primary key,
        name text not null,
        prompt text not null,
        icon text not null,
        description text not null,
        settings_json text not null,
        model_id text,
        model_name text,
        order_key text not null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_assistant_entities_order
        on assistant_entities(order_key, id);

      create table if not exists assistant_mcp_servers (
        assistant_id text not null,
        mcp_server_id text not null,
        position integer not null,
        primary key (assistant_id, mcp_server_id),
        foreign key (assistant_id) references assistant_entities(id) on delete cascade
      );

      create table if not exists assistant_context_sources (
        assistant_id text not null,
        context_source_id text not null,
        position integer not null,
        primary key (assistant_id, context_source_id),
        foreign key (assistant_id) references assistant_entities(id) on delete cascade
      );

      create table if not exists assistant_tags (
        assistant_id text not null,
        tag_id text not null,
        tag_name text not null,
        position integer not null,
        primary key (assistant_id, tag_id),
        foreign key (assistant_id) references assistant_entities(id) on delete cascade
      );

      create table if not exists assistant_topics (
        id text primary key,
        assistant_id text,
        name text not null,
        is_name_manually_edited integer not null,
        active_node_id text,
        group_id text,
        trace_id text,
        order_key text not null,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );

      create index if not exists idx_assistant_topics_assistant_order
        on assistant_topics(assistant_id, order_key, id);

      create table if not exists assistant_pins (
        topic_id text primary key,
        pinned_at text not null,
        foreign key (topic_id) references assistant_topics(id) on delete cascade
      );

      create table if not exists assistant_messages (
        id text primary key,
        topic_id text not null,
        parent_id text,
        role text not null,
        data_json text not null,
        searchable_text text not null,
        status text not null,
        siblings_group_id integer not null default 0,
        model_id text,
        model_snapshot_json text,
        stats_json text,
        created_at text not null,
        updated_at text not null,
        deleted_at text,
        foreign key (topic_id) references assistant_topics(id) on delete cascade
      );

      create index if not exists idx_assistant_messages_topic_created
        on assistant_messages(topic_id, created_at, id);

      create index if not exists idx_assistant_messages_parent
        on assistant_messages(topic_id, parent_id, siblings_group_id);

      create index if not exists idx_assistant_messages_search
        on assistant_messages(topic_id, searchable_text);

      create table if not exists assistant_platform_state (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );
    `
  },
  {
    id: '0002_assistant_library_provenance',
    up: `
      create table if not exists assistant_template_installs (
        assistant_id text primary key,
        source_kind text not null,
        source_product_id text,
        source_template_id text not null,
        source_template_version integer not null,
        prompt_hash_at_install text not null,
        installed_at text not null,
        updated_at text not null,
        foreign key (assistant_id) references assistant_entities(id) on delete cascade
      );

      create index if not exists idx_assistant_template_installs_source
        on assistant_template_installs(source_kind, source_product_id, source_template_id);
    `
  }
]

export type AssistantPlatformDatabase = {
  connection: DatabaseSync
  transact: <T>(callback: () => T) => T
}

export function createAssistantPlatformDatabase(path: string): AssistantPlatformDatabase {
  const connection = new DatabaseSync(path)
  let transactionDepth = 0
  connection.exec('pragma foreign_keys = on;')
  applyMigrations(connection)
  return {
    connection,
    transact: <T>(callback: () => T) =>
      runInTransaction(connection, callback, {
        getDepth: () => transactionDepth,
        setDepth: (nextDepth) => {
          transactionDepth = nextDepth
        }
      })
  }
}

function applyMigrations(connection: DatabaseSync): void {
  connection.exec(`
    create table if not exists assistant_platform_migrations (
      id text primary key,
      applied_at text not null
    );
  `)

  for (const migration of migrations) {
    const applied = connection
      .prepare('select id from assistant_platform_migrations where id = ?')
      .get(migration.id) as { id?: string } | undefined
    if (applied?.id) continue

    runInTransaction(connection, () => {
      connection.exec(migration.up)
      connection
        .prepare('insert into assistant_platform_migrations (id, applied_at) values (?, ?)')
        .run(migration.id, new Date().toISOString())
    })
  }
}

function runInTransaction<T>(
  connection: DatabaseSync,
  callback: () => T,
  depthState: {
    getDepth: () => number
    setDepth: (nextDepth: number) => void
  } = {
    getDepth: () => 0,
    setDepth: () => undefined
  }
): T {
  const depth = depthState.getDepth()
  const savepoint = `assistant_platform_sp_${depth}`
  if (depth === 0) connection.exec('begin')
  else connection.exec(`savepoint ${savepoint}`)
  depthState.setDepth(depth + 1)
  try {
    const result = callback()
    depthState.setDepth(depth)
    if (depth === 0) connection.exec('commit')
    else connection.exec(`release savepoint ${savepoint}`)
    return result
  } catch (error) {
    depthState.setDepth(depth)
    if (depth === 0) {
      connection.exec('rollback')
    } else {
      connection.exec(`rollback to savepoint ${savepoint}`)
      connection.exec(`release savepoint ${savepoint}`)
    }
    throw error
  }
}
