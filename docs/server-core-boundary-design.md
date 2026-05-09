# ServerCore 边界治理：职责收拢设计

## 问题

ServerCore 大量越过 Engine / AIManager 的 API 边界，直接操作内部字段和结构。导致：
- Engine 内部字段改名/重构必须同步改 ServerCore
- Engine 无法保证自身状态一致性（外部随时直接改字段）
- 测试困难——想测 reset 逻辑得通过 ServerCore 而不是直接测 Engine
- 测试代码也跟着越界——game-harness、server-harness、多个测试文件都重复 `game.aiManager = ...` + `game.getAIController = ...` 的猴子补丁

## 原则

- ServerCore 只调 Engine 和 AIManager 的公开 API，不直接操作内部字段
- Engine 的内部状态由 Engine 自己重置/修改
- AIManager 的内部结构由 AIManager 自己管理
- Engine 不应该知道 AI 的存在——`game.aiManager` 和 `game.getAIController` 是反模式

## 越界清单（按严重度排序）

### P0: Engine 不该知道 AI 的存在

`game.aiManager` 和 `game.getAIController` 是 ServerCore 猴子补丁打到 Engine 上的。Engine 的 `getPlayerController` 方法（main.js:254-270）通过 `this.getAIController?.(playerId)` 查找 AI 控制器——Engine 不该依赖外部注入的函数来获取 AI 控制器。

**影响范围**：测试代码也跟着越界——game-harness、server-harness、5+ 测试文件都重复 `game.aiManager = ...` + `game.getAIController = ...`。

**涉及代码**：
- server-core.js:236,241,342,347 — 猴子补丁注入
- server-core.js:1076-1077 — `this.game.aiManager.onMessage(msg)` 在 setupGameListeners 里
- engine/main.js:70 — `this.getAIController = null` 字段声明
- engine/main.js:258-263 — `this.getAIController?.(playerId)` 使用
- test/helpers/game-harness.js:99-105 — 测试也做同样的猴子补丁
- test/helpers/server-harness.js:135-137 — 同上
- 5+ 测试文件 — 同上

### P1: handleReset 直接操作 Engine 内部状态

ServerCore 一口气重置 Engine 的 15+ 个内部字段（540-560行），直接操作 player 对象的 alive/role/state/deathReason/revealed（521-538行），还漏了 `banishedPlayer`（现有 bug）。

### P2: game.players 直接变异

5 处直接赋值 `this.game.players = ...filter(...)` 或 `= [...aiPlayers, ...humanPlayers]`：
- handleRemoveAI:395 — 踢 AI
- handleSpectate:725 — 玩家转观战者
- handleChangePreset:639,652 — 溢出踢人
- handleReset:563 — 重排玩家

应该是 `game.removePlayer(playerId)` 等 API。

### P3: _updateIdMappings 直接操作 AIManager 内部

直接遍历 `aiManager.controllers` 按 name 匹配重建映射，直接替换 `this.aiManager.controllers = newControllers`（1157行）。

### P4: handleChangePreset 直接操作 Engine 配置

直接设置 `game.presetId`、`game.preset`、`game.effectiveRules`、`game.playerCount`（623-626行）。

### P5: Player 构造越界

3 处直接构造 player 对象并 push 到 `game.players`（308-318, 358-372, 773-782行），需要知道 player 的完整数据结构。

### P6: MessageManager 内部访问

`this.game.message.messages = []`（570行）直接操作 MessageManager 内部数组，`_nextId` 没归零。

### P7: AIManager controllers 直接访问

6 处直接访问 `aiManager.controllers`（遍历、get、delete、替换），绕过 AIManager 的 API：
- handleRemoveAI:397-399 — get + destroy + delete
- handleChangePreset:641-643 — 同上
- startGame:855-857 — 遍历调 onEnterGame
- _exitGameForAllAI:1026-1036 — 遍历调 onGameOver
- _updateIdMappings:1148-1157 — 遍历 + 替换

### P8: 游戏初始化代码重复

handleJoin（232-243行）和 handleAddAI（338-349行）有完全相同的 8 行初始化代码（创建 GameEngine、创建 AIManager、猴子补丁、注册 listener）。

## 改动清单

### 1. 消除 game.aiManager → ServerCore 直接调自己的 aiManager

