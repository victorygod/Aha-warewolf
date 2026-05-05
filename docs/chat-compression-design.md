# 聊天室压缩设计

## 一、核心理念

**Agent 的上下文是一条不中断的流。场景切换只改"我在做什么"（system prompt），不改"我知道什么"（messages）。压缩是唯一的变换——它是有损折叠，不是清空重建。**

Agent 就像一个真人，从聊天室走进游戏再走回聊天室。他不会失忆然后被塞一份聊天记录，他带着自己的记忆（压缩后的摘要），只接收还没看到的新消息。

由此推导：

1. **上下文连续性**：`mm.messages` 从 Agent 创建到销毁始终延续。`exitGame` 只改 system prompt，消息不动；`enterGame` 只追加 delta，不替换已有上下文。不存在"清空重建"的操作。
2. **统一压缩函数**：所有压缩场景共用一个 `compress()`，不同场景仅通过提示词模板区分。不搞多个压缩方法。
3. **增量压缩**：每次压缩时，前次摘要 + 新消息一起送入 LLM，产出合并后的新摘要。不存在孤立的多次压缩结果。整条流始终是 `[system, 压缩摘要(含所有历史), 新消息...]` 的结构。
4. **短内容免调 LLM**：当待压缩内容低于阈值时，跳过 LLM 调用，直接用紧凑原文包装为 `【之前压缩摘要】` 格式。这适用于强制触发压缩的场景（如 `enterGame`），目的是告诉 LLM 这些是前一阶段的内容，游戏对局刚开始，赛前讨论的大概内容心里有个数就行。
5. **Delta 追踪**：跨场景切换时，只追加 Agent 没看过的新消息（通过 chatWatermark），而非重新灌入完整历史。
6. **绝不替换**：任何操作都不应该用外部内容替换 `mm.messages` 中 system 之后的内容。只有 `compress()` 可以折叠消息，且产出格式与已有摘要一致。

## 二、设计目标

1. **减少 token 消耗**：聊天室历史可能很长，需要定期压缩
2. **保留关键信息**：发言风格、玩家关系、关键话题、游戏局势
3. **无缝衔接**：压缩后的摘要作为后续所有场景（游戏、聊天室）的背景上下文

## 三、当前实现问题

以下问题在现有代码中发现，设计方案需一并解决。

### 3.1 `postGameCompress` 与 `appendGameInfo` 顺序错误

当前代码（`server-core.js _executeAIChat`）：

```
AI 发完复盘消息 → postGameCompress() → appendGameInfo(gameInfo)
```

`appendGameInfo` 在压缩**之后**执行，导致游戏结果信息不在压缩摘要中。

**修复**：先 `appendGameInfo`，再 `postGameCompress`。

### 3.2 `loadChatHistory` 违反连续流理念

当前 `loadChatHistory(chatContent)` **替换** `mm.messages` 中 system 之后的所有内容。这违反了"绝不替换"原则：

1. Agent 在聊天室阶段积累的上下文（包括压缩摘要）被丢弃
2. `chatContent` 是 ServerCore 的完整聊天历史，不是 Agent 还没看到的增量内容
3. 前缀 `【聊天室历史】` 与 `_findPrevSummary()` 识别的 `【之前压缩摘要】` 不一致

**修复**：删除 `loadChatHistory`。`enterGame` 改为 `appendChatDelta` 追加增量，新 Agent 初始化也走同一路径（`lastChatMessageId = 0` 时 delta 就是完整历史）。

### 3.3 `postGameCompress` 使用 `mode='chat'` 且多余 `resetWatermark`

`postGameCompress()` 调用 `compress(llmModel, 'chat')`，chat 模式的提示词只包含玩家名字，不包含角色、位置、队友信息。游戏结束后的压缩内容包含大量游戏相关讨论，用 chat 模式压缩会丢失关键游戏上下文。

另外 `postGameCompress` 调了 `resetWatermark()`，但 `resetWatermark` 是游戏消息追踪机制，只在 `enterGame` 时需要重置。游戏结束后不需要重置。

