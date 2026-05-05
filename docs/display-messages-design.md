# DisplayMessages 统一消息流方案

## 问题

游戏消息 (`game.message`) 和聊天消息 (`chatMessages`) 是两个独立流，前端靠时序拼凑顺序。导致：

1. game_over 页面刷新后，聊天消息跑到游戏消息前面
2. game_brief 分割线插入位置不确定（取决于 broadcastState 防抖延迟）
3. 赛前聊天混入结算页
4. 返回房间后游戏消息不清除

根因：前端同时从 `state.messages`（游戏）和 `chat` 事件（聊天）两个源渲染，无法保证顺序。

## 核心思路

服务端维护 `displayMessages[]`，按实际发生顺序存储所有消息（游戏+聊天），作为前端展示的唯一消息源。前端只从 `state.messages` 渲染，顺序由服务器保证。游戏消息销毁时从 displayMessages 中移除。

## 关键约束（代码 review 结论）

1. **游戏进行中禁止聊天**：`handleChat` 第428行 `if (this.game.phaseManager.running) return`，所以游戏进行中不会有聊天消息。displayMessages 中游戏消息和聊天消息天然不交叉。
2. **聊天消息无 visibility**：所有聊天消息对所有人可见，不需要 visibility 过滤。
3. **游戏消息有 visibility**：需要按 `game.message.getVisibleTo()` 规则过滤（PUBLIC/SELF/CAMP/COUPLE 等）。
4. **观战者全量消息**：`_getStateForSpectator` 当前给观战者 `game.message.messages`（无过滤），合并后观战者应看到全部游戏消息+全部聊天消息。
5. **chatMessages 仍需保留**：AI 用 `_formatChatMessagesForAI(this.chatMessages)` 格式化聊天历史注入 agent，以及 `_handleChatMentions` 查询最近聊天。这两个功能依赖 chatMessages 数组，不能简单用 getter 从 displayMessages 派生（因为 displayMessages 含游戏消息，过滤开销且语义不清）。
6. **game_brief 无 playerName**：`_addGameBrief` 创建的消息没有 `playerName` 字段，`_formatChatMessagesForAI` 会输出 `undefined: ...`。这是已有 bug，本次一并修复。

## 数据结构

```js
// ServerCore 新增
this.displayMessages = [];
this.displayMessageId = 0;
this._gameOverDisplayId = 0;  // game_brief 入流时的 displayId，标记 post-game 起点

// 每条消息结构
{
  displayId: ++this.displayMessageId,  // 全局递增，保证顺序
  source: 'game' | 'chat',            // 来源
  // ...原始消息字段
}
```

## 服务端改动

### 1. 消息入流

**游戏消息**：`setupGameListeners` 中 `message:added` 事件 → push `{...msg, source:'game', displayId}`

**聊天消息**：三处创建聊天消息时同步入流：
- `handleChat`（第460行）→ push `{...chatMsg, source:'chat', displayId}`
- `_addGameBrief`（第985行）→ push `{...briefMsg, source:'chat', displayId}`，并补上 `playerName: ''`。同时记录 `this._gameOverDisplayId = displayId`
- `_processAIChatQueue`（第1129行）→ push `{...chatMsg, source:'chat', displayId}`

### 2. state.messages 下发（核心过滤逻辑）

替换 `broadcastState` 和 `_sendInitialState` 中的消息逻辑。根据当前阶段决定 filter：

```js
_getDisplayMessagesForPlayer(playerId) {
  const isRunning = this.game?.phaseManager?.running;
  const hasWinner = !!this.game?.winner;
  const isSpectator = playerId === null;

  return this.displayMessages.filter(msg => {
    // 游戏进行中：只含游戏消息（不显示聊天）
    if (isRunning && msg.source === 'chat') return false;

    // game_over：游戏消息 + post-game 聊天（displayId >= _gameOverDisplayId）
    if (hasWinner && msg.source === 'chat') {
      return msg.displayId >= this._gameOverDisplayId;
    }

    // 游戏消息：按 visibility 过滤（观战者全量）
    if (msg.source === 'game') {
      if (!this.game) return false;  // 无游戏时不显示游戏消息
      if (isSpectator) return true;
      const player = this.game.players.find(p => p.id === playerId);
      return player && this.game.message.canSee(player, msg, this.game);
    }

    // waiting（无游戏或非运行）：所有聊天消息
    return true;
  });
}
```

**调用点**：
- `broadcastState` 玩家：`state.messages = this._getDisplayMessagesForPlayer(info.playerId)`
- `broadcastState` 观战者：`state.messages = this._getDisplayMessagesForPlayer(null)`
- `_sendInitialState`：同上
- `game.getState()` 中的 `state.messages = this.message.getVisibleTo(player, this)` 替换为从外层传入

### 3. 返回房间（handleReset wasPlaying 路径）