**现状**：ServerCore 把 `aiManager` 猴子补丁到 Engine 上（`this.game.aiManager = this.aiManager`），setupGameListeners 里通过 `this.game.aiManager.onMessage(msg)` 转发消息。

**目标**：Engine 不持有 AIManager 引用。ServerCore 直接调自己的 `this.aiManager`。

**不做的事**：不改名 `getAIController`。`getPlayerController` 里的 `if (player.isAI)` 分支是合理的——AI 控制器需要外部创建（依赖 Agent/LLM），人类控制器 Engine 自己就能创建。改名为 `controllerProvider` 只是换皮，架构关系不变，但改动面涉及 5+ 测试文件，ROI 太低。

**ServerCore 侧变化**：
```js
// setupGameListeners 里
// before: this.game.aiManager.onMessage(msg)
// after:  this.aiManager.onMessage(msg)

// 初始化时不再设 this.game.aiManager
// _ensureGame 里删除 this.game.aiManager = this.aiManager
```

**Engine 侧变化**：
```js
// constructor 里删除 this.aiManager 相关（如果有的话）
// getAIController 保留不变
```

**测试侧变化**：
```js
// 删除 game.aiManager = aiManager
// 保留 game.getAIController = (id) => aiManager.get(id)
// 消息转发由 game-harness 的 setupGameListeners 处理
```

---

### 2. handleReset → game.reset()

**现状**：ServerCore 直接设置 Engine 的十几个内部字段，直接操作 player 对象，漏了 `banishedPlayer`。

**目标**：Engine 提供 `reset()` 方法，只清游戏状态和 player 的游戏属性。`ready` 和玩家排序由 ServerCore 在调完 reset 后自己处理。

**接口**：
```
game.reset({ keepPlayers: true })  // 游戏后重置：保留玩家，重置游戏状态和 player 游戏属性
```

**Engine.reset 做的事**（游戏状态）：
- `this.phaseManager.running = false` → `this.phaseManager = null`
- `this.cancelAllPendingRequests()` → 清 `_pendingRequests`
- 重置 gameOverInfo、winner、round、sheriff、couples、夜晚状态、votes、deathQueue 等
- `banishedPlayer`（当前漏了，是现有 bug）
- player 的游戏属性：`alive = true`、`role = null`、`state = {}`、`deathReason = undefined`、`revealed = undefined`
- `message.clear()`（只清数据不清 listener）
- 保留 `getAIController`（不重置）

**Engine.reset 不做的事**（房间管理）：
- 不碰 `ready`——`ready` 是 ServerCore 的房间管理概念，Engine 里没有任何地方写或判断 `ready`，只在 `getState()` 里读
- 不做玩家排序——AI 在前人类在后是房间展示需求，不是游戏规则。`assignRoles` 会重新 shuffle + 重分配 ID，reset 里的排序只是为了大厅展示

**ServerCore 侧变化**：
```js
// before: 20+ 行直接操作 game 内部字段 + player 状态

// after
if (this.aiManager) {
  this.aiManager.reassignToGame(this.game);
}
this.game.reset({ keepPlayers: true });

// 房间管理：ServerCore 自己处理
const aiPlayers = this.game.players.filter(p => p.isAI);
const humanPlayers = this.game.players.filter(p => !p.isAI);
aiPlayers.forEach(p => { p.ready = true; });
humanPlayers.forEach(p => { p.ready = false; });
this.game.players = [...aiPlayers, ...humanPlayers];
this.game.players.forEach((p, i) => { p.id = i + 1; });

this._updateIdMappings();
```

---

### 3. game.players 直接变异 → game.removePlayer()

**现状**：5 处直接赋值 `this.game.players = ...filter(...)` 或重排。

**目标**：Engine 提供 `removePlayer(playerId)` 方法。

**接口**：
```
game.removePlayer(playerId)  // 从 players 中移除指定玩家
```

**ServerCore 侧变化**：
```js
// before
this.game.players = this.game.players.filter(p => p.id !== playerId);

// after
this.game.removePlayer(playerId);
```

**4 处调用点**：handleRemoveAI（395行）、handleSpectate（725行）、handleChangePreset 踢人（639行、652行）。

注意：handleChangePreset 的踢人逻辑（踢谁、先踢 AI 再踢人类）留在 ServerCore——这是房间管理策略。Engine 只提供"移除一个玩家"的原子操作。

---

### 4. _updateIdMappings → aiManager.remapPlayerIds()

