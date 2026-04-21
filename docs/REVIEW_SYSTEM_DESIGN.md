# 狼人杀游戏 LLM 复盘与策略迭代系统设计

## 一、需求概述

在游戏结束后，利用 LLM 对每个 AI 角色进行复盘分析，并根据游戏表现更新策略文档。

### 核心需求
1. 新增「复盘阶段」，在游戏结束后自动触发
2. 针对每个 LLM 角色构建复盘提示词（非压缩内容）
3. 包含完整游戏结算信息（身份、死因、获胜阵营等）
4. 复盘提示词要求 LLM 分析角色攻略的改进点
5. 将分析结果追加到对应角色的策略文档末尾
6. 所有 LLM 角色并行执行复盘
7. 前端需等待所有复盘完成后才能点击「再开一局」

---

## 二、整体架构

### 2.1 流程图

```
游戏结束 (game_over)
    │
    ▼
┌─────────────────────────┐
│   新增复盘阶段 (review)   │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│  遍历所有 LLM 角色玩家    │
└─────────────────────────┘
    │
    ├─────────────────────┐
    ▼                     ▼
┌──────────┐        ┌──────────┐
│ 角色1    │        │ 角色2    │  (并行执行)
│ 复盘     │        │ 复盘     │
└──────────┘        └──────────┘
    │                     │
    └──────────┬──────────┘
               ▼
┌─────────────────────────┐
│  等待所有复盘完成        │
└─────────────────────────┘
               │
               ▼
┌─────────────────────────┐
│  通知前端：可开启新游戏   │
└─────────────────────────┘
```

### 2.2 文件结构

```
ai/
├── strategy/              # 现有策略文档目录
│   ├── 9-standard/
│   ├── 12-hunter-idiot/
│   └── 12-guard-cupid/
│
新增文件：
├── agents/
│   └── review.js          # 新增：复盘 Agent
│
新增/修改文件：
engine/
├── phase.js               # 修改：新增复盘阶段
├── review.js              # 新增：复盘逻辑
│
server.js                  # 修改：处理复盘完成事件
public/
├── app.js                 # 修改：等待复盘完成才能开新局
```

---

## 三、详细设计

### 3.1 游戏结算信息结构

游戏结束后，需要生成完整的结算信息，用于复盘提示词：

```javascript
// gameOverInfo 结构
{
  winner: 'good' | 'wolf' | 'third',  // 获胜阵营
  winnerText: '好人阵营' | '狼人阵营' | '第三方阵营',
  dayCount: 3,                         // 游戏天数
  players: [
    {
      id: 1,
      name: '玩家1',
      display: '1号位 玩家1',
      role: { id: 'seer', name: '预言家', camp: 'good' },
      alive: false,
      deathDay: 2,                     // 第几天死亡
      deathReason: '被狼人击杀' | '被放逐' | '被毒杀' | '殉情',
      isCouple: false,                 // 是否为情侣
      isSheriff: false                 // 是否为警长
    },
    // ... 其他玩家
  ],
  couples: [                           // 情侣信息（如果有丘比特）
    { player1: 1, player2: 3 }
  ]
}
```

### 3.2 复盘提示词结构

每个角色的复盘提示词包含以下部分：

```markdown
## 复盘提示词

你是狼人杀游戏分析师。请分析本局游戏中你的表现，并给出策略改进建议。

### 你的身份信息
- 位置：5号位
- 角色：预言家
- 阵营：好人

### 游戏结果
- 获胜阵营：狼人阵营
- 游戏天数：4天

### 你的死亡信息
- 死亡时机：第2天
- 死亡原因：被放逐
- 遗言内容：...

### 完整游戏过程
[非压缩的完整消息历史，按时间顺序排列]

### 游戏结算信息
[每个玩家的身份、死因、存活状态]

### 复盘要求
请分析以下内容：
1. 你在本局游戏中的决策是否正确？
2. 你的发言、投票、验人策略有哪些可以改进的地方？
3. 根据本局游戏的具体情况，角色攻略文档中应该补充或修改哪些内容？

请以以下格式返回：
```json
{
  "analysis": "你的分析（200字以内）",
  "improvements": [
    {"category": "发言策略", "content": "具体改进建议"},
    {"category": "投票策略", "content": "具体改进建议"},
    {"category": "攻略更新", "content": "建议更新的攻略内容"}
  ]
}
```
```

