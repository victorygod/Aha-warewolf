# 持久聊天室系统设计

## 1. 当前实现分析

### 1.1 结算页面现状

- 游戏结束时显示 `game_over` 阶段，展示获胜阵营和玩家身份
- 只有一个"返回房间"按钮，无聊天功能
- 无动画效果，无视觉反馈

### 1.2 现有消息机制

- `game.speak(playerId, content, visibility, actionType)` 记录发言到 `game.message`
- `game.message.add()` 触发 `message:added` 事件 → AI 分析 + 前端广播
- `canSpeak(player)` 对死亡玩家返回 false，阻止死亡玩家发言
- `handleSpeak(ws, msg)` 直接调 `game.speak()`，不受游戏阶段限制，但依赖 `game` 对象存在
- 前端 `sendSpeech()` 在有 `currentAction` 时走 `respond()`，否则走 `controller.speak(content)`

### 1.3 现有前端 UI

- `#messages` 区域：统一消息流，已有 `addChatMessage()` 微信聊天气泡样式
- `#speech-input` + `#send-btn`：统一输入框，游戏中发言用
- `#action-section`：操作区域，包含输入框、投票按钮、技能按钮
- `#waiting-room`：等待房间，游戏前显示

### 1.4 房间生命周期

```
waiting → playing (phase loop) → game_over → waiting (reset)
```

- **waiting**: `game` 对象存在但 `phaseManager` 为 null，无游戏逻辑运行
- **playing**: PhaseManager 驱动游戏循环
- **game_over**: `game.winner` 已设置，`phaseManager.running = false`
- **reset**: `handleReset()` 清空消息、重建 AI Controller

**关键发现**: 当前没有任何房间级别的聊天机制。所有消息都存储在 `game.message` 中，游戏重置时清空。

---

## 2. 重新设计：持久聊天室

### 2.1 核心概念

**这不是"赛后讨论"，而是"持久聊天室"。**

聊天室存在于房间级别，独立于游戏生命周期。玩家进入房间就能聊天，游戏结束后也能继续聊天，返回房间后聊天记录仍然保留。AI 始终在聊天室中，可以自由发言。

**聊天室与游戏的关系**:
- **waiting 阶段**: 聊天室是主要交互区域，AI 可以自由聊天
- **playing 阶段**: 聊天室完全隐藏，AI 和人类玩家都不可见、不可用，即使死亡也不可见
- **game_over 阶段**: 聊天室重新激活，AI 获得游戏结果上下文后自由发言
- **reset 后**: 聊天记录保留，新游戏开始时聊天室继续存在

### 2.2 关键设计决策：复用现有输入框和消息区

**聊天消息和游戏消息共用同一个消息显示区域和输入框，不新建独立的聊天室面板。**

现有 UI 已有：
- `#messages` 区域 + `addChatMessage()` 微信聊天气泡样式
- `#speech-input` + `#send-btn` 统一输入框

聊天消息直接追加到 `#messages` 区域，用已有的聊天气泡样式渲染，和游戏中的发言消息样式一致。输入框在 waiting/game_over 阶段发送聊天消息，在 playing 阶段发送游戏发言——同一个输入框，根据阶段切换发送通道。

**不需要**：独立的聊天室 DOM、独立的输入框、独立的 CSS 类。

### 2.3 数据架构

聊天室消息存储在 `ServerCore`，不在 `GameEngine`，跨游戏持久：

- `chatMessages[]`: 房间聊天消息数组
- `chatMessageId`: 聊天消息自增 ID
- `_chatActive`: AI 聊天是否激活
- `_aiChatQueue[]`: AI 聊天队列
- `_aiChatProcessing`: 队列处理锁

聊天消息格式：
- `id`: 自增 ID
- `type`: 固定为 `'chat'`，区别于游戏内 `'speech'`
- `playerId`: 发送者 ID
- `playerName`: 发送者名称
- `content`: 消息内容
- `isAI`: 是否 AI 发送
- `timestamp`: 时间戳
- `event`: 上下文标记 `'waiting'` / `'game_over'` / `null`

