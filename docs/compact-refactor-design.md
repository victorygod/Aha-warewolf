# 对话 Compact 改造设计

## 一、核心理念

**Compact 是对话的自然延续，不是外部注入的摘要块。**

Agent 的上下文是一条不中断的流。压缩不是把内容抽出来喂给新上下文做提取，而是在原对话流中追加一条 user 消息（请求总结），LLM 返回 assistant 摘要，然后删除旧消息。压缩产出是自然的对话轮次（user 问 → assistant 答），语义连贯。

Agent 就像一个真人，被问"我们刚才聊了什么"时会自然回顾。他不需要被塞一份别人写的会议纪要，他自己回忆，用自己的话总结。场景差异仅体现在那条 user 消息的内容上——问什么决定了总结什么，但"追问→回答→忘掉细节"这个动作始终一样。

**inject 是外部内容进入系统的唯一入口，answer 是思考的唯一出口。**

inject 存事实，answer 产观点。两者正交：inject 可独立存在（只需知道、不需回应），answer 必须在 inject 之后（先有内容才能思考）。所有持久化内容（游戏消息、聊天内容）通过 inject 写入 mm.messages，answer 不负责存内容，只负责调 LLM 产出 assistant 消息。事件驱动场景下 inject 和 answer 是两个独立队列项（inject 先入队，answer 后入队），请求驱动场景下 answer 执行前 flush 已有的 pendingInject——两种场景都保证内容先于思考进入 mm.messages。

**Server 调度，Agent 执行。**

Server 决定"什么时候做什么"（什么时候进游戏、什么时候投票、什么时候切换身份），只管 enqueue 请求、等待自己关心的 callback。Agent 决定"怎么做"（怎么构建上下文、怎么调 LLM、怎么压缩记忆），Server 不关心 Agent 内部状态，不直接操作 mm.messages，不关心压缩是否完成。可见性过滤由 AIController 完成，Agent 只接收可见消息，不关心可见性。

**AI 说话时机的判断应可扩展。**

当前 AI 只在被 @提及时才回应（被动触发），但架构需要支持 AI 主动说话的方向——例如根据 inject 的聊天内容、沉默时间、对话节奏等判断是否应该主动回应。inject + answer 的正交分离天然支持这个扩展：inject 已存入完整上下文，只需在 inject 的后续判断中加一步"是否应该主动回答"（类似当前 speech→analyze 的判断），即可走 answer(callback=推送函数) 产出回复。不需要改队列模型或接口。

由此推导：

1. **压缩在原对话流中发生**：追加 user 消息、LLM 返回 assistant 摘要、删除旧消息。不存在"另起炉灶"的操作。
2. **场景差异只在 user 消息内容**：不同场景定制不同的总结请求，删除旧消息的操作完全统一。compact 函数本身不关心场景。
3. **重复 compact 自然合并**：前次摘要已在对话历史中，LLM 看到完整历史自然产出合并摘要，无需显式注入 previous-summary。
4. **上下文表现与改造前保持一致**：mm.messages 里的内容结构不变（user 消息包含持久化内容，assistant 消息是 AI 回复）。改造改变的是内容写入的方式（inject + answer 分步写入 vs appendTurn 一次性写入），以及 ephemeral 内容（CURRENT_TASK、thinking、speaking）不再写入 mm.messages 而是仅在 buildLLMView 时注入。这样 compact 只能看到持久化内容，不会被当次决策指令污染。

## 二、改造目标

### 架构改造

| # | 目标 | 核心理念 | 当前问题 |
|---|------|---------|---------|
| A1 | compact 语义连贯 | compact 是对话的自然延续 | 压缩产出是 `【之前压缩摘要】` 单条 user，像外部注入，语义断裂 |
| A2 | inject 统一内容入口 | inject 是外部内容进入系统的唯一入口 | 内容通过 appendContent、appendTurn、formatIncomingMessages 等多条路径进入 mm.messages，职责不清 |
| A3 | 消除水位线 | push 机制替代 pull 机制 | lastProcessedId 和 lastChatMessageId 是 pull 回查机制，inject 逐条 push 后不再需要 |
| A4 | 聊天消息实时推送 | AI 感知所有聊天内容 | `_handleChatMentions` 只在 @提及时推送，普通聊天 AI 完全不知道 |

### Bug 修复

| # | 问题 | 严重度 | 根因 |
|---|------|--------|------|
| B1 | answer() 内自 enqueue compress 导致死锁 | P0 | answer 内部嵌套 await compact callback，processQueue 正在运行导致 callback 永远不触发 |
| B2 | getVoteResult 的 compact 是 fire-and-forget | P2 | day_vote 后 enqueue compact 不 await，exitGame 的 _drainQueue 会丢弃 |
| B3 | compress() 静默失败 | P3 | LLM 返回空内容时替换操作不执行也不报错 |
| B4 | Agent.messages getter 暴露可变引用 | P4 | 外部可直接 push/splice 绕过 MessageManager |
| B5 | Agent.destroy() 绕过 MessageManager | P5 | 直接赋值 mm.messages=[]，不重置 _currentMode |
| B6 | ServerCore 层越界 | P6 | 5 处直接访问 controller.agent 内部，绕过 AIController 层 |
| B7 | callSpeech 未处理 null 结果 | P3 | drain 导致 answer resolve(null) 时，callSpeech 访问 result.content 会 TypeError，callVote 和 callSkill 有兜底 |

> **P1（resetForNewGame 后 system prompt 过时）已被本次改造解决**：`onResetForNewGame` 合并到 `onEnterGame`，`updateSystem(game)` 改由 `onAfterAssignRoles` 在角色分配后调用，此时 role 已存在，system prompt 不会过时。

### 改造如何解决问题

改造前后对比见第七节「预期效果」。

## 三、队列模型

inject、answer、compact、action 是平级队列项，processQueue 串行处理，不存在嵌套 await。

### 四种队列项

