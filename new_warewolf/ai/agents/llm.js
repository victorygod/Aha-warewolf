/**
 * LLMAgent - LLM 决策 Agent
 * 调用 LLM API 进行决策
 */

const { buildSystemPrompt, getPhasePrompt } = require('../prompts');
const { formatMessageHistory } = require('../context');
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
  constructor(playerId, game) {
    this.playerId = playerId;
    this.game = game;
    this.systemPrompt = '';
    this.lastMessages = null;
  }

  /**
   * 根据上下文做出决策
   * @param {Object} context - 决策上下文
   * @returns {Object} action - 决策结果
   */
  async decide(context) {
    // 初始化系统提示词
    if (!this.systemPrompt) {
      const player = this.game.players.find(p => p.id === this.playerId);
      this.systemPrompt = buildSystemPrompt(player, this.game);
    }

    // 构建消息
    this.buildMessages(context);

    const player = this.game.players.find(p => p.id === this.playerId);
    getLogger().info(`${player?.name} 获取行动, 阶段: ${context.phase}`);

    // 检查 API 是否可用
    if (!this.isApiAvailable()) {
      throw new Error('API 不可用');
    }

    // 调用 API
    const response = await this.callAPI();
    return this.parseResponse(response, context);
  }

  // 构建消息
  buildMessages(context) {
    const historyText = formatMessageHistory(context.messages, this.game.players);
    const phasePrompt = getPhasePrompt(context.phase, context);
    const userContent = `${historyText}\n\n${phasePrompt}`;

    this.lastMessages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userContent }
    ];
  }

  // 检查 API 是否可用
  isApiAvailable() {
    return !!(process.env.BASE_URL && process.env.AUTH_TOKEN);
  }

  // 调用 API
  async callAPI() {
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
        messages: this.lastMessages
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
        if (data.type === 'pass_badge') {
          return { type: 'pass_badge', target: this.normalizeTarget(data.target, alivePlayers) };
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
    if (!isNaN(num) && num > 0 && num <= this.game.players.length) {
      const player = this.game.players[num - 1];
      if (player && player.alive) {
        return String(player.id);
      }
    }

    return String(target);
  }
}

module.exports = { LLMAgent };