**设计说明**：聊天消息不走 `game.speak()`，因为游戏内的 `canSpeak()` 对死亡玩家返回 false，赛后讨论需要死亡玩家也能发言。聊天消息独立于游戏的消息系统，不受游戏阶段限制。

### 2.4 WebSocket 协议

新增消息类型：

| 方向 | 类型 | 说明 |
|------|------|------|
| 客户端→服务端 | `chat` | 房间聊天消息 |
| 服务端→客户端 | `chat` | 广播聊天消息 |
| 服务端→客户端 | `chat_history` | 加入时发送历史消息 |

`handleChat(ws, msg)` 处理逻辑：
- 校验客户端信息
- playing 阶段直接 return，不处理
- 构建聊天消息对象，推入 `chatMessages`，广播给所有客户端
- 触发 AI @提及回应

**设计说明**：playing 阶段不处理聊天消息，因为游戏内的发言机制已经足够，聊天室在游戏中完全隐藏。如果用游戏内的 `message:added` 事件，AI 分析会尝试处理所有消息类型，需要扩展 `shouldAnalyzeMessage()` 支持新的聊天类型。

关键：聊天消息走 `ServerCore` 广播，不走 `game.speak()`。不受 `canSpeak()` 限制，不受游戏重置清空。

### 2.5 前端交互设计

#### 2.5.1 waiting 阶段

```
┌─────────────────────────────────────────────┐
│  🎭 狼人杀                    等待玩家加入    │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─ 等待房间 ─────────────────────────────┐ │
│  │  [预设选择]  [玩家1 ✅] [玩家2 ⏳]     │ │
│  │  [玩家3 ✅] [玩家4 ✅] [+ 添加AI]     │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ── 聊天 ──────────────────────────────     │
│                                             │
│     🎭 3号 银狼                             │
│     大家好！我是银狼，今天想玩预言家         │
│                                             │
│     🎭 5号 月影                             │
│     @银狼 你上次玩预言家被首刀了哈哈        │
│                                             │
│     🎭 1号 你                               │
│     我准备好了，开始吧                       │
│                                             │
│  ┌──────────────────────────────┐ ┌──────┐  │
│  │ 输入消息... (@玩家名 提及AI)  │ │ 发送 │  │
│  └──────────────────────────────┘ └──────┘  │
└─────────────────────────────────────────────┘
```

- 输入框就是现有的 `#speech-input`，发送走 `chat` 通道
- 消息用现有的 `addChatMessage()` 聊天气泡样式渲染，和游戏中发言一致
- 等待房间面板和消息区上下排列

#### 2.5.2 playing 阶段

```
┌─────────────────────────────────────────────┐
│  🌙 第2夜                    你是：预言家    │
├──────┬──────────────────────────┬───────────┤
│ 1号  │                          │  5号      │
│ 存活 │  ── 第2夜 ──             │  死亡     │
│      │                          │           │
│ 2号  │     🎭 3号 银狼          │  6号      │
│ 存活 │     我觉得2号像狼人      │  存活     │
│      │                          │           │
│ 3号  │     🎭 4号 星辰          │  7号      │
│ 存活 │     我同意               │  存活     │
│      │                          │           │
│ 4号  │  ┌──────────────────┐    │  8号      │
│ 存活 │  │ 请选择查验对象    │    │  存活     │
│      │  │ [1号] [2号] [6号] │    │           │
│      │  └──────────────────┘    │           │
└──────┴──────────────────────────┴───────────┘
```

- 聊天消息区域完全隐藏，只显示游戏消息
- 输入框在发言阶段按现有逻辑使用（`respond` 到 `currentAction`）
- 无聊天功能，和现在完全一致

#### 2.5.3 game_over 阶段

