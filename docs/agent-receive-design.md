# Agent Receive 重构设计

## 理念

### Agent 自己的事情由 Agent 自己决定

Agent 收到消息后该做什么——分析、回复、忽略——应该由 Agent 自己判断，而不是由 Controller 替它决定。Controller 只负责把消息递给 Agent，Agent 自己决定要不要行动。

### Agent 和人类功能范围接近

人类玩家通过 `requestAction` 接收游戏指令，AI 通过 `receive()` 接收消息。两者功能范围接近（都能发言、投票、用技能），但实现方式不同。

**对外接口保留**：`getSpeechResult()` / `getVoteResult()` / `useSkill()` 作为 Controller 的对外接口，内部调用 `receive()`。

### 可见性不是 Agent 的事

人类不做可见性过滤——服务端只推送他能看到的消息。AI 也应该一样。删除 Controller 中的 `_isMessageVisible()` 逻辑，由 MessageManager 统一过滤。

### 阻塞与非阻塞

阻塞是游戏层的事，不是 Agent 的事。Agent 只管处理消息、返回结果，不知道也不需要知道调用方是 `await` 还是 fire-and-forget。

## 设计理念

我们应该把决策都放到agent里，agent去receive外界的信息。
游戏进行到什么状态了，轮到我投票/发言/用技能了嘛？谁说了什么话？游戏开始/结束？这些都是应该server传了信息以后，agent自己决定应该做啥。server传完了就不管了，除了少数游戏阶段server需要等agent回复才能执行下一步以外，server的作用就是一个通知的角色。
所以agent会receive 所有的server发来的消息，作为外界输入的唯一入口，不再接受任何其他更改调用。
receive的对象内会包含所有agent该知道的消息，就像人类前端，包含本条消息、游戏当前可看信息、聊天室里有谁等等，（人类的每条消息可能会包含所有的消息历史，这是因为前端每次更新都需要渲染所有的消息历史，但agent则不需要，所以agent应该不用所有的消息历史）
receive收到消息对象后，会立刻进行解析，判断这条消息应该怎么处理，比如是直接enqueue，还是enqueue前/后紧接着enqueue一个compact（比如day_vote/game start/game over等），还是别的什么需要在enqueue前做的事情，都在解析这步做。

然后agent内部会持续process这个队列，顺序串行消费，就像现在这样。不同的消息可能需要不同的处理方式，有的是answer，有的是analyze，有的是inject普通消息，有的是chat mention，有的是compact。对这些不同种类的消息的分类和处理其实就是一个轻量级的rule base的决策机制，相当于固定了agent应该采用哪种策略处理对应种类的消息。
也就是说这个rule base的决策机制将agent receive到的消息预先做了分类和目标定义，然后交给后面的agent loop处理。
由此我们可以整理一下agent都会处理哪些消息？有没有什么比现在的分类或方案更好的处理方式？
比如answer和chat mention其实都是必须回答，他们其实都是同一种处理对吧？analyze其实就是不会产生tool调用的answer，是否完全可以把他们都合并？是否依然可以用一套简单的agent loop进行处理。

确保agent对外界唯一的输出就是agent loop的产出。

## 消息结构设计

### 1. buildContext 调整

现有 `buildContext()` 产出的内容：
- **去掉 `messages` 字段**（Agent 内部自行维护消息历史）
- **增加 `preset` 字段**（用于 `updateSystemMessage` 构建规则、策略）

返回结构：
```javascript
{
  phase, players, alivePlayers, self, dayCount,
  werewolfTarget, witchPotion,
  preset,      // 新增：板子预设（用于 system prompt 构建规则、策略）
  winner,      // 新增：游戏胜者（用于判断是否已结束）
  phaseManagerRunning,  // 新增：游戏是否在进行中（用于聊天@回复判断）
  action, extraData
}
```

**注**：
- `context` 只包含必要字段，不包含整个 `game` 对象
- `updateSystemMessage(context, mode)` 从 `context` 中提取所需信息（`self`、`players`、`preset` 等）
- **需要修改 `agent.js` 的 `updateSystemMessage` 方法签名**：从 `(player, game, mode)` 改为 `(context, mode)`
- `buildContext` **不关注 `msg`**，只构建游戏状态；`msg` 的特定信息（如 `mentioner`）由派生逻辑显式构造到 `extraData` 中
- `context.messages` **已被移除**，Agent 内部通过 `MessageManager` 自行维护消息历史