```js
this.displayMessages = this.displayMessages.filter(m => m.source !== 'game');
this._gameOverDisplayId = 0;
```

游戏消息从展示流中移除。下次 broadcastState 下发的 state.messages 只含聊天消息。

非 wasPlaying 路径（完全重置）：`this.displayMessages = []; this._gameOverDisplayId = 0;`

### 4. 删除 chat_history 事件

6处 `chat_history` 发送全部删除。`state.messages` 已包含一切。

### 5. 实时聊天反馈

聊天消息入流后，主动触发 broadcastState：
- 在 `_addGameBrief`、`_processAIChatQueue`、`handleChat` 中，消息 push 到 displayMessages 后调用 `this.broadcastState()`
- 利用现有防抖（100ms），不会频繁广播
- 前端通过 updateMessages 增量渲染，顺序由 displayMessages 数组保证

同时保留 `broadcast('chat')` 用于前端 `chatHistory` 存储（AI 上下文等），但前端不再从 chat 事件渲染 DOM。

### 6. chatMessages 保留

`chatMessages` 数组保留，在消息入流时同步 push。供 AI 格式化使用：
- `startGame()` 中 `_formatChatMessagesForAI(this.chatMessages)`
- `_handleChatMentions` 中 `this.chatMessages.filter(...)`

修复 `_addGameBrief` 中 chatMsg 缺少 `playerName` 的 bug。

### 7. 新开一局的处理

`startGame()` 中重置 `_gameOverDisplayId = 0`。新一局的游戏消息入流后，`isRunning` 阶段 filter 只返回游戏消息，pre-game 和 post-game 聊天都被过滤掉。新一局 game_over 时 `_addGameBrief` 重新设置 `_gameOverDisplayId`。

## 前端改动

### 1. updateMessages 统一渲染

按 `source` 字段分流：`source === 'chat'` 走 `renderChatMessage`，`source === 'game'` 走 `displayMessage`。

```js
function updateMessages() {
  const messages = controller.getMessageHistory();
  const state = controller.getState();
  let addedChat = false;
  let addedGame = false;

  messages.forEach(msg => {
    if (document.querySelector(`[data-msg-id="${msg.displayId}"]`)) return;
    if (msg.source === 'chat') {
      renderChatMessage(msg, state);
      addedChat = true;
    } else {
      displayMessage(msg, state);
      addedGame = true;
    }
  });

  if (addedGame) {
    scrollToBottom(elements.messagesSection);
    messagesInitialized = true;
  }
  if (addedChat) {
    scrollToBottomIfNear(elements.messagesSection);
  }
}
```

**注意**：`renderChatMessage` 和 `addChatMessage` 是不同函数，不能合并：
- `renderChatMessage`：聊天室消息（无编号名字、chat-room 样式、@提及高亮、game_brief 分割线、event label）
- `addChatMessage`：游戏发言（带编号名字、wolf-channel/last-words 样式、警长标记）

`renderChatMessage` 保留，仅改 DOM id 为 `displayId`。

`addMessage` / `addPhaseDivider` / `addChatMessage` 中的 `data-msg-id` 改用 `displayId`。
`renderChatMessage` 中的 `data-msg-id` 改用 `displayId`。

### 2. handleChatMessage 只存不渲染

```js
case 'chat':
  if (msg.data) {
    this.chatHistory.push(msg.data);
    // 不再调用 onChatMessage，不渲染 DOM
  }
  break;
```

### 3. 删除 chat_history 处理

controller.js 中 `case 'chat_history'` 删除。app.js 中 `handleChatMessage` 函数删除（不再需要）。

### 4. 删除阶段转换中的聊天渲染

`needWaitingChat` / `needGameOverChat` 全部删除。所有渲染走 `updateMessages`。

阶段转换时需要清 DOM + 清 messageHistory，让 updateMessages 重新渲染：

```js
// 返回房间：清 DOM + 清 messageHistory
if (lastPhase && lastPhase !== 'waiting' && state.phase === 'waiting') {
  elements.messages.innerHTML = '';
  messagesInitialized = false;
  controller.messageHistory = [];  // 清空，让 updateMessages 从 state.messages 重建
}

// 进入游戏：清 DOM + 清 messageHistory
if (lastPhase === 'waiting' && state.phase !== 'waiting' && state.phase !== 'game_over') {
  elements.messages.innerHTML = '';
  messagesInitialized = false;
  controller.messageHistory = [];  // 清空，state.messages 只含游戏消息
}
```

### 5. messageHistory 去重改为 displayId

controller.js 中 `messageHistory` 去重逻辑改用 `displayId`：
```js
msg.data.messages.forEach(m => {
  if (!this.messageHistory.some(existing => existing.displayId === m.displayId)) {
    this.messageHistory.push(m);
  }
});
```