**修复**：改为 `mode='game'`，删除 `resetWatermark` 调用。

### 3.4 `processQueue` 压缩不传 mode

当前 `processQueue` 中 `type === 'compress'` 没传 mode，默认 `'game'`。

**修复**：enqueue 时携带 mode，processQueue 透传。

### 3.5 `resetForNewGame` 压缩时机问题

`handleReset` 先重置 `p.role = null`，再调用 `reassignToGame` → `resetForNewGame` → `compress`，导致压缩时角色信息丢失。

**修复**：`handleReset` 中调整顺序，先压缩再重置角色（见 6.2 修改 3）。

## 四、压缩时机与流程

### 4.1 进入游戏时

**触发**：`startGame()` 中调用 `enterGame()`

**当前行为**：`loadChatHistory(chatContent)` 替换 Agent 已有上下文

**优化**：通过 chatWatermark 追踪已处理的聊天消息，只追加 delta，然后压缩

**关键时序**：`startGame()` 的调用顺序是：

```
enterGame (role=null) → assignRoles → _updateIdMappings → updateSystemMessage
```

`enterGame` 在 `assignRoles` **之前**调用，此时 `player.role === null`。`updateSystem(player, game, 'game')` 会因 guard（`mode === 'game' && !player.role`）直接 return。游戏模式的 system prompt 是在 `assignRoles` 之后由 `_updateIdMappings` → `updateSystemMessage()` 设置的。

因此 `enterGame` 不应调用 `updateSystem(game)`——它会被跳过，且与后续的 `updateSystemMessage` 职责重复。

```
enterGame(player, game, deltaChatContent):
  1. _drainQueue()
  2. 如果有 deltaChatContent → appendChatDelta(deltaChatContent)
  3. enqueue compress('chat')  // 告诉 LLM 这是赛前信息，心里有个数就行
  4. resetWatermark()

// assignRoles 之后，_updateIdMappings 调用 updateSystemMessage 设置游戏 system prompt
```

使用 `mode='chat'` 的原因：进入游戏时没有游戏消息，delta 全是聊天内容。chat 模式的提示词侧重社交关系和发言风格，这正是赛前信息需要保留的。游戏开始后 LLM 会通过游戏阶段的 system prompt 和消息获取游戏上下文，不需要在赛前摘要里重复。

**chatWatermark 机制**：

Agent 的 `lastChatMessageId` 记录已处理的聊天消息 ID（对应 ServerCore 的 `chatMessageId`，不是 `displayMessageId`）。ServerCore 在 `startGame` 时只传递该 ID 之后的聊天消息作为 delta（见 6.2 修改 1）。

注意：
- 用 `m.id`（chatMessageId）过滤，不用 `m.displayId`。因为 `displayId` 包含游戏消息，而 `chatMessageId` 只对聊天消息递增
- `chatMessageId` 在 `handleReset` 时不重置，聊天消息保留在 `displayMessages` 中，所以 delta 机制跨局安全
- 新 Agent 的 `lastChatMessageId = 0`，delta 就是完整历史，无需特殊处理
- 替换当前 `controller.lastChatMessageId`（在 `_handleChatMentions` 中使用），统一放到 `agent` 上

### 4.2 聊天室阶段的消息流

聊天室阶段 AI 看到的内容有两条路径：

1. **AI 自己的对话**（通过 `appendTurn`）：进入 `mm.messages`，会被压缩保留
2. **其他人的聊天**（通过 `_handleChatMentions` 的 `recentChat`）：只在当前 turn 的 task prompt 里出现，**不进入 `mm.messages`**

这意味着聊天室阶段 `mm.messages` 的增长主要来自 AI 自己的发言和思考。其他人的聊天内容只在当前 turn 可见，不持久化。这是合理的设计——不需要把所有聊天内容都持久化，token 阈值压缩处理 AI 自己对话的增长即可。

### 4.3 其他压缩时机