### 2. receive 入参结构

```javascript
receive({ msg, context }) -> Promise<result | null>
```

- `msg`: 普通消息时为 `{type, playerId, content}`，决策请求时为 `null`
- `context`: 由 Controller 调用 `buildContext()` 构建后传入

### 3. 使用场景

| 场景 | msg | context.action |
|------|-----|----------------|
| 普通消息（他人发言） | `{type: MSG.SPEECH, playerId:2, content:'...'}` | `undefined` / `'inform'` |
| 决策请求（投票/技能） | `null` | `'day_vote'` / `'action_guard'` / ... |
| 聊天消息 | `{type: MSG.CHAT, playerId:2, content:'...'}` | - |

Agent 根据 `msg` 是否为 null 以及 `context.action` 的值，判断如何处理。

**示例**：
```javascript
// 他人发言
receive({
  msg: { type: MSG.SPEECH, playerId: 2, content: '我觉得李四像狼' },
  context: /* buildContext 标准输出（去掉 messages），action 无值 */
})

// 轮到我投票
receive({
  msg: null,
  context: /* buildContext 标准输出（去掉 messages），action: 'day_vote' */
})
// 返回 Promise<{ target: 2 }>
```

## Agent 内部架构

### 派生（Derive）

`receive({msg, context})` 的入口处理逻辑，负责解析消息并派生队列项。

**返回值结构**：
```javascript
{ promise: Promise | null, items: [...] }
```

- `items`：派生的队列项数组，按顺序入队
- `promise`：决策场景返回 Promise，普通消息返回 null

**派生规则**：

| 条件 | 派生结果 | 说明 |
|------|---------|------|
| `msg === null` | `[{type: 'decision', context, resolve}]` + Promise | 决策请求（投票/技能/发言） |
| `msg.type === MSG.GAME_START` | `[_drainDecisionsAndCompacts, compact(赛前), action(切game模式), message]` | 游戏开始，丢弃赛前未完成的决策 |
| `msg.type === MSG.GAME_OVER` | `[_drainDecisionsAndCompacts, action(切chat模式), message, decision(复盘), compact]` | 游戏结束，丢弃游戏内未完成的决策（先切 chat 模式确保 system 消息存在） |
| `msg.type === MSG.SPEECH` && 他人 | `[message, decision(analyze)]` | 他人发言，入队后分析 |
| `msg.type === MSG.SPEECH` && 自己 | `[]` | 自己发的，丢弃 |
| `msg.type === MSG.CHAT` && 被@ | `[message, decision(chat回复)]` | 聊天提及，分析后回复 |
| `msg.type === MSG.CHAT` && 自己 | `[]` | 自己发的，丢弃 |
| `msg.type === MSG.CHAT` | `[message]` | 普通聊天 |
| 其他（如 `MSG.DEATH_ANNOUNCE`、`MSG.PHASE_START` 等） | `[message]` | 默认入队（`MSG.PHASE_START` 无需特殊处理，作为普通消息入队即可） |

**注**：
- `callback` 用于赛后复盘等异步广播场景。Server 端 fire-and-forget（不等待结果），但 Agent 内部仍会等待 `answer()` 返回后调用 callback
- **整个项目中 `msg.type` 必须使用 `MSG` 常量，禁止直接使用字符串**
- `_drainDecisionsAndCompacts`：丢弃队列中已有的 `decision` 和 `compact` 类型项。**丢弃前必须 `resolve(null)` 所有被丢弃的 decision**，避免调用方永久等待。
- `compact` 模式：新增 `pre_game` 模式，用于赛前讨论压缩，提示词需说明"游戏即将开始"
- **压缩行为不入队**：chat 回复后直接 `await this.mm.compact()`，不通过队列

**chat 类型 prompt 示例**：
```javascript
[ACTION.CHAT]: (_aliveList, context) => {
  const { event, mentioner } = context.extraData?.chatContext || {};
  if (event === 'mentioned') {
    // msg.content 已在上下文（flush 后的历史消息中）
    return `【有人@你】${mentioner} 提到了你。可选回应，调用 action_chat 工具...`;
  }
  if (event === 'game_over') {
    return `【游戏结束】获胜！可选复盘，调用 action_chat 工具...`;
  }
  return `【聊天室】可选发言，调用 action_chat 工具，支持 @名字...`;
};
```

