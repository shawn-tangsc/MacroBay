import { z } from 'zod'

import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import type { AgentRuntimeSessionChunk } from '../../ai/agent-platform/runtime/runtimeTypes'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { SkillsRuntimeService } from '../../ai/agent-platform/skills/SkillsRuntimeService'
import { buildSkillRuntimeToolId } from '../../ai/agent-platform/skills/SkillsRuntimeService'

export type SkillToolSdkModule = {
  tool?: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: 'text'; text: string }>
      structuredContent?: unknown
      isError?: boolean
    }>
  ) => unknown
  createSdkMcpServer?: (input: {
    name: string
    version?: string
    tools: unknown[]
  }) => unknown
}

type BuildSkillToolSdkMcpServersInput = {
  composition: AgentRuntimeComposition
  agentId: string
  sessionId: string
  getAgentState: () => Promise<AgentStoreState>
  runtime: SkillsRuntimeService
  emitChunk?: (chunk: AgentRuntimeSessionChunk) => void
  signal?: AbortSignal
  loadSdkHelpers?: () => Promise<SkillToolSdkModule | null>
}

const skillToolMcpServerKey = 'agent-skills'

/**
 * Skill tools are file readers. The SDK rejects plain JSON Schema, so the shape is declared in Zod,
 * and every field stays optional because a call without a path returns the capability summary.
 */
const skillToolInputSchema = z
  .object({
    path: z.string().optional(),
    filePath: z.string().optional(),
    sourcePath: z.string().optional()
  })
  .strict()

export async function buildSkillToolSdkMcpServers(input: BuildSkillToolSdkMcpServersInput): Promise<Record<string, unknown>> {
  if (input.composition.skills.skills.length === 0 || input.composition.skills.toolIds.length === 0) return {}

  const sdk = (await input.loadSdkHelpers?.()) ?? (await defaultLoadSkillToolSdkHelpers())
  if (!sdk?.tool || !sdk.createSdkMcpServer) return {}

  const sdkTools = input.composition.skills.skills.flatMap((skill) =>
    skill.tools.map((toolName) => {
      const toolId = buildSkillRuntimeToolId(skill, toolName)
      return sdk.tool!(
        toolId,
        `${skill.name} skill tool: ${toolName}. Pass {"path": "<file>"} to read a file the skill declares; omit it for a summary.`,
        skillToolInputSchema,
        async (args) => {
          input.emitChunk?.({
            type: 'tool-input-start',
            sessionId: input.sessionId,
            toolCallId: toolId,
            toolName
          })
          input.emitChunk?.({
            type: 'tool-input-available',
            sessionId: input.sessionId,
            toolCallId: toolId,
            toolName,
            input: args
          })

          try {
            const state = await input.getAgentState()
            const result = await input.runtime.invokeSkillTool(state, {
              agentId: input.agentId,
              sessionId: input.sessionId,
              toolId,
              input: args,
              ...(input.signal ? { signal: input.signal } : {})
            })

            if (result.isError) {
              input.emitChunk?.({
                type: 'tool-output-error',
                sessionId: input.sessionId,
                toolCallId: toolId,
                errorText: normalizeSkillToolOutput(result.output)
              })
            } else {
              input.emitChunk?.({
                type: 'tool-output-available',
                sessionId: input.sessionId,
                toolCallId: toolId,
                output: result.output
              })
            }

            return {
              content: [
                {
                  type: 'text' as const,
                  text: normalizeSkillToolOutput(result.output)
                }
              ],
              ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
              ...(result.isError !== undefined ? { isError: result.isError } : {})
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            input.emitChunk?.({
              type: 'tool-output-error',
              sessionId: input.sessionId,
              toolCallId: toolId,
              errorText: message
            })

            return {
              content: [
                {
                  type: 'text' as const,
                  text: message
                }
              ],
              isError: true,
              structuredContent: {
                error: {
                  message
                }
              }
            }
          }
        }
      )
    })
  )

  if (sdkTools.length === 0) return {}

  return {
    [skillToolMcpServerKey]: sdk.createSdkMcpServer({
      name: skillToolMcpServerKey,
      version: '1.0.0',
      tools: sdkTools
    })
  }
}

function normalizeSkillToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

async function defaultLoadSkillToolSdkHelpers(): Promise<SkillToolSdkModule | null> {
  try {
    return (await import('@anthropic-ai/claude-agent-sdk')) as SkillToolSdkModule
  } catch {
    return null
  }
}