| 时机 | 触发方式 | mode | 说明 |
|------|----------|------|------|
| 游戏进行中 | day vote 后 enqueue + answer() token 阈值 | `game` | 已有逻辑 + 新增阈值检查 |
| 游戏结束 | exitGame → AI复盘 → appendGameInfo → enqueue compress | `game` | LLM 面对游戏结束内容会自然侧重结果 |
| 聊天室进行中 | answer() token 阈值 | `chat` | 新增 |
| 重开新局 | handleReset → resetForNewGame → enqueue compress | `game` | 先压缩再重置角色 |

### 4.4 完整生命周期

```
Agent 创建:
  messages = []

聊天室阶段:
  messages = [system_chat, 聊天消息...]
  token 超阈值 → compress('chat')
  messages = [system_chat, 聊天摘要, 新消息...]

进入游戏 enterGame():
  appendChatDelta(delta) → compress('chat')
  messages = [system_chat, 合并摘要]                  // 保留已有上下文，追加增量后压缩
  + resetWatermark → 后续游戏消息增量追加

assignRoles → _updateIdMappings → updateSystemMessage:
  messages = [system_game, 合并摘要]                  // 此时 role 已有值，system prompt 更新为游戏模式

游戏进行中:
  messages = [system_game, 合并摘要, 游戏消息...]
  day vote 后 → enqueue compress('game')
  token 超阈值 → enqueue compress('game')
  messages = [system_game, 合并摘要]              // 聊天室+游戏信息合并

游戏结束 exitGame():
  messages = [system_chat, 合并摘要, 游戏消息...] // 只改 system，消息不动

AI 发复盘消息:
  messages = [system_chat, 合并摘要, 游戏消息, 复盘消息...]

appendGameInfo:
  messages = [system_chat, 合并摘要, 游戏消息, 复盘消息, 游戏结果信息]

postGameCompress('game'):
  messages = [system_chat, 最终摘要]              // 全部内容合并为一条

回到聊天室:
  messages = [system_chat, 最终摘要, 新聊天消息...] // 上下文连续

聊天室多轮对话（含 @提及）:
  token 超阈值 → enqueue compress('chat')
  messages = [system_chat, 合并摘要, 新消息...]

重开新局 (handleReset → resetForNewGame):
  enqueue compress('game') → 重置角色 → updateSystem(game) 被跳过(role=null) → resetWatermark
  messages = [system_chat, 压缩摘要]              // system 仍为 chat，直到 assignRoles 后才更新
```

**流程对比**：

| 时机 | 优化前 | 优化后 |
|------|--------|--------|
| enterGame | loadChatHistory 替换完整聊天历史 | appendChatDelta(delta) → enqueue compress('chat')，保留已有上下文 |
| 游戏进行中 | day vote 后压缩（仅 game 模式） | 同前 + answer() 中 token 阈值检查 |
| 游戏结束 | compress('chat') → appendGameInfo + resetWatermark | appendGameInfo → enqueue compress('game')，无 resetWatermark |
| 聊天室进行中 | 无压缩 | answer() 中 token 阈值触发 enqueue compress('chat') |
| 重开新局 | compress() 默认 game 模式 + resetWatermark | enqueue compress('game')，先压缩再重置角色；system 仍为 chat 直到 assignRoles |

## 五、压缩函数设计

### 5.1 统一 compress 函数

一个函数，所有场景通用。mode 只影响提示词模板，短内容跳过 LLM 直接用原文：

```js
class MessageManager {
  async compress(llmModel, mode = 'game') {
    if (!this.compressionEnabled) return;
    try {
      const newContent = this._compactHistoryAfterSummary();
      if (!newContent) return;

      const player = this._lastContext?.self;
      if (!player) return;

      const prevSummary = this._findPrevSummary();

      let text;
      if (newContent.length < COMPACT_THRESHOLD) {
        text = prevSummary ? `${prevSummary}\n\n${newContent}` : newContent;
      } else if (llmModel && llmModel.isAvailable()) {
        const prompt = this._buildCompressPrompt(mode, newContent, player, prevSummary);
        const result = await llmModel.call([{ role: 'user', content: prompt }], { enableThinking: false });
        text = result.choices?.[0]?.message?.content;
      } else {
        text = '[[' + this._buildCompressPrompt(mode, newContent, player, prevSummary) + ']]';
      }

      if (text) {
        this.messages = [
          this.messages[0],
          { role: 'user', content: `【之前压缩摘要】\n${text}` }
        ];
      }
    } catch (err) {
      getLogger().error(`[MessageManager] 压缩历史失败：${err.message}`);
    }
  }
}
```