**formatter.js 已有函数**：
```javascript
// 使用现有的 formatChatMessages
function formatMessageToText(msg, selfId) {
  if (msg.type === MSG.CHAT || msg.event === 'chat') {
    if (msg.playerId === selfId && msg.isAI) return null;
    return `${msg.playerName}: ${msg.content}`;
  }
  if (msg.type === MSG.GAME_OVER) {
    return msg.content;
  }
  return msg.content || null;
}
```

**实现示例**：
```javascript
async receive({msg, context}) {
  const {promise, items} = this.derive({msg, context});
  
  // 严格按顺序入队
  for (const item of items) {
    this.enqueue(item);
  }
  
  return promise;
}

derive({msg, context}) {
  // 引入常量：const { MSG, PHASE } = require('../../engine/constants');
  
  // 决策请求
  if (msg === null) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return {
      promise,
      items: [{type: 'decision', context, resolve}]
    };
  }
  
  switch (msg.type) {
    case MSG.GAME_START:
      // 丢弃上状态的 decision 和 compact（赛前未完成的行动和压缩）
      this._drainDecisionsAndCompacts();
      return {
        promise: null,
        items: [
          {type: 'compact', mode: 'pre_game'},  // 压缩赛前讨论，提示词说明即将开始游戏
          {type: 'action', fn: () => this.updateSystemMessage(context, 'game')},
          {type: 'message', msg, context}
        ]
      };
      
    case MSG.GAME_OVER:
      // 丢弃上状态的 decision 和 compact（游戏内未完成的行动和压缩）
      this._drainDecisionsAndCompacts();
      return {
        promise: null,
        items: [
          {type: 'message', msg, context},
          {
            type: 'decision',
            context: {...context, action: 'chat', extraData: {chatContext: {event: 'game_over'}}},
            callback: this.createBroadcastCallback()
          },
          {type: 'action', fn: () => this.updateSystemMessage(context, 'chat')},
          {type: 'compact', mode: 'chat'}
        ]
      };
      
    case MSG.SPEECH:
      // 自己发的、自己已死亡、游戏已结束：不分析
      // 使用 playerId + playerName 双重校验，避免 AI 重新分配时的误判
      if ((msg.playerId === context.self.id && msg.playerName === context.self.name) || !context.self.alive || context.winner) {
        return {promise: null, items: []};
      }
      // 只分析白天公开发言（警长竞选、白天讨论）
      const isDaySpeech = context.phase === PHASE.SHERIFF_SPEECH || context.phase === PHASE.DAY_DISCUSS;
      if (!isDaySpeech) {
        return {promise: null, items: [{type: 'message', msg, context}]};
      }
      return {
        promise: null,
        items: [
          {type: 'message', msg, context},
          {type: 'decision', context: {...context, action: 'analyze'}, resolve: null}
        ]
      };
      
    case MSG.CHAT:
      // 使用 playerId + playerName 双重校验
      if (msg.playerId === context.self.id && msg.playerName === context.self.name) {
        return {promise: null, items: []};
      }
      // 被@且游戏未在进行中（等待中或赛后）才回复
      if (this.isMentioned(msg) && !context.phaseManagerRunning) {
        return {
          promise: null,
          items: [
            {type: 'message', msg, context},
            {
              type: 'decision',
              context: {...context, action: 'chat', extraData: {chatContext: {event: 'mentioned', mentioner: msg.playerName}}},
              callback: this.createBroadcastCallback()
            }
          ]
        };
      }
      return {
        promise: null,
        items: [{type: 'message', msg, context}]
      };
      
    default:
      return {
        promise: null,
        items: [{type: 'message', msg, context}]
      };
  }
}

// 丢弃队列中的 decision 和 compact，并 resolve 所有被丢弃的 decision
_drainDecisionsAndCompacts() {
  const drained = this.requestQueue.filter(
    item => item.type === 'decision' || item.type === 'compact'
  );
  for (const item of drained) {
    if (item.type === 'decision' && item.resolve) {
      item.resolve(null);  // resolve null 表示被丢弃，调用方视为弃权
    }
  }
  this.requestQueue = this.requestQueue.filter(
    item => item.type !== 'decision' && item.type !== 'compact'
  );
}

// 检查是否应该压缩（阈值判断）
_shouldCompact() {
  if (this.mm._currentMode === 'game') return false;
  const messages = this.mm.messages;
  const pendingText = this.mm.pendingInject.join('');
  const totalTokens = estimateTokens(messages) + Math.ceil(pendingText.length / 4);
  return totalTokens > TOKEN_THRESHOLD;
}

// 获取当前可用的模型（优先级：Mock > LLM > Random）
_getModel() {
  return this.mockModel || this.llmModel || this.randomModel;
}

// 注意：所有需要模型的地方都应该调用 _getModel()，包括：
// - processQueue() 中的 compact 处理
// - consume() 中的 compact 处理
// - consume() 中的 chat 回复后压缩
```