```
┌─────────────────────────────────────────────┐
│           🎭 狼人阵营获胜！                   │
│              ✨ 胜利动画 ✨                  │
├─────────────────────────────────────────────┤
│  1号 玩家A  🐺狼人  存活  👑警长             │
│  2号 玩家B  🔮预言家  死亡  ⚔被击杀          │
│  3号 银狼   🐺狼人  存活                     │
│  4号 星辰   💊女巫  存活  💕情侣             │
│  ...                                        │
│           [ 返回房间 ]                       │
├─────────────────────────────────────────────┤
│  ── 聊天 ──────────────────────────────      │
│                                             │
│     🎭 3号 银狼                             │
│     哈哈我赢了！女巫你居然没毒我             │
│                                             │
│     🎭 4号 星辰                             │
│     @银狼 你第一晚就跳预言家，我差点信了     │
│                                             │
│     🎭 2号 玩家B                            │
│     我太冤了，第一晚就被刀了                 │
│                                             │
│  ┌──────────────────────────────┐ ┌──────┐  │
│  │ 输入消息... (@玩家名 提及AI)  │ │ 发送 │  │
│  └──────────────────────────────┘ └──────┘  │
└─────────────────────────────────────────────┘
```

- 结算面板在上方，聊天消息区在下方，自然衔接
- 输入框重新激活，发送走 `chat` 通道
- 消息样式和 waiting 阶段一样，用聊天气泡
- "返回房间"按钮按下后回到 waiting 阶段，聊天记录保留

**设计说明**：game_over 阶段不垄断操作区，而是让结算面板和聊天输入框共存。现有 `updateDefaultAction()` 在 game_over 阶段会替换整个操作区，需要修改为保留输入框。

#### 2.5.4 输入框行为总结

| 阶段 | 输入框状态 | 发送通道 | 消息显示 |
|------|-----------|---------|---------|
| waiting | 启用，placeholder="输入消息..." | `chat` | 聊天气泡 |
| playing（发言阶段） | 启用，placeholder="输入发言内容..." | `respond`（到 currentAction） | 游戏消息气泡 |
| playing（非发言阶段） | 禁用/隐藏 | — | — |
| game_over | 启用，placeholder="输入消息..." | `chat` | 聊天气泡 |

同一个 `#speech-input`，根据阶段切换 placeholder 和发送逻辑。

### 2.6 AI 聊天参与

**核心原则：AI 在聊天室中畅所欲言，不限制发言次数。**

#### 2.6.1 AI 聊天触发时机

- **waiting 阶段**: AI 可以自由聊天，使用社交 prompt
- **game_over 阶段**: AI 收到游戏结束消息后自由发言，使用复盘 prompt
- **playing 阶段**: 聊天室完全隐藏，AI 不参与

#### 2.6.2 游戏结束时的 AI 通知

游戏结束后，不是由 ServerCore 单独构建上下文通知 AI，而是**把游戏结束信息作为一条新消息送入 AI 的消息队列**，和游戏中接收其他消息的机制完全一致：

1. `_checkGameEnd()` 设置 `game.winner` 和 `gameOverInfo` 后，通过 `game.emit('game:over')` 通知 ServerCore
2. ServerCore 收到事件后，为每个 AI（包括存活和已死亡的）构建一条游戏结束消息，内容包含胜负结果、所有玩家身份揭示
3. **已死亡的 AI** 额外需要补充死亡后错过的消息（死亡后到游戏结束期间发生的公开事件），因为死亡 AI 的 `MessageManager` 在死亡后停止了消息消费
4. 这条消息的 `CURRENT_TASK` 设为："如果你有什么想说的，请调用聊天室发言工具发言，支持 @名字"。AI 可以选择发言或跳过（调用 skip 工具）
5. AI 的回应（如果选择发言）通过 `chat:message` 事件发到 ServerCore 广播

**设计说明**：不采用"先判断是否要发言，再生成内容"的两阶段方式，因为每个 AI 调一次 LLM 判断"是否要发言"，再调一次生成内容，8 个 AI 至少 8 次额外调用，多数可能返回"不发言"。让 AI 自行决定是否发言，不需要预判调用。

这样做的优势：
- **存活 AI** 只是多接收了一条消息，和游戏中接收其他玩家发言的体验完全一致，不需要特殊的"通知"机制
- **死亡 AI** 通过补充错过的消息，也能完整理解游戏走向
- AI 是否发言由 LLM 自己决定，不需要额外的判断调用

#### 2.6.3 AIController 扩展