三条路径产出格式完全一致：`【之前压缩摘要】\n{text}`。

### 5.2 提示词模板

两个 mode：`game`、`chat`。`game_over` 合并进 `game`——压缩时的提示词模板只引导 LLM 关注什么，LLM 面对游戏结束内容时会自然侧重结果和转折，不需要单独的模板。`chat_enter` 也合并进 `chat`——压缩的都是聊天内容，摘要会一直留在流里供后续所有场景使用。

```js
_buildCompressPrompt(mode, newContent, player, prevSummary) {
  const identity = this._buildIdentity(player, mode);
  const prev = prevSummary ? `上次压缩摘要:\n${prevSummary}\n\n` : '';

  const templates = {
    game: `请将以下游戏进展压缩为300字以内的摘要，保留：
1. 存活人数和阵营分布
2. 已暴露的关键信息（身份、查验、守护等）
3. 可疑玩家和推理线索
4. 局势走向`,

    chat: `请将以下聊天记录压缩为300字以内的摘要，保留：
1. 各玩家的发言风格和特点
2. 玩家之间的互动关系和态度
3. 讨论的关键话题和观点
4. 任何未解决的分歧或争议`
  };

  return `${identity}

${prev}${templates[mode] || templates.game}

待压缩内容：
${newContent}`;
}

_buildIdentity(player, mode) {
  if (mode === 'game') {
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
        wolfTeammates = ` 队友:${positions}`;
      }
    }

    return `你的身份: ${player.name || '未知'} ${position}号位 角色:${roleName}${wolfTeammates}`;
  }
  return `你的身份: ${player.name || '未知'}`;
}
```

### 5.3 聊天内容追加

`appendChatDelta`：追加增量到消息队列尾部，不替换已有内容。

```js
appendChatDelta(deltaContent) {
  if (!deltaContent) return;
  this.messages.push({ role: 'user', content: deltaContent });
}
```

不使用特殊前缀。`_compactHistoryAfterSummary` 收集时无需区分来源——游戏结束后 `postGameCompress` 会将所有游戏内容打包压缩，之后 `mm.messages` 中不会再有游戏+聊天混合的未压缩内容。聊天阶段的压缩输入只有聊天内容，不存在混合问题。

### 5.4 `_lastContext` 依赖与保护

| 场景 | `_lastContext` 状态 | 是否安全 |
|------|---------------------|----------|
| 游戏中 day vote 后压缩 | 由 `answer()` 设置 | 安全 |
| `postGameCompress` | 由最后一次 `answer()` 设置 | 安全 |
| `enterGame` 后压缩 | 入队前通过 `setCompressContext` 显式设置 | 安全 |
| `answer()` 阈值触发压缩 | 由当前 `answer()` 设置 | 安全 |
| `resetForNewGame` 压缩 | `_lastContext` 引用的玩家对象 role 已被重置为 null | **不安全** → 见 6.2 修改 3 |

### 5.5 `_currentMode` 追踪

`_currentMode` 用于 `answer()` 中决定压缩模式（`chat` 或 `game`）。放在 Agent 上，由实际成功更新 system prompt 的操作设置：

- `exitGame`：`updateSystem(chat)` 必定成功 → 设 `_currentMode = 'chat'`
- `resetForNewGame`：`updateSystem(game)` 因 `player.role=null` 被跳过 → **不设**，保持当前值
- `_updateIdMappings → updateSystemMessage`：`updateSystem(game)` 成功 → 设 `_currentMode = 'game'`

这样 `resetForNewGame` 后 `_currentMode` 保持 `'chat'`，正确反映实际状态（system prompt 仍是 chat）。

