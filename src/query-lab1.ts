/**
 * Lab 1: API Calling — "The First Conversation"
 *
 * This file is a focused replacement for src/query.ts.
 * Lab 1 keeps the real TUI and model streaming path, but intentionally removes
 * tool execution and the agent loop. The agent can speak, but it cannot act.
 */

import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import { type ToolUseContext } from './Tool.js'
import { asSystemPrompt, type SystemPrompt } from './utils/systemPromptType.js'
import type {
  Message,
  RequestStartEvent,
  StreamEvent,
  ToolUseSummaryMessage,
  TombstoneMessage,
} from './types/message.js'
import { getMessagesAfterCompactBoundary } from './utils/messages.js'
import { prependUserContext, appendSystemContext } from './utils/api.js'
import { getRuntimeMainLoopModel } from './utils/model/model.js'
import { productionDeps, type QueryDeps } from './query/deps.js'
import type { QuerySource } from './constants/querySource.js'
import { logError } from './utils/log.js'

export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  taskBudget?: { total: number }
  deps?: QueryDeps
}

type Lab1Terminal =
  | { reason: 'completed' }
  | { reason: 'model_error'; error: Error }
  | { reason: 'aborted_streaming' }

export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Lab1Terminal
> {
  const { systemPrompt, userContext, systemContext, querySource } = params
  const deps = params.deps ?? productionDeps()
  const messages = [...params.messages]
  let toolUseContext = params.toolUseContext

  // TODO-Lab1-1: Build the complete system prompt.
  const fullSystemPrompt = asSystemPrompt(
    appendSystemContext(systemPrompt, systemContext),
  )

  yield { type: 'stream_request_start' }

  // TODO-Lab1-2: Select the messages that should be sent to the model.
  const messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]

  toolUseContext = { ...toolUseContext, messages: messagesForQuery }

  const appState = toolUseContext.getAppState()
  const permissionMode = appState.toolPermissionContext.mode
  const currentModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel: toolUseContext.options.mainLoopModel,
  })

  // TODO-Lab1-3: Call the model stream and yield every event back to the TUI.
  try {
    for await (const message of deps.callModel({
      messages: prependUserContext(messagesForQuery, userContext),
      systemPrompt: fullSystemPrompt,
      thinkingConfig: toolUseContext.options.thinkingConfig,
      // Lab 1 deliberately sends no tools: the agent can answer text, but
      // read/write/bash execution only becomes available in later labs.
      tools: [],
      signal: toolUseContext.abortController.signal,
      options: {
        async getToolPermissionContext() {
          return toolUseContext.getAppState().toolPermissionContext
        },
        model: currentModel,
        toolChoice: undefined,
        isNonInteractiveSession:
          toolUseContext.options.isNonInteractiveSession,
        fallbackModel: params.fallbackModel,
        querySource,
        agents: [],
        allowedAgentTypes: [],
        hasAppendSystemPrompt: !!toolUseContext.options.appendSystemPrompt,
        maxOutputTokensOverride: params.maxOutputTokensOverride,
        mcpTools: [],
        hasPendingMcpServers: false,
        queryTracking: toolUseContext.queryTracking,
        effortValue: appState.effortValue,
        advisorModel: appState.advisorModel,
        skipCacheWrite: params.skipCacheWrite,
        agentId: toolUseContext.agentId,
        addNotification: toolUseContext.addNotification,
      },
    })) {
      yield message
    }
  } catch (error) {
    logError(error)
    return { reason: 'model_error', error: error as Error }
  }

  if (toolUseContext.abortController.signal.aborted) {
    return { reason: 'aborted_streaming' }
  }

  // TODO-Lab1-4: End the turn. No tool handling, no follow-up loop.
  return { reason: 'completed' }
}
