# 聊天室压缩设计

## 一、当前上下文流程

### 1.1 整体架构

```
ServerCore                    Agent                      MessageManager
    │                          │                            │
    │ startGame()              │                            │
    │ ────────────────────────>│                            │
    │                          │ enterGame(player, game,    │
    │                          │   chatContent)             │
    │                          │ ──────────────────────────>│
    │                          │                            │ compress(game)
    │                          │                            │ (已删除，无效)
    │                          │ updateSystem(game)        │
    │                          │ ──────────────────────────>│
    │                          │ loadChatHistory(chat)     │
    │                          │ ──────────────────────────>│
    │                          │ resetWatermark()          │
    │                          │                            │
    │ 游戏进行中               │                            │
    │ ────────────────────────>│ answer(context)          │
    │                          │ ──────────────────────────>│ formatIncomingMessages()
    │                          │                            │
    │ 游戏结束                 │                            │
    │ ────────────────────────>│                            │
    │                          │ exitGame()                │
    │                          │ ──────────────────────────>│ updateSystem(chat)
    │                          │                            │
    │ postGameCompress         │                            │
    │ ────────────────────────>│ postGameCompress()        │
    │                          │ ──────────────────────────>│ compress(chat)
```

### 1.2 当前消息流转

| 阶段 | 消息内容 | 存储位置 |
|------|----------|----------|
| 聊天室 | 玩家聊天内容 | ServerCore.displayMessages (source='chat') |
| 进入游戏 | 聊天室历史 → loadChatHistory | Agent.messages |
| 游戏进行中 | 增量游戏消息 + @提及上下文 | Agent.messages (appendTurn) |
| 游戏结束 | 游戏结果信息 | Agent.messages (appendGameInfo) |

### 1.3 当前压缩逻辑

```js
// MessageManager.compress(mode)
// mode: 'game' | 'chat'

_compactHistoryAfterSummary() {
  // 1. 收集上次压缩点之后的所有消息
  // 2. user 消息：直接保留内容
  // 3. assistant 消息：有 tool_calls 跳过，否则标记 [分析] 保留
  // 4. tool 消息：保留结果
}

_buildCompressPrompt(newContent, player, prevSummary) {
  // game 模式：300字摘要，包含存活人数、关键信息、局势走向
}

_buildChatCompressPrompt(newContent, player, prevSummary) {
  // chat 模式：300字摘要，只保留聊天内容
}
```

---

## 二、聊天室压缩方案

### 2.1 设计目标

1. **减少 token 消耗**：聊天室历史可能很长，需要定期压缩
2. **保留关键信息**：发言风格、玩家关系、关键话题
3. **无缝衔接游戏**：压缩后仍可作为游戏决策的背景上下文

### 2.2 压缩时机

#### 时机 A：进入游戏时压缩聊天室历史

**触发条件**：每次 `enterGame()` 调用时

**当前行为**：
```js
enterGame(player, game, chatContent) {
  // compress(game) ← 已删除，无效代码
  loadChatHistory(chatContent)  // 直接加载原始聊天内容
}
```

**优化为**：
```js
enterGame(player, game, chatContent) {
  // 1. 如果有聊天室历史，先压缩
  if (chatContent) {
    const summary = await this.mm.compressChatHistory(chatContent, player);
    this.mm.loadChatSummary(summary);  // 加载摘要而非原始内容
  }
  // 2. 切换到游戏模式
  this.mm.updateSystem(player, game, 'game');
  this.mm.resetWatermark();
}
```

**压缩提示词**：
```
请将以下聊天室历史压缩为200字以内的摘要，保留：
1. 玩家的发言风格和特点
2. 玩家之间的互动关系（谁和谁聊得多）
3. 关键话题或争议点
4. 整体氛围（活跃/沉默/友好/对立）

聊天室历史：
{chatContent}
```

---

#### 时机 B：Token 阈值触发压缩

**触发条件**：Agent.messages 的 token 数超过阈值