| 类型 | 调 LLM | 产出 | 场景 |
|------|--------|------|------|
| inject | 否 | pendingInject 缓冲，flush 时合并为一条 user 消息写入 mm.messages | 所有外部内容进入系统的入口：游戏消息、聊天内容、游戏结果信息 |
| answer | 是 | assistant/tool 消息追加到 mm.messages | 决策（callback=resolve）、分析/回应（callback=推送函数） |
| compact | 是（用当前 messages） | user 请求 + assistant 摘要，删旧消息 | 压缩 |
| action | 否 | 执行同步操作（如 updateSystem），不写 mm.messages | 生命周期中的状态切换操作 |

### inject 和 answer 的关系

事件驱动场景下，inject 和 answer 是两个独立队列项：inject 先入队，answer 后入队，processQueue 串行执行保证顺序。请求驱动场景下（speech/vote/useSkill），内容已通过之前的 message:added 事件 inject 入队，answer 执行前 flush 已有的 pendingInject，保证 LLM 能看到所有新内容。两种场景都保证内容先于思考进入 mm.messages。

独立 inject 的场景：内容只需存储不需 AI 回应（聊天消息、非 speech 游戏消息）。inject + answer 的场景：内容既需存储又需 AI 思考（游戏发言 → inject + answer(analyze)、@提及 → inject + answer(CHAT, mentioned)）。game_over 消息通过 onMessage 自动 inject，消息本身已包含完整信息（胜负结果 + 所有玩家角色），inject 时格式化即可，无需额外补充。

### Server 调用 AI 的三种模式

Server 对 AI 的调用有三种模式，按阻塞程度递减：

**1. 串行等待**（callback=resolve）：PhaseManager 逐个调用 AI 决策，必须等当前 AI 返回结果才能推进下一步。典型场景：发言、技能使用。

**2. 并发等待**（callback=resolve，Promise.all）：Server 同时向多个 AI 发请求，各 AI 并发执行，server 等所有结果返回后才继续。典型场景：投票、狼人讨论。

**3. 触发即忘**（callback=推送函数或 null）：Server 只负责通知 AI，不阻塞等结果。callback=null 时 AI 输出仅影响自身上下文（如 analyze），callback=推送函数时 AI 回复通过 callback 广播（如 @提及、赛后复盘）。

callback 取值与具体场景的对应关系见 6.9 节。

模式 3 是"AI 说话时机可扩展"理念的基础——当前只有被 @提及时才回应，未来可以根据 inject 的内容、沉默时间等判断是否主动回应，推送机制不变。

### 消除水位线

当前水位线（lastProcessedId、lastChatMessageId）是 pull 机制——"我上次处理到哪了，把后面的给我"。改后每条消息产生时立即 inject（push 机制），不存在"不知道哪些是新的"这个问题。

- **lastProcessedId**：不再需要。当前用于 `formatIncomingMessages` 过滤游戏消息增量，改后游戏消息通过 `onMessage` 逐条 inject，answer 不再需要从 context 拿消息列表过滤增量。
- **lastChatMessageId**：不再需要。当前用于 `handleMention` 过滤聊天增量，改后聊天消息逐条 inject，AI 已有完整聊天上下文。

消除水位线的前提：每条可见消息都能 inject 入队。可见性过滤由 AIController 完成（已有 `shouldAnalyzeMessage` 和 `canSee` 判断），Agent 只接收可见消息，不关心可见性。具体路径：

- 游戏消息：`game.message.add()` emit `message:added` → AIManager.onMessage(msg) → controller.inject(msg) → 可见性过滤 → enqueue inject（所有可见消息）+ enqueue answer(analyze)（仅 speech）
- 聊天消息：`handleChat` → AIManager.onMessage(msg) → controller.inject(msg) → 过滤自己 + @判断 → enqueue inject + enqueue answer(CHAT, mentioned)（仅 @了自己）

#### inject 替代水位线的可行性验证

**消息不漏发**：所有游戏消息都通过 `game.message.add()` 创建，内部同步执行 `this.messages.push(msg)` + `this.emit('message:added', msg)`。经审计，engine 目录内没有任何代码绕过 `add()` 直接操作 `game.message.messages`（仅构造函数初始化和 reset 清空）。每条消息一定 emit，一定按 `_nextId++` 顺序。

**push 和 emit 必须原子绑定**：`add()` 内 push 和 emit 是同步顺序执行，天然原子。这是 inject 替代水位线的根本依赖——如果 push 了没 emit，消息就漏了。这个约束必须在 `add()` 方法上标记，防止未来拆开或异步化。

**消息清空不影响 Agent**：`handleReset` 里 `this.game.message.messages = []` 清空游戏消息，不触发事件。但 Agent 的 mm.messages 是 Agent 自己的记忆，不等于 game.message 的镜像。reset 时 Agent 走自己的生命周期（onEnterGame 做 compact），mm.messages 里的旧消息被 compact 压缩，不需要和 game.message 同步清空。

**生命周期切换丢弃是正确的**：`_exitGameForAllAI` 调 `_drainQueue()` 丢弃 pending inject。被丢弃的是旧阶段的未处理消息，新生命周期（赛后聊天、新游戏）会走自己的 inject 流程，旧消息不需要。

**drain 时的 answer 回调处理**：drain 会对队列中所有项调 `callback?.(null)`。对于 answer 项（callback=resolve），这会导致 Promise resolve 为 null，controller 收到 null 结果。当前 PhaseManager 的 callVote 和 callSkill 已能处理 null（弃权/技能未使用），但 callSpeech 访问 `result.content` 会 TypeError。改造时需要让 AIController 的 getSpeechResult 在 result 为 null 时返回默认发言（如"过。"），确保 drain 不会导致游戏崩溃。

**聊天消息需新增通知路径**：当前 `chatMessages` 直接 push 到数组，没有事件。改后 `handleChat` 里需显式调用 `AIManager.onMessage(msg)`，将聊天消息 inject 给 AI。

### compact 的触发方式

| 方式 | callback | 场景 | 说明 |
|------|----------|------|------|
| token 超限 | 无 | inject 后 eager 检查超限 | inject 处理器检查 mm.messages + pendingInject 的 token 总量，超限则 enqueue compact |
| 生命周期切换 | 无 | onEnterGame、onGameOver | 显式 enqueue compact，server 不关心压缩何时完成，顺序由队列保证 |

compact 永远不需要 callback——server 只管 enqueue，顺序由 processQueue 串行保证。生命周期切换时 compact 作为队列项排在其他操作之后（如 onGameOver 的 answer + action 之后），processQueue 串行执行保证顺序。

