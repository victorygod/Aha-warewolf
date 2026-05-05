# 聊天室 AI 上下文设计

本文档定义聊天室场景下 AI 的上下文结构，与游戏内上下文分离。

---

## 1. 场景区分

| 场景 | 上下文类型 | 说明 |
|------|------------|------|
| waiting 阶段（聊天室） | 聊天室上下文 | 纯聊天，无游戏信息 |
| playing 阶段（游戏内） | 游戏上下文 | 完整的游戏局势 |
| game_over 阶段（复盘） | 聊天室上下文 | 游戏结束后的复盘/闲聊，和 waiting 阶段是同一个上下文 |
| 赛后聊天 | 聊天室上下文 | 和waiting 阶段（聊天室）是同一个阶段 |

---

## 2. 聊天室上下文结构

```
[
  { role: 'system', content: '...' },           // [0] 名字 + backgroundSection
  { role: 'user', content: '...' },           // [1] 历史压缩摘要
  { role: 'user', content: '...' },           // [2] 最新聊天消息 + CURRENT_TASK
]
```

### 2.1 System Prompt

聊天室只包含基本信息，不包含游戏局势：

```
你是卡夫卡。
【背景】
...（profile 的 backgroundSection 内容）
```

### 2.2 历史压缩摘要

格式与游戏内一致：

```
【之前压缩摘要】
第1天：大家互相打招呼，3号比较活跃...
```

### 2.3 最新聊天消息 + CURRENT_TASK

和游戏内发言一样，注入 thinking 和 speaking：

聊天消息来源：从 `extraData.chatContext` 获取（不是 `context.messages`）

格式化方式：`玩家名: 内容`（如 `1号张三: 大家好`）

```
【聊天室】当前在线玩家：1号张三，2号李四，3号卡夫卡（你），4号王五

最新聊天记录：
1号张三: 大家好
4号王五: @卡夫卡 今天怎么样？

【行为逻辑】
你是一个理性而温柔的对话者...

【说话方式】
你喜欢用优雅的语言...

【当前任务】
有人 @了你，是否要回应？你也可以 @其他玩家或发起新话题。不想说话可以跳过。
```

---

## 3. CURRENT_TASK 定义

| 任务类型 | 触发条件 | Prompt |
|----------|----------|--------|
| 自由聊天 | 无人 @AI 且非赛后 | `你可以自由聊天，打招呼、讨论话题、@其他玩家。` |
| 被 @回应 | 其他玩家 @了 AI | `有人 @了你，是否要回应？` |
| 赛后总结 | game_over 阶段 | `游戏结束了，${winner}获胜。你可以自由复盘、讨论本局表现，或闲聊。` |

---

## 4. 压缩机制

### 4.1 压缩时机

- **发言后立即压缩**：每次 AI 发送聊天消息后触发压缩
- **后台自动压缩**：上下文超阈值时自动触发
- **进入游戏时压缩**：waiting 阶段的聊天对游戏无价值，进入游戏前压缩

### 4.2 压缩流程

与游戏内压缩类似，但内容不同：

```
1. _compactHistoryAfterSummary() → 提取待压缩内容
   - 收集从压缩点到当前的聊天消息

2. _findPrevSummary() → 找上次摘要

3. _buildCompressPrompt() → 构建压缩 prompt
   - 身份信息（名字）
   - 上次压缩摘要
   - 新增聊天消息
   - 要求生成 100 字以内的聊天摘要

4. 压缩结果替换 messages
```

### 4.3 压缩后消息替换

压缩后 messages 完整替换为：

```
[
  { role: 'system', content: '...' },           // 名字 + backgroundSection
  { role: 'user', content: '【之前压缩摘要】\n...' }  // 新摘要替换掉所有历史
]
```

### 4.4 压缩 prompt 示例

```
你是聊天室分析师。请将以下聊天记录压缩为100字以内的摘要。

## 你的身份
名字:卡夫卡

## 上次压缩摘要
（无）

## 新增聊天记录
1号张三: 大家好
2号李四: 欢迎新朋友
3号卡夫卡: 谢谢大家好
4号王五: @卡夫卡 今天怎么样？

请生成简洁的摘要，保留关键话题和玩家互动。
```

---

## 5. 消息生命周期

### 5.1 消息流转

```
新聊天消息到达
    ↓
构建上下文（system + 摘要 + 新消息 + CURRENT_TASK）
    ↓
调用 LLM 生成回复
    ↓
发送聊天消息
    ↓
触发压缩（压缩历史）
```

### 5.2 历史保留策略

- **AI 自己的发言**：只保留最终成功的 tool 调用（assistant + tool result）
- **其他玩家消息**：作为普通 user 消息进入上下文
- **压缩后**：只保留 system + 新摘要

---

## 6. 与游戏上下文的关键区别

| 维度 | 游戏上下文 | 聊天室上下文 |
|------|------------|-------------|
| System Prompt | 完整游戏设定（角色、阵营、规则、队友） | 只有名字 + background |
| 历史内容 | 游戏发言、投票、夜晚行动等 | 纯聊天记录 |
| CURRENT_TASK | 投票、发言、验人等游戏动作 | 聊天、@回应 |
| 压缩频率 | 每次投票后 | 每次发言后 |
| 压缩摘要长度 | 300 字 | 100 字 |

---

## 7. 代码实现要点

### 7.1 新的压缩方法

在 `MessageManager` 中添加 `_compressChat()` 方法：