只在 `AIController` 中新增 `sendChatMessage(context)` 方法，遵循 Controller 调度 → Agent 思考的分层：
- 构建 `chatContext`（包含事件类型、游戏结果、@提及信息等）
- 调用 `agent.enqueue({ type: 'answer', context })` 获取发言内容
- 生成的聊天消息发送到 ServerCore 广播（ServerCore 在创建 GameEngine 时绑定事件监听，接收 `chat:message` 事件）
- 消息发送成功后压缩上下文

**设计说明**：不在 Agent 里直接处理消息发送，避免违反分层原则。Agent 只负责生成内容，实际发送由 Controller 处理。ServerCore 通过监听 GameEngine 的事件来接收 AI 发送的聊天消息。

#### 2.6.4 @提及与 AI 回应

- 从聊天内容中用正则提取 `@(\S+)` 匹配玩家名
- 匹配到 AI 玩家则入队 `_aiChatQueue`
- 队列串行处理，同一时刻只有一个 AI 在思考，每条消息前随机延迟 0-2 秒
- **AI 发的消息中的 @不触发递归回应**，防止 ping-pong 死循环
- playing 阶段不处理任何 @提及

**设计说明**：不靠"每个 AI 最多 3 次"限制来控制循环，因为 ping-pong 场景下不够。靠串行队列 + AI 消息不触发递归来根本防止死循环。

### 2.7 AI 上下文生命周期管理

AI 不会强制清空上下文，聊天室的聊天记录会保留在 AI 的上下文中。需要在关键时机触发压缩，避免上下文膨胀：

**聊天室发言的上下文保留策略**：
- AI 自己的聊天发言，只保留最终成功的那次 tool 调用（assistant 消息 + tool result），和游戏中发言的保留策略一致
- 其他玩家的聊天消息作为普通用户消息进入上下文
- 当上下文总长度超过阈值时，触发后台压缩（和游戏中压缩机制一致）

**关键压缩时机**：

| 时机 | 原因 | 处理 |
|------|------|------|
| 聊天消息发送成功后 | 和游戏中发言后一样，发言完成即压缩 | `agent.enqueue({ type: 'compress' })` |
| 上下文超过阈值 | 聊天消息积累导致上下文过长 | 后台消息队列自动触发压缩 |
| 进入游戏时 | 如果 AI 上下文里有聊天室的聊天记录，游戏开始前需要压缩掉 | 游戏开始时检查，有聊天记录则立即触发压缩 |
| 游戏结束时 | AI 会 review 整局游戏，review 完立即压缩 | 游戏结束消息处理完后触发压缩 |

进入游戏时的压缩很重要：waiting 阶段的闲聊对游戏没有信息价值，如果不压缩掉，会浪费 token 并可能干扰 AI 的游戏决策。

### 2.8 全 AI 游戏的启动控制

当房间内所有玩家都是 AI 时，返回房间后 AI 会自动准备（`ready: true`），导致游戏立即自动开始，观战席上的人类玩家没有机会参与。

**解决方案**：全 AI 游戏返回房间后，不自动开始。向所有已连接的玩家（观战席上）弹窗询问"是否开始新游戏？"，任意一个玩家点击"开始"即开始游戏。

具体逻辑：
- `handleReset()` 中，如果所有玩家都已 ready（全 AI 场景），不调用 `_checkAndStartGame()`
- 改为广播一个 `game_ready` 消息给所有客户端
- 前端收到 `game_ready` 后显示"开始游戏"按钮或弹窗
- 任意玩家点击后发送 `start_game` 消息，服务端调用 `startGame()`
- 如果没有人类玩家在线，则自动开始（纯 AI 观战场景）

### 2.9 游戏结束流程修改

在 `_checkGameEnd()` 中，设置 `this.running = false` 之后，通过 `game.emit('game:over')` 通知 ServerCore。ServerCore 监听此事件，为每个 AI 构建游戏结束消息并入队。

**设计说明**：不在 game_over 阶段启动赛后讨论，因为 PhaseManager 主循环靠 `this.running` 决定是否继续，设了 false 后循环直接退出。聊天室是房间级别的机制，不依赖游戏阶段系统，用事件驱动更灵活。

不新增 PHASE 常量。只新增 `ACTION.CHAT` 常量。

### 2.10 游戏重置处理