### 消费（Consume）

队列串行消费逻辑，标准 Node.js 模式：

```javascript
enqueue(item) {
  this.queue.push(item);
  this.processQueue();  // 触发消费
}

async processQueue() {
  if (this.isProcessing) return;
  this.isProcessing = true;
  
  try {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      await this.consume(item);  // 串行处理
    }
  } finally {
    this.isProcessing = false;
  }
}

async consume(item) {
  switch (item.type) {
    case 'message': 
      // 只加入 pending，不 flush，不 compact
      this.mm.inject(item.msg.content);
      break;
    case 'decision': 
      // 先 flush 之前的消息，再决策
      this.mm.flush();
      const result = await this.answer(item.context);
      item.resolve?.(result);
      item.callback?.(result);
      // chat 模式回复后，立刻进行压缩阈值判断，超限直接压缩
      if (item.context?.action === 'chat' && this.mm._currentMode === 'chat') {
        if (this._shouldCompact()) {
          await this.mm.compact(this._getModel(), 'chat');
        }
      }
      break;
    case 'compact': 
      // 先 flush 再压缩
      this.mm.flush();
      await this.mm.compact(this._getModel(), item.mode || this.mm._currentMode);
      break;
    case 'action':
      // 执行副作用
      if (typeof item.fn === 'function') {
        item.fn();
      }
      break;
  }
}
```

**队列项类型**：
- `message`：分析思考，入队到 messageManager（对应当前的 `inject`）
- `decision`：LLM 决策，返回结果给调用方（对应当前的 `answer`）
- `compact`：消息压缩
- `action`：执行副作用函数

**与当前代码的映射**：
| 当前类型 | 新类型 | 说明 |
|----------|--------|------|
| `inject` | `message` | 普通消息入队 |
| `answer` | `decision` | LLM 决策 |
| `compact` | `compact` | 消息压缩（不变） |
| `action` | `action` | 副作用函数（不变） |

## Controller 与 Agent 职责划分

### Controller 职责（简化后）

Controller 只负责：
1. **构建游戏状态**：`buildContext()` 返回当前游戏状态（phase, players, self, preset, winner, phaseManagerRunning 等）
2. **Promise 包装器**：`getSpeechResult()` / `getVoteResult()` / `useSkill()` 将 Agent 的异步结果包装为 Promise
3. **日志记录**：记录 AI 的决策结果
4. **技能执行**：`useSkill()` 中调用 `executeSkill()` 执行实际技能
5. **游戏事件发送**：`onEnterGame()` / `onGameOver()` 发送 `MSG.GAME_START` / `MSG.GAME_OVER` 消息

**Controller 不再负责**：
- ❌ 消息可见性过滤（由 Server 的 MessageManager 过滤）
- ❌ 消息文本提取（由 `formatter.formatMessageToText()` 处理）
- ❌ 是否分析判断（由 `Agent.derive()` 决定）
- ❌ 是否回复@（由 `Agent.derive()` 决定）
- ❌ @检测逻辑（迁移到 `Agent._isMentioned()`）
- ❌ `updateSystemMessage()`（由 `Agent.derive()` 在状态切换时派生 `action` 项）
- ❌ 发送聊天消息（`sendChatMessage()` 已删除，由 `Agent.derive()` 处理 `MSG.CHAT` 消息）

### Agent 职责（重构后）

Agent 负责所有决策逻辑：
1. **统一入口**：`receive({msg, context})` 接收所有外界输入
2. **消息派生**：`derive({msg, context})` 解析消息，决定入队什么类型的项
3. **队列消费**：`consume(item)` 串行消费队列项
4. **状态清理**：`_drainDecisionsAndCompacts()` 丢弃无效队列项并 resolve Promise

