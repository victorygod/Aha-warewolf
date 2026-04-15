# 历史消息压缩方案

## 问题分析

从 `docs/backend.log` 可以看到，每次 AI 决策时，历史消息占据了上下文的大半部分。例如第4天时，历史消息包含：
- 第1天警长竞选的所有发言、投票
- 第1天白天的发言、投票
- 第2夜的狼人讨论、投票
- 第2天的发言、投票
- ...以此类推

这些历史消息在每次决策时都被完整发送给 LLM，导致：
1. Token 消耗快速增长
2. 上下文窗口压力增大
3. 重要信息被淹没在冗余内容中

## 压缩时机

**触发点**：`day_vote` 阶段结束后（即 `post_vote` 阶段开始前）

**原因**：
- 白天投票是一天的核心事件，投票后局势基本明朗
- 此时压缩可以为后续夜晚和下一天的决策提供精简上下文
- 投票结果本身是重要信息，需要包含在压缩内容中

## 压缩目标

将历史消息压缩为 **200字以内** 的局势摘要，包含：
1. **存活状态**：当前存活玩家及其位置
2. **死亡记录**：已死亡玩家及死亡原因（被刀、被毒、被投）
3. **身份信息**：已暴露的身份（女巫跳身份、预言家留遗言等）
4. **投票分析**：关键投票结果及其暗示
5. **局势判断**：好人/狼人优势、可疑玩家等

## 技术方案

### 1. 新增压缩模块

**文件**：`ai/compressor.js`

```javascript
/**
 * 历史消息压缩器
 * 职责：将完整历史消息压缩为精简摘要
 */

class HistoryCompressor {
  constructor(game) {
    this.game = game;
  }

  /**
   * 压缩历史消息
   * @param {Array} messages - 待压缩的消息列表
   * @param {Object} player - 当前玩家（用于过滤可见性）
   * @returns {Promise<string>} 压缩后的摘要（200字以内）
   */
  async compress(messages, player) {
    // 1. 过滤玩家可见消息
    const visibleMessages = this.filterVisible(messages, player);

    // 2. 构建压缩提示词
    const prompt = this.buildCompressPrompt(visibleMessages, player);

    // 3. 调用 LLM 压缩
    const summary = await this.callLLM(prompt);

    return summary;
  }

  /**
   * 构建压缩提示词
   */
  buildCompressPrompt(messages, player) {
    // 提取关键信息
    const deaths = this.extractDeaths(messages);
    const votes = this.extractKeyVotes(messages);
    const identities = this.extractIdentities(messages);

    return `你是狼人杀游戏分析师。请将以下游戏历史压缩为200字以内的摘要。

## 你的身份
位置: ${this.getPlayerPosition(player)}号
角色: ${player.role?.name || player.role}

## 关键事件
### 死亡记录
${deaths}

### 关键投票
${votes}

### 暴露身份
${identities}

## 原始历史
${this.formatMessages(messages)}

## 要求
1. 保留关键信息：死亡、身份暴露、关键投票
2. 省略冗余发言（"我是好人"等无信息量内容）
3. 突出对局势判断有价值的信息
4. 控制在200字以内
5. 使用简洁的符号：X号=位置，狼/民/神=角色，刀/毒/投=死因`;
  }
}
```

### 2. 消息管理器扩展

**修改文件**：`engine/message.js`

```javascript
class MessageManager extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this._nextId = 1;
    this.compressedHistory = null;  // 压缩后的历史摘要
    this.compressedAfterId = 0;      // 压缩点之后的消息ID
  }

  /**
   * 获取对某玩家可见的消息（支持压缩）
   */
  getVisibleTo(player, game, useCompression = true) {
    const allVisible = this.messages.filter(msg => this.canSee(player, msg, game));

    if (!useCompression || !this.compressedHistory) {
      return allVisible;
    }

    // 返回：压缩摘要 + 压缩点之后的新消息
    const newMessages = allVisible.filter(msg => msg.id > this.compressedAfterId);

    // 如果压缩摘要存在，作为特殊消息返回
    if (this.compressedHistory) {
      return [
        { type: 'compressed_history', content: this.compressedHistory },
        ...newMessages
      ];
    }

    return allVisible;
  }

  /**
   * 设置压缩历史
   */
  setCompressedHistory(summary, afterId) {
    this.compressedHistory = summary;
    this.compressedAfterId = afterId;
  }
}
```

### 3. 阶段流程集成

**修改文件**：`engine/phase.js`

在 `day_vote` 阶段后添加压缩逻辑：

```javascript
// day_vote 阶段
{
  id: 'day_vote',
  name: '白天投票',
  execute: async (game) => {
    // ... 现有投票逻辑 ...

    // 投票结束后，异步压缩历史（不阻塞游戏流程）
    game.compressHistoryAsync();
  }
}
```

### 4. GameEngine 扩展

**修改文件**：`engine/main.js`

