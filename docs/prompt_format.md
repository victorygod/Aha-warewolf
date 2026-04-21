# AI 提示词格式优化

## 目标

减少字符数，提高信息密度，让 AI 更容易解析关键信息。

## 当前格式问题

1. **冗余分隔符**：`===== 第1天夜晚 =====` 浪费字符
2. **冗余词语**：`【技能】你查验了`、`【投票结果】` 等
3. **格式不统一**：有的用 `【】`，有的用 `[]`
4. **私有信息分散**：查验结果在历史消息中逐条显示，不便于 AI 回顾
5. **重复前缀**：每条消息都带阶段标记

## 目标格式

### 系统提示词（单行）

```
名字:阿明 
位置:6号位 
角色:狼人 
队友:3号Claude,7号阿鹏
你是一个深沉的人，心思缜密。你说话不多但每句都经过思考。
规则:女巫仅首夜可自救|守卫不可连守|猎人被毒不能开枪|首夜/白天死亡有遗言|情侣一方死另一方殉情
```

### 消息历史（紧凑）

```
第1夜
[狼人]
3号Claude:刀5号吧
7号阿鹏:同意
票型：5号小红（3号、7号）；1号小绿（6号）
最终击杀：5号小红
[守卫]2号小玲:守护4号a
[女巫]9号小五:救5号小红
[预言家]1号小绿:3号Claude=狼人
第1天
[死亡]5号小红
[警长竞选]
上:1号小绿,4号a 下:2号小玲,3号Claude
退水:无
1号小绿:我是预言家
4号a:我是好人
票型：1号小绿(2号,3号,6号) 4号a(7号)
pk:1号小绿,4号a
1号小绿:我验了3号是狼
4号a:我是民
票型：1号小绿(2号,3号) 4号a(6号,7号)
[警长]1号小绿当选
[警长]1号小绿:指定4号a先发言
[发言]
4号a:我是好人
2号小玲:我是预言家
3号Claude:我才是预言家
...
1号小绿:我是预言家，3号是狼
[投票]3号Claude(1,2,4) 7号阿鹏(3)
pk:3号Claude,7号阿鹏
[发言]
3号Claude:我是狼
7号阿鹏:我是好人
[投票]3号Claude(1,2,4,6) 7号阿鹏(3)
[放逐]3号Claude
[遗言]3号Claude:我是猎人
[猎人]3号Claude:枪杀7号阿鹏
[警长]3号Claude:传警徽给1号小绿
[死亡]7号阿鹏
[情侣]7号阿鹏:和10号阿啦殉情
[遗言]7号阿鹏:xxx
[遗言]10号阿啦:xxx
第2夜
[狼人]
...
[平安夜]
第2天
[发言]
...
[投票]...
[放逐]6号小六
[遗言]6号小六:xxx
[白痴]6号小六:翻牌免疫
```

### 当前状态（汇总私有信息）

```
存活:1号小绿,2号小玲,4号a,6号阿杰,8号小红,9号小燕(6人)
你的状态:查验[3号=狼人,5号=好人] 药水:解药0/毒药1 上晚守护:4号(不可选)
行动:【预言家】选查验目标，可选目标：2,4,6,8,9(回复位置编号)
```

## 消息类型格式对照表