**现状**：ServerCore 直接遍历 `aiManager.controllers` 按 name 匹配重建映射，直接替换 Map。

**目标**：AIManager 提供 `remapPlayerIds()` 方法，自己按 name 匹配计算映射。

**接口**：
```
aiManager.remapPlayerIds()  // 无参，AIManager 自己从 game.players + controller.playerName 算映射
```

**AIManager.remapPlayerIds 实现**：
- 遍历 `this.game.players` 中 `isAI` 的玩家
- 按 `controller.playerName === player.name` 匹配到旧 controller
- 更新 `controller.playerId = player.id`
- 用新 ID 重建 `this.controllers` Map
- 调用每个 controller 的 `updateSystemMessage()`

**ServerCore 侧变化**：
```js
// before: 20+ 行直接操作 aiManager.controllers

// after
this._updatePlayerClientMappings();  // ServerCore 只管自己的 playerClients
this.aiManager.remapPlayerIds();      // AIManager 管自己的映射
```

**额外封装**：当前还有 6 处直接访问 `aiManager.controllers`，需要补齐 AIManager 的 API：

| 现有访问 | 新 API |
|---------|--------|
| `aiManager.controllers.get(id)` + `.delete(id)` | `aiManager.remove(playerId)` |
| `for (const c of aiManager.controllers.values())` | `aiManager.forEach(fn)` |
| 遍历调 `controller.onEnterGame()` | `aiManager.onEnterGame()` |
| 遍历调 `controller.onGameOver()` | `aiManager.onGameOver(broadcastFn)` |

**aiManager.remove(playerId) 实现要点**：必须内部调 `controller.destroy()` 再 delete。

---

### 5. handleChangePreset → game.changePreset(presetId)

**现状**：ServerCore 直接设置 `game.presetId`、`game.preset`、`game.effectiveRules`、`game.playerCount`。

**目标**：Engine 提供 `changePreset(presetId)` 方法。

**接口**：
```
game.changePreset(presetId)  // 内部更新 presetId/preset/effectiveRules/playerCount
```

**Engine.changePreset 实现**：
- 校验 `BOARD_PRESETS[presetId]` 存在
- 校验 `!this.phaseManager?.running`
- 设置 `this.presetId`、`this.preset`、`this.effectiveRules`
- 清 `this._playerCount = null`

**留在 ServerCore 的**：踢人逻辑、取消人类 ready、`_updateIdMappings()` + `broadcastState()`

---

### 6. Player 构造 → game.addPlayer()

**现状**：3 处直接构造 player 对象并 push 到 `game.players`。

**目标**：Engine 提供 `addPlayer(data)` 方法，返回 playerId。保持 player 对象结构不变（AI 专属字段仍挂在 player 上），但创建权归 Engine。

**接口**：
```
const playerId = game.addPlayer({ name, isAI, emoji, debugRole, ... })
```

**Engine.addPlayer 实现**：内部计算 nextPlayerId（从 ServerCore 的 `_nextPlayerId()` 移入），合并默认值，push 到 `this.players`，返回 playerId。

**3 处调用点**：handleJoin（人类）、handleAddAI（AI）、handleSwitchRole（观战者转玩家）。

---

### 7. MessageManager 内部 → game.message.clear()

**现状**：`this.game.message.messages = []` 只清了数组，`_nextId` 没归零。

**目标**：MessageManager 提供 `clear()` 方法，同时重置 `messages = []` 和 `_nextId = 1`。

---

### 8. _exitGameForAllAI → aiManager.onGameOver(broadcastFn)

**现状**：ServerCore 的 `_exitGameForAllAI` 遍历 `aiManager.controllers`，为每个 controller 创建闭包 broadcastFn 并调 `controller.onGameOver(this.game, broadcastFn)`。

@提及检测和响应已在 AIController 内部：`handleChat` → `aiManager.onMessage(chatMsg)` → controller 的 `inject()` → `_shouldRespondToMention()` → `_createMentionCallback()` → `chatBroadcastFn`。不需要改动。

**目标**：`_exitGameForAllAI` 的遍历逻辑移入 AIManager。

**接口**：
```
aiManager.onGameOver(broadcastFn)  // broadcastFn: (player, content, event) => void
```