### 聊天消息的实时推送

当前架构**不支持实时获取聊天消息**：`_handleChatMentions` 只在 AI 被 @提及时才推送 chat delta，其他人的普通聊天消息 AI 完全不知道。

改后：`handleChat` 里每条新聊天消息都通知所有 AI controller，走 enqueue inject，不调 LLM。过滤规则：跳过 AI 自己发的消息（防级联）。

### token 超限 eager 触发

触发点从 answer 内部 lazy 检查改为 inject 之后 eager 检查。超限时由 Agent 根据 `mm._currentMode` 构建 summaryRequest 并 enqueue compact。mm 不知道场景，只负责执行压缩。

## 四、场景映射

| 场景 | 内容来源 | compact | updateSystem | 其他 |
|------|---------|---------|-------------|------|
| 进入游戏后 | — | chat 请求 | game（assignRoles 后由 onAfterAssignRoles 调用） | onEnterGame 只做 compact(chat)，聊天消息已通过 inject 实时进入 |
| day_vote 后 | 游戏消息（inject + answer callback=resolve） | game 请求 | — | — |
| 赛后 review 后 | game_over 消息（onMessage 自动 inject，含完整信息）+ AI 复盘（answer callback=推送） | chat 请求 | chat（队列项 action） | onGameOver 入队 answer → action(updateSystem, chat) → compact(chat) |
| 聊天室 token 超限 | — | chat 请求 | — | eager 触发 |
| 聊天消息实时推送 | chat delta（inject） | token 超限时 eager 触发 | — | 新增 |

说明：
- 进入游戏时 onEnterGame 做 compact(chat)，updateSystem(game) 由 server 在 assignRoles 后通过 controller.updateSystemMessage() 调用
- 赛后 review 后用 chat 请求：游戏已结束，回到聊天室场景，侧重社交关系和发言风格
- 聊天消息实时推送走 inject，不调 LLM，AI 只存储上下文，等被 @提及时才回应

## 五、当前代码调研

### 5.1 answer() 的所有显式触发条件

| # | 触发条件 | 代码位置 | actionType | callback | 说明 |
|---|---------|---------|------------|----------|------|
| 1 | 游戏发言 | `engine/main.js:299` → `controller.getSpeechResult` → `controller.js:55` | DAY_DISCUSS / LAST_WORDS / SHERIFF_SPEECH / NIGHT_WEREWOLF_DISCUSS | resolve | PhaseManager 调 game.callSpeech，必须返回发言内容 |
| 2 | 游戏投票 | `engine/main.js:334` → `controller.getVoteResult` → `controller.js:68` | DAY_VOTE / SHERIFF_VOTE | resolve | PhaseManager 调 game.callVote，必须返回投票结果 |
| 3 | 技能使用 | `engine/main.js:396,582` → `controller.useSkill` → `controller.js:113` | SEER / WITCH / GUARD / HUNTER / CUPID / SHOOT / PASS_BADGE / ASSIGN_ORDER | resolve | PhaseManager 调 game.callSkill，必须返回技能目标 |
| 4 | 游戏发言自动分析 | `server-core.js:1193` → `aiManager.onMessageAdded` → `controller.enqueueMessage` → `controller.js:136` | analyze | null | 游戏中 speech 类型消息触发，AI 不需要回复 |
| 5 | 聊天 @提及 | `server-core.js:1073` → `_enqueueAIChat` → `_executeAIChat` → `controller.sendChatMessage` → `controller.js:145` | CHAT (event=mentioned) | resolve | 玩家 @AI 名字触发 |
| 6 | 赛后聊天 | `server-core.js:1144` → `controller.sendChatMessage` → `controller.js:145` | CHAT (event=game_over) | resolve | 游戏结束后触发 AI 复盘 |
| 7 | 死亡 AI 补消息 | `server-core.js:1047` → `controller.supplementDeadMessages` → `controller.js:185` | analyze | null | 游戏结束后补发死亡 AI 错过的游戏消息 |

### 5.2 所有内容进入 mm.messages 的路径

| # | 触发 | 方法链 | 入队方式 | role |
|---|------|--------|---------|------|
| 1 | 聊天室 @提及 | `handleChat` → `_handleChatMentions` → `controller.handleMention` → `sendChatMessage` → `answer` → `appendTurn` | task prompt + AI 回复 | user + assistant |
| 2 | 游戏发言自动分析 | `onMessageAdded` → `enqueueMessage` → `answer` → `appendTurn` | 发言内容 + 分析任务 + AI 分析 | user + assistant |
| 3 | 游戏决策 | PhaseManager → `getVoteResult` 等 → `answer` → `appendTurn` | 可见消息 + 任务 + 推理 + 工具调用 + 工具结果 | user + assistant + tool |
| 4 | 进入游戏 | `enterGame` → `mm.appendContent(delta)` | 聊天 delta | user |
| 5 | 赛后游戏结果 | `onMessage` → inject（game_over 消息含 gameOverInfo） | 游戏结果信息 | user |
| 6 | 压缩 | `compress` → 替换为 `【之前压缩摘要】` | 摘要文本 | user（单条） |
| 7 | 销毁 | `Agent.destroy` → `mm.messages = []` | 清空 | — |

> 注：改后所有路径统一走 inject 入队，路径 4、5 不再走 `mm.appendContent()` 直接 push。

### 5.3 关键发现：只有 speech 触发自动分析

`ANALYSIS_NODES = ['speech']`，只有发言类型消息触发自动分析。投票、死亡、技能结果等其他游戏事件不会自动进入 `mm.messages`——它们只在 AI 下次做决策时通过 `formatIncomingMessages`（按 `lastProcessedId` 水位线过滤）间接可见。

改后：`onMessage` 对所有游戏消息触发 inject，speech 额外触发 answer(analyze)。水位线不再需要。

### 5.4 关键发现：聊天内容不实时推送

聊天室阶段其他人的聊天内容只在当前 turn 的 task prompt 里临时可见（`recentChat`），不进入 `mm.messages`。`_handleChatMentions` 只在 @提及时推送，普通聊天 AI 完全不知道。