reset() 时仍清空 `messageHistory`。

### 6. displayMessage 传 displayId

`addMessage`、`addPhaseDivider`、`addChatMessage` 的 id 参数改为 displayId。`displayMessage` 函数内部从 `msg.displayId` 取值传递。

## 场景验证

| 场景 | displayMessages 内容 | filter 结果 | 前端显示 |
|------|---------------------|-------------|---------|
| 赛前聊天 | [chat1, chat2] | waiting → 全部 chat | 聊天消息 ✓ |
| 游戏进行中 | [chat1, chat2, game1, game2...] | running → 只含 game | 游戏消息，无聊天 ✓ |
| game_over | [chat1, chat2, game1..., brief, AIchat] | winner → game + displayId≥brief 的 chat | 游戏消息+brief+赛后聊天 ✓ |
| 刷新 game_over | 同上 | 同上，一次渲染顺序正确 | 同上 ✓ |
| 返回房间 | 过滤游戏 → [chat1, chat2, brief, AIchat] | 非running非winner → 全部 chat | 所有聊天+brief ✓ |
| 刷新 waiting | 同上 | 同上 | 同上 ✓ |
| 再开一局 | [chat1, chat2, brief, AIchat, game1...] | running → 只含 game | 新游戏消息，无旧聊天 ✓ |
| 第二局 game_over | [..., brief2, AIchat2] | winner → game + displayId≥brief2 的 chat | 第二局游戏+brief2+赛后 ✓ |
| 游戏中人类发聊天 | handleChat 返回（running=true），不入流 | 无 | ✓ |
| game_over 后人类发聊天 | chat 入 displayMessages，broadcastState | updateMessages 增量渲染 | ✓ |
| 观战者 game_over | 全量 displayMessages | game+全部 chat（不过滤 visibility） | ✓ |

## 可删除/简化的现有代码

### 整体删除

| 文件 | 代码 | 原因 |
|------|------|------|
| app.js L988-1008 | `handleChatMessage` 函数 | 聊天消息从 state.messages 渲染，不需要独立 handler |
| app.js L249 | `controller.onChatMessage = handleChatMessage` | 上述函数删除 |
| app.js L1331-1342 | `needWaitingChat` / `needGameOverChat` 声明和赋值 | 不再需要手动渲染聊天 |
| app.js L1363-1375 | 两个 if 块渲染 chatHistory | 不再需要 |
| controller.js L15 | `this.chatHistory = []` | 聊天消息在 state.messages 中，前端不再单独存储 |
| controller.js L27 | `this.onChatMessage = null` | 不再需要 |
| controller.js L174-180 | `case 'chat':` handler | 不再需要 |
| controller.js L183-189 | `case 'chat_history':` handler | 不再需要 |
| controller.js L368 | chatHistory 注释 | 字段已删 |
| controller_patch.js | 整个文件 | 运行时补丁，已不需要 |
| server-core.js L42 | `this.chatMessages = []` | 合并到 displayMessages |
| server-core.js L43 | `this.chatMessageId = 0` | 合并到 displayMessageId |
| server-core.js L248-249 | `chat_history` 发送（重连玩家） | state.messages 已包含 |
| server-core.js L264-265 | `chat_history` 发送（重连观战者） | state.messages 已包含 |
| server-core.js L282-283 | `chat_history` 发送（新观战者） | state.messages 已包含 |
| server-core.js L300-301 | `chat_history` 发送（房间满观战者） | state.messages 已包含 |
| server-core.js L333-334 | `chat_history` 发送（新玩家加入） | state.messages 已包含 |
| server-core.js L944-945 | `chat_history` 发送（_sendInitialState） | state.messages 已包含 |
| server-core.js L461 | `broadcast('chat', chatMsg)`（玩家聊天） | 聊天消息通过 broadcastState 下发 |
| server-core.js L986 | `broadcast('chat', briefMsg)`（game_brief） | 同上 |
| server-core.js L1130 | `broadcast('chat', chatMsg)`（AI 聊天） | 同上 |

### 简化

