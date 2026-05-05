# Agent 生命周期设计：对齐玩家会话

## 核心原则

Agent 的生命周期对齐「玩家会话」，而非「一局游戏」。模式切换是 Agent 上的显式操作，不是销毁重建。

## 生命周期

```
add_ai → 创建 Agent（chat 模式）
  ↓ enterGame()
游戏开始 → 切换到 game 模式
  ↓ exitGame()
游戏结束 → 切回 chat 模式
  ↓ enterGame() 或 resetForNewGame()
新游戏 → 进入新 game 模式
  ↓
remove_ai → 销毁 Agent
```

## 新增 API

### Agent

```js
enterGame(player, game) {
  // 1. 压缩当前聊天历史为摘要
  // 2. 切换 system prompt 为 game 模式
  // 3. 注入聊天摘要作为背景
  // 4. lastProcessedId = 0
  // 5. _lastContext = null
}

exitGame(player) {
  // 1. 压缩游戏历史为摘要
  // 2. 切换 system prompt 为 chat 模式
  // 3. 游戏摘要追加到消息历史
  // 4. lastProcessedId = 0
  // 5. _lastContext = null
}

resetForNewGame(player, game) {
  // 等价于 exitGame + enterGame 的组合
  // 1. 压缩当前游戏历史为摘要
  // 2. 切换 system prompt 为新 game 模式
  // 3. 上一局摘要可选注入
  // 4. lastProcessedId = 0
  // 5. _lastContext = null
}
```

### AIController

```js
reassignToGame(newGame, newPlayerId) {
  // 更新 this.game 引用
  // 更新 this.playerId（PlayerController 基类）
  // 调用 this.agent.resetForNewGame(this.getPlayer(), newGame)
}
```

### AIManager

```js
reassignToGame(newGame) {
  // 更新 this.game 引用
  // 遍历所有 controller，调用 controller.reassignToGame
}
```

## ServerCore 侧改动

### handleReset (wasPlaying=true)

之前：
```js
this.aiManager.controllers = new Map();
aiPlayers.forEach(p => {
  this.createAI(this.aiManager, p.id, {});
});
```

之后：
```js
this.aiManager.reassignToGame(this.game);
// _updateIdMappings 处理 playerId 变更
```

### startGame

之前：
```js
if (this.aiManager && this.chatMessages.length > 0) {
  const chatContent = this._formatChatMessagesForAI(this.chatMessages);
  for (const controller of this.aiManager.controllers.values()) {
    controller.agent.mm.loadChatHistory(chatContent);
  }
}
```

之后：不再需要。enterGame 已处理聊天摘要注入。

### handleRemoveAI / handleChangePreset

需要新增 Agent 的 detach 逻辑，清理内部状态后释放。

---

## playerId 冗余问题

### 现状

playerId 散落在 5 个位置，各自在 constructor 中拷贝存储：

| 位置 | 用途 |
|------|------|
| AIController.playerId | 从 PlayerController 继承，`getPlayer()`/`getState()` 等全部依赖 |
| Agent.playerId | 仅日志输出 |
| Agent.mm.playerId | `formatIncomingMessages` 中 `players.find(p => p.id === this.playerId)` 找自己 |
| Agent.randomModel.playerId | 过滤自己（`p.id !== this.playerId`），选目标时排除 |
| Agent.mockModel.playerId | 报错信息 |

### 问题

每个对象各自存了一份 playerId，没有从上往下引用。当 playerId 变更时（assignRoles shuffle + reindex），需要同步更新所有 5 处，当前 `_updateIdMappings` 只更新了 AIController 和 Agent，漏了 mm 和 models。

### 解决方案：消除冗余存储

playerId 只应在 AIController 上存储一份，下游对象通过 context 获取：

1. **Agent.playerId** → 改为通过 `context.self.id` 获取，日志中用名称替代 playerId
2. **Agent.mm.playerId** → `formatIncomingMessages` 已有 `context.players`，用 `context.players.find(p => p.id === currentPlayerId)` 替代，playerId 从 Agent 传入
3. **Agent.randomModel.playerId** → 从 `context.self.id` 或 `context.alivePlayers` 过滤，不再构造时存 playerId
4. **Agent.mockModel.playerId** → 同上

这样 playerId 变更只需更新 AIController.playerId 一处，无需传播。

---

## 消息 ID 体系与 lastProcessedId 语义

### 两套独立的 ID 体系

| 体系 | 存储位置 | 生成方式 | 生命周期 |
|------|----------|----------|----------|
| 游戏消息 ID | `game.message._nextId` | `this._nextId++` | 随 GameEngine / 重置时 messages 清空但 _nextId 不重置 |
| 聊天消息 ID | `ServerCore.chatMessageId` | `++this.chatMessageId` | 随 ServerCore，从不重置 |

两套 ID 互不干扰，Agent 内部的 `lastProcessedId` 只与游戏消息 ID 交互。

### lastProcessedId 语义

`lastProcessedId` 是 **game.message 中的消息 ID 水位线**，含义是"ID 大于此值的游戏消息是新的"，用于增量喂入 Agent。