`handleReset()` 保留 `chatMessages` 数组。重置后回到 waiting 阶段，聊天记录仍在，AI 可以继续聊天。

全 AI 场景下，`handleReset()` 检测到所有玩家都已 ready 时，不调用 `_checkAndStartGame()`，改为广播 `game_ready` 消息让观战玩家决定是否开始（见 2.8）。

**设计说明**：游戏重置时不能清空消息和重建 AI Controller，否则进行中的 AI 发言 Promise 会被丢弃。保留聊天记录，新游戏开始时聊天室继续存在。

### 2.11 Agent 提示词

在 `CURRENT_TASK` 中新增 `ACTION.CHAT` 条目，根据 `chatContext` 中的 `event` 字段区分三种 prompt：

- **game_over**: 包含胜负结果、所有玩家身份揭示，prompt 为"如果你有什么想说的，请调用聊天室发言工具发言，支持 @名字"
- **mentioned**: 被其他玩家 @了，包含提及者和内容，鼓励回应
- **waiting**: 无游戏信息，纯社交，打招呼、讨论角色偏好

工具注册复用 `createDiscussTool` 模式，注册 `ACTION.CHAT`。`isSpeech()` 函数加入 `ACTION.CHAT`。

### 2.12 常量新增

`engine/constants.js` 新增 `ACTION.CHAT = 'action_chat'`。

不需要新增 PHASE 或 MSG 常量。聊天消息类型为 `'chat'`，由 ServerCore 管理，不走 `game.message`。

---

## 3. 前端实现要点

### 3.1 消息渲染

聊天消息直接用现有的 `addChatMessage()` 渲染到 `#messages` 区域，和游戏中的发言消息样式完全一致。不需要新的 DOM 结构或 CSS 类。

聊天消息和游戏消息的区别：
- 聊天消息通过 `controller.on('chat_message')` 事件接收，游戏消息通过 `controller.on('state')` 接收
- 聊天消息的 `type` 为 `'chat'`，渲染时可以加一个小的上下文标签（如"等待中"或"赛后"）来区分
- 游戏消息和聊天消息在同一个消息流中按时间顺序混合显示

### 3.2 输入框切换

同一个 `#speech-input`，根据阶段切换行为：

- **waiting / game_over**: placeholder 改为"输入消息..."，`sendSpeech()` 走 `controller.sendChat(content)` 通道
- **playing（有 currentAction）**: placeholder 改为"输入发言内容..."，走现有 `controller.respond()` 通道
- **playing（无 currentAction）**: 输入框禁用/隐藏，和现在一致

在 `updateUI()` 或 `updateDefaultAction()` 中根据 `state.phase` 切换输入框的 placeholder 和发送逻辑。

### 3.3 阶段切换时消息区清理

- **waiting → playing**: 不清空消息区，但隐藏聊天输入框。游戏消息会继续追加到消息区。AI 进入游戏时压缩掉聊天记录上下文。
- **playing → game_over**: 保留游戏消息，追加一个"游戏结束"分割线，然后聊天消息继续追加。
- **game_over → waiting（reset）**: 保留所有消息（游戏消息 + 聊天消息），聊天输入框继续可用。

### 3.4 加入房间时加载历史

新玩家加入时，服务端发送 `chat_history` 消息，包含 `chatMessages` 数组。前端收到后批量渲染到消息区。

### 3.5 全 AI 游戏的启动弹窗

当收到 `game_ready` 消息时，前端显示一个弹窗或按钮：

- 弹窗内容："所有玩家已就绪，是否开始游戏？"
- 按钮："开始游戏"
- 任意玩家点击后发送 `start_game` 消息
- 如果观战席无人，服务端自动开始

### 3.6 结算页面改进

游戏结束时，结算面板在消息区上方显示（或作为消息区的一条特殊消息），聊天消息继续在下方追加。输入框重新激活。

动画效果：
- 获胜阵营标识从屏幕中央放大淡入
- 身份牌逐张翻转效果（CSS 3D transform）
- 存活/死亡状态用颜色/图标区分
- 翻牌动画结束后，消息区自动滚动到底部

---

## 4. 实现优先级

