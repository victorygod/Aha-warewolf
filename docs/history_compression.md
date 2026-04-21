# 历史消息压缩方案

## 核心思路

压缩逻辑完全内聚到 LLMAgent 内部，不改动游戏核心流程。

- 触发时机：day_vote 结束后（不含 PK 投票）
- 并发：每个 AI 独立压缩，互不阻塞
- 阻塞：该 AI 执行下一个操作前，等待自己的压缩完成

## 增量压缩逻辑

每个Agent独立维护自己的压缩点，在自己白天投票结束后立即压缩。

```
该Agent第1天 day_vote 结束（投票完成后）：
  压缩输入: 消息 1 到 day_vote结束时刻的消息
  输出: compressedSummary_1, compressedAfterMessageId = D1投票结束时的消息ID

该Agent第2天 day_vote 结束（投票完成后）：
  压缩输入: compressedSummary_1 + 消息 (D1压缩点+1) 到 D2投票结束时刻的消息
  输出: compressedSummary_2, compressedAfterMessageId = D2投票结束时的消息ID

该Agent第3天 day_vote 结束（投票完成后）：
  压缩输入: compressedSummary_2 + 消息 (D2压缩点+1) 到 D3投票结束时刻的消息
  输出: compressedSummary_3, compressedAfterMessageId = D3投票结束时的消息ID
```

## 实现方案

### 1. LLMAgent 内部逻辑 (`ai/agents/llm.js`)

```javascript
class LLMAgent {
  constructor(playerId, game, options = {}) {
    this.compressionEnabled = options.compressionEnabled !== false;
    this.compressedSummary = null;
    this.compressedAfterMessageId = 0;
    this.compressionPromise = null;  // 压缩任务 Promise 引用
  }

  // 触发点：day_vote 结束后调用（异步，不阻塞）
  compressHistoryAfterVote(messages) {
    if (!this.compressionEnabled || !this.isApiAvailable()) return;
    if (this.compressionPromise) return;  // 已有压缩进行中，跳过

    this.compressionPromise = this._doCompress(messages);
  }

  // 实际压缩逻辑
  async _doCompress(messages) {
    try {
      const newMessages = messages.filter(m =>
        m.id > this.compressedAfterMessageId &&
        m.type !== 'vote_result'
      );
      if (newMessages.length === 0) return;

      const prompt = this.buildCompressPrompt(newMessages);
      const summary = await this.callCompressAPI(prompt);

      if (summary) {
        this.compressedSummary = summary;
        this.compressedAfterMessageId = messages[messages.length - 1]?.id || 0;
      }
    } finally {
      this.compressionPromise = null;
    }
  }

  // 阻塞点：每次决策前检查并等待自己的压缩完成
  async decide(context) {
    if (this.compressionPromise) {
      await this.compressionPromise;
      this.compressionPromise = null;
    }
    // ... 正常决策逻辑 ...
  }

  // 构建消息时使用压缩摘要
  buildMessages(context) {
    const useCompression = this.compressionEnabled &&
                           this.compressedSummary &&
                           context.messages?.length > 0;

    if (useCompression) {
      const newMsgs = context.messages.filter(m => m.id > this.compressedAfterMessageId);
      historyText = this.formatWithCompression(newMsgs);
    } else {
      historyText = formatMessageHistory(context.messages, this.game.players);
    }
    // ...
  }

  formatWithCompression(newMsgs) {
    const lines = ['【历史摘要】', this.compressedSummary];
    if (newMsgs.length > 0) {
      lines.push('', '【最新动态】', formatMessageHistory(newMsgs, this.game.players));
    }
    return lines.join('\n');
  }
}
```

### 2. 触发入口 (`ai/controller.js`)

在 AIController 的 `getVoteResult` 方法中，投票完成后立即触发自己的压缩：

```javascript
async getVoteResult(actionType = 'vote', extraData = {}) {
  // ... 原有投票逻辑 ...

  // 投票完成后立即触发自己的压缩（异步，不阻塞）
  if (this.llmAgent && actionType === 'vote') {
    const messages = this.game.message.messages;
    this.llmAgent.compressHistoryAfterVote(messages);
  }

  return { targetId };
}
```

## 工作流程

```
D2 阶段顺序: day_announce → day_discuss → day_vote → post_vote

D2 day_vote 进行中
    ↓
1号投票 → 投票完成 → 立即触发 compressHistoryAfterVote()（异步）
    ↓
2号投票 → 投票完成 → 立即触发 compressHistoryAfterVote()（异步）
    ↓
3号投票 → 投票完成 → 立即触发 compressHistoryAfterVote()（异步）
    ↓
... 所有AI并发压缩自己的历史

游戏继续 → 进入 post_vote / 夜晚阶段

（假设进入夜晚）
守卫行动 → 狼人行动 → 女巫行动 → 预言家行动 → ...

D3 白天
    ↓
day_announce → day_discuss → day_vote
    ↓
1号被要求发言 → LLMAgent.decide()
    ↓
发现 this.compressionPromise（自己的压缩中）
    ↓
await this.compressionPromise ← 阻塞！等待自己的压缩完成
    ↓ 压缩完成
继续执行决策，返回发言内容
```

## 关键设计点

| 机制 | 实现 |
|------|------|
| **触发时机** | 仅 day_vote 结束后，不在发言/技能/PK后触发 |
| **并发** | 多个 AI 同时启动压缩，互不阻塞 |
| **阻塞** | 该 AI 需要执行下一个操作时，await 自己的 compressionPromise |
| **游戏流程** | 完全不受影响，只有该 AI 行动时会等自己的压缩 |
| **降级** | 压缩失败不影响游戏（catch 异常） |

## 注意事项

1. **PK 投票**：当前方案在 day_vote 结束后就压缩，不包含 PK 投票
2. **按阵营压缩**：后续可优化为狼人和好人分别压缩（看到的历史不同）