## 调用时机映射

| 场景 | 当前调用方式 | 新设计 | 是否等待 |
|------|-------------|--------|---------|
| 聊天消息 | `AIManager.onMessage(msg)` | `receive({msg: {type: MSG.CHAT}, context})` | ❌ |
| 他人发言 | `message.add(...)` → `onMessage` | `receive({msg: {type: MSG.SPEECH}, context})` | ❌ |
| 游戏开始 | `AIManager.onEnterGame()` | `receive({msg: {type: MSG.GAME_START}, context})` | ❌ |
| 游戏结束 | `AIManager.onGameOver(fn)` | `receive({msg: {type: MSG.GAME_OVER}, context})` | ❌ |
| 阶段变更 | `message.add(PHASE_START)` → `onMessage` | `receive({msg: {type: MSG.PHASE_START}, context})` | ❌ |
| 死亡公告等其他消息 | `message.add(...)` → `onMessage` | `receive({msg: {type: MSG.xxx}, context})` | ❌ |
| 玩家发言 | `game.callSpeech()` → `getSpeechResult()` | Controller 构建 context，调用 `receive({msg: null, context})` | ✅ 顺序等待 |
| 投票 | `game.callVote()` → `getVoteResult()` | Controller 构建 context，调用 `receive({msg: null, context})` | ✅ 并发等待 |
| 技能使用 | `game.callSkill()` → `useSkill()` | Controller 构建 context，调用 `receive({msg: null, context})` | ✅ 顺序等待 |

**注**：
- `MSG.GAME_START` 由 `AIManager.onEnterGame()` 发送（在 `server-core.js` 的 `startGame()` 中调用）
- `MSG.GAME_BRIEF` 需要补充到 `constants.js`
- `server-core.js` 中 `type: 'chat'` 需改为 `MSG.CHAT`

**注**：所有消息类调用（❌）通过 `AIManager.onMessage` 统一分发；所有决策类调用（✅）通过 `PlayerController` 接口直接调用。

---

## 迁移计划

### Phase 1: 在 Agent 实现核心功能

1. 实现 `receive({msg, context})` 统一入口
2. 实现 `derive({msg, context})` 消息派生逻辑
3. 实现 `_drainDecisionsAndCompacts()` 状态清理
4. 实现 `isMentioned(msg)` @检测
5. 实现 `_extractMessageText(msg)` 文本提取（或引用 `formatter.formatMessageToText`）

### Phase 2: Controller 逻辑迁移

**`inject()` 拆分迁移**：
1. 将 `inject()` 中的判断逻辑迁移到 `derive()`
2. 将 `_shouldAnalyzeAfterInject()` 逻辑迁移到 `derive()`
3. 将 `_shouldRespondToMention()` 逻辑迁移到 `derive()`
4. `inject()` 改为调用 `agent.receive({msg, context})`

**`onEnterGame()` / `onGameOver()` 迁移**：
5. `AIManager.onEnterGame()` 改为发送 `MSG.GAME_START` 消息，由 `derive()` 处理
6. `AIManager.onGameOver()` 改为发送 `MSG.GAME_OVER` 消息，由 `derive()` 处理

**删除 Controller 直接调用 agent.enqueue 的方法**：
7. 删除 `Controller.updateSystemMessage()`
8. 删除 `Controller.sendChatMessage()` 中的 `updateSystemMessage()` 调用，改为在 `derive()` 中处理

**决策方法内部调用 `receive()`**：
9. `getSpeechResult()` 内部调用 `receive({msg: null, context})`，包装为 Promise 返回
10. `getVoteResult()` 内部调用 `receive({msg: null, context})`，包装为 Promise 返回
11. `useSkill()` 内部调用 `receive({msg: null, context})`，包装为 Promise 返回

**决策方法保留为对外接口**，不删除。外部调用者继续使用 `getSpeechResult()` 等接口，不需要直接调用 `receive()`。

### Phase 3: 清理与验证

1. 删除 `Controller._isMessageVisible()`（由 Server 过滤）
2. 删除 `Controller._extractMessageText()`
3. 删除 `Controller._shouldAnalyzeAfterInject()`
4. 删除 `Controller._shouldRespondToMention()`
5. 删除 `Controller._isMentioned()`
6. 验证所有测试通过