### 3.3 复盘阶段定义 (engine/phase.js)

在 `PHASE_FLOW` 中新增复盘阶段：

```javascript
// engine/phase.js

{
  id: 'review',
  name: '复盘分析',
  condition: (game) => game.winner != null,  // 游戏已结束
  execute: async (game) => {
    // 触发复盘逻辑
    await game.runReview();
  }
}
```

### 3.4 复盘逻辑 (engine/review.js)

```javascript
// engine/review.js

const { createLogger } = require('../utils/logger');
const { loadStrategyGuide, saveStrategyGuide } = require('../ai/prompts');
const fs = require('fs');
const path = require('path');

let reviewLogger = null;
function getLogger() {
  if (!reviewLogger) {
    reviewLogger = createLogger('review.log');
  }
  return reviewLogger;
}

/**
 * 执行复盘
 * @param {GameEngine} game - 游戏引擎实例
 * @returns {Promise<void>}
 */
async function runReview(game) {
  getLogger().info('开始执行游戏复盘...');

  // 获取游戏结算信息
  const gameOverInfo = game.getGameOverInfo();

  // 获取所有 LLM 角色玩家
  const llmPlayers = game.players.filter(p =>
    p.isAI && p.controller?.llmAgent
  );

  getLogger().info(`共 ${llmPlayers.length} 个 LLM 角色需要复盘`);

  // 并行执行所有复盘
  const reviewPromises = llmPlayers.map(player =>
    reviewPlayer(player, game, gameOverInfo)
  );

  // 等待所有复盘完成
  const results = await Promise.all(reviewPromises);

  // 统计复盘结果
  const successCount = results.filter(r => r.success).length;
  getLogger().info(`复盘完成：成功 ${successCount}/${results.length}`);

  // 通知前端复盘完成
  game.emit('review:complete', { successCount, total: results.length });

  return results;
}

/**
 * 对单个角色执行复盘
 */
async function reviewPlayer(player, game, gameOverInfo) {
  const playerId = player.id;
  const roleId = player.role.id;
  const presetId = game.presetId;

  getLogger().info(`开始复盘：${player.name} (${roleId})`);

  try {
    // 构建复盘提示词
    const prompt = buildReviewPrompt(player, game, gameOverInfo);

    // 调用 LLM 获取复盘结果
    const llmAgent = player.controller.llmAgent;
    const response = await llmAgent.callReviewAPI(prompt);

    // 解析 LLM 响应
    const result = parseReviewResponse(response);

    if (result.success) {
      // 将改进建议追加到策略文档
      await appendToStrategyGuide(presetId, roleId, result.improvements);
      getLogger().info(`复盘成功：${player.name}，已更新策略文档`);
    }

    return { playerId, roleId, ...result };
  } catch (error) {
    getLogger().error(`复盘失败：${player.name}, ${error.message}`);
    return { playerId, roleId, success: false, error: error.message };
  }
}

/**
 * 构建复盘提示词
 */
function buildReviewPrompt(player, game, gameOverInfo) {
  const roleId = player.role.id;
  const roleName = player.role.name;
  const position = game.players.findIndex(p => p.id === player.id) + 1;

  // 获取非压缩的完整消息历史
  const messages = game.message.getAllMessages()
    .filter(m => m.visibility === 'public' ||
                 m.sender === player.id ||
                 (m.receiver === player.id));

  // 格式化消息历史
  const messageHistory = formatMessageHistory(messages, game.players, player);

  // 构建玩家结算信息
  const playerInfo = gameOverInfo.players.find(p => p.id === player.id);

  return `你是狼人杀游戏分析师。请分析本局游戏中你的表现，并给出策略改进建议。

## 你的身份信息
- 位置：${position}号位
- 角色：${roleName}
- 阵营：${player.role.camp === 'good' ? '好人' : player.role.camp === 'wolf' ? '狼人' : '第三方'}

### 游戏结果
- 获胜阵营：${gameOverInfo.winnerText}
- 游戏天数：${gameOverInfo.dayCount}天

### 你的死亡信息
- 存活状态：${playerInfo.alive ? '存活' : '死亡'}
- 死亡时机：${playerInfo.alive ? '存活' : '第' + playerInfo.deathDay + '天'}
- 死亡原因：${playerInfo.deathReason || '无'}