| 消息类型 | 当前格式 | 目标格式 |
|---------|---------|---------|
| 阶段开始 | `===== 第1天夜晚 =====` | `第1夜` |
| 狼人讨论 | `[发言] 3号Claude：我觉得应该刀5号` | `[狼人]` 换行 `3号Claude:刀5号` |
| 狼人票型 | `【投票结果】5号小红 2票` | `票型：5号小红（3号、7号）；1号小绿（6号）` |
| 狼人击杀 | 无 | `最终击杀：5号小红` |
| 守卫守护 | `【技能】你守护了 4号a` | `[守卫]2号小玲:守护4号a` |
| 女巫用药 | `【技能】你使用解药救了 5号小红` | `[女巫]9号小五:救5号小红` |
| 预言家查验 | `【技能】你查验了 3号Claude，TA是狼人` | `[预言家]1号小绿:3号Claude=狼人` |
| 死亡公告 | `【死亡】5号小红 死亡` | `[死亡]5号小红` |
| 警长竞选 | `【竞选】警上：1号阿华...警下：...` | `[警长竞选]` 换行 `上:1号小绿,4号a 下:2号小玲` |
| 竞选发言 | `[发言] 1号阿华：我是预言家` | `1号小绿:xx` (竞选标题下) |
| 竞选退水 | 无 | `退水:无` 或 `退水:1号小绿` |
| 竞选票型 | `【投票结果】1号小绿 2票` | `票型：1号小绿(2号,3号)` |
| 白天发言 | `[发言] 1号阿华：我是预言家` | `[发言]` 换行 `1号小绿:我是预言家` |
| 放逐投票 | `【投票结果】3号Claude 2票` | `[投票]3号Claude(1,2) 7号阿鹏(3,4)` |
| PK投票 | 无 | `[放逐pk] 3号Claude(1,2,4) 7号阿鹏(3)` |
| 放逐结果 | 无 | `[放逐]3号Claude` |
| 猎人开枪 | `【技能】猎人 3号Claude 开枪带走了 8号` | `[猎人]猎人3号Claude:枪杀8号阿x` |
| 遗言 | `[遗言] 3号Claude：我是狼` | `[遗言]3号Claude:我是猎人` |
| 情侣殉情 | `【死亡】8号阿x 殉情` | `[情侣]8号阿x:和10号阿啦殉情` |
| 丘比特连线 | `【技能】你连接了 1号 和 4号 为情侣` | `[丘比特]X号:1号↔4号` |

## 私有信息汇总格式

| 角色 | 历史消息 | 当前状态汇总 |
|-----|---------|-------------|
| 预言家 | `[预言家]1号小绿:3号Claude=狼人` | `查验[3号=狼人,5号=好人]` |
| 女巫 | `[女巫]9号小五:救5号小红` | `药水:解药0/毒药1` |
| 守卫 | `[守卫]2号小玲:守护4号a` | `上晚守护:4号(不可选)` |
| 丘比特 | `[丘比特]X号:1号↔4号` | `连线:1号↔4号` |
| 情侣 | `[情侣]你的伴侣:4号` | `伴侣:4号` |

## 符号约定

| 符号 | 含义 | 示例 |
|-----|------|------|
| `:` | 玩家发言/动作分隔 | `3号Claude:刀5号` |
| `=` | 查验结果 | `3号Claude=狼人` |
| `()` | 投票者列表 | `3号Claude(1,2)` 表示1号、2号投给3号 |
| `↔` | 丘比特连线 | `1号↔4号` |
| `(不可选)` | 守卫连守限制 | `上晚守护:4号(不可选)` |

> **注意**：死亡公告不显示死因，玩家只能通过游戏过程推断（如女巫是否救人、狼人刀谁等）。

## 阶段命名

| 当前 | 目标 |
|-----|------|
| 第1天夜晚 | `第1夜` |
| 第1天白天 | `第1天` |
| 第2天夜晚 | `第2夜` |
| 第2天白天 | `第2天` |

## 实现要点

1. **阶段标题**：`第1夜` / `第1天` 单独一行
2. **子阶段标题**：`[狼人]`、`[警长竞选]`、`[发言]` 等单独一行，下面列出详细内容
3. **票型格式**：`票型：目标（投票者）；目标（投票者）`，显示谁投给了谁
4. **投票结果**：`[投票]目标(投票者列表)` 或 `[放逐]目标`
5. **私有消息**：`[角色]玩家:动作` 格式，包含执行者信息
6. **当前状态汇总**：在最后显示存活列表、私有状态、行动提示
7. **行动提示**：包含可选目标列表，如 `可选目标：2,4,6,8,9`

## 字符数对比示例

### 当前格式（约 600 字符）
```
===== 第1天夜晚 =====

[发言] 3号Claude：我觉得应该刀5号
[发言] 7号阿鹏：同意
【投票结果】5号小红 2票
【技能】你守护了 4号a
【技能】你使用解药救了 5号小红
【技能】你查验了 3号Claude，TA是狼人

===== 第1天白天 =====
【死亡】5号小红 死亡

【竞选】警上：1号阿华、4号a、7号阿鹏、8号小红、9号小燕 | 警下：2号小玲、3号Claude、5号阿明、6号阿杰
[发言] 1号阿华：我是预言家，3号是狼
【投票结果】3号Claude 2票、7号阿鹏 1票
```

