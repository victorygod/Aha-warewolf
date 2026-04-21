# 压缩可见性过滤改造方案

## 问题

压缩流程传入的是 `game.message.messages`（全量消息），而非 `getVisibleTo(player, game)`（按可见性过滤后的消息）。导致：

1. **压缩输入泄露**：非狼人玩家的压缩摘要中包含狼人讨论、狼人投票等 `visibility=camp` 的消息
2. **压缩输出泄露**：压缩后的摘要（`compressedSummary`）包含了该玩家不该知道的信息
3. **压缩后增量消息**：`formatWithCompression(newMsgs)` 中的 `newMsgs` 来自 `context.messages`（已过滤），但摘要本身基于全量消息，信息已泄露

## 根因

`ai/controller.js:211-212`：

```js
const messages = this.game.message.messages;  // 全量消息，无过滤！
this.llmAgent.compressHistoryAfterVote(messages);
```

应该用 `this.getVisibleMessages()` 替代 `this.game.message.messages`。

## 改造方案

### 1. 修改压缩输入数据源

`ai/controller.js` 中调用 `compressHistoryAfterVote` 时，传入已过滤的消息：

```js
// 之前：全量消息
const messages = this.game.message.messages;

// 之后：按可见性过滤
const messages = this.getVisibleMessages();
```

这一步是核心修复。改完后，每个玩家压缩的输入只包含自己可见的消息，摘要自然也只包含可见信息。

### 2. 检查其他直接使用 `game.message.messages` 的地方

确认 `compressHistoryAfterVote` 是唯一绕过可见性过滤的地方。`buildMessages` 中的 `context.messages` 来自 `getVisibleMessages()`，已正确过滤。

### 3. 测试验证

- 修改 `test/compression.test.js` 中直接传 `game.message.messages` 的调用，改为传已过滤的消息
- 新增测试：验证非狼人玩家的压缩输入不包含 `visibility=camp` 的消息
- 新增测试：验证狼人玩家的压缩输入包含狼人讨论消息

## 影响范围

| 文件 | 改动 |
|------|------|
| `ai/controller.js` | `compressHistoryAfterVote` 调用处：`game.message.messages` → `this.getVisibleMessages()` |
| `test/compression.test.js` | 同步修改测试中的消息来源 |

改动极小，一行核心代码。`_doCompress`、`buildCompressPrompt`、`formatWithCompression` 等函数不需要改动——它们只处理传入的消息，只要传入的消息已过滤，输出自然正确。