**反馈环**：当前 `_broadcastAIChat` 广播后调 `this.aiManager.onMessage(chatMsg)` 形成反馈环。这个反馈环在 `_broadcastAIChat` 里，不在 `_exitGameForAllAI` 里，移入 AIManager 不影响——broadcastFn 由 ServerCore 提供，ServerCore 的 `_broadcastAIChat` 仍负责反馈环。

反馈环不会循环：chatMsg 带 `isAI = true`，`AIController._extractMessageText` 里发消息的 AI 自己会跳过。

**callback 签名设计**：当前 `_exitGameForAllAI` 在 for 循环里为每个 controller 创建闭包（捕获 controller 来调 `controller.getPlayer()`）。移入 AIManager 后，`onGameOver(broadcastFn)` 内部自己包装 callback：从 result 提取 content，用 controller.getPlayer() 获取 player，调 `broadcastFn(player, content, 'game_over')`。

---

### 9. startGame 遍历 controllers → aiManager.onEnterGame()

**现状**：
```js
for (const controller of this.aiManager.controllers.values()) {
  controller.onEnterGame();
}
```

**目标**：
```js
this.aiManager.onEnterGame();
```

`onGameOver` 的 `game` 参数可移除——`AIController.onGameOver(game, broadcastFn)` 的 `game` 参数在方法体内未被使用。

---

### 10. 游戏初始化代码去重

**现状**：handleJoin（232-243行）和 handleAddAI（338-349行）有完全相同的 8 行初始化代码。

**目标**：提取为 `_ensureGame(presetId)` 方法。

```js
_ensureGame(presetId) {
  if (this.game) return;
  this.currentPresetId = presetId || '9-standard';
  this.game = new GameEngine({ presetId: this.currentPresetId });
  this.aiManager = this.createAIManager(this.game);
  this.game.getAIController = (playerId) => this.aiManager.get(playerId);
  this.aiManager.chatBroadcastFn = (player, content, event) => {
    this._broadcastAIChat(player, content, event);
  };
  resetUsedNames();
  this.setupGameListeners();
}
```

---

## 与 compact-refactor-design 的对齐检查

compact-refactor-design 的核心理念：

> **Server 调度，Agent 执行。** Server 决定"什么时候做什么"，只管 enqueue 请求、等待自己关心的 callback。Server 不关心 Agent 内部状态，不直接操作 mm.messages，不关心压缩是否完成。

本设计文档的改动与此理念的对齐情况：

| compact 理念 | 本设计是否违背 | 说明 |
|-------------|--------------|------|
| Server 只调 AIController 公共方法和 AIManager 分发方法 | ✅ 对齐 | 改动 4/8/9 把所有 `aiManager.controllers` 直接访问替换为 `aiManager.onEnterGame()`、`aiManager.onGameOver()`、`aiManager.remove()` |
| Server 不访问 agent 内部 | ✅ 对齐 | 当前代码已无 `controller.agent.xxx` 访问（compact refactor 已清理） |
| Server 不直接操作 mm.messages | ✅ 对齐 | 本设计不涉及 mm.messages，只涉及 Engine 和 AIManager 的边界 |
| AIController 是业务决策层 | ✅ 对齐 | 改动 8 的 callback 包装从 ServerCore 闭包移到 AIManager 内部，AIController 仍控制"怎么回复" |
| AIManager 是分发器，无业务逻辑 | ✅ 对齐 | 新增的 `onEnterGame`/`onGameOver`/`remove`/`forEach`/`remapPlayerIds` 都是简单遍历/委托，无业务逻辑 |
| 生命周期通过 onEnterGame/onGameOver 通知 | ✅ 对齐 | 改动 8/9 正是把直接遍历改为通过 AIManager 代理调 onEnterGame/onGameOver |
| 消息通知通过 onMessage | ✅ 对齐 | 改动 1 消除 `game.aiManager`，setupGameListeners 里直接调 `this.aiManager.onMessage(msg)` |
| 角色分配后通过 updateSystemMessage | ✅ 对齐 | 不变，onAfterAssignRoles 里仍调 controller.updateSystemMessage() |

**无违背。** 本设计与 compact-refactor-design 的理念完全对齐，且填补了 compact 设计未覆盖的 Engine 侧边界问题。

compact 设计的 B6（ServerCore 层越界）指"5 处直接访问 controller.agent 内部"，已在 compact refactor 中解决。本设计解决的是更上层的越界：ServerCore 直接操作 Engine 内部状态和 AIManager 内部结构。