### 目标格式（约 350 字符）
```
第1夜
[狼人]
3号Claude:刀5号吧
7号阿鹏:同意
票型：5号小红（3号、7号）
最终击杀：5号小红
[守卫]2号小玲:守护4号a
[女巫]9号小五:救5号小红
[预言家]1号小绿:3号Claude=狼人
第1天
[死亡]5号小红
[警长竞选]
上:1号小绿,4号a 下:2号小玲,3号Claude
退水:无
1号小绿:我是预言家
票型：1号小绿(2号,3号)
[发言]
1号小绿:我是预言家，3号是狼
[投票]3号Claude(1,2) 7号阿鹏(3,4)
存活:1号小绿,2号小玲,4号a,6号阿杰,8号小红,9号小燕(6人)
你的状态:查验[3号=狼人]
行动:【预言家】选查验目标，可选目标：2,4,6,8,9
```

节省约 **42%** 字符。

## 消息输入格式（实际数据结构）

### 1. phase_start - 阶段开始
```javascript
{
  type: 'phase_start',
  content: '狼人讨论',  // phase.name
  phase: 'night_werewolf_discuss',  // phase.id
  phaseName: '狼人讨论',
  visibility: 'public'
}
```
**阶段ID映射**：
- 夜晚：`cupid`, `guard`, `night_werewolf_discuss`, `night_werewolf_vote`, `witch`, `seer`, `hunter_night`
- 白天：`day_announce`, `sheriff_campaign`, `sheriff_speech`, `sheriff_vote`, `day_discuss`, `day_vote`, `post_vote`

### 2. speech / wolf_speech / last_words - 发言
```javascript
{
  type: 'speech',  // 或 'wolf_speech', 'last_words'
  content: '我是好人',
  playerId: 3,
  playerName: '小刚',
  visibility: 'public'  // 或 'camp'（狼人）, 'self'（遗言）
}
```

### 3. wolf_vote_result - 狼人投票结果
```javascript
{
  type: 'wolf_vote_result',
  content: '狼人选择击杀 6号阿杰',
  visibility: 'camp',
  playerId: 3,  // 狼人代表
  voteDetails: [
    { voter: '3号Claude', target: '5号小红' },
    { voter: '4号小丽', target: '5号小红' },
    { voter: '7号阿鹏', target: '1号小绿' }
  ],
  voteCounts: { '5': 2, '1': 1 }  // targetId -> count
}
```

### 4. vote_result - 投票结果
```javascript
{
  type: 'vote_result',
  content: '投票结果\n3号Claude → 5号小红\n...',
  voteDetails: [{ voter: '3号Claude', target: '5号小红' }, ...],
  voteCounts: { '5': 2, '1': 1 },
  visibility: 'public',
  bubble: true
}
```

### 5. vote_tie - 平票
```javascript
{
  type: 'vote_tie',
  content: '平票：3号小刚、4号小丽',
  visibility: 'public'
}
```

### 6. action - 技能动作
```javascript
// 预言家查验（有 metadata）
{
  type: 'action',
  content: '你查验了 3号小刚，TA是狼人',
  playerId: 1,
  visibility: 'self',
  meta { targetId: 3, result: 'wolf' }
}

// 女巫救人（无 metadata）
{
  type: 'action',
  content: '你使用解药救了 5号小红',
  playerId: 5,
  visibility: 'self'
}

// 女巫毒人
{
  type: 'action',
  content: '你毒杀了 3号小刚',
  playerId: 5,
  visibility: 'self'
}

// 守卫守护
{
  type: 'action',
  content: '你守护了 2号小红',
  playerId: 2,
  visibility: 'self'
}

// 猎人开枪（公开）
{
  type: 'action',
  content: '猎人 3号Claude 开枪带走了 7号阿鹏',
  playerId: 3,
  visibility: 'public'
}

// 丘比特连线
{
  type: 'action',
  content: '你连接了 1号 和 4号 为情侣',
  playerId: 8,
  visibility: 'self'
}
```

### 7. death_announce - 死亡公告
```javascript
{
  type: 'death_announce',
  content: '5号小红 死亡',  // 或 '5号小红 被猎人射杀'
  deaths: [{ id: 5, name: '小红' }],
  visibility: 'public'
}
```

### 8. sheriff_candidates - 警长竞选候选人
```javascript
{
  type: 'sheriff_candidates',
  content: '警上：1号小明、4号小丽 | 警下：2号小红、3号小刚',
  visibility: 'public',
  meta {
    onStage: [{ id: 1, name: '小明' }, { id: 4, name: '小丽' }],
    offStage: [{ id: 2, name: '小红' }, { id: 3, name: '小刚' }]
  }
}
```