改后：`handleChat` 里每条新聊天消息都通知所有 AI controller，走 enqueue inject，不调 LLM。AI 已有完整聊天上下文，`handleMention` 不再需要构建 `recentChat` 字段。

### 5.5 所有修改 mm.messages 的方法（当前代码）

| 方法 | 操作 | 调用方 |
|------|------|--------|
| 构造函数 | `this.messages = []` | Agent 构造 |
| `appendTurn(msgs, newMessages)` | push + 更新 lastProcessedId | `_agentLoop`（3 处） |
| `updateSystem(player, game, mode)` | 替换/插入 messages[0] | Agent 3 处 + AIController |
| `compress(llmModel, mode, context)` | 替换为 `[system, 摘要user]` | `processQueue` |
| `appendContent(content)` | push user 消息（改后删除，统一走 inject 队列项） | Agent 3 处 |
| `Agent.destroy()` | `mm.messages = []`（直接赋值） | AIController.destroy |
| `Agent.messages` getter | 暴露可变引用 | 测试代码直接 push |

### 5.6 水位线系统

| 水位线 | 位置 | ID 来源 | 重置时机 | 改后变化 |
|--------|------|---------|----------|---------|
| `lastProcessedId` | MessageManager | `game.message._nextId` | `resetWatermark()` → 0 | 删除。游戏消息逐条 inject，不再需要增量过滤 |
| `lastChatMessageId` | Agent | 当前由 `ServerCore.chatMessageId` 提供 | 不重置，只前进 | 删除。聊天消息逐条 inject，不再需要增量过滤 |

## 六、工程实现设计

### 6.1 inject 缓冲与合并

#### 为什么需要合并

当前 mm.messages 的结构是交替的 user/assistant 对：

```
[system, user:{游戏消息+任务}, assistant:{回复}, user:{游戏消息+任务}, assistant:{回复}, ...]
```

如果 inject 逐条消息直接 push user 消息，多个连续 inject 会产生连续的 user 消息：

```
[system, user:{消息1}, user:{消息2}, user:{消息3}, assistant:{回复}, ...]
```

这改变了消息结构，可能导致 LLM 行为变化，也和 compact 的假设不一致（compact 遍历 messages 时期望 user/assistant 交替）。

#### 缓冲区设计

inject 不直接写入 mm.messages，而是写入 `mm.pendingInject` 缓冲区。缓冲区在以下时机 flush（合并为一条 user 消息写入 mm.messages）：

1. **answer 执行前**：flush 缓冲区 → 一条 user 消息 → 然后调 LLM → assistant 消息
2. **compact 执行前**：flush 缓冲区 → 一条 user 消息 → 然后执行压缩
3. **token 超限检查时**：需要把缓冲区内容计入 token 估算

flush 操作：将 `pendingInject` 中所有文本片段拼接为一条 user 消息，push 到 mm.messages，清空缓冲区。

#### 缓冲区内容

调用方在 inject 时提取文本内容，传入 `mm.inject(text)`。`pendingInject` 存储的是文本字符串，不是原始消息对象。MessageManager 不知道消息类型和游戏上下文，只负责存和拼。

文本来源：
- 游戏消息：`msg.content` 已由 `buildMessage` 模板在 `message.add()` 时格式化好（如"第2夜: 3号张三 被狼人杀害"），inject 直接取 `msg.content`。game_over 消息额外携带 `gameOverInfo`（玩家角色信息），controller.inject 需将 `msg.content` 和 `gameOverInfo` 一起格式化为完整文本
- 聊天消息：`chatMsg` 对象有 `playerName` 和 `content`，inject 时拼接为 `playerName: content`

flush 时直接用换行符拼接所有 pendingInject 文本为一条 user 消息。

#### 和当前结构的对齐

当前 `formatIncomingMessages` 返回 `{newContent, newMessages}`，`newContent` 是格式化后的文本。改后：

- inject 时调用方提取文本内容，传入 `mm.inject(text)`
- flush 时拼接所有 pendingInject 文本为一条 user 消息
- answer 不再需要 `formatIncomingMessages`，内容已在 inject 时提取并存入缓冲区

### 6.2 MessageManager 改造

#### 新增属性

- `pendingInject`：缓冲区数组，存储文本字符串

#### 新增方法

- `inject(text)`：将文本追加到 `pendingInject`，仅此而已。token 检查和 enqueue compact 由 processQueue 的 inject 处理器负责，不在 mm 里
- `flush()`：将 `pendingInject` 中所有文本用换行拼接为一条 user 消息，push 到 mm.messages，清空 `pendingInject`。如果 `pendingInject` 为空则不操作
- `compact(mode)`：在原对话流中执行压缩。flush 缓冲区 → 追加 user 请求消息 → LLM 返回 assistant 摘要 → 删除旧消息（保留 system + 新的 user/assistant 对）
- `destroy()`：统一重置 messages + pendingInject + _currentMode，替代直接赋值

#### 修改方法

- `buildLLMView(ephemeralContent)`：不再接收 fullContent 参数。从 mm.messages 构建视图，末尾追加一条 user 消息含 ephemeralContent（CURRENT_TASK + thinking + speaking），仅用于 LLM 调用，不写回 mm.messages
- `appendTurn`：删除。inject 负责 user 消息，answer 只追加 assistant 消息
- `appendContent`：删除。统一走 inject
- `formatIncomingMessages`：删除。不再需要水位线过滤
- `compress`：替换为 compact，逻辑完全不同（见 6.4 compact 改造）

#### 删除属性

- `lastProcessedId`：不再需要水位线
- `resetWatermark()`：不再需要

### 6.3 Agent 改造

#### processQueue 改造

当前 processQueue 只处理 compress 和 answer 两种类型。改后处理四种：

- **inject**：调 `mm.inject(text)` 追加到 pendingInject，然后做 eager token 检查（mm.messages + pendingInject 的 token 总量），超限则 enqueue compact
- **answer**：先 `mm.flush()` → 构建 LLM 视图 → 调 LLM → 追加 assistant/tool 消息到 mm.messages
- **compact**：先 `mm.flush()` → 执行 compact
- **action**：执行同步操作（如 updateSystem），不调 LLM，不写 mm.messages

#### answer 改造