## 行为差异分析

改动后与当前行为有 3 处差异，均为修 bug 或更正确的资源清理，无功能退化：

### 差异 1: _pendingRequests 处理方式

| | 当前 | 改后 |
|---|---|---|
| 处理方式 | `this.game._pendingRequests = new Map()` 直接替换 | `this.cancelAllPendingRequests()` 先取消再清空 |
| promise 结局 | 5 分钟后 reject 超时错误 | 立即 resolve `{ cancelled: true }` |
| setTimeout | 泄漏 | 立即 clearTimeout 清掉 |

**可观测影响**：无。reset 后没有人还在 await 这些 promise。

### 差异 2: MessageManager _nextId 归零

| | 当前 | 改后 |
|---|---|---|
| `_nextId` | 不重置，新游戏消息 ID 续接上局 | 重置为 1 |

**可观测影响**：无。`_nextId` 生成的 ID 只在 MessageManager 内部的 messages 数组里，无外部依赖。

### 差异 3: banishedPlayer 被重置

| | 当前 | 改后 |
|---|---|---|
| `banishedPlayer` | handleReset 漏了，残留脏数据 | reset 中清为 null |

**可观测影响**：修了一个现有 bug。

## Review 结论

| 改动 | 风险点 | 结论 |
|------|--------|------|
| 1. 消除 game.aiManager | 只删一行猴子补丁 + 改 setupGameListeners 里的调用方；getAIController 保留不动 | 低风险 |
| 2. game.reset() | cancelAllPendingRequests 顺序、gameOverInfo/banishedPlayer 别漏、message:added listener 不丢；ready 和排序由 ServerCore 处理 | 实现时注意顺序即可 |
| 3. game.removePlayer() | handleChangePreset 踢人逻辑留在 ServerCore，只替换 filter 为 removePlayer | 低风险 |
| 4. aiManager.remapPlayerIds() | remove(playerId) 必须内部调 destroy() | 低风险 |
| 5. game.changePreset() | _playerCount 清零方式 | 无风险 |
| 6. game.addPlayer() | 3 处调用点对象结构不同，addPlayer 合并默认值；时序安全 | 无风险 |
| 7. message.clear() | _nextId 归零安全 | 无风险 |
| 8. onGameOver 代理 | 反馈环在 _broadcastAIChat 里不受影响；callback 包装移到 AIManager 内部 | 低风险 |
| 9. onEnterGame 代理 | 无特殊风险 | 无风险 |
| 10. 初始化去重 | 纯重构，行为不变 | 无风险 |

## 改动依赖关系

```
7  (message.clear)      — 无依赖
5  (changePreset)       — 无依赖
9  (onEnterGame 代理)    — 无依赖
10 (初始化去重)          — 无依赖
3  (removePlayer)       — 无依赖
6  (addPlayer)          — 需要同步改 3 处调用点
4  (remapPlayerIds + AIManager 封装) — 需要补 remove/forEach 等方法
8  (onGameOver 代理)     — 依赖 4（需要 AIManager.onGameOver 方法）
2  (game.reset)          — 依赖 7（reset 内部调 message.clear），改动最大
1  (消除 game.aiManager)  — 无依赖，改动小
```

建议执行顺序：1 → 7 → 5 → 9 → 10 → 3 → 6 → 4 → 8 → 2

## 目标状态

### 三层职责

**GameEngine** — 游戏规则引擎，不持有 AIManager 引用

- 持有所有游戏状态（players、round、votes、sheriff 等）
- 提供行动 API：`callSpeech`、`callVote`、`callSkill`（PhaseManager 调用）
- 提供生命周期 API：`reset()`、`changePreset()`、`addPlayer()`、`removePlayer()`
- 通过 `getAIController` 回调获取 AI 控制器（由上层注入）——Engine 知道有些玩家是 AI（`isAI` 字段），需要外部提供控制器，但不知道 AIManager 的存在
- 不持有 `aiManager` 引用

**AIManager** — AI 控制器的容器和分发器，无业务逻辑

- 持有 `controllers` Map，对外不暴露
- 分发消息：`onMessage(msg)` → 遍历调 `controller.inject(msg)`
- 生命周期代理：`onEnterGame()`、`onGameOver(broadcastFn)`、`remapPlayerIds()`
- 管理控制器：`createAI()`、`remove(playerId)`、`get(playerId)`、`forEach(fn)`
- 持有 `game` 引用（用于 remapPlayerIds 和 controller 构建 context）
- 持有 `chatBroadcastFn`（由 ServerCore 注入，controller 用于聊天广播）