### Phase 1: 聊天室基础框架
- [ ] ServerCore 新增 `chatMessages`、`chatMessageId`、聊天队列属性
- [ ] 新增 `handleChat()` 处理 `chat` WebSocket 消息
- [ ] 新增 `chat` 和 `chat_history` 消息类型
- [ ] 加入房间时发送聊天历史 `chat_history`
- [ ] 前端 controller.js 新增 `sendChat()`（人类玩家发送聊天）和聊天事件监听
- [ ] 前端 app.js 用现有 `addChatMessage()` 渲染聊天消息到 `#messages`
- [ ] 前端输入框根据阶段切换 placeholder 和发送通道
- [ ] `handleReset()` 保留 `chatMessages`

### Phase 2: 人类玩家聊天
- [ ] waiting 阶段输入框启用，发送走 `chat` 通道
- [ ] game_over 阶段输入框启用，发送走 `chat` 通道
- [ ] playing 阶段输入框行为不变（现有游戏发言逻辑）
- [ ] @提及前端高亮渲染
- [ ] 观战玩家（未加入游戏的玩家）也能在 waiting/game_over 阶段发送聊天消息

### Phase 3: AI 聊天参与
- [ ] `engine/constants.js` 新增 `ACTION.CHAT`
- [ ] `ai/agent/tools.js` 注册 `action_chat` 工具
- [ ] `ai/agent/prompt.js` 新增 `CURRENT_TASK[ACTION.CHAT]`
- [ ] `AIController` 新增 `sendChatMessage()` 和 `_buildChatContext()`
- [ ] ServerCore 新增 `_startAIChat()`、`_triggerAIPostGameChat()`、`_handleChatMentions()`
- [ ] ServerCore 监听 `game:over` 事件，为每个 AI 构建游戏结束消息并入队
- [ ] ServerCore 新增 `_enqueueAIChat()` 和 `_processAIChatQueue()` 串行队列
- [ ] AI 聊天消息通过 `chat:message` 事件发送到 ServerCore

### Phase 4: AI 上下文管理
- [ ] 聊天发言后触发压缩（和游戏中发言一致）
- [ ] 上下文超阈值时后台自动压缩
- [ ] 进入游戏时检查 AI 上下文，有聊天记录则立即触发压缩
- [ ] 游戏结束消息处理完后触发压缩
- [ ] 死亡 AI 收到游戏结束消息前，补充死亡后错过的公开消息

### Phase 5: 全 AI 游戏启动控制
- [ ] `handleReset()` 中全 AI 场景不自动开始
- [ ] 广播 `game_ready` 消息给所有客户端
- [ ] 前端显示"开始游戏"弹窗/按钮
- [ ] 新增 `start_game` WebSocket 消息类型
- [ ] 无人类玩家在线时自动开始

### Phase 6: 结算页面视觉改进
- [ ] 结算面板作为特殊消息渲染到消息区上方
- [ ] 身份翻牌动画和获胜动画
- [ ] 翻牌结束后消息区自动滚动到底部

### Phase 7: waiting 阶段 AI 闲聊
- [ ] AI 在 waiting 阶段可以主动发起聊天
- [ ] waiting 阶段 AI 聊天上下文（无游戏信息，纯社交）
- [ ] AI 互相打招呼、讨论角色偏好等轻量交互

---

## 5. 技术难点和解决方案

### 5.1 聊天消息与游戏消息的区分

聊天消息存储在 `ServerCore.chatMessages`，游戏消息存储在 `GameEngine.message`。两套系统互不干扰：
- 聊天消息类型为 `'chat'`，不走 `game.message.add()`，不触发 `message:added` 事件
- 聊天消息不受 `canSpeak()` 限制，不受游戏重置清空
- 前端同一个 `#messages` 区域渲染两种消息，用消息的 `type` 字段区分样式

### 5.2 playing 阶段聊天室完全隐藏

playing 阶段聊天室完全隐藏，AI 和人类玩家都不可见、不可用：
- 后端 `handleChat()` 在 playing 阶段直接 return，不处理任何聊天消息
- 后端 `_handleChatMentions()` 在 playing 阶段直接 return
- 前端输入框在 playing 阶段保持现有游戏发言逻辑，不切换到 chat 通道
- 前端不渲染 `chat` 类型的消息（playing 期间也不会收到）