### 完整游戏过程
${messageHistory}

### 游戏结算信息
${formatGameOverInfo(gameOverInfo)}

### 复盘要求
请分析以下内容：
1. 你在本局游戏中的决策是否正确？
2. 你的发言、投票策略有哪些可以改进的地方？
3. 根据本局游戏的具体情况，角色攻略文档中应该补充或修改哪些内容？

请以JSON格式返回：
{
  "analysis": "你的分析（200字以内）",
  "improvements": [
    {"category": "分类", "content": "具体改进建议"}
  ]
}`;
}

/**
 * 格式化游戏结算信息
 */
function formatGameOverInfo(gameOverInfo) {
  const lines = ['| 位置 | 玩家 | 角色 | 阵营 | 存活 | 死亡原因 |'];
  lines.push('|------|------|------|------|------|----------|');

  for (const p of gameOverInfo.players) {
    const pos = gameOverInfo.players.findIndex(gp => gp.id === p.id) + 1;
    const camp = p.role.camp === 'good' ? '好人' : p.role.camp === 'wolf' ? '狼人' : '第三方';
    lines.push(`| ${pos}号 | ${p.name} | ${p.role.name} | ${camp} | ${p.alive ? '是' : '否'} | ${p.deathReason || '-'} |`);
  }

  return lines.join('\n');
}

/**
 * 解析复盘响应
 */
function parseReviewResponse(response) {
  try {
    // 尝试提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: '无法解析响应' };
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      success: true,
      analysis: result.analysis,
      improvements: result.improvements || []
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 追加改进建议到策略文档
 */
async function appendToStrategyGuide(presetId, roleId, improvements) {
  if (!improvements || improvements.length === 0) return;

  const strategyPath = path.join(__dirname, '..', 'ai', 'strategy', presetId, `${roleId}.md`);

  if (!fs.existsSync(strategyPath)) {
    getLogger().warn(`策略文档不存在：${strategyPath}`);
    return;
  }

  // 读取现有内容
  let content = fs.readFileSync(strategyPath, 'utf-8');

  // 添加复盘建议
  const timestamp = new Date().toISOString().slice(0, 10);
  const newSection = `\n\n---\n\n## 复盘建议 (${timestamp})\n\n`;

  const improvementLines = improvements.map(i => `- **${i.category}**: ${i.content}`).join('\n');

  content += newSection + improvementLines;

  // 写回文件
  fs.writeFileSync(strategyPath, content, 'utf-8');
}

module.exports = { runReview };
```

### 3.5 修改 GameEngine (engine/main.js)

在 GameEngine 中添加复盘方法：

```javascript
// engine/main.js

// 添加 import
const { runReview } = require('./review');

// 在 GameEngine 类中添加方法
class GameEngine {
  // ... 现有方法 ...

  /**
   * 执行游戏复盘
   */
  async runReview() {
    // 使用事件循环，避免阻塞
    setImmediate(async () => {
      try {
        await runReview(this);
      } catch (error) {
        getLogger().error(`复盘执行失败: ${error.message}`);
      }
    });
  }
}
```

### 3.6 修改 PhaseManager (engine/phase.js)

在游戏结束后触发复盘阶段：

```javascript
// engine/phase.js

// 修改 _checkGameEnd 方法
_checkGameEnd() {
  const winner = this.game.config.hooks.checkWin(this.game);
  if (winner) {
    this.game.winner = winner;
    getLogger().info(`游戏结束，胜者: ${winner}`);
    this.game.gameOverInfo = this.game.getGameOverInfo();
    this.currentPhase = { id: 'game_over', name: '游戏结束' };
    this.game.message.add({
      type: 'game_over',
      content: `游戏结束，${winner === 'good' ? '好人阵营' : winner === 'wolf' ? '狼人阵营' : '第三方阵营'}获胜`,
      winner: winner,
      gameOverInfo: this.game.gameOverInfo,
      visibility: 'public'
    });

    // 清除所有待处理请求
    this.game.cancelAllPendingRequests();

    // 触发复盘阶段
    this.game.runReview();

    this.running = false;
    return true;
  }
  return false;
}
```

### 3.7 修改 LLMAgent (ai/agents/llm.js)

添加复盘 API 调用方法：

```javascript
// ai/agents/llm.js

class LLMAgent {
  // ... 现有方法 ...

