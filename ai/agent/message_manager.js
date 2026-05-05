const { formatMessageHistory } = require('./formatter');
const { buildSystemPrompt } = require('./prompt');
const { createLogger } = require('../../utils/logger');

let backendLogger = null;
const getLogger = () => backendLogger || (backendLogger = createLogger('backend.log'));

const ROLE_NAMES = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  hunter: '猎人',
  villager: '村民',
  idiot: '白痴',
  cupid: '丘比特'
};

class MessageManager {
  constructor(options = {}) {
    this.messages = [];
    this.lastProcessedId = 0;
    this.compressionEnabled = options.compressionEnabled !== false;
    this._lastContext = null;
  }

  formatIncomingMessages(context) {
    const newMessages = context.messages.filter(m => m.id > this.lastProcessedId);
    const players = context.players || [];
    const currentPlayer = players.find(p => p.id === context.self?.id);
    const newContent = formatMessageHistory(newMessages, players, currentPlayer);
    return { newContent, newMessages };
  }

  buildLLMView(fullContent) {
    let view = JSON.parse(JSON.stringify(this.messages));
    view.push({ role: 'user', content: fullContent });
    return view;
  }

  appendTurn(msgs, newMessages) {
    for (const msg of msgs) {
      this.messages.push(msg);
    }
    const latestId = (newMessages && newMessages.length > 0)
      ? newMessages[newMessages.length - 1].id
      : this.lastProcessedId;
    this.lastProcessedId = latestId;
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
  }

  async compress(llmModel, mode = 'game') {
    if (!this.compressionEnabled) return;
    try {
      const newContent = this._compactHistoryAfterSummary();
      if (!newContent) return;

      const player = this._lastContext?.self;
      if (!player) return;

      const prevSummary = this._findPrevSummary();
      const prompt = mode === 'chat'
        ? this._buildChatCompressPrompt(newContent, player, prevSummary)
        : this._buildCompressPrompt(newContent, player, prevSummary);

      let text;
      if (llmModel && llmModel.isAvailable()) {
        const summary = await llmModel.call([{ role: 'user', content: prompt }], { enableThinking: false });
        text = summary.choices?.[0]?.message?.content;
      } else {
        text = '[[' + prompt + ']]';
      }

      if (text) {
        this.messages = [
          this.messages[0],
          { role: 'user', content: `【之前压缩摘要】\n${text}` }
        ];
        getLogger().info(`[MessageManager] 压缩完成，摘要长度=${text.length}`);
      }
    } catch (err) {
      getLogger().error(`[MessageManager] 压缩历史失败：${err.message}`);
    }
  }

  appendChatSummary(summary) {
    if (!summary) return;
    const content = `【之前压缩摘要】\n${summary}`;
    if (this.messages.length > 1 && this.messages[1].role === 'user' && this.messages[1].content?.startsWith('【之前压缩摘要】')) {
      this.messages[1] = { role: 'user', content };
    } else {
      this.messages.push({ role: 'user', content });
    }
  }

  replaceWithSummary(summary) {
    if (!summary) return;
    const systemMsg = this.messages[0]?.role === 'system' ? this.messages[0] : null;
    this.messages = systemMsg
      ? [systemMsg, { role: 'user', content: `【之前压缩摘要】\n${summary}` }]
      : [{ role: 'user', content: `【之前压缩摘要】\n${summary}` }];
  }

  loadChatHistory(chatContent) {
    if (!chatContent) return;
    const systemMsg = this.messages[0]?.role === 'system' ? this.messages[0] : null;
    this.messages = systemMsg
      ? [systemMsg, { role: 'user', content: `【聊天室历史】\n${chatContent}` }]
      : [{ role: 'user', content: `【聊天室历史】\n${chatContent}` }];
    getLogger().info(`[MessageManager] 加载聊天室历史，内容长度=${chatContent.length}`);
  }

  resetWatermark() {
    this.lastProcessedId = 0;
    this._lastContext = null;
  }

  appendGameInfo(gameInfo) {
    this.messages.push({ role: 'user', content: gameInfo });
  }

  setCompressContext(context) {
    this._lastContext = context;
  }

  _findPrevSummary() {
    if (this.messages.length > 1 &&
        this.messages[1].role === 'user' &&
        this.messages[1].content?.startsWith('【之前压缩摘要】')) {
      return this.messages[1].content.replace('【之前压缩摘要】\n', '');
    }
    return null;
  }

  _compactHistoryAfterSummary() {
    const startIdx = this.messages[1]?.content?.startsWith('【之前压缩摘要】') ? 2 : 1;
    const msgs = this.messages.slice(startIdx);
    if (msgs.length === 0) return null;

    const lines = [];
    for (const msg of msgs) {
      if (msg.role === 'user') {
        lines.push(msg.content);
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls?.length > 0) continue;
        if (msg.content) lines.push(`[分析]${msg.content}`);
      } else if (msg.role === 'tool') {
        lines.push(msg.content);
      }
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  _buildCompressPrompt(newContent, player, prevSummary) {
    const role = player.role;
    const roleId = role?.id || role;
    const roleName = ROLE_NAMES[roleId] || roleId;
    const players = this._lastContext?.players || [];
    const position = players.findIndex(p => p.id === player.id) + 1;

    let wolfTeammates = '';
    if (roleId === 'werewolf') {
      const teammates = players.filter(p => p.alive && p.id !== player.id && p.role?.id === 'werewolf');
      if (teammates.length > 0) {
        const positions = teammates.map(p => players.findIndex(gp => gp.id === p.id) + 1 + '号').join('、');
        wolfTeammates = `\n你的队友: ${positions}`;
      }
    }

    const identityInfo = `名字:${player.name || '未知'} 位置:${position}号位 角色:${roleName}${wolfTeammates}`;

    return `你是狼人杀游戏分析师。请将以下游戏历史压缩为300字以内的局势摘要。

## 你的身份
${identityInfo}

## 上次压缩摘要
${prevSummary || '（无）'}

## 新增消息（从上次压缩点到当前）
${newContent}

请生成简洁的局势摘要，包含：
1. 当前存活人数和阵营分布
2. 关键信息和可疑玩家
3. 可能的局势走向

直接输出摘要，不要有其他内容，非确定性信息需要保留概率分析。`;
  }

  _buildChatCompressPrompt(newContent, player, prevSummary) {
    const identityInfo = `名字:${player.name || '未知'}`;

    return `请将以下聊天历史压缩为300字以内的摘要。

## 你的身份
${identityInfo}

## 上次压缩摘要
${prevSummary || '（无）'}

## 新增消息（从上次压缩点到当前）
${newContent}

直接输出摘要，不要有其他内容。`;
  }
}

module.exports = { MessageManager };