### 5.3 AI 上下文管理

AI 不会强制清空上下文，聊天记录会保留。关键策略：

- **聊天发言保留**：只保留最终成功的 tool 调用（assistant + tool result），和游戏中发言一致
- **超阈值压缩**：上下文总长度超过阈值时，后台消息队列自动触发压缩
- **进游戏压缩**：waiting 阶段的聊天对游戏没有信息价值，游戏开始时如果 AI 上下文里有聊天记录，立即触发压缩
- **游戏结束压缩**：AI review 完游戏结果后立即压缩
- **死亡 AI 补消息**：死亡 AI 在收到游戏结束消息前，把死亡后到游戏结束期间的公开消息补充到上下文，确保能理解完整局势

### 5.4 并发控制

- `_aiChatQueue` 串行队列，同一时刻只有一个 AI 在思考
- 每条消息处理前加随机延迟 0-2 秒
- @提及不会递归触发：AI 发的消息不触发 @回应（检查 `msg.isAI`）
- 不限制 AI 发言次数，AI 畅所欲言

### 5.5 聊天记录持久化

- `chatMessages` 存储在 `ServerCore` 而非 `GameEngine`
- soft reset（游戏结束后返回房间）：聊天记录完全保留
- hard reset：保留最近 N 条
- 新玩家加入时发送 `chat_history`，确保能看到之前的聊天

### 5.6 @提及实现

- 正则提取 `@(\S+)` 匹配玩家名
- `_findAIControllerByName()` 在 `game.players` 中查找匹配的 AI
- playing 阶段不触发 @提及
- AI 回应中包含 @会递归触发，即AI可以互相@进行对话

### 5.7 全 AI 游戏启动

- `handleReset()` 检测所有玩家是否都已 ready（全 AI 场景），如果是则不自动开始
- 广播 `game_ready` 消息，前端弹窗让观战玩家决定是否开始
- 新增 `start_game` WebSocket 消息类型，服务端收到后调用 `startGame()`
- 如果没有人类玩家在线（纯 AI 观战），服务端自动开始

---

## 6. 设计决策（已确认）

1. **聊天室独立于游戏**: 聊天室是房间级别功能，存储在 `ServerCore`，不受游戏生命周期影响。游戏重置不清空聊天记录。

2. **消息通道分离**: 聊天消息用 `chat` 类型，走 `ServerCore` 广播；游戏消息用 `speech` 类型，走 `game.message`。两套系统互不干扰。

3. **复用现有 UI**: 聊天消息和游戏消息共用 `#messages` 区域和 `#speech-input` 输入框，用 `addChatMessage()` 渲染。不新建独立的聊天室面板。根据阶段切换输入框的 placeholder 和发送通道。

4. **AI 畅所欲言**: 不限制 AI 发言次数。防死循环靠串行队列 + @提及不递归触发，不靠次数限制。

5. **playing 阶段聊天室完全隐藏**: AI 和人类玩家都不可见、不可用，即使死亡也不可见。waiting 和 game_over 阶段聊天室正常显示。

6. **游戏结束消息走现有 AI 消息队列**: 不新建"通知"机制，把游戏结束信息作为一条新消息送入 AI 的消息队列。存活 AI 只是多接收一条消息，死亡 AI 额外补充错过的消息。AI 自行决定是否发言，不需要额外判断调用。

7. **AI 上下文不强制清空**: 聊天记录保留在上下文中，通过关键时机压缩（发言后、超阈值、进游戏、游戏结束）控制上下文长度。

8. **全 AI 游戏不自动开始**: 返回房间后弹窗让观战玩家决定，任意玩家点击即开始。无人类在线时自动开始。

9. **复用现有机制**: AI 聊天复用 `agent.enqueue()` + `createDiscussTool()` 模式，不新建独立 Agent。提示词通过 `CURRENT_TASK[ACTION.CHAT]` 注入。

10. **动画优先级**: 结算页面采用 2D 翻牌 + 逐个揭示，节奏感优先于华丽度。翻牌结束后消息区自动滚动到底部。