**ServerCore** — 传输层 + 房间管理 + 调度器

- WebSocket 连接管理、消息路由
- 房间管理：玩家加入/踢出/观战/准备状态
- 游戏生命周期：创建 Engine、启动、重置
- AI 创建/销毁（通过 AIManager 的 API）
- 显示层：displayMessages 的组装和按玩家可见性过滤
- 广播机制

### 调用链

```
PhaseManager.execute(game)
  → game.callSkill / game.callVote / game.callSpeech
    → game.getPlayerController(playerId)
      → AI 玩家: game.getAIController(playerId) → AIManager.get(playerId)
      → 人类玩家: new HumanController(playerId, game)
        → game.requestAction → emit('player:action') → ServerCore 转发给前端
```

Engine 只调 `getAIController`，不知道返回的控制器来自 AIManager。ServerCore 在创建 Engine 时注入这个回调。

### 消息流

```
游戏消息:
  game.message.add() → emit('message:added')
    → ServerCore.setupGameListeners:
        1. displayMessages.push(...)     ← 展示层
        2. this.aiManager.onMessage(msg) ← AI 层（不再走 game.aiManager）

聊天消息:
  handleChat() → chatMessages.push(...) + displayMessages.push(...)
    → this.aiManager.onMessage(chatMsg) ← AI 层
```

ServerCore 直接调自己的 `this.aiManager.onMessage(msg)`，不经过 Engine。

### 生命周期

```
创建游戏:
  ServerCore._ensureGame(presetId)
    → new GameEngine({ presetId })
    → new AIManager(game)
    → game.getAIController = (id) => aiManager.get(id)
    → aiManager.chatBroadcastFn = (player, content, event) => this._broadcastAIChat(...)
    → setupGameListeners()

启动游戏:
  ServerCore.startGame()
    → aiManager.onEnterGame()        ← 不再遍历 controllers
    → game.assignRoles()
    → aiManager.forEach(c => c.updateSystemMessage())  ← onAfterAssignRoles

游戏结束:
  game_over 消息 → aiManager.onMessage(msg)  ← inject 自动处理
    → ServerCore: _addGameBrief() + aiManager.onGameOver(broadcastFn)
    → AIManager: 遍历 controllers 调 onGameOver（内部 drain + answer + action + compact）

重置游戏:
  ServerCore.handleReset()
    → aiManager.reassignToGame(game)
    → game.reset({ keepPlayers: true })  ← 只清游戏状态和 player 游戏属性
    → ServerCore 处理房间管理：设 ready、重排玩家、重分配 ID
    → _updatePlayerClientMappings() + aiManager.remapPlayerIds()
```

### ServerCore 不再做的事

| 现在 | 改后 |
|------|------|
| 直接设 Engine 的 15+ 个内部字段 | `game.reset()` 一行 |
| 直接设 `game.presetId/preset/effectiveRules/playerCount` | `game.changePreset()` |
| 直接构造 player 对象 push 到 `game.players` | `game.addPlayer()` |
| 直接 `game.players = ...filter(...)` | `game.removePlayer()` |
| 直接 `game.message.messages = []` | `game.message.clear()` |
| 猴子补丁 `game.aiManager` | 消除，ServerCore 直接调 `this.aiManager` |
| 直接遍历 `aiManager.controllers` | `aiManager.onEnterGame()` / `onGameOver()` / `remove()` / `forEach()` |
| 直接替换 `aiManager.controllers = new Map` | `aiManager.remapPlayerIds()` |
| 重复 8 行初始化代码 | `_ensureGame(presetId)` |

### 测试代码的变化

```js
// 现在：每个测试文件都要做猴子补丁
game.aiManager = aiManager;
game.getAIController = (id) => aiManager.get(id);
if (game.aiManager) { game.aiManager.onMessage(msg); }

// 改后：消除 game.aiManager，保留 game.getAIController
game.getAIController = (id) => aiManager.get(id);
// 消息转发由 game-harness 的 setupGameListeners 直接调 aiManager.onMessage
```

Engine 的测试可以直接测 `reset()`、`changePreset()`、`addPlayer()`、`removePlayer()`，不需要通过 ServerCore。