---

## 完整改动清单

### 代码改动

| 文件 | 改动 | 说明 |
|------|------|------|
| `engine/constants.js` | 补充 `MSG.GAME_BRIEF: 'game_brief'` | 新增常量 |
| `server-core.js` | `type: 'chat'` → `MSG.CHAT` | 统一使用常量 |
| `server-core.js` | `startGame()` 调用 `aiManager.onEnterGame()` 发送 `MSG.GAME_START` | 让 AI 感知游戏开始 |
| `ai/controller.js` | `onEnterGame()` 改为发送 `MSG.GAME_START` 消息 | 与文档设计一致 |
| `ai/controller.js` | `onGameOver()` 改为发送 `MSG.GAME_OVER` 消息 | 与文档设计一致 |
| `ai/controller.js` | `inject()` 改为调用 `agent.receive()` | 统一入口 |
| `ai/controller.js` | 删除 `updateSystemMessage()` 方法 | 由 Agent.derive() 派生 action |
| `ai/controller.js` | 删除 `sendChatMessage()` 方法 | 由 Agent.derive() 派生 decision(chat) |
| `ai/controller.js` | 删除 `shouldAnalyzeMessage()` 方法 | 消息过滤由 Server 负责 |
| `ai/controller.js` | 删除 `_shouldRespondToMention()`, `_isMentioned()` 方法 | 由 Agent.derive() 处理 |
| `ai/controller.js` | `getSpeechResult()` 等决策方法调用 `receive({msg: null, context})` | 统一决策入口 |
| `ai/controller.js` | `remapPlayerIds()` 不再调用 `updateSystemMessage()` | 由 Agent 在下次 receive 时自行更新 |
| `ai/agent/agent.js` | 实现 `receive()` / `derive()` / `consume()` | 核心功能 |
| `ai/agent/agent.js` | 实现 `_drainDecisionsAndCompacts()` | 状态清理 |
| `ai/agent/agent.js` | 实现 `_shouldCompact()` | 阈值判断 |
| `ai/agent/agent.js` | 实现 `_getModel()` | 模型选择（Mock > LLM > Random） |
| `ai/agent/agent.js` | `updateSystemMessage(player, game, mode)` → `updateSystemMessage(context, mode)` | 签名调整 |
| `ai/agent/agent.js` | `processQueue()` 拆分出 `consume(item)` 方法 | 细化队列消费逻辑 |
| `test/unit/ai/ai-integration.test.js` | 删除阵营消息过滤测试 | 由 Server 负责 |
| `test/unit/ai/ai-integration.test.js` | 修改 `updateSystemMessage` 测试 | 使用新的 context 签名 |
| `test/unit/ai/agent-lifecycle.test.js` | 修改 `onEnterGame` 测试 | 测试 _drainDecisionsAndCompacts |
| `test/helpers/server-harness.js` | 修改 `updateSystemMessage` 调用 | 使用新的 context 签名 |

### Controller 直接调用 Agent 的清理清单

**需要收口到 Agent.derive() 的调用**：

| 当前代码位置 | 当前调用 | 改为 |
|-------------|----------|------|
| `inject()` 行 39 | `enqueue({type: 'inject'})` | `receive({msg, context})` |
| `inject()` 行 43 | `enqueue({type: 'answer'})` 分析 | 由 `derive()` 派生 `decision(analyze)` |
| `inject()` 行 48 | `enqueue({type: 'action'})` 切换模式 | 由 `derive()` 派生 `action` |
| `inject()` 行 51 | `enqueue({type: 'answer'})` chat 回复 | 由 `derive()` 派生 `decision(chat)` |
| `onEnterGame()` 行 179-180 | `_drainQueue() + enqueue(compact)` | 发送 `MSG.GAME_START` |
| `onGameOver()` 行 184-188 | `enqueue(answer + action + compact)` | 发送 `MSG.GAME_OVER` |
| `sendChatMessage()` 行 259 | `updateSystemMessage()` | 由 `derive()` 派生 `action` |

**保留的调用（Controller 职责）**：

| 调用 | 说明 |
|------|------|
| `agent.destroy()` | 资源清理 |
| `agent.chatBroadcastFn = fn` | 回调函数设置 |
| `agent.receive()` | 决策方法内部调用 |
| `agent.buildContext()` | 构建游戏状态 |