当前 answer 内部：`formatIncomingMessages` → `buildCurrentTurn` → `buildLLMView(full)` → LLM 调用 → `appendTurn`

改后：
1. `mm.flush()` — 将 pendingInject 合并为一条 user 消息写入 mm.messages
2. 构建 ephemeral 内容：CURRENT_TASK + thinking + speaking
3. `mm.buildLLMView(ephemeral)` — 从 mm.messages 构建视图，末尾追加 ephemeral user 消息
4. LLM 调用（在 llmView 深拷贝上进行多轮 tool_calls）
5. agent loop 结束后，将最终成功的 assistant + tool 消息对 push 到 mm.messages（中间失败的轮次只存在于 llmView 中，不写入 mm.messages）

注意：CURRENT_TASK、thinking、speaking 仍在 LLM 视图中（通过 buildLLMView 注入），但不写入 mm.messages。这保持了 LLM 看到的内容和之前一致，同时 compact 只能看到持久化内容。

`buildCurrentTurn` 改造：当前返回 `{ full, history }`，history 包含 newContent + CURRENT_TASK，被 appendTurn 写入 mm.messages。改后 newContent 来自 flush（已写入 mm.messages），CURRENT_TASK 来自 ephemeral，history 字段不再需要。`buildCurrentTurn` 简化为只返回 ephemeral 内容（CURRENT_TASK + thinking + speaking），供 buildLLMView 使用。

#### 两条消息路径

AI 的行为由两条路径驱动，不能合并：

- **事件驱动**（message:added 事件 / handleChat 调用）→ `controller.inject(msg)` → 内部决定：存内容 + 是否需要回应。走 inject + 可选 answer（callback=null 用于 analyze，callback=推送函数用于 @提及回应）
- **请求驱动**（PhaseManager 调用）→ `controller.getSpeechResult()` / `getVoteResult()` / `useSkill()` → answer(callback=resolve)。走 answer，因为需要返回结果给游戏引擎

事件驱动是"AI 被告知发生了什么"，请求驱动是"AI 被要求做出决策"。inject 统一了事件驱动的入口，但请求驱动仍需独立的 controller 方法。

#### 删除方法/属性

- `shouldCompress()`：不再需要，token 检查移到 inject 之后
- `lastChatMessageId`：不再需要
- `enterGame`：不再直接操作 mm，由 AIController 统一调度
- `exitGame`：不再直接操作 mm，由 AIController 统一调度
- `postGameCompress`：不再需要，由 AIController 生命周期方法内部处理
- `resetForNewGame`：不再需要，走 onEnterGame 同一流程（首次进游戏和重开新局本质相同）
- `appendContent`：不再需要，统一走 inject
- `appendGameOverInfo`：删除，game_over 消息通过 onMessage inject 已包含完整信息
- `messages` getter：删除，外部通过 AIController 访问

#### 新增方法

- `_checkTokenAndCompact()`：估算 mm.messages + pendingInject 的 token 数，超限则 enqueue compact

### 6.4 compact 改造

当前 `compress()` 逻辑：提取旧内容 → 构建独立 prompt → LLM 调用 → 替换为 `【之前压缩摘要】` 单条 user 消息

改后 compact 逻辑：

1. `mm.flush()` — flush 缓冲区
2. 在 mm.messages 末尾追加一条 user 消息，内容根据 mode 生成（如"请总结以上游戏进展，保留关键信息"）
3. LLM 调用，输入为完整 mm.messages，输出为 assistant 摘要
4. 删除步骤 2 之前的所有消息（保留 system），保留步骤 2 的 user 消息和步骤 3 的 assistant 消息
5. 最终 mm.messages = `[system, user:{总结请求}, assistant:{摘要}]`

重复 compact 自然合并：前次摘要已在 mm.messages 中作为 assistant 消息存在，LLM 看到完整历史自然产出合并摘要。

compact 失败处理：LLM 返回空时重试一次，仍空则上下文变为 `[system, user:{请求}, assistant:空]`，打 warn 日志。无 LLM 时由退化模型（MockModel/RandomModel）处理：将非 system 消息用 `[[]]` 包裹为一条 user 消息，作为 assistant 回复返回，上下文变为 `[system, user:{请求}, assistant:[[历史内容]]]`。Agent 在 enqueue compact 时根据模型可用性选择传入 llmModel 或退化模型（mockModel/randomModel）。

### 6.5 AIController 改造

#### inject 作为事件驱动入口

`controller.inject(msg)` 是事件驱动消息进入 AI 系统的统一入口。它负责：

1. 可见性过滤：不可见的消息不 inject
2. 提取文本：事件本身已携带格式化好的文本（game message 的 `msg.content` 由 `buildMessage` 模板生成，chat message 在 emit 前拼接 `playerName: content`），inject 直接取用
3. enqueue inject：将文本存入 pendingInject
4. 判断后续行为：游戏消息中 speech 类型额外 enqueue answer(analyze)；聊天消息中 @了自己额外 enqueue answer(CHAT, mentioned)；其他仅 inject

注意：inject 只覆盖事件驱动侧。请求驱动侧（speech/vote/useSkill）仍由 PhaseManager 通过 `controller.getSpeechResult()` / `getVoteResult()` / `useSkill()` 触发，走 `agent.enqueue({type: 'answer', context, callback: resolve})`，不经过 inject。

AIManager 的 `onMessage(msg)` 统一处理游戏消息和聊天消息，遍历 controller 调 `inject(msg)`，不再有自己的判断逻辑。

#### 生命周期方法

Server 只通知 controller 发生了什么状态变化，不指定做什么：

- `controller.onEnterGame()`：Server 调用，controller 内部决定：drain 队列（丢弃旧阶段残留的 answer/analyze）→ enqueue compact(chat)。改后聊天消息实时 inject，不再需要注入 chat delta。updateSystem(game) 不在此处调用——由 `onAfterAssignRoles` 中的 `controller.updateSystemMessage()` 在角色分配完成后调用
- `controller.onGameOver(game)`：Server 调用，controller 内部决定：drain 队列（丢弃旧阶段残留的 answer/analyze）→ enqueue answer(game_over, callback=推送函数) → enqueue action(updateSystem, chat) → enqueue compact(chat)。game_over 消息已通过 `onMessage` → inject 自动注入（含胜负结果 + 所有玩家角色信息），onGameOver 不需要再额外 inject。action 是同步队列项，processQueue 串行执行保证 updateSystem 在 answer 之后、compact 之前

