/**
 * LLMAgent - LLM 决策 Agent
 * 调用 LLM API 进行决策
 */

const { buildSystemPrompt, getPhasePrompt, ROLE_NAMES, formatWithCompression, buildCompressPrompt } = require('../prompts');
const { formatMessageHistory, buildMessages } = require('../context');
const { createLogger } = require('../../utils/logger');

// 创建日志实例（延迟初始化，只使用backend.log）
let backendLogger = null;
function getLogger() {
  if (!backendLogger) {
    backendLogger = global.backendLogger || createLogger('backend.log');
  }
  return backendLogger;
}

class LLMAgent {
  constructor(playerId, game, options = {}) {
    this.playerId = playerId;
    this.game = game;

    // 压缩配置
    this.compressionEnabled = options.compressionEnabled !== false;
    this.compressedSummary = null;
    this.compressedAfterMessageId = 0;
    this.compressionPromise = null;
  }

  /**
   * 根据上下文做出决策
   * @param {Object} context - 决策上下文
   * @returns {Object} action - 决策结果
   */
  async decide(context) {
    // 等待之前的压缩完成（如果有）
    if (this.compressionPromise) {
      await this.compressionPromise;
      this.compressionPromise = null;
    }

    const player = this.game.players.find(p => p.id === this.playerId);
    if (!player) {
      getLogger().error(`[LLMAgent] player 不存在：playerId=${this.playerId}, players=${this.game?.players?.length || 0}`);
      throw new Error(`player ${this.playerId} 不存在`);
    }

    // 检查是否需要使用压缩
    const useCompression = this.compressionEnabled &&
                           this.compressedSummary &&
                           context.messages?.length > 0;

    // 使用统一的 buildMessages
    const result = buildMessages(player, this.game, context, {
      useCompression,
      compressedSummary: this.compressedSummary,
      compressedAfterMessageId: this.compressedAfterMessageId
    });

    getLogger().info(`${player.name} 获取行动, 阶段: ${context.phase}`);

    // 检查 API 是否可用
    if (!this.isApiAvailable()) {
      throw new Error('API 不可用');
    }

    // 调用 API，传入消息
    const response = await this.callAPI(result.lastMessages);
    return this.parseResponse(response, context);
  }

  /**
   * 投票结束后立即调用压缩（异步，不阻塞调用者）
   * @param {Array} messages - 完整消息列表
   */
  compressHistoryAfterVote(messages) {
    getLogger().info(`[LLMAgent] compressHistoryAfterVote: compressionEnabled=${this.compressionEnabled}, isApiAvailable=${this.isApiAvailable()}`);
    if (!this.compressionEnabled || !this.isApiAvailable()) return;
    if (this.compressionPromise) return; // 已有压缩进行中，跳过

    getLogger().info(`[LLMAgent] 开始压缩历史, playerId=${this.playerId}, 当前消息数=${messages.length}`);
    this.compressionPromise = this._doCompress(messages);
  }

  /**
   * 实际执行压缩（私有方法）
   */
  async _doCompress(messages) {
    try {
      // 找出需要压缩的新消息（从上次压缩点到当前）
      const newMessages = messages.filter(m =>
        m.id > this.compressedAfterMessageId &&
        m.type !== 'vote_result'
      );

      if (newMessages.length === 0) return;

      const player = this.game.players.find(p => p.id === this.playerId);
      const prompt = buildCompressPrompt(newMessages, player, this.game.players, this.compressedSummary);
      const summary = await this.callCompressAPI(prompt);

      if (summary) {
        this.compressedSummary = summary;
        this.compressedAfterMessageId = messages[messages.length - 1]?.id || 0;
      }
    } catch (err) {
      getLogger().error(`[LLMAgent] 压缩历史失败: ${err.message}`);
    }
  }

  /**
   * 调用压缩专用 API（复用现有 API）
   */
  async callCompressAPI(prompt) {
    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.AUTH_TOKEN;
    const model = process.env.MODEL;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: '你是一个简洁的狼人杀游戏分析师，擅长压缩信息' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  }

  // 检查 API 是否可用
  isApiAvailable() {
    return !!(process.env.BASE_URL && process.env.AUTH_TOKEN);
  }

  // 调用 API
  async callAPI(messages) {
    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.AUTH_TOKEN;
    const model = process.env.MODEL;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages
      })
    });

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    return response.json();
  }

  // 解析响应
  parseResponse(response, context) {
    const text = response.choices?.[0]?.message?.content || '';
    getLogger().info(`${this.playerId} LLM 响应：${text.substring(0, 100)}`);

    const { phase, alivePlayers } = context;

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);

        // 解析不同类型的响应
        if (data.type === 'speech') {
          return { type: 'speech', content: data.content || '过。' };
        }
        if (data.type === 'vote') {
          return { type: 'vote', target: this.normalizeTarget(data.target, alivePlayers) };
        }
        if (data.type === 'witch') {
          return { type: 'witch', action: data.action || 'skip', target: this.normalizeTarget(data.target, alivePlayers) };
        }
        // 女巫直接返回 heal/poison 类型
        if (data.type === 'heal') {
          return { type: 'heal' };
        }
        if (data.type === 'poison') {
          return { type: 'poison', target: this.normalizeTarget(data.target, alivePlayers) };
        }
        if (data.type === 'target') {
          return { type: 'target', target: this.normalizeTarget(data.target, alivePlayers) };
        }
        if (data.type === 'skip') {
          return { type: 'skip' };
        }
        // 竞选：参与/不参与
        if (data.type === 'campaign') {
          return { type: 'campaign', run: data.run === true };
        }
        // 退水：退出/继续
        if (data.type === 'withdraw') {
          return { type: 'withdraw', withdraw: data.withdraw === true };
        }
        // 丘比特连线：两个目标
        if (data.type === 'cupid') {
          const targets = Array.isArray(data.targets)
            ? data.targets.map(t => this.normalizeTarget(t, alivePlayers)).filter(Boolean)
            : [];
          return { type: 'cupid', targetIds: targets };
        }
        // 猎人开枪
        if (data.type === 'shoot') {
          return { type: 'shoot', target: this.normalizeTarget(data.target, alivePlayers) };
        }
        // 传警徽
        if (data.type === 'passBadge') {
          return { type: 'passBadge', target: this.normalizeTarget(data.target, alivePlayers) };
        }
        // 指定发言顺序
        if (data.type === 'assignOrder') {
          return { type: 'assignOrder', target: this.normalizeTarget(data.target, alivePlayers) };
        }
      }
    } catch (e) {
      getLogger().error(`${this.playerId} LLM 解析失败：${e.message}`);
    }

    // 回退：根据阶段类型返回
    if (['day_discuss', 'sheriff_speech', 'last_words', 'night_werewolf_discuss'].includes(phase)) {
      return { type: 'speech', content: text.trim() || '过。' };
    }

    return { type: 'skip' };
  }

  // 标准化目标（将位置转换为 ID）
  normalizeTarget(target, alivePlayers) {
    if (!target) return null;

    // 如果是数字，可能是位置（1-based）
    const num = parseInt(target);
    const players = this.game?.players || [];
    if (!isNaN(num) && num > 0 && num <= players.length) {
      const player = players[num - 1];
      if (player && player.alive) {
        return String(player.id);
      }
    }

    return String(target);
  }
}

module.exports = { LLMAgent };