**注意**：所有 `enqueue()` 调用都应该收口到 `receive()` / `derive()` 中，Controller 不再直接操作队列。决策方法通过调用 `receive({msg: null, context})` 实现。

### 文档已记录的设计要点

- ✅ `_drainDecisionsAndCompacts()` 必须 resolve 所有被丢弃的 decision
- ✅ `msg.playerId` 校验使用双重校验（id + name）
- ✅ 使用 `this.mm._currentMode === 'chat'` 判断 chat 模式
- ✅ `_shouldCompact()` 阈值判断，返回 boolean
- ✅ `mm.compact()` 直接执行压缩，不入队
- ✅ `_getModel()` 获取可用模型（优先级：Mock > LLM > Random）
- ✅ Controller 不再负责消息过滤、文本提取、分析判断
- ✅ Agent 负责所有决策逻辑

### buildLLMView 模板化设计（2026-05-09 更新）

**问题**：原设计用 `ephemeral` 字段同时控制「插入位置」和「是否持久化」，导致 analyze 的 task 被错误地放到原始内容前面。

**解决方案**：`buildCurrentTurn` 返回结构化对象，`buildLLMView` 用固定模板拼接。

#### 返回结构

```javascript
{
  thinking: '【行为逻辑】\n...',  // 空字符串表示无
  speaking: '【说话方式】\n...',  // 空字符串表示无
  task: '【白天发言】...',
  ephemeralTask: true  // analyze 为 true，其他为 false
}
```

#### 固定模板顺序

```
【行为逻辑】thinking
【说话方式】speaking  (如果有)
[原始 user 消息内容]
【任务指令】task
```

#### 代码示例

```javascript
// buildLLMView
buildLLMView(parts) {
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

// 持久化逻辑（agent.js）
const taskToPersist = parts.task && !parts.ephemeralTask ? parts.task : '';
if (taskToPersist) {
  const last = this.mm.messages[this.mm.messages.length - 1];
  if (last?.role === 'user') {
    last.content += '\n' + taskToPersist;  // task 追加到原始内容后
  } else {
    this.mm.messages.push({ role: 'user', content: taskToPersist });
  }
}
```

#### 各场景的 parts 结构与持久化效果

| 场景 | 走 answer() | thinking | speaking | task | ephemeralTask | LLMView 结构 | mm.messages 持久化效果 |
|------|-------------|----------|----------|------|---------------|--------------|---------------------|
| analyze | ✅ | ✅ | '' | ✅ | true | thinking + 原始 + task | 只添加 assistant(分析结果)，task 不持久化 |
| 发言类 (DAY_DISCUSS, SHERIFF_SPEECH, LAST_WORDS, NIGHT_WEREWOLF_DISCUSS) | ✅ | ✅ | ✅ | ✅ | false | thinking + speaking + 原始 + task | 原始 user 后追加 task |
| 投票/技能类 (DAY_VOTE, SEER, GUARD, WITCH, CUPID, SHOOT 等) | ✅ | ✅ | '' | ✅ | false | thinking + 原始 + task | 原始 user 后追加 task |
| 聊天室 (CHAT) | ✅ | ✅ | ✅ | ✅ | false | thinking + speaking + 原始 + task | 原始 user 后追加 task，回复后判断阈值压缩 |
| compact | ❌ | — | — | — | — | 不走 buildLLMView | mm.compact() 内部直接处理，添加 summary request → 获取摘要 → 替换 messages |

**持久化说明**：
- `ephemeralTask: true` → task 只出现在 LLMView 中，不持久化到 mm.messages（analyze）
- `ephemeralTask: false` → task 既出现在 LLMView 中，也持久化到 mm.messages 的最后一条 user 消息后
- `thinking` 和 `speaking` 永远不持久化（只在 LLMView 中作为 persona）
- **compact 不走 answer()**，直接在 consume() 中调用 `mm.compact()` 处理

#### 完整 Action 类型覆盖表