### 9. sheriff_elected - 警长当选
```javascript
{
  type: 'sheriff_elected',
  content: '1号小明 当选警长',  // 或 '1号小明 当选警长（PK当选）'
  sheriffId: 1,
  visibility: 'public'
}
```

### 10. system - 系统消息
```javascript
{
  type: 'system',
  content: '无人竞选警长',  // 或 '你和 4号 是情侣'
  playerId: 3,  // 可选，目标玩家
  visibility: 'public'  // 或 'self'
}
```

### 11. game_over - 游戏结束
```javascript
{
  type: 'game_over',
  content: '游戏结束，好人阵营获胜',
  winner: 'good',  // 或 'wolf', 'third'
  gameOverInfo: { ... },
  visibility: 'public'
}
```

## 改造方案

### 核心思路

1. **阶段合并**：夜晚所有阶段合并为 `第N夜`，白天所有阶段合并为 `第N天`
2. **子阶段标题**：`[狼人]`、`[警长竞选]`、`[发言]` 等作为子标题
3. **结构化数据优先**：优先使用 `metadata`、`deaths`、`voteDetails` 等结构化字段，文本匹配作为兜底

### 阶段分组

**夜晚阶段** → 输出 `第N夜`：
- `cupid` → 丘比特连线
- `guard` → 守卫守护（无标题）
- `night_werewolf_discuss` → `[狼人]` 子标题开始
- `night_werewolf_vote` → 狼人投票（继续在 `[狼人]` 下）
- `witch` → 女巫技能（无标题）
- `seer` → 预言家查验（无标题）

**白天阶段** → 输出 `第N天`：
- `day_announce` → `[死亡]xxx` 开头
- `sheriff_campaign` → `[警长竞选]` 子标题
- `sheriff_speech` → 竞选发言（在 `[警长竞选]` 下）
- `sheriff_vote` → 竞选投票（在 `[警长竞选]` 下）
- `day_discuss` → `[发言]` 子标题
- `day_vote` → `[投票]` 投票结果
- `post_vote` → `[放逐]`、`[遗言]` 等

### 格式化函数改造

```javascript
function formatMessageHistory(messages, players, gameState = {}) {
  const lines = [];
  let nightCount = 0;
  let dayCount = 0;
  let currentSection = null;  // 'night' | 'day'
  let inWolfSection = false;
  let inSheriffSection = false;
  let inSpeechSection = false;

  for (const msg of messages) {
    // 1. 处理阶段开始
    if (msg.type === 'phase_start') {
      handlePhaseStart(msg, lines, ...);
      continue;
    }

    // 2. 根据消息类型格式化
    switch (msg.type) {
      case 'wolf_speech':
        // 狼人发言，不重复输出 [狼人]
        lines.push(formatSpeech(msg, players));
        break;

      case 'wolf_vote_result':
        // 狼人投票结果
        lines.push(formatWolfVoteResult(msg, players));
        break;

      case 'speech':
      case 'last_words':
        // 普通发言/遗言
        lines.push(formatSpeech(msg, players));
        break;

      case 'action':
        // 技能动作，优先用 metadata
        lines.push(formatAction(msg, players));
        break;

      case 'death_announce':
        // 死亡公告，用 deaths 数组
        lines.push(formatDeath(msg, players));
        break;

      // ... 其他类型
    }
  }

  return lines.join('\n');
}
```

### 关键格式化函数

