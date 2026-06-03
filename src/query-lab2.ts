/**
 * Lab 2: Tool System — Giving the Agent Hands
 *
 * Lab 1 taught the agent to talk by calling the model and yielding text back to
 * the TUI. Lab 2 adds one new capability: notice when the model asks for a tool
 * and execute exactly one batch of tool calls.
 *
 * This file intentionally does not contain an Agent Loop. After one tool batch
 * finishes, query() returns. Lab 3 will add the while loop that feeds tool
 * results back to the model for autonomous multi-step work.
 */

import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import type { ToolUseContext } from './Tool.js'
import { asSystemPrompt, type SystemPrompt } from './utils/systemPromptType.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  ToolUseSummaryMessage,
  UserMessage,
  TombstoneMessage,
} from './types/message.js'
import {
  getMessagesAfterCompactBoundary,
  normalizeMessagesForAPI,
} from './utils/messages.js'
import { appendSystemContext, prependUserContext } from './utils/api.js'
import { getRuntimeMainLoopModel } from './utils/model/model.js'
import { runTools } from './services/tools/toolOrchestration.js'
import { productionDeps, type QueryDeps } from './query/deps.js'
import type { Terminal } from './query/transitions.js'
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

export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
> {
  const { systemPrompt, userContext, systemContext, canUseTool, querySource } =
    params
  const deps = params.deps ?? productionDeps()
  let toolUseContext = params.toolUseContext

  // Lab 1 complete: build the system prompt.
  const fullSystemPrompt = asSystemPrompt(
    appendSystemContext(systemPrompt, systemContext),
  )

  yield { type: 'stream_request_start' }

  // Lab 1 complete: prepare messages for the model.
  const messagesForQuery = [...getMessagesAfterCompactBoundary(params.messages)]
  toolUseContext = { ...toolUseContext, messages: messagesForQuery }

  const appState = toolUseContext.getAppState()
  const permissionMode = appState.toolPermissionContext.mode
  const currentModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel: toolUseContext.options.mainLoopModel,
  })

  const assistantMessages: AssistantMessage[] = []
  const toolResults: (UserMessage | AttachmentMessage)[] = []

  // TODO 5 setup: keep these accumulators before the streaming loop.
  const toolUseBlocks: ToolUseBlock[] = []
  let needsFollowUp = false

  // Lab 1 complete: call the model and stream messages to the TUI.
  try {
    for await (const message of deps.callModel({
      messages: prependUserContext(messagesForQuery, userContext),
      systemPrompt: fullSystemPrompt,
      thinkingConfig: toolUseContext.options.thinkingConfig,
      tools: toolUseContext.options.tools,
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
        agents: toolUseContext.options.agentDefinitions.activeAgents,
        allowedAgentTypes:
          toolUseContext.options.agentDefinitions.allowedAgentTypes,
        hasAppendSystemPrompt: !!toolUseContext.options.appendSystemPrompt,
        maxOutputTokensOverride: params.maxOutputTokensOverride,
        mcpTools: appState.mcp.tools,
        hasPendingMcpServers: appState.mcp.clients.some(
          client => client.type === 'pending',
        ),
        queryTracking: toolUseContext.queryTracking,
        effortValue: appState.effortValue,
        advisorModel: appState.advisorModel,
        skipCacheWrite: params.skipCacheWrite,
        agentId: toolUseContext.agentId,
        addNotification: toolUseContext.addNotification,
      },
    })) {
      yield message

      // TODO 5: collect tool_use blocks from assistant messages.
      //
      // Steps:
      // 1. Check whether message.type === 'assistant'.
      // 2. Push the assistant message into assistantMessages.
      // 3. Filter message.message.content for blocks whose type is 'tool_use'.
      // 4. Push those blocks into toolUseBlocks.
      // 5. Set needsFollowUp = true if at least one tool block was found.
      //
      // Until this TODO is completed, Lab 2 behaves like Lab 1: the agent can
      // talk, but it ignores tool requests.
    }
  } catch (error) {
    logError(error)
    return { reason: 'model_error', error: error as Error }
  }

  if (toolUseContext.abortController.signal.aborted) {
    return { reason: 'aborted_streaming' }
  }

  // TODO 6: if no tool_use blocks were found, return completed.

  // TODO 7: execute exactly one batch of tools with runTools().
  //
  // Use:
  //   runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)
  //
  // For each update:
  // - yield update.message when present so the TUI can show tool results.
  // - update toolUseContext when update.newContext is present.

  // TODO 8: when yielding a tool result message, normalize it and push user
  // messages into toolResults. Lab 2 collects these results for Lab 3, but does
  // not feed them back to the model yet.
  void canUseTool
  void runTools
  void normalizeMessagesForAPI
  void assistantMessages
  void toolResults
  void toolUseBlocks
  void needsFollowUp

  if (toolUseContext.abortController.signal.aborted) {
    return { reason: 'aborted_tools' }
  }

  // Lab 2 stops after one model call and one possible tool batch. Lab 3 adds
  // message-history updates and loops back to call the model again.
  return { reason: 'completed' }
}
