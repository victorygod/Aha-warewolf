const { isSpeech, loadExperience } = require('./prompt');
const { getToolsForAction, getTool } = require('./tools');
const { buildToolResultMessage, formatMessageToText } = require('./formatter');
const { LLMModel } = require('./models/llm_model');
const { RandomModel } = require('./models/random_model');
const { MockModel } = require('./models/mock_model');
const { MessageManager, TOKEN_THRESHOLD } = require('./message_manager');
const { createLogger } = require('../../utils/logger');
const { MSG, PHASE, ACTION } = require('../../engine/constants');

let backendLogger = null;
const getLogger = () => backendLogger || (backendLogger = createLogger('backend.log'));

function estimateTokens(messages) {
  let count = 0;
  for (const msg of messages) {
    if (msg.content) count += Math.ceil(msg.content.length / 4);
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.arguments) count += Math.ceil(tc.function.arguments.length / 4);
      }
    }
  }
  return count;
}

class Agent {
  constructor(options = {}) {
    this.requestQueue = [];
    this.isProcessing = false;
    this.initContext = options.initContext || null;

    this.mm = new MessageManager({
      compressionEnabled: options.compressionEnabled !== false
    });

    this.llmModel = options.useLLM ? new LLMModel(options) : null;
    this.randomModel = new RandomModel();
    this.mockModel = options.mockOptions ? new MockModel(null, options.mockOptions) : null;

    this._models = [
      { model: this.mockModel, name: 'MockModel' },
      { model: this.llmModel, name: 'LLMModel' },
      { model: this.randomModel, name: 'RandomModel' }
    ];

    // 初始化 system 消息（chat 模式），确保后续 compact 有 system 消息
    if (this.initContext) {
      this.updateSystemMessage(this.initContext, 'chat');
    }
  }

  // ==================== 系统消息 ====================

  /**
   * 更新系统消息（签名调整：从 (player, game, mode) 改为 (context, mode)）
   */
  updateSystemMessage(context, mode = 'game') {
    const player = context.self;
    const game = {
      players: context.players,
      round: context.dayCount,
      presetId: context.presetId,
      preset: context.preset,
      werewolfTarget: context.werewolfTarget
    };
    this.mm.updateSystem(player, game, mode);
  }

  destroy() {
    this._drainQueue();
    this.mm.destroy();
  }

  // ==================== 统一入口 ====================

  /**
   * 统一入口：接收所有外界输入
   * @param {Object} options
   * @param {Object|null} options.msg - 普通消息时为 {type, playerId, content}，决策请求时为 null
   * @param {Object} options.context - buildContext 标准输出
   * @returns {Promise<result|null>} - 决策场景返回 Promise，普通消息返回 null
   */
  async receive({ msg, context }) {
    const { promise, items } = this.derive({ msg, context });

    // 严格按顺序入队
    for (const item of items) {
      this.enqueue(item);
    }

    return promise;
  }

  /**
   * 消息派生：解析消息并派生队列项
   */
  derive({ msg, context }) {
    // 决策请求
    if (msg === null) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      // day_vote 决策后需要压缩
      const needCompact = context.action === ACTION.DAY_VOTE;
      return {
        promise,
        items: needCompact
          ? [
              { type: 'decision', context, resolve },
              { type: 'compact', mode: 'game' }
            ]
          : [{ type: 'decision', context, resolve }]
      };
    }