  /**
   * 调用复盘 API
   * @param {string} prompt - 复盘提示词
   * @returns {Promise<string>} LLM 响应
   */
  async callReviewAPI(prompt) {
    const apiConfig = this.getApiConfig();
    if (!apiConfig) {
      throw new Error('API 配置不可用');
    }

    const response = await fetch(`${apiConfig.base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.auth_token}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: '你是一个专业的狼人杀游戏分析师，擅长分析游戏策略。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`API 调用失败: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }
}
```

### 3.8 前端修改 (public/app.js)

前端需要等待复盘完成后才能开启新游戏：

```javascript
// public/app.js

// 修改游戏结束处理
function handleGameOver(data) {
  // 显示游戏结束界面
  showGameOverUI(data);

  // 显示"复盘中"状态
  showReviewStatus('复盘中，请稍候...');

  // 禁用"再开一局"按钮
  disableNewGameButton();
}

// 处理复盘完成事件
function handleReviewComplete(data) {
  showReviewStatus(`复盘完成！共分析 ${data.successCount}/${data.total} 个角色`);

  // 启用"再开一局"按钮
  enableNewGameButton();
}

// WebSocket 消息处理
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'game_over':
      handleGameOver(msg.data);
      break;

    case 'review_status':
      showReviewStatus(msg.data.message);
      break;

    case 'review_complete':
      handleReviewComplete(msg.data);
      break;

    // ... 其他消息处理
  }
};
```

### 3.9 服务器修改 (server.js)

服务器需要处理复盘完成事件并通知前端：

```javascript
// server.js

// 在游戏消息监听中添加复盘完成处理
game.on('review:complete', (data) => {
  // 广播复盘完成消息
  broadcast({ type: 'review_complete', data });
});
```

---

## 四、策略文档更新机制

### 4.1 更新格式

复盘建议追加到策略文档末尾，格式如下：

```markdown
---

## 复盘建议 (2024-04-21)

- **发言策略**: 在被查杀后应该更加激进地反驳，而不是简单表水
- **投票策略**: 第3天应该投票给5号而不是3号，当时5号发言更可疑
- **攻略更新**: 预言家在被悍跳时应该先分析对跳者的发言逻辑再决定是否退水
```

### 4.2 更新限制

为了避免策略文档无限增长，建议：
1. 每个角色最多保留最近 10 条复盘建议
2. 定期清理过时的复盘建议（如超过 30 天）
3. 可以添加一个「重要更新」标记，标记关键策略变更

---

## 五、错误处理

### 5.1 LLM 调用失败

如果某个角色的复盘失败：
- 记录错误日志
- 继续处理其他角色
- 不阻塞整体流程

### 5.2 文件写入失败

如果策略文档写入失败：
- 回滚文件内容
- 记录错误日志
- 跳过该角色的更新

### 5.3 前端断连

如果前端在复盘过程中断连：
- 继续在后台执行复盘
- 复盘完成后记录在日志中
- 下次连接时显示复盘状态

---

## 六、配置项

### 6.1 新增配置

在 `api_key.conf` 或游戏配置中可以添加：

```json
{
  "review_enabled": true,
  "review_parallel": true,
  "review_timeout": 30000,
  "max_improvements_per_role": 10
}
```

### 6.2 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| review_enabled | 是否启用复盘功能 | true |
| review_parallel | 是否并行执行复盘 | true |
| review_timeout | 单个角色复盘超时时间(ms) | 30000 |
| max_improvements_per_role | 每个角色最大保留建议数 | 10 |

---

## 七、测试计划

### 7.1 单元测试
- 测试复盘提示词构建
- 测试策略文档追加
- 测试错误处理

### 7.2 集成测试
- 测试完整复盘流程
- 测试并行执行
- 测试前端交互

### 7.3 压力测试
- 12 人局全部 LLM 角色复盘
- 验证复盘完成时间

---

## 八、注意事项

1. **非压缩内容**: 复盘时必须使用非压缩的完整消息历史，确保 LLM 获取全部信息
2. **并行执行**: 所有 LLM 角色的复盘应并行执行，减少等待时间
3. **前端阻塞**: 「再开一局」按钮必须等待所有复盘完成后才能点击
4. **日志记录**: 所有复盘操作都需要记录日志，便于调试
5. **策略备份**: 建议定期备份策略文档，防止误操作导致内容丢失