### 5.6 水位线系统

两套水位线系统互相独立，分别追踪游戏消息和聊天消息的增量。

| 水位线 | 位置 | ID 来源 | 重置时机 |
|--------|------|---------|----------|
| `lastProcessedId` | `MessageManager` | `game.message._nextId`（从 1 递增） | `resetWatermark()` → 0 |
| `lastChatMessageId` | `Agent` | `ServerCore.chatMessageId`（从 0 递增） | 不重置，只前进 |

**跨局安全性**：

- `game.message._nextId` 在 `handleReset` 中不重置（只清 `messages = []`），第二局消息 ID 从上一局末尾继续。`resetWatermark()` 将 `lastProcessedId` 归零，`id > 0` 正确捕获所有新消息。
- `chatMessageId` 在 `handleReset` 中不重置，聊天消息保留在 `displayMessages` 中。`lastChatMessageId` 只前进不后退，delta 机制跨局安全。
- 新 Agent 的 `lastChatMessageId = 0`，delta 等于完整聊天历史，无需特殊处理。

**场景切换时的水位线状态**：

| 时机 | lastProcessedId | lastChatMessageId | 说明 |
|------|-----------------|-------------------|------|
| Agent 创建 | 0 | 0 | — |
| 聊天室阶段 | 0（无游戏消息） | 随 @提及更新 | — |
| enterGame 后 | 0（resetWatermark） | = chatMessageId | delta 已消费 |
| 游戏进行中 | 随 appendTurn 前进 | 不变（游戏中无聊天） | — |
| exitGame 后 | 保持游戏末尾值 | 不变 | — |
| postGameCompress 后 | 不变 | 不变 | 压缩不影响水位线 |
| resetForNewGame 后 | 0（resetWatermark） | = chatMessageId | 由 handleReset 设置 |
| 等待阶段 | 0 | 随 @提及更新 | — |
| 再次 enterGame 后 | 0（resetWatermark） | = chatMessageId | delta 已消费 |

## 六、API 变更

### 6.1 Agent

所有压缩统一走 `enqueue`，不直接调 `mm.compress()`。

```js
class Agent {
  constructor(options = {}) {
    // ... 原有逻辑
    this.lastChatMessageId = 0;
    this._currentMode = 'chat';
  }

  async enterGame(player, game, deltaChatContent) {
    this._drainQueue();
    if (deltaChatContent) {
      this.mm.appendChatDelta(deltaChatContent);
    }
    this.mm.setCompressContext({ self: player, players: game.players || [] });
    await new Promise(resolve => {
      this.enqueue({ type: 'compress', mode: 'chat', callback: resolve });
    });
    this.mm.resetWatermark();
  }

  exitGame(player) {
    this._drainQueue();
    this.mm.updateSystem(player, null, 'chat');
    this._currentMode = 'chat';
  }

  async postGameCompress() {
    await new Promise(resolve => {
      this.enqueue({ type: 'compress', mode: 'game', callback: resolve });
    });
  }

  async resetForNewGame(player, game) {
    this._drainQueue();
    await new Promise(resolve => {
      this.enqueue({ type: 'compress', mode: 'game', callback: resolve });
    });
    this.mm.updateSystem(player, game, 'game');
    // updateSystem 因 role=null 被跳过，不设 _currentMode，保持 'chat'
    if (player.role) this._currentMode = 'game';
    this.mm.resetWatermark();
  }

  async answer(context) {
    if (this.shouldCompress()) {
      const mode = this._currentMode === 'chat' ? 'chat' : 'game';
      await new Promise(resolve => {
        this.enqueue({ type: 'compress', mode, callback: resolve });
      });
    }
    this.mm.setCompressContext(context);
    // ... 原有逻辑
  }

  shouldCompress() {
    const tokenCount = estimateTokens(this.mm.messages);
    return tokenCount > TOKEN_THRESHOLD;
  }
}
```

`_updateIdMappings → updateSystemMessage` 设置游戏 system prompt 时，需同步设 `_currentMode = 'game'`：

