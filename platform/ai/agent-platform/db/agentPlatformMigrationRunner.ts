import type { DatabaseSync } from 'node:sqlite'

import type { AgentPlatformMigration } from './createAgentPlatformDatabase'

/**
 * Applying the platform migrations, and the nested transaction they run in.
 *
 * Both were the tail of the database constructor and neither needs the connection factory: the
 * migration list is handed in, so this module knows nothing about how the file is opened. That is
 * also why the list stays where it is — a runner that reads a copy it does not own cannot drift
 * from the list it runs.
 */
export function applyMigrations(connection: DatabaseSync, migrations: readonly AgentPlatformMigration[]): void {
  connection.exec(`
    create table if not exists agent_platform_migrations (
      id text primary key,
      applied_at text not null
    );
  `)

  for (const migration of migrations) {
    const applied = connection
      .prepare('select id from agent_platform_migrations where id = ?')
      .get(migration.id) as { id?: string } | undefined
    if (applied?.id) continue

    runInTransaction(connection, () => {
      if (typeof migration.up === 'string') connection.exec(migration.up)
      else migration.up(connection)
      connection
        .prepare('insert into agent_platform_migrations (id, applied_at) values (?, ?)')
        .run(migration.id, new Date().toISOString())
    })
  }
}

export function runInTransaction<T>(
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
  const savepoint = `agent_platform_sp_${depth}`
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