#### formatAction - 技能动作
```javascript
function formatAction(msg, players) {
  const meta = msg.metadata;

  // 预言家查验 - 优先用 metadata
  if (meta?.targetId && meta?.result) {
    const target = players.find(p => p.id === meta.targetId);
    const pos = getPlayerPosition(meta.targetId, players);
    const result = meta.result === 'wolf' ? '狼人' : '好人';
    return `[预言家]?:${pos}号${target?.name}=${result}`;
  }

  // 其他技能 - 文本匹配兜底
  const content = msg.content;
  if (content.includes('守护')) {
    // 守卫: 你守护了 2号小红 → [守卫]?:守护2号小红
    const match = content.match(/守护了?\s*(\d+)号(\S+)/);
    if (match) return `[守卫]?:守护${match[1]}号${match[2]}`;
  }

  if (content.includes('解药')) {
    // 女巫救: 你使用解药救了 5号小红 → [女巫]?:救5号小红
    const match = content.match(/救了?\s*(\d+)号(\S+)/);
    if (match) return `[女巫]?:救${match[1]}号${match[2]}`;
  }

  if (content.includes('毒杀')) {
    // 女巫毒: 你毒杀了 3号小刚 → [女巫]?:毒3号小刚
    const match = content.match(/毒杀了?\s*(\d+)号(\S+)/);
    if (match) return `[女巫]?:毒${match[1]}号${match[2]}`;
  }

  if (content.includes('开枪带走')) {
    // 猎人: 猎人 3号Claude 开枪带走了 7号阿鹏 → [猎人]3号Claude:枪杀7号阿鹏
    const match = content.match(/猎人\s*(\d+)号(\S+)\s+开枪带走了?\s*(\d+)号(\S+)/);
    if (match) return `[猎人]${match[1]}号${match[2]}:枪杀${match[3]}号${match[4]}`;
  }

  if (content.includes('连接了')) {
    // 丘比特: 你连接了 1号 和 4号 为情侣 → [丘比特]?:1号↔4号
    const match = content.match(/连接了\s*(\d+)号.*和.*(\d+)号/);
    if (match) return `[丘比特]?:${match[1]}号↔${match[2]}号`;
  }

  // 兜底
  return `[技能]${content}`;
}
```

#### formatDeath - 死亡公告
```javascript
function formatDeath(msg, players) {
  // 优先用 deaths 数组
  if (msg.deaths?.length > 0) {
    const names = msg.deaths.map(d => {
      const pos = getPlayerPosition(d.id, players);
      return `${pos}号${d.name}`;
    }).join('、');
    return `[死亡]${names}`;
  }

  // 兜底：移除 " 死亡"、" 被猎人射杀" 后缀
  let content = msg.content || '';
  content = content.replace(' 死亡', '').replace(' 被猎人射杀', '');
  return `[死亡]${content}`;
}
```

#### formatWolfVoteResult - 狼人投票
```javascript
function formatWolfVoteResult(msg, players) {
  const lines = [];

  // 票型
  if (msg.voteDetails?.length > 0) {
    // 按 target 分组
    const byTarget = {};
    for (const v of msg.voteDetails) {
      const target = v.target;
      if (!byTarget[target]) byTarget[target] = [];
      byTarget[target].push(v.voter);
    }
    const parts = Object.entries(byTarget).map(([target, voters]) => {
      return `${target}（${voters.join('、')}）`;
    });
    lines.push(`票型：${parts.join('；')}`);
  }

  // 最终击杀
  if (msg.content) {
    const match = msg.content.match(/击杀\s*(\d+)号(\S+)/);
    if (match) {
      lines.push(`最终击杀：${match[1]}号${match[2]}`);
    }
  }

  return lines.join('\n');
}
```

#### formatVoteResult - 投票结果
```javascript
function formatVoteResult(msg, players) {
  // 用 voteDetails 格式化
  if (msg.voteDetails?.length > 0) {
    const byTarget = {};
    for (const v of msg.voteDetails) {
      if (!byTarget[v.target]) byTarget[v.target] = [];
      byTarget[v.target].push(v.voter);
    }
    const parts = Object.entries(byTarget).map(([target, voters]) => {
      return `${target}(${voters.join(',')})`;
    });
    return `[投票]${parts.join(' ')}`;
  }

  // 兜底
  return `[投票]${msg.content || ''}`;
}
```

#### formatSheriffCandidates - 警长竞选
```javascript
function formatSheriffCandidates(msg, players) {
  // 优先用 metadata
  if (msg.metadata) {
    const onStage = msg.metadata.onStage.map(p => `${getPlayerPosition(p.id, players)}号${p.name}`).join(',');
    const offStage = msg.metadata.offStage.map(p => `${getPlayerPosition(p.id, players)}号${p.name}`).join(',');
    return `[警长竞选]\n上:${onStage} 下:${offStage}`;
  }

  // 兜底：文本解析
  const content = msg.content || '';
  const upMatch = content.match(/警上[：:]\s*([^|]+)/);
  const downMatch = content.match(/警下[：:]\s*(.+)/);
  const parts = [];
  if (upMatch) parts.push(`上:${upMatch[1].trim()}`);
  if (downMatch) parts.push(`下:${downMatch[1].trim()}`);
  return `[警长竞选]\n${parts.join(' ')}`;
}
```