`onEnterGame` 同时覆盖首次进游戏和重开新局两个场景——两者本质相同：compact 当前上下文（chat 模式），等 assignRoles 后 updateSystem(game)。

重开新局时 `handleReset` → `reassignToGame` 只需将 controller 关联到新 game 对象，不调 `onEnterGame`。因为 `onGameOver` 已处理赛后过渡（AI 已在 chat 模式），`onEnterGame` 只在 `startGame` 时调用。`reassignToGame` 不再有 AI 生命周期职责。

这些方法替代当前 server-core 直接调 `agent.enterGame`、`agent.exitGame`、`agent.postGameCompress`、`agent.appendGameOverInfo`、`agent.resetForNewGame`。Server 不再知道 compact、inject、updateSystem 的存在。

#### 赛后 review

当前流程：`_triggerAIPostGameChat` → `controller.sendChatMessage(gameOverContext)` → answer(callback=resolve) → server await 结果 → 广播为聊天消息 → `appendGameOverInfo` + `postGameCompress`。Server 阻塞等 AI 回复。

改后流程（模式 3：触发即忘）：
1. `game_over` 消息 → `onMessage` 自动 inject（消息含胜负结果 + 所有玩家角色信息，格式化后写入 mm.messages）→ `controller.onGameOver(game)` → enqueue answer(game_over, callback=推送函数) → enqueue action(updateSystem, chat) → enqueue compact(chat)
2. answer 完成后：callback 把结果推给 server 广播为聊天消息，server 不等
3. action(updateSystem, chat) 在 answer 之后执行，切换身份提示
4. compact(chat) 在 action 之后执行，由队列串行保证

AI 先复盘再压缩——队列串行保证 answer → action(updateSystem, chat) → compact(chat) 的顺序。赛后回复、身份切换、压缩都是 Agent 自身行为，server 只管触发不管后续。

`buildGameOverChatContext` 可删除：game_over 消息已通过 `onMessage` → inject 注入（含胜负结果 + 所有玩家角色信息），answer(game_over) 的 task prompt 只需提示语（如"游戏结束了，你有什么想说的？"），不需要额外拼接 playersInfo。

#### 修改方法

- `shouldAnalyzeMessage(msg, selfPlayerId, game)`：保留，由 inject 内部调用，判断是否需要额外 analyze
- `handleMention`：不再需要构建 `recentChat` 字段（聊天内容已通过 inject 存入 mm.messages）

#### 删除方法

- `supplementDeadMessages`：不再需要。死亡 AI 错过的游戏消息已通过 inject 进入 mm.messages
- `enqueueMessage`：inject 部分合并到 inject，analyze 部分由 inject 内部判断触发

### 6.6 AIManager 改造

#### 简化

AIManager 只有一个消息入口方法，遍历 controller 调 inject：

- `onMessage(msg)`：遍历 controller，调 `controller.inject(msg)`。inject 内部根据消息类型做不同处理（game 消息：visibility 过滤 + speech→analyze；chat 消息：过滤自己 + @→answer）

不再需要 `shouldAnalyzeMessage` 和 `handleMention` 的判断逻辑在 AIManager 层——这些逻辑下沉到 controller.inject。

### 6.7 ServerCore 改造

#### 删除直接访问 agent 的代码

所有 `controller.agent.xxx` 调用替换为 `controller.xxx`：

- `controller.agent.lastChatMessageId = ...`：删除，水位线不再需要
- `controller.agent.enterGame(...)`：改为 `controller.onEnterGame()`
- `controller.agent.exitGame(player)`：改为 `controller.onGameOver(game)`
- `controller.agent.appendGameOverInfo(...)` + `controller.agent.postGameCompress(...)`：删除，game_over 消息已通过 onMessage inject 包含完整信息，onGameOver 只需 enqueue answer + action + compact
- `controller.agent.lastChatMessageId = ...`（赛后聊天）：删除

#### 新增通知路径

- `handleChat` 中，每条聊天消息除了 push 到 `chatMessages`，还需调 `this.aiManager?.onMessage(msg)`

#### 生命周期改造

- `startGame`：调 `controller.onEnterGame()`，不再 await
- `handleReset` → `reassignToGame`：只关联新 game 对象，不再调 AI 生命周期方法（onGameOver 已处理赛后过渡，onEnterGame 在 startGame 时调用）
- `onAfterAssignRoles`：保留 `controller.updateSystemMessage()` 调用，在角色分配完成后更新 AI 的 system prompt 为 game 模式
- `_exitGameForAllAI`：调 `controller.onGameOver(game)`
- `_triggerAIPostGameChat`：删除。赛后复盘已在 `onGameOver` 内部通过 enqueue answer(game_over, callback=推送) 处理，不需要单独触发

### 6.8 删除清单

| 删除项 | 原因 |
|--------|------|
| `mm.lastProcessedId` | 水位线由 inject 逐条 push 替代 |
| `mm.resetWatermark()` | 不再需要 |
| `mm.formatIncomingMessages()` | 不再需要水位线过滤 |
| `mm.appendContent()` | 统一走 inject |
| `mm.appendTurn()` | inject 负责 user 消息，answer 只追加 assistant |
| `mm.compress()` | 替换为 mm.compact() |
| `mm._findPrevSummary()` | compact 不再需要查找前次摘要 |
| `mm._compactHistoryAfterSummary()` | compact 不再提取旧内容 |
| `mm._buildCompressPrompt()` | compact 的 user 请求内容不同 |
| `Agent.lastChatMessageId` | 水位线不再需要 |
| `Agent.shouldCompress()` | token 检查移到 inject 之后 |
| `Agent.enterGame()` | 改由 AIController 生命周期方法 |
| `Agent.exitGame()` | 改由 AIController 生命周期方法 |
| `Agent.postGameCompress()` | 改由 AIController 生命周期方法 |
| `Agent.resetForNewGame()` | 首次进游戏和重开新局本质相同，统一走 onEnterGame |
| `Agent.appendContent()` | 统一走 inject |
| `Agent.appendGameOverInfo()` | 删除，game_over 消息通过 onMessage inject 已包含完整信息 |
| `buildCurrentTurn()` 的 history 字段 | newContent 来自 flush，CURRENT_TASK 来自 ephemeral，history 不再需要 |
| `Agent.messages` getter | 删除可变引用 |
| `AIController.supplementDeadMessages()` | inject 已覆盖 |
| `AIController.enqueueMessage()` | inject 部分合并到 inject，analyze 部分由 inject 内部判断触发 |
| `AIController.reassignToGame()` 中的 AI 生命周期调用 | reassignToGame 只关联新 game 对象，不再调 resetForNewGame/onEnterGame |
| `AIManager.onMessageAdded()` | 合并为 `onMessage(msg)` |
| `AIManager.onChatMessageAdded()` | 合并为 `onMessage(msg)` |
| `formatChatMessages()` 在 handleMention 中的调用 | 聊天内容已通过 inject 存入 |

