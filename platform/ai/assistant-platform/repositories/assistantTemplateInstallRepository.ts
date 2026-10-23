import type { AssistantTemplateSourceKind } from '../library/assistantTemplateSchemas'
import type { AssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'

export type AssistantTemplateInstallRecord = {
  assistantId: string
  sourceKind: AssistantTemplateSourceKind
  sourceProductId: string | null
  sourceTemplateId: string
  sourceTemplateVersion: number
  promptHashAtInstall: string
  installedAt: string
  updatedAt: string
}

export type AssistantTemplateInstallInput = Omit<AssistantTemplateInstallRecord, 'installedAt' | 'updatedAt'>

type AssistantTemplateInstallRow = {
  assistant_id: string
  source_kind: AssistantTemplateSourceKind
  source_product_id: string | null
  source_template_id: string
  source_template_version: number
  prompt_hash_at_install: string
  installed_at: string
  updated_at: string
}

export type AssistantTemplateInstallRepository = {
  getByAssistantId: (assistantId: string) => AssistantTemplateInstallRecord | null
  listBySource: (templateId: string) => AssistantTemplateInstallRecord[]
  upsert: (input: AssistantTemplateInstallInput) => AssistantTemplateInstallRecord
  deleteByAssistantId: (assistantId: string) => boolean
}

export function createAssistantTemplateInstallRepository(
  db: AssistantPlatformDatabase
): AssistantTemplateInstallRepository {
  return {
    getByAssistantId(assistantId) {
      const row = db.connection
        .prepare('select * from assistant_template_installs where assistant_id = ?')
        .get(assistantId) as AssistantTemplateInstallRow | undefined
      return row ? hydrate(row) : null
    },

    listBySource(templateId) {
      const rows = db.connection
        .prepare(
          `select * from assistant_template_installs
           where source_template_id = ?
           order by installed_at asc, assistant_id asc`
        )
        .all(templateId) as AssistantTemplateInstallRow[]
      return rows.map(hydrate)
    },

    upsert(input) {
      return db.transact(() => {
        const existing = this.getByAssistantId(input.assistantId)
        const now = new Date().toISOString()
        const installedAt = existing?.installedAt ?? now
        db.connection
          .prepare(
            `insert into assistant_template_installs (
              assistant_id, source_kind, source_product_id, source_template_id,
              source_template_version, prompt_hash_at_install, installed_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(assistant_id) do update set
              source_kind = excluded.source_kind,
              source_product_id = excluded.source_product_id,
              source_template_id = excluded.source_template_id,
              source_template_version = excluded.source_template_version,
              prompt_hash_at_install = excluded.prompt_hash_at_install,
              updated_at = excluded.updated_at`
          )
          .run(
            input.assistantId,
            input.sourceKind,
            input.sourceProductId,
            input.sourceTemplateId,
            input.sourceTemplateVersion,
            input.promptHashAtInstall,
            installedAt,
            now
          )
        const next = this.getByAssistantId(input.assistantId)
        if (!next) throw new Error(`Failed to write assistant template install: ${input.assistantId}`)
        return next
      })
    },

    deleteByAssistantId(assistantId) {
      return db.transact(() => {
        const result = db.connection
          .prepare('delete from assistant_template_installs where assistant_id = ?')
          .run(assistantId)
        return Number(result.changes ?? 0) > 0
      })
    }
  }
}

function hydrate(row: AssistantTemplateInstallRow): AssistantTemplateInstallRecord {
  return {
    assistantId: row.assistant_id,
    sourceKind: row.source_kind,
    sourceProductId: row.source_product_id,
    sourceTemplateId: row.source_template_id,
    sourceTemplateVersion: row.source_template_version,
    promptHashAtInstall: row.prompt_hash_at_install,
    installedAt: row.installed_at,
    updatedAt: row.updated_at
  }
}