```js
// AIController.updateSystemMessage()
updateSystemMessage() {
  this.agent.updateSystemMessage(this.getPlayer(), this.game);
  this.agent._currentMode = 'game';
}
```

### 6.2 ServerCore

**修改 1**：`startGame` 中按 Agent 的 chatWatermark 传递 delta：

```js
for (const controller of this.aiManager.controllers.values()) {
  const lastId = controller.agent.lastChatMessageId || 0;
  const deltaMessages = this.displayMessages.filter(m => m.source === 'chat' && m.id > lastId);
  const delta = deltaMessages.length > 0
    ? this._formatChatMessagesForAI(deltaMessages)
    : null;
  await controller.agent.enterGame(player, this.game, delta);
  controller.agent.lastChatMessageId = this.chatMessageId;
}
```

**修改 2**：`_executeAIChat` 中调整顺序，appendGameInfo 先于 postGameCompress：

```js
if (chatContext.event === 'game_over') {
  const gameInfo = this._buildGameInfoMessage();
  if (gameInfo) {
    controller.agent.mm.appendGameInfo(gameInfo);
  }
  await controller.agent.postGameCompress();
}
```

**修改 3**：`handleReset` 中先压缩再重置角色：

```js
// 先压缩（此时 role 仍在，压缩信息完整）
if (this.aiManager) {
  for (const controller of this.aiManager.controllers.values()) {
    controller.game = this.game;
    await controller.agent.resetForNewGame(controller.getPlayer(), this.game);
  }
}
// 再重置角色
aiPlayers.forEach(p => { p.role = null; ... });
// 更新 chatWatermark
if (this.aiManager) {
  for (const controller of this.aiManager.controllers.values()) {
    controller.agent.lastChatMessageId = this.chatMessageId;
  }
}
```

**修改 4**：`_handleChatMentions` 中把 `controller.lastChatMessageId` 统一改为 `controller.agent.lastChatMessageId`，同时删除不存在的 `lastCompressedChatId` 引用：

```js
// 修改前
const lastCompressedId = controller.agent.mm.lastCompressedChatId || controller.lastChatMessageId || 0;
controller.lastChatMessageId = chatMsg.id;

// 修改后
const lastId = controller.agent.lastChatMessageId || 0;
controller.agent.lastChatMessageId = chatMsg.id;
```

**修改 5**：`_executeAIChat` 中 AI 发送消息后更新 `lastChatMessageId`，避免下次 delta 重复包含自己的消息：

```js
// 在 chatMsg 被添加到 displayMessages 之后
controller.agent.lastChatMessageId = this.chatMessageId;
```

### 6.3 MessageManager 变更汇总

| 方法 | 变更 |
|------|------|
| `compress(llmModel, mode)` | mode 简化为 `game`、`chat` 两个；短内容跳过 LLM；fallback 保留 `[[prompt]]` |
| `appendChatDelta(deltaContent)` | 新增，追加增量到消息队列尾部，不用前缀 |
| `loadChatHistory` | **删除**，被 `appendChatDelta` + `compress` 替代 |
| `appendChatSummary` | **删除**，被统一 `compress()` 替代 |
| `replaceWithSummary` | **删除**，被统一 `compress()` 替代 |
| `_buildCompressPrompt(mode, ...)` | 统一入口，按 mode 选择模板 |
| `_buildIdentity(player, mode)` | 新增，按场景决定身份信息详细程度 |
| `_buildCompressPrompt()` / `_buildChatCompressPrompt()` | 合并为 `_buildCompressPrompt(mode, ...)`，删除旧方法 |

### 6.4 队列压缩支持 mode 和 callback

```js
const { type, mode, context, callback } = this.requestQueue.shift();
if (type === 'compress') {
  await this.mm.compress(this.llmModel, mode);
  callback?.();
} else {
  const result = await this.answer(context);
  callback?.(result);
}
```

## 七、Token 估算与阈值

```js
const TOKEN_THRESHOLD = 4000;
const COMPACT_THRESHOLD = 800;
```