```javascript
class GameEngine {
  // ...

  /**
   * 异步压缩历史（不阻塞游戏流程）
   */
  compressHistoryAsync() {
    // 只在有 LLM 配置时执行
    if (!process.env.BASE_URL || !process.env.AUTH_TOKEN) {
      return;
    }

    // 异步执行，不等待结果
    this._compressPromise = this._compressHistory();
  }

  async _compressHistory() {
    const compressor = new HistoryCompressor(this);

    // 为每个玩家生成压缩摘要（因为可见性不同）
    const summaries = new Map();

    for (const player of this.players.filter(p => p.alive)) {
      const visibleMessages = this.message.getVisibleTo(player, this, false);
      const summary = await compressor.compress(visibleMessages, player);
      summaries.set(player.id, summary);
    }

    // 存储压缩结果
    this.message.compressedSummaries = summaries;
    this.message.compressedAfterId = this.message.messages.length;
  }
}
```

### 5. 上下文构建调整

**修改文件**：`ai/context.js`

```javascript
function formatMessageHistory(messages, players, compressedHistory = null) {
  if (compressedHistory) {
    // 使用压缩历史
    const lines = ['[历史摘要]', compressedHistory];

    // 只格式化压缩点之后的新消息
    const newMessages = messages.filter(m => m.type !== 'compressed_history');
    if (newMessages.length > 0) {
      lines.push('', '[最新动态]');
      lines.push(formatMessages(newMessages, players));
    }

    return lines.join('\n');
  }

  // 原有逻辑：完整格式化
  return formatMessages(messages, players);
}
```

## 数据流

```
day_vote 结束
    ↓
触发异步压缩（不阻塞）
    ↓
为每个存活玩家生成摘要
    ↓
存储到 message.compressedSummaries
    ↓
后续决策时：
    ↓
获取压缩摘要 + 新消息
    ↓
构建精简上下文
```

## 压缩提示词示例

```
你是狼人杀游戏分析师。请将以下游戏历史压缩为200字以内的摘要。

## 你的身份
位置: 7号
角色: 村民

## 关键事件
### 死亡记录
第1夜: 5号预言家(被刀)
第2夜: 3号狼人、4号狼人(女巫毒杀)
第3天: 2号村民(被投)

### 关键投票
第1天警长: 7号小芳(2票) vs 1号aa(6票)，1号当选
第3天放逐: 2号阿华(3票)出局

### 暴露身份
6号Claude: 自称女巫，毒杀4号
5号阿伟: 预言家遗言，查验7号=好人

## 原始历史
[第1天警长竞选发言...]
[第1天投票结果...]
...

## 要求
1. 保留关键信息
2. 省略无信息量发言
3. 突出对局势判断有价值的信息
4. 控制在200字以内
```

## 预期输出示例

```
【局势】D3，存活4人(1民1狼2神)。死亡:5预言(刀)、3狼(毒)、4狼(毒)、2民(投)。
【身份】6号女巫(已跳，毒杀4号)，9号狼(未跳)。
【投票】D1警长1号当选；D3投出2号村民。
【分析】狼人剩9号，好人优势。9号发言"我是好人"无信息，6号女巫可信。
【建议】重点怀疑9号，观察1号、7号、8号站边。
```

## 实现步骤

1. **创建 `ai/compressor.js`**
   - 实现 `HistoryCompressor` 类
   - 实现关键信息提取函数
   - 实现 LLM 调用和结果解析

2. **修改 `engine/message.js`**
   - 添加 `compressedSummaries` 属性
   - 添加 `compressedAfterId` 属性
   - 修改 `getVisibleTo` 支持压缩历史

3. **修改 `engine/phase.js`**
   - 在 `day_vote` 结束后触发异步压缩

4. **修改 `engine/main.js`**
   - 添加 `compressHistoryAsync` 方法
   - 管理压缩生命周期

5. **修改 `ai/context.js`**
   - `formatMessageHistory` 支持压缩历史
   - `buildFullContext` 传递压缩摘要

6. **测试验证**
   - 单元测试：压缩逻辑
   - 集成测试：完整游戏流程
   - 性能测试：Token 消耗对比

## 注意事项

1. **可见性差异**：不同玩家看到的历史不同（狼人知道队友，好人不知道），需要为每个玩家单独压缩

2. **异步不阻塞**：压缩在后台执行，不影响游戏流畅度

3. **降级策略**：如果 LLM 不可用或压缩失败，回退到完整历史

4. **压缩时机**：只在天数推进时压缩，避免频繁调用 LLM

5. **压缩粒度**：可配置压缩频率（每天压缩 vs 隔天压缩）

## 后续优化

1. **增量压缩**：只压缩新增内容，复用之前的压缩结果

2. **缓存机制**：相同历史不重复压缩

3. **压缩质量评估**：监控压缩后的信息完整性

4. **玩家个性化**：根据玩家角色调整压缩重点（狼人关注队友，好人关注投票）