### 6.9 answer 触发方式总览

改造后 answer 的所有触发方式、与 inject 的关系、callback 取值：

| # | 触发方式 | 驱动类型 | action | inject 关系 | callback | 说明 |
|---|---------|---------|--------|------------|----------|------|
| 1 | 发言 | 请求驱动 | DAY_DISCUSS / LAST_WORDS / SHERIFF_SPEECH / NIGHT_WEREWOLF_DISCUSS | answer 执行前 flush 已有 pendingInject（内容来自之前的 message:added inject） | resolve | PhaseManager 串行调用，必须返回发言内容 |
| 2 | 投票 | 请求驱动 | DAY_VOTE / SHERIFF_VOTE / POST_VOTE | 同上 | resolve | PhaseManager 并发调用，Promise.all 等全部结果 |
| 3 | 技能 | 请求驱动 | SEER / WITCH / GUARD / HUNTER / CUPID / SHOOT / PASS_BADGE / ASSIGN_ORDER / SHERIFF_CAMPAIGN / WITHDRAW | 同上 | resolve | PhaseManager 调用，必须返回技能目标 |
| 4 | 发言分析 | 事件驱动 | analyze | inject 与 answer 是两个独立队列项：inject 先入队（存 speech 内容），answer 后入队 | null | speech 触发的 onMessage 里 inject + enqueue answer(analyze)，AI 不需要回复 server |
| 5 | @提及回应 | 事件驱动 | CHAT (mentioned) | inject 与 answer 是两个独立队列项：inject 先入队（存聊天内容），answer 后入队 | 推送函数 | AI 回复通过 callback 广播为聊天消息，server 不等 |
| 6 | 赛后复盘 | 事件驱动 | CHAT (game_over) | game_over 消息通过 onMessage 自动 inject（含胜负结果 + 所有玩家角色信息），onGameOver 入队 answer | 推送函数 | AI 回复通过 callback 广播，server 不等；队列后续执行 action(updateSystem, chat) + compact(chat) |

**请求驱动 vs 事件驱动的关键区别**：

- 请求驱动（1-3）：PhaseManager 主动调用 controller 方法，answer 是唯一入队的队列项。内容已通过之前的 message:added 事件 inject 入队，answer 执行时 flush pendingInject 即可看到所有新消息。callback=resolve，server 必须等结果。
- 事件驱动（4-6）：onMessage 或 onGameOver 触发，answer 是唯一入队的队列项。内容已通过 message:added 事件 inject 入队，answer 执行时 flush pendingInject 即可看到所有新消息。callback 不是 resolve，server 不等。

**callback 取值语义**：

| callback 值 | 含义 | 使用场景 |
|-------------|------|---------|
| resolve | Promise 的 resolve 函数，answer 完成后 resolve 结果，server await 此 Promise | 发言、投票、技能——游戏流程必须等 AI 决策结果 |
| 推送函数 | answer 完成后调用此函数将结果广播为聊天消息，server 不 await | @提及回应、赛后复盘——AI 产生的聊天内容需广播给其他玩家 |
| null | answer 完成后无后续动作，AI 输出仅影响自身上下文 | 发言分析——分析结果留在 mm.messages 中供后续决策参考 |

### 6.10 改造顺序

基础改造按依赖顺序执行，每步可独立验证：

1. **MessageManager 缓冲区**：新增 `pendingInject`、`inject()`、`flush()`，暂不删除旧方法，两套并存
2. **Agent processQueue**：新增 inject 类型处理，answer 改为先 flush 再调 LLM
3. **compact 改造**：替换 compress 为 compact，在原对话流中执行
4. **消除水位线**：删除 `lastProcessedId`、`lastChatMessageId`、`formatIncomingMessages`、`resetWatermark`，inject 替代
5. **AIController 层补齐**：新增 `onEnterGame`、`onGameOver`、`inject(msg)`，统一事件驱动入口
6. **AIManager 简化**：`onMessageAdded` 和 `onChatMessageAdded` 合并为 `onMessage(msg)`，遍历 controller 调 inject
7. **ServerCore 解耦**：删除直接访问 agent 的代码，改为通过 AIController
8. **Bug 修复**：B1-B7
9. **清理**：删除旧方法、旧属性

## 七、目标架构

### 组件职责

**MessageManager**：纯数据层，只管存储和缓冲，不做业务判断。

| 方法 | 职责 |
|------|------|
| `inject(text)` | 追加文本到 pendingInject 缓冲区 |
| `flush()` | 缓冲区合并为一条 user 消息写入 messages |
| `compact(mode)` | 在原对话流中压缩：flush → 追加 user 请求 → LLM 摘要 → 删旧消息 |
| `buildLLMView(ephemeral)` | 从 messages 构建完整 LLM 视图，末尾注入 ephemeral 内容 |
| `updateSystem(player, game, mode)` | 替换 system 消息 |
| `destroy()` | 重置 messages + pendingInject + _currentMode |

MessageManager 不知道队列、不知道场景、不知道 token 检查。compact 只接收 mode 参数决定 user 请求内容，不知道是谁触发的。

**Agent**：队列执行器和 LLM 调用器。

