/**
 * query-lab.ts — PoC 简化版 Agent Loop
 *
 * 这个文件是 query.ts（1729 行）的简化版本，只保留核心循环逻辑：
 * 1. 调用 LLM（deps.callModel）
 * 2. 收集 tool_use blocks
 * 3. 如果没有 tool_use → return completed
 * 4. 执行工具（runTools）
 * 5. 更新消息，continue
 *
 * 省略的生产级功能：
 * - 上下文压缩（microcompact, autocompact, snip, context collapse）
 * - 错误恢复（prompt-too-long, max_output_tokens 升级）
 * - 流式工具执行（StreamingToolExecutor）
 * - 模型降级（fallback）
 * - Stop hooks
 * - 分析/遥测
 * - Token budget
 * - Tool use summary
 */

import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from './Tool.js'
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
  createUserMessage,
  normalizeMessagesForAPI,
  getMessagesAfterCompactBoundary,
} from './utils/messages.js'
import { prependUserContext, appendSystemContext } from './utils/api.js'
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
  const {
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    querySource,
    maxTurns,
  } = params
  const deps = params.deps ?? productionDeps()

  let messages = [...params.messages]
  let toolUseContext = params.toolUseContext
  let turnCount = 0

  const fullSystemPrompt = asSystemPrompt(
    appendSystemContext(systemPrompt, systemContext),
  )

  // eslint-disable-next-line no-constant-condition
  while (true) {
    turnCount++

    // 安全保护：最大迭代次数
    if (maxTurns && turnCount > maxTurns) {
      return { reason: 'max_turns', turnCount }
    }

    // 通知 TUI 开始新一轮请求
    yield { type: 'stream_request_start' }

    // 获取 compact boundary 后的消息（兼容已有的压缩标记）
    const messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]

    // 更新 toolUseContext.messages 以便工具执行时能看到对话历史
    toolUseContext = { ...toolUseContext, messages: messagesForQuery }

    const assistantMessages: AssistantMessage[] = []
    const toolResults: (UserMessage | AttachmentMessage)[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false

    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode
    const currentModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel: toolUseContext.options.mainLoopModel,
    })

    // ===== 步骤 1：调用 LLM =====
    try {
      for await (const message of deps.callModel({
        messages: prependUserContext(messagesForQuery, userContext),
        systemPrompt: fullSystemPrompt,
        thinkingConfig: toolUseContext.options.thinkingConfig,
        tools: toolUseContext.options.tools,
        signal: toolUseContext.abortController.signal,
        options: {
          async getToolPermissionContext() {
            const appState = toolUseContext.getAppState()
            return appState.toolPermissionContext
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
          hasAppendSystemPrompt:
            !!toolUseContext.options.appendSystemPrompt,
          maxOutputTokensOverride: params.maxOutputTokensOverride,
          mcpTools: appState.mcp.tools,
          hasPendingMcpServers: appState.mcp.clients.some(
            c => c.type === 'pending',
          ),
          queryTracking: toolUseContext.queryTracking,
          effortValue: appState.effortValue,
          advisorModel: appState.advisorModel,
          skipCacheWrite: params.skipCacheWrite,
          agentId: toolUseContext.agentId,
          addNotification: toolUseContext.addNotification,
        },
      })) {
        // ===== 步骤 2：yield 消息给 TUI，收集 tool_use =====
        yield message

        if (message.type === 'assistant') {
          assistantMessages.push(message)

          const msgToolUseBlocks = message.message.content.filter(
            content => content.type === 'tool_use',
          ) as ToolUseBlock[]

          if (msgToolUseBlocks.length > 0) {
            toolUseBlocks.push(...msgToolUseBlocks)
            needsFollowUp = true
          }
        }
      }
    } catch (error) {
      logError(error)
      return { reason: 'model_error', error: error as Error }
    }

    // 如果被中断了
    if (toolUseContext.abortController.signal.aborted) {
      return { reason: 'aborted_streaming' }
    }

    // ===== 步骤 3：判断是否需要执行工具 =====
    if (!needsFollowUp) {
      return { reason: 'completed' }
    }

    // ===== 步骤 4：执行工具 =====
    const toolUpdates = runTools(
      toolUseBlocks,
      assistantMessages,
      canUseTool,
      toolUseContext,
    )

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message
        toolResults.push(
          ...normalizeMessagesForAPI(
            [update.message],
            toolUseContext.options.tools,
          ).filter(_ => _.type === 'user'),
        )
      }
      if (update.newContext) {
        toolUseContext = { ...update.newContext }
      }
    }

    // 工具执行期间被中断
    if (toolUseContext.abortController.signal.aborted) {
      return { reason: 'aborted_tools' }
    }

    // ===== 步骤 5：更新消息历史，继续循环 =====
    messages = [
      ...messagesForQuery,
      ...normalizeMessagesForAPI(assistantMessages, toolUseContext.options.tools),
      ...toolResults,
    ]
  }
}
