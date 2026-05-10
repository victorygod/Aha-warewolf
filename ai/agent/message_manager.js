const { buildSystemPrompt, COMPACT_TEMPLATES, getCurrentTask, isSpeech } = require('./prompt');
const { createLogger } = require('../../utils/logger');

let backendLogger = null;
const getLogger = () => backendLogger || (backendLogger = createLogger('backend.log'));

const TOKEN_THRESHOLD = 4000;

class MessageManager {
  constructor(options = {}) {
    this.messages = [];
    this.pendingInject = [];
    this.compressionEnabled = options.compressionEnabled !== false;
    this._currentMode = 'chat';
  }

  inject(text) {
    if (!text) return;
    this.pendingInject.push(text);
  }

  flush() {
    if (this.pendingInject.length === 0) return null;
    const content = this.pendingInject.join('\n');
    this.messages.push({ role: 'user', content });
    this.pendingInject = [];
    return content;
  }

  destroy() {
    this.messages = [];
    this.pendingInject = [];
    this._currentMode = 'chat';
  }

  /**
   * 准备决策/分析的完整上下文：生成提示词 → 构建 LLMView → 持久化 task
   * @param {string} action - 行动类型（如 'action_day_discuss', 'analyze'）
   * @param {object} context - 游戏上下文（用于获取 task 提示词）
   * @param {object} self - 玩家信息（包含 thinking/speaking）
   * @returns {{ llmView: Array, persisted: boolean }}
   */
  prepareLLMView(action, context, self) {
    // 1. 内联 buildCurrentTurn 逻辑，生成提示词组件
    const task = getCurrentTask(action, context);
    const needThinking = action !== 'compact';
    const needSpeaking = isSpeech(action);
    const ephemeralTask = action === 'analyze' || action === 'reflect';

    const thinking = (needThinking && self?.thinking)
      ? `【行为逻辑】\n${self.thinking}`
      : '';
    const speaking = (needSpeaking && self?.speaking)
      ? `【说话方式】\n${self.speaking}`
      : '';

    // 2. 构建 LLMView（只读，不修改原始 messages）
    const llmView = this._buildLLMViewInternal({ thinking, speaking, task });

    // 3. 持久化 task（仅当 ephemeralTask=false 时）
    let persisted = false;
    if (task && !ephemeralTask) {
      const last = this.messages[this.messages.length - 1];
      if (last?.role === 'user') {
        last.content += '\n' + task;
      } else {
        this.messages.push({ role: 'user', content: task });
      }
      persisted = true;
    }

    return { llmView, persisted };
  }

  /**
   * 内部方法：根据提示词组件构建 LLMView
   */
  _buildLLMViewInternal(parts) {
    const view = JSON.parse(JSON.stringify(this.messages));
    if (!parts || (!parts.thinking && !parts.speaking && !parts.task)) return view;

    const last = view[view.length - 1];

    // 固定模板顺序：thinking → speaking → 原始内容 → task
    const template = [
      parts.thinking,
      parts.speaking,
      '{original}',
      parts.task
    ].filter(Boolean).join('\n');

    if (last?.role === 'user') {
      last.content = template.replace('{original}', last.content);
    } else {
      view.push({ role: 'user', content: template.replace('{original}', '') });
    }

    return view;
  }

  updateSystem(player, game, mode = 'game') {
    if (!player) return;
    if (mode === 'game' && !player.role) return;
    const systemPrompt = buildSystemPrompt(player, { game, mode });
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0] = { role: 'system', content: systemPrompt };
    } else {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }
    this._currentMode = mode;
  }

  async compact(model, mode = 'game') {
    if (!this.compressionEnabled) return;
    try {
      this.flush();

      if (this.messages.length <= 1) return;

      const summaryRequest = this._buildSummaryRequest(mode);
      this.messages.push({ role: 'user', content: summaryRequest });

      const summary = await this._callModelForSummary(model);

      const systemMsg = this.messages[0]?.role === 'system' ? this.messages[0] : null;
      const userMsg = this.messages[this.messages.length - 1];
      const assistantMsg = { role: 'assistant', content: summary || '' };

      this.messages = systemMsg
        ? [systemMsg, userMsg, assistantMsg]
        : [userMsg, assistantMsg];

      if (summary) {
        getLogger().info(`[MessageManager] compact 完成，mode=${mode}，摘要长度=${summary.length}`);
      } else {
        getLogger().warn(`[MessageManager] compact 无可用摘要，mode=${mode}`);
      }
    } catch (err) {
      getLogger().error(`[MessageManager] compact 失败：${err.message}`);
    }
  }

  async _callModelForSummary(model) {
    if (!model || !model.isAvailable()) return null;

    const compactContext = { action: 'compact', _messagesForLLM: this.messages, _tools: [] };

    const result = await model.call(compactContext);

    if (result?.choices?.[0]?.message?.content) {
      return result.choices[0].message.content;
    }
    if (result?.raw?.content) {
      return result.raw.content;
    }

    if (model.call.length >= 2) {
      const result2 = await model.call(Array.isArray(compactContext) ? compactContext : this.messages);
      if (result2?.choices?.[0]?.message?.content) {
        return result2.choices[0].message.content;
      }
    }

    return null;
  }

  _buildSummaryRequest(mode) {
    return COMPACT_TEMPLATES[mode] || COMPACT_TEMPLATES.game;
  }
}

module.exports = { MessageManager, TOKEN_THRESHOLD };