| Action | isSpeech | thinking | speaking | 走 answer() | LLMView 结构 |
|--------|----------|----------|----------|-------------|--------------|
| `analyze` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_day_discuss` | ✅ | ✅ | ✅ | ✅ | thinking + speaking + 原始 + task |
| `action_last_words` | ✅ | ✅ | ✅ | ✅ | thinking + speaking + 原始 + task |
| `action_sheriff_speech` | ✅ | ✅ | ✅ | ✅ | thinking + speaking + 原始 + task |
| `action_night_werewolf_discuss` | ✅ | ✅ | ✅ | ✅ | thinking + speaking + 原始 + task |
| `action_chat` | ✅ | ✅ | ✅ | ✅ | thinking + speaking + 原始 + task |
| `action_day_vote` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_post_vote` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_sheriff_vote` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_night_werewolf_vote` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_seer` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_guard` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_witch` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_cupid` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_shoot` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_sheriff_campaign` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_withdraw` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_assignOrder` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_passBadge` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `action_explode` | ❌ | ✅ | ❌ | ✅ | thinking + 原始 + task |
| `compact` | ❌ | ❌ | ❌ | ❌ | 不走 buildLLMView，直接 mm.compact() |

### prepareLLMView 封装方案（2026-05-09 更新）

**目标**：将 `buildCurrentTurn` + `buildLLMView` + 持久化 三步合并为一个高层方法。

**改造前**（三步分离）：

```javascript
// agent.js
const parts = buildCurrentTurn(context.action, context, context.self);
const llmView = this.mm.buildLLMView(parts);
const taskToPersist = parts.task && !parts.ephemeralTask ? parts.task : '';
if (taskToPersist) {
  // 持久化逻辑...
}
```

**改造后**（一步完成）：

```javascript
// agent.js
const { llmView, persisted } = this.mm.prepareLLMView(
  context.action,
  context,
  context.self
);
```

---

#### MessageManager.prepareLLMView 实现

```javascript
// message_manager.js
const { getCurrentTask, isSpeech } = require('./prompt');

class MessageManager {
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
    const ephemeralTask = action === 'analyze';

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
}
```

---

#### prompt.js 改动

**删除 `buildCurrentTurn` 函数**（逻辑已内联到 `prepareLLMView`）：

```javascript
// 删除以下函数
// function buildCurrentTurn(action, context, self) { ... }
```

**保留的工具函数**：
- `getCurrentTask(action, context)` - 获取各阶段的 task 提示词
- `isSpeech(action)` - 判断是否为发言类动作

---

#### agent.js 改动

**`answer()` 方法简化**：

```javascript
async answer(context) {
  const expectedAction = context.action === 'analyze' ? 'content' : (getTool(context.action) || 'content');
  const isDecision = expectedAction !== 'content';

  // 一步完成：生成提示词 + 构建 LLMView + 持久化
  const { llmView, persisted } = this.mm.prepareLLMView(
    context.action,
    context,
    context.self
  );

  const tools = isDecision ? getToolsForAction(context.action, context) : [];

  const playerName = context.self?.name || 'unknown';
  getLogger().debug(`[Agent] ${playerName} ${isDecision ? '决策' : '分析'} messages count: ${llmView.length}, action=${context.action}`);

  // 使用 llmView 调用 _agentLoop...
}
```

---

#### 优点

| 改造前 | 改造后 |
|--------|--------|
| `answer()` 调用 3 个独立操作 | `answer()` 只调用 1 个方法 |
| `answer()` 知道 `ephemeralTask` 的存在 | `ephemeralTask` 逻辑封装在内部 |
| `mm.messages` 修改在 `answer()` 里 | `mm.messages` 修改封装在 `MessageManager` |
| `buildCurrentTurn` 返回对象需要外部理解结构 | 外部无需知道提示词结构 |
| `prompt.js` + `message_manager.js` + `agent.js` 分散 | 逻辑内聚在 `MessageManager.prepareLLMView` |

---

#### 各场景的提示词生成规则（不变）

| 场景 | thinking | speaking | task | ephemeralTask |
|------|----------|----------|------|---------------|
| analyze | ✅ (有 self.thinking 时) | ❌ | ✅ | true |
| 发言类 (DAY_DISCUSS, CHAT, SHERIFF_SPEECH, LAST_WORDS, NIGHT_WEREWOLF_DISCUSS) | ✅ | ✅ | ✅ | false |
| 投票/技能类 (DAY_VOTE, SEER, GUARD, WITCH, CUPID, SHOOT 等) | ✅ | ❌ | ✅ | false |
| compact | ❌ | ❌ | ✅ | false |