- 不是"第几条消息"，而是基于 `game.message._nextId` 自增计数器的绝对值
- 只在游戏模式下使用（聊天模式通过 chatContext 一次性传入，不走增量过滤）
- `appendTurn` 时更新：`lastProcessedId = newMessages 中最后一条的 id`

### lastChatMessageId 语义

`lastChatMessageId` 是 **chatMessages 中的消息 ID 水位线**，含义是"此 AI 上次参与聊天时的消息 ID"，用于 `@提及` 时截取最近的聊天上下文。

- 只在聊天模式下使用（`_handleChatMentions` 中设置）
- 引用的是 `ServerCore.chatMessageId` 体系，该 ID 在整个 ServerCore 生命周期内连续递增、从不重置
- 因此跨多场游戏始终有效

### 多场游戏模拟

```
聊天室1：chatMessageId=1,2,3  game.message 无消息
  ↓ enterGame()
游戏1：game.message._nextId=1→5，lastProcessedId=0→5
       chatMessageId 不变（游戏中禁止聊天）
  ↓ exitGame()
聊天室2：chatMessageId=4,5,6  lastProcessedId=5（不再使用，直到下次 enterGame）
  ↓ enterGame()
游戏2：
  - 情况 A（复用 GameEngine）：game.message.messages 清空，但 _nextId 继续从 6 开始
    → lastProcessedId 重置为 0，6>0，增量过滤正常
  - 情况 B（新 GameEngine）：_nextId 从 1 开始
    → lastProcessedId 重置为 0，1>0，增量过滤正常
  ↓ exitGame()
聊天室3：chatMessageId=7,8,9  lastChatMessageId 仍指向聊天室2的最后一条
```

**结论**：只要 `enterGame` / `resetForNewGame` 显式重置 `lastProcessedId = 0`，无论 GameEngine 是否复用，增量过滤都能正确工作。

### 当前代码的隐患

当前 `handleReset` 重建 Agent，`lastProcessedId` 初始为 0，碰巧正确。但这是隐式依赖：
- 依赖重建 Agent → lastProcessedId = 0
- 依赖复用 GameEngine → _nextId 不重置 → 新消息 ID > 0

如果改为新 GameEngine（_nextId 从 1 开始）+ 保留 Agent（lastProcessedId 未重置），则所有新消息被过滤掉。**必须显式重置**。

---

## 需要额外考虑的问题

### 1. AIController.game 引用失效（HIGH）

**现状**：PlayerController 构造时存储 `this.game`，所有方法（getPlayer、getState、getVisibleMessages、技能执行）都依赖它。

**解决**：`reassignToGame(newGame)` 更新 `this.game`。wasPlaying=true 路径复用同一 GameEngine，只需重置 Agent 内部状态；wasPlaying=false 路径创建新 GameEngine，需要更新引用。

### 2. EventEmitter 无 off() 方法（MEDIUM）

**现状**：`engine/event.js` 只有 `on` 和 `emit`，没有 `off`/`removeListener`。

**影响**：当前不阻塞（wasPlaying=true 复用同一 GameEngine，wasPlaying=false 旧 GameEngine 随 GC 消失）。但未来创建新 GameEngine 时需要清理旧监听器。

**解决**：给 EventEmitter 加 `off(event, handler)` 方法。

### 3. Agent 请求队列中有未完成任务（MEDIUM）

**现状**：`requestQueue` 和 `isProcessing` 在游戏结束时可能有未完成的请求。

**影响**：`isProcessing = true` 时新请求不会被处理；未完成的 Promise 永远不会 resolve。

**解决**：在 `resetForNewGame` / `exitGame` 中清空 `requestQueue`，设置 `isProcessing = false`。

### 4. 重置时 agentType/mockOptions 丢失（MEDIUM → 已解决）

**现状**：`handleReset` 调用 `this.createAI(this.aiManager, p.id, {})`，传入空 options。

**解决**：保持 Agent 不变就不存在此问题。

### 5. MessageManager._lastContext 过时（LOW）

**解决**：在 `resetForNewGame` / `exitGame` 中清空 `_lastContext = null`。

### 6. handleRemoveAI / handleChangePreset 缺少 Agent 清理（MEDIUM）

**解决**：新增 `Agent.destroy()` 方法，清空队列、取消处理。在 removeAI/presetChange 时调用。

---

## 实施优先级

| 优先级 | 任务 | 原因 |
|--------|------|------|
| P0 | Agent.resetForNewGame / enterGame / exitGame | 核心生命周期方法 |
| P0 | 消除 playerId 冗余存储 | 从根源解决 playerId 同步问题 |
| P0 | AIController.reassignToGame | game 引用更新 |
| P0 | handleReset 改用 reassignToGame | 核心改动点 |
| P1 | Agent 请求队列清理 | 防止 isProcessing 死锁 |
| P1 | startGame 移除 loadChatHistory | enterGame 已处理 |
| P2 | EventEmitter.off() | 当前不阻塞，但应补全 |
| P2 | Agent.destroy() | removeAI/presetChange 场景 |