```javascript
async _compressChat(llmModel) {
  const newContent = this._compactChatHistoryAfterSummary();
  if (!newContent) return;

  const player = this._lastContext?.self;
  if (!player) return;

  const prevSummary = this._findPrevSummary();
  const prompt = this._buildChatCompressPrompt(newContent, player, prevSummary);

  // ... LLM 调用和压缩逻辑
}
```

### 7.2 新的上下文构建方法

在 `prompt.js` 中添加聊天室专用的 prompt 构建：

```javascript
function buildChatContext(player, chatMessages, currentTask) {
  const system = buildChatSystemPrompt(player);
  const summary = findPrevSummary();
  const newContent = formatChatMessages(chatMessages);
  return { system, summary, newContent, currentTask };
}
```

### 7.3 触发点

```javascript
// controller.js - 聊天发送成功后
async sendChatMessage(chatContext) {
  // ... 生成聊天内容
  this.agent.enqueue({ type: 'compress_chat' });
}
```

---

## 8. 现有代码分析

### 已实现的功能

| 功能 | 代码位置 | 说明 |
|------|----------|------|
| 聊天消息存储 | `server-core.js:42` | `this.chatMessages` |
| 聊天消息格式化 | `server-core.js:1073-1075` | `_formatChatMessagesForAI()` |
| CURRENT_TASK 定义 | `prompt.js:152-168` | ACTION.CHAT 的三种场景（自由聊天、被@、赛后） |
| 工具注册 | `tools.js:160` | `createDiscussTool(ACTION.CHAT)` |
| 赛后聊天触发 | `server-core.js:993-1024` | `_triggerAIPostGameChat()` |
| @提及触发 | `server-core.js:1047-1061` | `_handleChatMentions()` |
| 进入游戏时压缩 | `server-core.js:842-857` | `_compressChatForAI()` |

### 发现的问题

1. **压缩类型错误** (`controller.js:168`)：
   ```javascript
   this.agent.enqueue({ type: 'compress' });  // ❌ 游戏压缩
   // 应该是
   this.agent.enqueue({ type: 'compress_chat' });  // ✅ 聊天室压缩
   ```

2. **context 构建问题** (`controller.js:41`)：
   - `messages: this.getVisibleMessages()` 是**游戏消息**，不是聊天消息
   - 聊天消息应从 `extraData.chatContext` 传递

3. **缺少实现**：
   - `message_manager.js` 没有 `_compressChat()` 方法
   - `agent.js` 没有处理 `compress_chat` 类型

---

## 9. 目标状态推演

### 场景 1：初始状态
```
messages: [
  { role: 'system', content: '你是卡夫卡。\n【背景】...' },
]
```

### 场景 2：玩家发消息
```
messages: [
  { role: 'system', content: '你是卡夫卡。\n【背景】...' },
  { role: 'user', content: '1号张三: 大家好' },
]
```

### 场景 3：AI 被 @提及
```
messages: [
  { role: 'system', content: '你是卡夫卡。\n【背景】...' },
  { role: 'user', content: '1号张三: 大家好' },
  { role: 'user', content: '3号王五: @卡夫卡 今天怎么样？\n\n【行为逻辑】...\n【说话方式】...\n【当前任务】有人 @了你，是否要回应？' },
]
```

### 场景 4：AI 回复后（发言后立即压缩）
```
messages: [
  { role: 'system', content: '你是卡夫卡。\n【背景】...' },
  { role: 'user', content: '1号张三: 大家好' },
  { role: 'user', content: '3号王五: @卡夫卡 今天怎么样？' },
  { role: 'assistant', content: null, tool_calls: [...] },
  { role: 'tool', content: '你说：谢谢大家，今天很开心' },
]
```

### 场景 5：压缩后
```
messages: [
  { role: 'system', content: '你是卡夫卡。\n【背景】...' },
  { role: 'user', content: '【之前压缩摘要】\n大家互相打招呼，3号王五@卡夫卡询问今天怎么样' },
]
```

### 场景 6：新消息到达（压缩后）
```
messages: [
  { role: 'system', content: '你是卡夫卡。\n【背景】...' },
  { role: 'user', content: '【之前压缩摘要】\n大家互相打招呼，3号王五@卡夫卡询问今天怎么样' },
  { role: 'user', content: '4号赵六: 今天天气不错' },
]
```

### 场景 7：进入游戏时（切换 system + 压缩）
```
messages: [
  { role: 'system', content: '你是卡夫卡。位置:3号位。角色:预言家。...' },  // 切换为游戏 system
  { role: 'user', content: '【之前压缩摘要】\n赛前大家讨论了...' },
]
```

### 场景 8：游戏结束复盘
```
messages: [
  { role: 'system', content: '你是卡夫卡。\n【背景】...' },
  { role: 'user', content: '【之前压缩摘要】\n...' },
  { role: 'user', content: '【游戏结束】好人获胜！\n...\n\n【行为逻辑】...\n【说话方式】...\n【当前任务】游戏结束了，你可以...' },
]
```

---

## 10. 待实现项

- [x] `agent.js` 处理 `compress_chat` 类型
- [x] `message_manager.js` 添加 `compressChat()` 方法（压缩后完整替换 messages）
- [x] `message_manager.js` 添加 `_compactChatHistoryAfterSummary()` 方法
- [x] `message_manager.js` 添加 `_buildChatCompressPrompt()` 方法
- [x] `controller.js` 修复聊天后触发 `compress_chat`（而非 `compress`）
- [x] `prompt.js` 添加 `buildChatSystemPrompt()` 方法（只有名字 + background）
- [x] `prompt.js` 聊天室 CURRENT_TASK 同样注入 thinking 和 speaking（isSpeech 已包含 ACTION.CHAT）