**实现方式**：
```js
// 在 answer() 每次调用前检查
async answer(context) {
  // 检查是否需要压缩
  if (this.shouldCompress()) {
    await this.mm.compress(this.llmModel, 'chat');
  }
  // ... 正常逻辑
}

shouldCompress() {
  const tokenEstimate = estimateTokens(this.mm.messages);
  return tokenEstimate > TOKEN_THRESHOLD;  // 如 4000 tokens
}
```

**压缩提示词**：
```
请将以下聊天记录压缩为300字以内的摘要，保留：
1. 各玩家的发言风格和特点
2. 玩家之间的互动关系和态度
3. 讨论的关键话题和观点
4. 任何未解决的分歧或争议

近期聊天记录：
{recentMessages}
```

**增量压缩**：
- 保留上次的压缩摘要作为上下文
- 只压缩新增消息，避免重复处理

---

#### 时机 C：游戏结束时压缩

**触发条件**：`postGameCompress()` 调用时

**当前行为**：已经存在，压缩游戏历史

**优化为**：同时压缩聊天室历史 + 游戏历史

```js
async postGameCompress() {
  // 1. 压缩游戏历史（已有）
  await this.mm.compress(this.llmModel, 'game');

  // 2. 压缩聊天室历史（新增）
  await this.mm.compress(this.llmModel, 'chat_summary');

  this.mm.resetWatermark();
}
```

**压缩提示词**：
```
请将本局游戏后的聊天室聊天压缩为200字以内的摘要，保留：
1. 玩家对游戏结果的讨论
2. 玩家之间的关系变化
3. 值得记录的关键话题

聊天记录：
{chatMessages}
```

---

### 2.3 压缩函数设计

**核心原则**：复用现有压缩框架，区分模式

```js
class MessageManager {
  // 压缩模式枚举
  static COMPRESS_MODE = {
    GAME: 'game',           // 游戏局势压缩
    CHAT_ENTER: 'chat_enter',   // 进入游戏时压缩聊天室
    CHAT_TOKEN: 'chat_token',   // Token 阈值触发压缩
    CHAT_GAME_OVER: 'chat_game_over'  // 游戏结束压缩聊天室
  };

  async compress(llmModel, mode = 'game') {
    const newContent = this._compactHistoryAfterSummary();
    if (!newContent) return;

    const player = this._lastContext?.self;
    if (!player) return;

    const prevSummary = this._findPrevSummary();

    // 根据模式选择提示词
    const prompt = this._buildCompressPromptByMode(mode, newContent, player, prevSummary);

    // 调用 LLM 压缩
    let text;
    if (llmModel?.isAvailable()) {
      const result = await llmModel.call([{ role: 'user', content: prompt }]);
      text = result.choices?.[0]?.message?.content;
    } else {
      text = `[[摘要模式:${mode}]]${newContent.slice(0, 100)}`;
    }

    if (text) {
      this._applyCompressedSummary(text, mode);
    }
  }

  _buildCompressPromptByMode(mode, newContent, player, prevSummary) {
    const baseInfo = `你的身份: ${player.name || '未知'}`;
    const prevContext = prevSummary ? `上次压缩摘要:\n${prevSummary}\n` : '';

    switch (mode) {
      case 'chat_enter':
        return `${baseInfo}

请将以下聊天室历史压缩为200字以内的摘要，保留：
1. 玩家的发言风格和特点
2. 玩家之间的互动关系
3. 关键话题或争议点
4. 整体氛围

${prevContext}聊天室历史：
${newContent}`;

      case 'chat_token':
        return `${baseInfo}

请将以下聊天记录压缩为300字以内的摘要，保留：
1. 各玩家的发言风格和特点
2. 玩家之间的互动关系和态度
3. 讨论的关键话题和观点
4. 任何未解决的分歧或争议

${prevContext}近期聊天记录：
${newContent}`;

      case 'chat_game_over':
        return `${baseInfo}

请将本局游戏后的聊天室聊天压缩为200字以内的摘要，保留：
1. 玩家对游戏结果的讨论
2. 玩家之间的关系变化
3. 值得记录的关键话题

${prevContext}聊天记录：
${newContent}`;

      default:
        return this._buildCompressPrompt(newContent, player, prevSummary);
    }
  }

  _applyCompressedSummary(text, mode) {
    // 统一格式：保留为【之前压缩摘要】
    const content = `【之前压缩摘要】\n${text}`;
    this.messages = [this.messages[0], { role: 'user', content }];
  }
}
```

