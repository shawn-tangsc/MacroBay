#!/usr/bin/env node
/**
 * Operator CLI for channel adapter acceptance.
 *
 * It opens the agent SQLite database directly, so the desktop app must be closed for the same
 * userData directory. Evidence must never contain tokens, chat ids, or raw provider bodies.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { createAgentPlatformDatabase } from '../platform/ai/agent-platform/db/createAgentPlatformDatabase'
import type { AgentChannelType } from '../platform/ai/agent-platform/schemas/channelSchemas'
import { ChannelAcceptanceService } from '../platform/ai/agent-platform/channels/ChannelAcceptanceService'
import { channelAdapterKeys, type ChannelAdapterKey } from '../platform/ai/agent-platform/channels/ChannelManagementPredicates'
import type { ChannelAdapterAcceptanceEntry } from '../platform/ai/agent-platform/channels/channelContracts'

type CliMode = 'record' | 'revoke' | 'status'

export type ChannelAcceptanceCliArgs = {
  dbPath: string
  mode: CliMode
  actor: string
  recordPath?: string
  adapterKey?: ChannelAdapterKey
}

const USAGE = `Usage:
  channel-acceptance --db <agents.sqlite> --status
  channel-acceptance --db <agents.sqlite> --record <evidence.json> --actor <name>
  channel-acceptance --db <agents.sqlite> --revoke <adapter-key> --actor <name>

Adapter keys: ${channelAdapterKeys.join(', ')}`

export function parseChannelAcceptanceArgs(argv: readonly string[]): ChannelAcceptanceCliArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token?.startsWith('--')) continue
    const [flag, inline] = token.slice(2).split('=', 2)
    if (!flag) throw new Error('invalid flag')
    if (flag === 'status') {
      values.set('status', 'true')
      continue
    }
    const value = inline ?? argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${flag}`)
    if (!inline) index += 1
    values.set(flag, value)
  }

  const dbPath = values.get('db')
  if (!dbPath) throw new Error('--db is required')
  const recordPath = values.get('record')
  const adapterKey = values.get('revoke')
  const status = values.has('status')
  const modes = [recordPath, adapterKey, status ? 'status' : null].filter(Boolean)
  if (modes.length !== 1) throw new Error('exactly one of --record, --revoke, or --status is required')

  const mode: CliMode = recordPath ? 'record' : adapterKey ? 'revoke' : 'status'
  const actor = values.get('actor')?.trim() ?? ''
  if (mode !== 'status' && (!actor || actor.length > 120)) throw new Error('--actor is required')

  if (adapterKey && !(channelAdapterKeys as readonly string[]).includes(adapterKey)) {
    throw new Error(`unknown adapter key: ${adapterKey}`)
  }
  return {
    dbPath,
    mode,
    actor,
    ...(recordPath ? { recordPath } : {}),
    ...(adapterKey ? { adapterKey: adapterKey as ChannelAdapterKey } : {})
  }
}

type EvidenceFile = {
  adapterKey: ChannelAdapterKey
  adapterVersion: string
  realSmokeAt: string
  capabilities: Record<string, boolean>
  checks: Record<string, string>
  capabilityEvidence?: Record<string, string>
}

export function evidenceFileToEntry(value: unknown): ChannelAdapterAcceptanceEntry {
  const evidence = value as Partial<EvidenceFile> | null
  if (!evidence || typeof evidence !== 'object') throw new Error('evidence must be an object')
  if (!evidence.adapterKey || !(channelAdapterKeys as readonly string[]).includes(evidence.adapterKey)) {
    throw new Error('evidence.adapterKey is invalid')
  }
  if (typeof evidence.adapterVersion !== 'string' || !evidence.adapterVersion.trim()) {
    throw new Error('evidence.adapterVersion is required')
  }
  if (typeof evidence.realSmokeAt !== 'string') throw new Error('evidence.realSmokeAt is required')
  const checks = evidence.checks ?? {}
  const capabilities = evidence.capabilities ?? {}
  const adapterType = (evidence.adapterKey === 'lark' ? 'feishu' : evidence.adapterKey) as AgentChannelType

  return {
    adapterType,
    adapterVersion: evidence.adapterVersion.trim(),
    status: 'supported',
    capabilities: {
      receiveText: capabilities.receiveText === true,
      receiveImages: capabilities.receiveImages === true,
      receiveFiles: capabilities.receiveFiles === true,
      sendText: capabilities.sendText === true,
      streaming: capabilities.streaming === true,
      typingIndicator: capabilities.typingIndicator === true,
      nativeCommands: capabilities.nativeCommands === true,
      groupMention: capabilities.groupMention === true,
      qrEnrollment: capabilities.qrEnrollment === true,
      reconnect: capabilities.reconnect === true
    },
    receiveSmokeAt: checks.receive ?? null,
    sendSmokeAt: checks.send ?? null,
    reconnectSmokeAt: checks.reconnect ?? null,
    restartRecoveryAt: checks.restartRecovery ?? null,
    proxySmokeAt: checks.proxySystem ?? checks.proxy ?? null,
    credentialRotationAt: checks.credentialRotation ?? null,
    disableDeleteFencingAt: checks.disableDeleteFence ?? null,
    capabilityEvidence: Object.fromEntries(
      Object.entries(evidence.capabilityEvidence ?? {}).filter(([key]) => key in capabilities)
    )
  }
}

export function runChannelAcceptanceCli(args: ChannelAcceptanceCliArgs): string {
  const database = createAgentPlatformDatabase(args.dbPath)
  try {
    const acceptance = new ChannelAcceptanceService(database)
    if (args.mode === 'status') {
      const byKey = new Map(acceptance.listSupport().map((row) => [row.adapterKey, row]))
      const support = channelAdapterKeys.map((adapterKey) => byKey.get(adapterKey) ?? {
        adapterKey,
        status: 'blocked',
        adapterVersion: '',
        evidenceRecordedAt: null,
        updatedAt: null
      })
      const current = database.connection.prepare(
        'select adapter_type,adapter_version,updated_at from channel_adapter_acceptance_current order by adapter_type'
      ).all()
      return JSON.stringify({ support, current }, null, 2)
    }

    if (args.mode === 'revoke') {
      if (!args.adapterKey) throw new Error('--revoke requires an adapter key')
      const adapterType = (args.adapterKey === 'lark' ? 'feishu' : args.adapterKey) as AgentChannelType
      acceptance.revokeCurrent(adapterType)
      return JSON.stringify({ ok: true, action: 'revoke', adapterKey: args.adapterKey, actor: args.actor })
    }

    if (!args.recordPath) throw new Error('--record requires a file path')
    const evidence = JSON.parse(readFileSync(args.recordPath, 'utf8')) as EvidenceFile
    const entry = evidenceFileToEntry(evidence)
    acceptance.recordSuccessfulSmoke({ entry, actor: args.actor, realSmokeAt: evidence.realSmokeAt })
    return JSON.stringify({ ok: true, action: 'record', adapterKey: args.adapterKey ?? evidence.adapterKey, actor: args.actor })
  } finally {
    database.connection.close()
  }
}

function main(): void {
  try {
    const args = parseChannelAcceptanceArgs(process.argv.slice(2))
    process.stdout.write(`${runChannelAcceptanceCli(args)}\n`)
  } catch (error) {
    process.stderr.write(`${USAGE}\n\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