| 方法 | 职责 |
|------|------|
| `enqueue(item)` | 入队 inject/answer/compact/action |
| `processQueue` | 串行处理四种队列项，无嵌套 await |
| `_checkTokenAndCompact()` | inject 后 eager token 检查，超限则 enqueue compact |

Agent 不知道游戏逻辑、不知道消息来源、不知道可见性。它只执行队列项：inject 写缓冲区，answer 调 LLM，compact 压缩，action 调同步函数。

**AIController**：业务决策层，决定"什么时候做什么"。

| 方法 | 触发方 | 职责 |
|------|--------|------|
| `inject(msg)` | AIManager.onMessage | 可见性过滤 + 提取文本 + enqueue inject + 判断后续（speech→analyze，@提及→answer） |
| `getSpeechResult()` | PhaseManager | enqueue answer(callback=resolve) |
| `getVoteResult()` | PhaseManager | enqueue answer(callback=resolve) |
| `useSkill()` | PhaseManager | enqueue answer(callback=resolve) |
| `onEnterGame()` | ServerCore.startGame | drain + enqueue compact(chat) |
| `onGameOver(game)` | ServerCore._exitGameForAllAI | drain + enqueue answer + action + compact |
| `updateSystemMessage()` | ServerCore.onAfterAssignRoles | 调 mm.updateSystem(game) |

AIController 是唯一知道"游戏规则"的层：什么消息要分析、什么消息要回应、什么时候压缩、什么时候切换身份。

**AIManager**：分发器，无业务逻辑。

| 方法 | 职责 |
|------|------|
| `onMessage(msg)` | 遍历 controller，调 inject(msg) |

**ServerCore**：调度器，只管"什么时候通知谁"。

ServerCore 只调 AIController 的公共方法和 AIManager 的分发方法，不访问 agent 内部。生命周期通知通过 `onEnterGame`/`onGameOver`，消息通知通过 `onMessage`，角色分配后通过 `updateSystemMessage`。

### 数据流

```
游戏消息                        聊天消息
  │                               │
  ▼                               ▼
game.message.add()           handleChat()
  │                               │
  │ emit message:added            │ 调 AIManager.onMessage(msg)
  ▼                               ▼
AIManager.onMessage(msg) ◄───────┘
  │
  ▼
controller.inject(msg)
  ├─ 可见性过滤
  ├─ 提取文本 → agent.enqueue({type:'inject', text})
  └─ 判断后续
       ├─ speech → enqueue answer(analyze, callback=null)
       └─ @自己 → enqueue answer(CHAT, mentioned, callback=推送)

PhaseManager 调用
  │
  ▼
controller.getSpeechResult / getVoteResult / useSkill
  └─ agent.enqueue({type:'answer', context, callback:resolve})
```

### 队列处理

```
processQueue 串行执行：

inject → mm.inject(text) → token 检查 → 超限则 enqueue compact
answer → mm.flush() → buildLLMView(ephemeral) → LLM → push assistant → callback(result)
compact → mm.flush() → mm.compact(mode)
action → 执行同步函数（如 updateSystem）
```

四种队列项平级，无嵌套 await，B1 死锁不可能发生。

### mm.messages 结构

改造前：
```
[system, user:{【之前压缩摘要】...}, user:{消息+任务}, assistant:{回复}, ...]
```

改造后：
```
[system, user:{总结请求}, assistant:{摘要}, user:{flush后的消息}, assistant:{回复}, ...]
```

变化：
- 压缩产出是 user+assistant 对，语义连贯
- 不再有 `【之前压缩摘要】` 单条 user 块
- 不再有水位线过滤的增量拼接，所有内容通过 inject 逐条进入、flush 合并
- ephemeral 内容（CURRENT_TASK、thinking、speaking）仅存在于 buildLLMView 返回的视图，不写入 messages

### 生命周期流程

**首次进游戏**：`startGame` → `onEnterGame()` → drain + compact(chat) → `assignRoles` → `onAfterAssignRoles` → `updateSystemMessage(game)`

**游戏进行中**：消息通过 `onMessage` → `inject` 实时进入，决策通过 PhaseManager → answer 执行

**游戏结束**：game_over 消息 → `onMessage` 自动 inject（含胜负结果 + 所有玩家角色信息）→ `_exitGameForAllAI` → `onGameOver(game)` → drain + answer(game_over, callback=推送) + action(updateSystem, chat) + compact(chat)

**重开新局**：`handleReset` → `reassignToGame`（只关联新 game 对象）→ `startGame` → `onEnterGame()` → drain + compact(chat) → `assignRoles` → `onAfterAssignRoles` → `updateSystemMessage(game)`

**聊天阶段**：每条聊天消息通过 `handleChat` → `onMessage` → inject 实时进入，@提及触发 answer 回应

### 预期效果

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 压缩语义 | `【之前压缩摘要】` 单条 user，像外部注入 | user 请求 + assistant 摘要，对话自然延续 |
| 内容入口 | appendContent、appendTurn、formatIncomingMessages 多条路径 | inject 统一入口 |
| 消息增量 | lastProcessedId/lastChatMessageId 水位线 pull | inject 逐条 push，无水位线 |
| 聊天感知 | 仅 @提及时推送，普通聊天 AI 不知道 | 每条聊天消息实时 inject，AI 有完整上下文 |
| 死锁风险 | answer 内嵌套 await compact，callback 永远不触发（P0） | 队列项平级串行，无嵌套 await |
| 压缩可靠性 | LLM 返回空时静默失败（P3） | 重试一次，仍空则删旧消息 + error 日志 |
| 层级边界 | ServerCore 5 处直接访问 agent 内部（P6） | Server 只调 AIController 公共方法 |
| system prompt 过时 | resetForNewGame 后 role=null 导致 system prompt 过时（P1） | updateSystem(game) 在 assignRoles 后调用，role 已存在 |
| AI 主动说话 | 架构不支持 | inject + answer 正交分离，只需加 shouldRespond 判断即可扩展 |
| callSpeech 空结果 | drain resolve(null) 时 callSpeech 访问 result.content TypeError（B7） | AIController 统一处理 answer 返回 null/undefined |
| 代码复杂度 | 多条内容写入路径、水位线维护、Server 直接操作 agent | 单一入口、无水位线、层级清晰 |