---

### 2.4 Token 估算与阈值

```js
// 简单估算：平均 1 token ≈ 1.5 字符
function estimateTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    if (msg.content) {
      total += msg.content.length / 1.5;
    }
  }
  return total;
}

// 阈值配置
const TOKEN_THRESHOLD = {
  CHAT: 4000,   // 聊天室模式阈值
  GAME: 6000    // 游戏模式阈值（可更高）
};
```

---

## 三、API 变更

### 3.1 Agent 变更

```js
class Agent {
  // 新增：聊天室 Token 阈值压缩检查
  async answer(context) {
    // 每次决策前检查是否需要压缩
    if (this.shouldCompressChat()) {
      await this.mm.compress(this.llmModel, 'chat_token');
    }
    // ... 原有逻辑
  }

  shouldCompressChat() {
    const tokenCount = estimateTokens(this.mm.messages);
    return tokenCount > TOKEN_THRESHOLD.CHAT;
  }

  // 修改：enterGame 时压缩聊天室历史
  async enterGame(player, game, chatContent) {
    this._drainQueue();

    if (chatContent) {
      // 进入游戏时压缩聊天室历史
      const summary = await this.mm.compressAndGetSummary(
        this.llmModel,
        chatContent,
        player,
        'chat_enter'
      );
      this.mm.loadChatSummary(summary);
    }

    this.mm.updateSystem(player, game, 'game');
    this.mm.resetWatermark();
  }

  // 修改：postGameCompress 同时压缩游戏和聊天室
  async postGameCompress() {
    await this.mm.compress(this.llmModel, 'game');
    await this.mm.compress(this.llmModel, 'chat_game_over');
    this.mm.resetWatermark();
  }
}
```

### 3.2 MessageManager 新增方法

```js
class MessageManager {
  // 压缩聊天室历史并返回摘要（用于 enterGame）
  async compressAndGetSummary(llmModel, chatContent, player, mode) {
    // 构建压缩提示词
    const prompt = this._buildChatEnterPrompt(chatContent, player);

    let text;
    if (llmModel?.isAvailable()) {
      const result = await llmModel.call([{ role: 'user', content: prompt }]);
      text = result.choices?.[0]?.message?.content;
    } else {
      text = chatContent.slice(0, 200);
    }

    return text;
  }

  // 加载压缩后的摘要（替代 loadChatHistory）
  loadChatSummary(summary) {
    const systemMsg = this.messages[0]?.role === 'system' ? this.messages[0] : null;
    this.messages = systemMsg
      ? [systemMsg, { role: 'user', content: `【聊天室压缩摘要】\n${summary}` }]
      : [{ role: 'user', content: `【聊天室压缩摘要】\n${summary}` }];
  }
}
```

---

## 四、流程对比

### 4.1 优化前 vs 优化后

| 时机 | 优化前 | 优化后 |
|------|--------|--------|
| enterGame | 直接加载原始聊天内容 | 先压缩聊天室历史，再加载摘要 |
| 游戏进行中 | 无压缩 | Token 阈值触发压缩 |
| postGameCompress | 只压缩游戏历史 | 同时压缩游戏+聊天室 |

### 4.2 Token 消耗预估

假设每局聊天室有 100 条消息，平均每条 50 字符：

- **优化前**：约 5000 字符 → ~3300 tokens
- **优化后**：
  - 进入游戏：压缩为 200 字 → ~130 tokens
  - 游戏中：阈值 4000 tokens 触发压缩 → 保持 <4000 tokens
  - 游戏结束：再压缩为 200 字 → ~130 tokens

---

## 五、待确认问题

1. **Token 阈值**：4000 是否合适？是否需要分模式设置？
2. **压缩频率**：游戏中每次 compress 会覆盖上次摘要，增量压缩是否足够？
3. **fallback**：当 LLM 不可用时，压缩策略是什么？（当前是截断）
4. **与游戏压缩的交互**：聊天室压缩和游戏压缩是否需要不同的触发条件？