| 文件 | 代码 | 改动 |
|------|------|------|
| server-core.js L460 | `chatMessages.push(chatMsg)`（玩家聊天） | 改为 `displayMessages.push({...chatMsg, source:'chat', displayId})` + `broadcastState()` |
| server-core.js L985 | `chatMessages.push(briefMsg)`（game_brief） | 改为 `displayMessages.push({...briefMsg, source:'chat', displayId, playerName:''})` + 记录 `_gameOverDisplayId` |
| server-core.js L1129 | `chatMessages.push(chatMsg)`（AI 聊天） | 改为 `displayMessages.push({...chatMsg, source:'chat', displayId})` + `broadcastState()` |
| server-core.js L844 | `_formatChatMessagesForAI(this.chatMessages)` | 改为 `this.displayMessages.filter(m => m.source === 'chat')` |
| server-core.js L1072 | `this.chatMessages.filter(...)` | 改为 `this.displayMessages.filter(m => m.source === 'chat' && ...)` |
| server-core.js L936-958 | `_sendInitialState` | 删除 chat_history 分支；无游戏时也用 displayMessages 构建 state.messages |
| server-core.js L882-921 | `broadcastState` | 在 `this.send(ws, 'state', state)` 前覆盖 `state.messages = this._getDisplayMessagesForPlayer(...)` |
| server-core.js L801-822 | `_getStateForSpectator` | 覆盖 `state.messages = this._getDisplayMessagesForPlayer(null)` |
| engine/main.js L689 | `messages: []` | 保留默认值，ServerCore 在 broadcastState 中覆盖 |
| engine/main.js L746 | `state.messages = this.message.getVisibleTo(...)` | 保留，供 AI/测试使用；ServerCore 在 broadcastState 中覆盖 |
| app.js L1585-1604 | `updateMessages` | 按 source 分流：chat→renderChatMessage, game→displayMessage；聊天消息用 scrollToBottomIfNear |
| app.js L1698 | `addMessage` | id 参数改用 displayId |
| app.js L1717 | `addChatMessage` | id 参数改用 displayId |
| app.js L1750 | `addPhaseDivider` | id 参数改用 displayId |
| app.js L1011-1054 | `renderChatMessage` | DOM id 改用 displayId（`chat-${msg.displayId}`），逻辑保留 |
| controller.js L114-127 | `messageHistory` 去重逻辑 | 改用 displayId 去重 |
| controller.js L364-369 | `reset()` | 删除 chatHistory 注释，保留 messageHistory 清空 |

### 保留（重要，不可删除/合并）

| 代码 | 原因 |
|------|------|
| `renderChatMessage` | 聊天室消息渲染（无编号名字、chat-room 样式、@提及高亮、game_brief 分割线、event label），与 `addChatMessage`（游戏发言、带编号名字、wolf-channel 样式、警长标记）是不同函数，不能合并 |
| `addChatMessage` | 游戏发言渲染，仍被 `displayMessage` 调用 |
| `addMessage` | 系统消息渲染 |
| `game.message.canSee()` | visibility 过滤仍需要，在 `_getDisplayMessagesForPlayer` 中调用 |
| `engine/main.js` L689/746 | `state.messages` 赋值 | 保留，供 AIController/PlayerController/测试使用；ServerCore 在 broadcastState 中覆盖为 displayMessages |
| `broadcast('chat')` | **删除** | 聊天消息通过 broadcastState 下发，不再需要单独的 chat 事件 |

### 额外注意

1. **broadcastState 性能**：聊天消息入流后直接调 `broadcastState()` 发送完整 state。聊天频率低（人类几秒一条，AI 0-2s 延迟），不会造成性能问题。但如果未来需要优化，可以加防抖或保留 `broadcast('chat')` 仅做轻量通知。
2. **engine/main.js getState()**：`state.messages` 保留原有逻辑（L689 默认空数组 + L746 visibility 过滤），ServerCore 在 `broadcastState` 中覆盖 `state.messages`。这样 AI 和测试代码不受影响。
3. **_handleChatMentions 的 id 引用**：`lastCompressedChatId` 和 `lastChatMessageId` 原来基于 `chatMessageId`，统一后改为 `displayMessageId`。

## 实现步骤

1. 服务端：新增 `displayMessages` + `displayMessageId` + `_gameOverDisplayId`，消息入流
2. 服务端：新增 `_getDisplayMessagesForPlayer()`，实现阶段感知的过滤逻辑
3. 服务端：`broadcastState` / `_sendInitialState` 改用 `_getDisplayMessagesForPlayer()`
4. 服务端：`engine/main.js` 删除 `state.messages` 赋值，由 ServerCore 注入
5. 服务端：`handleReset` 过滤游戏消息 + 重置 `_gameOverDisplayId`
6. 服务端：`startGame` 重置 `_gameOverDisplayId`
7. 服务端：删除 `chat_history` 事件和 `broadcast('chat')`
8. 服务端：聊天消息入流后触发 broadcastState
9. 服务端：修复 `_addGameBrief` 缺少 `playerName` 的 bug
10. 前端：`updateMessages` 按 source 分流（chat→renderChatMessage, game→displayMessage），聊天用 scrollToBottomIfNear
11. 前端：DOM id 统一改用 displayId（renderChatMessage、addMessage、addPhaseDivider、addChatMessage）
12. 前端：删除 `handleChatMessage`、`onChatMessage`、`chatHistory`、`chat`/`chat_history` handler
13. 前端：删除阶段转换聊天渲染（needWaitingChat/needGameOverChat），改为清 messageHistory
14. 前端：删除 `controller_patch.js`
15. 测试验证