    switch (msg.type) {
      case MSG.GAME_START:
        // 丢弃上状态的 decision 和 compact（赛前未完成的行动和压缩）
        this._drainDecisionsAndCompacts();
        return {
          promise: null,
          items: [
            // 1. 先压缩聊天室历史（此时有 chat 模式的 system 消息）
            { type: 'compact', mode: 'pre_game' },
            // 2. 切换到 game 模式的 system 消息
            { type: 'mode_change', mode: 'game', context },
            // 3. 注入 GAME_START 消息
            { type: 'message', msg, context }
          ]
        };

      case MSG.GAME_OVER:
        // 丢弃上状态的 decision 和 compact（游戏内未完成的行动和压缩）
        this._drainDecisionsAndCompacts();
        return {
          promise: null,
          items: [
            // 1. 注入 GAME_OVER 消息
            { type: 'message', msg, context },
            // 2. 执行赛后 chat 决策（AI 复盘发言）
            {
              type: 'decision',
              context: { ...context, action: ACTION.CHAT, extraData: { ...context.extraData, chatContext: { event: 'game_over' } } },
              callback: context.extraData?.callback
            },
            // 3. 经验沉淀：反思本局并更新个人经验
            {
              type: 'decision',
              context: { ...context, action: 'reflect', currentExperience: loadExperience(context.presetId, context.self?.role?.id || context.self?.role, context.self?.profileName) },
              resolve: null
            },
            // 4. 用 game 视角压缩游戏历史（此时 system 消息还是 game 模式）
            { type: 'compact', mode: 'game_over' },
            // 5. 切换到 chat 模式的 system 消息
            { type: 'mode_change', mode: 'chat', context }
          ]
        };

      case MSG.SPEECH:
        // 自己发的、自己已死亡、游戏已结束：不分析
        if ((msg.playerId === context.self.id && msg.playerName === context.self.name) || !context.self.alive || context.winner) {
          return { promise: null, items: [] };
        }
        // 只分析白天公开发言（警长竞选、白天讨论）
        const isDaySpeech = context.phase === PHASE.SHERIFF_SPEECH || context.phase === PHASE.DAY_DISCUSS;
        if (!isDaySpeech) {
          return { promise: null, items: [{ type: 'message', msg, context }] };
        }
        return {
          promise: null,
          items: [
            { type: 'message', msg, context },
            { type: 'decision', context: { ...context, action: 'analyze' }, resolve: null }
          ]
        };

      case MSG.CHAT:
        // 使用 playerId + playerName 双重校验
        if (msg.playerId === context.self.id && msg.playerName === context.self.name) {
          return { promise: null, items: [] };
        }
        // 被@且游戏未在进行中（等待中或赛后）才回复
        if (this._isMentioned(msg, context) && !context.phaseManagerRunning) {
          return {
            promise: null,
            items: [
              { type: 'message', msg, context },
              {
                type: 'decision',
                context: { ...context, action: ACTION.CHAT, extraData: { ...context.extraData, chatContext: { event: 'mentioned', mentioner: msg.playerName, mentionContent: msg.content } } },
                callback: context.extraData?.callback
              }
            ]
          };
        }
        return {
          promise: null,
          items: [{ type: 'message', msg, context }]
        };

      default:
        return {
          promise: null,
          items: [{ type: 'message', msg, context }]
        };
    }
  }

  /**
   * 丢弃队列中的 decision 和 compact，并 resolve 所有被丢弃的 decision
   */
  _drainDecisionsAndCompacts() {
    const drained = this.requestQueue.filter(
      item => item.type === 'decision' || item.type === 'compact'
    );
    for (const item of drained) {
      if (item.type === 'decision' && item.resolve) {
        item.resolve(null);  // resolve null 表示被丢弃，调用方视为弃权
      }
    }
    this.requestQueue = this.requestQueue.filter(
      item => item.type !== 'decision' && item.type !== 'compact'
    );
  }

  /**
   * @检测
   */
  _isMentioned(msg, context) {
    const content = msg.content;
    const myName = context?.self?.name;
    if (!content || !myName) return false;

    let pos = 0;
    while ((pos = content.indexOf('@', pos)) !== -1) {
      const textAfterAt = content.slice(pos + 1);
      if (textAfterAt.length === 0) { pos++; continue; }

      if (!textAfterAt.startsWith(myName)) { pos++; continue; }

      // 检查是否有更长匹配（优先匹配更长的名字）
      const hasLongerMatch = false;  // 简化处理，由外部 context 提供玩家列表
      if (!hasLongerMatch) return true;
      pos++;
    }
    return false;
  }

  /**
   * 检查是否应该压缩（阈值判断）
   */
  _shouldCompact() {
    if (this.mm._currentMode === 'game') return false;
    const messages = this.mm.messages;
    const pendingText = this.mm.pendingInject.join('');
    const totalTokens = estimateTokens(messages) + Math.ceil(pendingText.length / 4);
    return totalTokens > TOKEN_THRESHOLD;
  }

  /**
   * 获取当前可用的模型（优先级：Mock > LLM > Random）
   */
  _getModel() {
    return this.mockModel || this.llmModel || this.randomModel;
  }

  // ==================== 队列管理 ====================

  enqueue(item) {
    this.requestQueue.push(item);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (this.requestQueue.length > 0) {
        const item = this.requestQueue.shift();
        await this.consume(item);  // 串行处理
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async consume(item) {
    switch (item.type) {
      case 'message':
        // 只加入 pending，不 flush，不 compact
        // 聊天室消息使用 formatMessageToText 格式化
        const formattedContent = item.msg.type === MSG.CHAT
          ? formatMessageToText(item.msg, item.context?.self?.id)
          : item.msg.content;
        if (formattedContent) {
          this.mm.inject(formattedContent);
        }
        break;

      case 'decision':
        // 如果是 chat 模式且没有 system 消息，先初始化
        if (item.context?.action === ACTION.CHAT && this.mm._currentMode === 'chat') {
          if (this.mm.messages.length === 0 || this.mm.messages[0]?.role !== 'system') {
            this.updateSystemMessage(item.context, 'chat');
          }
        }
        this.mm.flush();
        const result = await this.answer(item.context);
        getLogger().info(`[Agent.consume] decision 完成，action=${item.context?.action}, result=${result ? JSON.stringify(result) : 'null'}, callback=${item.callback ? '有' : '无'}`);
        if (item.resolve) item.resolve(result);
        if (item.callback) item.callback(result);
        // chat 模式回复后，立刻进行压缩阈值判断，超限直接压缩
        if (item.context?.action === ACTION.CHAT && this.mm._currentMode === 'chat') {
          if (this._shouldCompact()) {
            await this.mm.compact(this._getModel(), 'chat');
          }
        }
        break;

      case 'compact':
        await this.mm.compact(this._getModel(), item.mode || this.mm._currentMode);
        break;

      case 'mode_change':
        this.updateSystemMessage(item.context, item.mode);
        break;
    }
  }

  async answer(context) {
    const expectedAction = (context.action === 'analyze' || context.action === 'reflect') ? 'content' : (getTool(context.action) || 'content');
    const isDecision = expectedAction !== 'content';

    // 一步完成：生成提示词 + 构建 LLMView + 持久化
    const { llmView, persisted } = this.mm.prepareLLMView(
      context.action,
      context,
      context.self
    );

    const tools = (isDecision || context.action === 'reflect') ? getToolsForAction(context.action, context) : [];

    const playerName = context.self?.name || 'unknown';
    getLogger().debug(`[Agent] ${playerName} ${isDecision ? '决策' : '分析'} messages count: ${llmView.length}, action=${context.action}, expectedAction=${typeof expectedAction === 'string' ? expectedAction : expectedAction?.name}`);

    for (const { model, name } of this._models) {
      if (!model?.isAvailable()) continue;

      try {
        const result = await this._agentLoop(model, context, expectedAction, llmView, tools);
        if (result !== null) {
          return result;
        }
      } catch (e) {
        getLogger().warn(`${name} ${isDecision ? '决策' : '分析'}失败，尝试下一模型：${e.message}`);
      }
    }

    return isDecision ? { type: 'skip' } : '';
  }

  async _agentLoop(model, context, expectedAction, llmView, tools) {
    const maxIterations = 5;
    let iteration = 0;
    let lastAssistantContent = null;
    let lastToolCalls = null;
    let lastToolResult = null;

    while (iteration++ < maxIterations) {
      const result = await model.call({
        ...context,
        _messagesForLLM: llmView,
        _tools: tools
      });
      const raw = result?.raw;
      const toolCalls = raw?.tool_calls || [];
      const content = raw?.content;

      if (toolCalls.length > 0) {
        llmView.push({
          role: 'assistant',
          content: raw?.content || null,
          tool_calls: toolCalls
        });

        for (const toolCall of toolCalls) {
          const tool = getTool(toolCall.function.name);
          let execResult;
          if (!tool) {
            execResult = { success: false, error: `未找到工具: ${toolCall.function.name}` };
          } else {
            try {
              execResult = tool.execute(JSON.parse(toolCall.function.arguments), context);
            } catch (e) {
              execResult = { success: false, error: `参数格式错误: 无法解析 JSON（${e.message}）` };
            }
          }

          const toolResultContent = execResult.success
            ? buildToolResultMessage(toolCall.function.name, execResult.action || { skip: true }, context)
            : execResult.error;

          llmView.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent
          });

          if (expectedAction !== 'content' && toolCall.function.name === expectedAction.name) {
            if (execResult.success) {
              const action = execResult.skip ? { skip: true } : execResult.action;
              this.mm.messages.push(
                { role: 'assistant', content: raw?.content || null, tool_calls: [toolCall] },
                { role: 'tool', tool_call_id: toolCall.id, content: toolResultContent }
              );
              getLogger().info(`[Agent] ${context.self?.name || 'unknown'} 决策完成：${context.phase}, action=${JSON.stringify(action)}`);
              return action;
            }
            getLogger().warn(`[Agent] ${context.self?.name || 'unknown'} tool 执行失败：${execResult.error}, execResult=${JSON.stringify(execResult)}`);
            lastAssistantContent = raw?.content || null;
            lastToolCalls = [toolCall];
            lastToolResult = { tool_call_id: toolCall.id, content: toolResultContent };
            getLogger().warn(`[Agent] ${context.self?.name || 'unknown'} tool 执行失败：${execResult.error}，继续重试`);
          }
        }

        continue;
      }

      if (expectedAction === 'content') {
        this.mm.messages.push({ role: 'assistant', content: content || '' });
        getLogger().info(`[Agent] ${context.self?.name || 'unknown'} 完成，分析内容长度: ${content?.length || 0}`);
        if (!content) {
          getLogger().warn(`[Agent] ${context.self?.name || 'unknown'} 分析返回空内容，原始raw: ${JSON.stringify(raw)}`);
        }
        return content || '';
      }

      lastAssistantContent = content || null;
      llmView.push({ role: 'assistant', content });
      llmView.push({ role: 'user', content: '请使用工具来发言或操作。' });
    }

    this._saveFailedHistory(lastAssistantContent, lastToolCalls, lastToolResult);
    getLogger().error(`[Agent] ${context.self?.name || 'unknown'} agent loop 超过最大迭代次数`);
    return null;
  }

  _saveFailedHistory(assistantContent, toolCalls, toolResult) {
    if (toolCalls && toolCalls.length > 0) {
      this.mm.messages.push(
        { role: 'assistant', content: assistantContent, tool_calls: toolCalls }
      );
      if (toolResult) this.mm.messages.push(toolResult);
    } else if (assistantContent !== null) {
      this.mm.messages.push({ role: 'assistant', content: assistantContent });
    }
  }

  _drainQueue() {
    for (const item of this.requestQueue) {
      if (item.callback) item.callback(null);
    }
    this.requestQueue = [];
    this.isProcessing = false;
  }
}

module.exports = { Agent, TOKEN_THRESHOLD };