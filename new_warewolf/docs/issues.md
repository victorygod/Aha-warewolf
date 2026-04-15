# 狼人杀服务端问题分析

## 问题1：并发问题

### 1.1 警长竞选 - 串行问题 ✅ 已修复

**现象**：从日志可以看到，警长竞选是逐个玩家进行的：
```
1776170094567 [AI] 阿华 使用技能 campaign → {"run":true}
1776170094569 [AI] 小玲 使用技能 campaign → {"run":false}
1776170094570 Claude 使用技能 campaign  # 等待人类玩家
...
```

**原因**：`engine/phase.js` 第146-175行使用了 for 循环 + await：
```javascript
for (const player of candidates) {
  const result = await game.callSkill(player.id, 'campaign');
  // ...
}
```

**期望行为**：所有玩家应该**同时**决定是否竞选，而不是逐个等待。竞选是一个需要保密的决定，应该并发执行。

**修复情况**：
- ✅ 已修改 `engine/phase.js`，竞选阶段使用 `Promise.all` 并发执行
- ✅ 退水阶段同样修改为并发执行

### 1.2 警长投票 - 已是并发 ✅

从 `engine/vote.js` 第177-181行可以看到，警长投票已经使用 `Promise.all`。

### 1.3 狼人投票 - 已是并发 ✅

从 `engine/phase.js` 第80行可以看到，狼人投票已经使用 `Promise.all`。

### 1.4 白天投票 - 已是并发 ✅

从 `engine/phase.js` 第326行可以看到，白天投票已经使用 `Promise.all`。

---

## 问题2：AI Context 信息问题

### 2.1 位置编号错误 ✅ 已修复

**现象**：从日志可以看到，AI 收到的可选投票范围位置编号错误：
```
1776170094559 [AI] 小燕 使用技能 seer，可选: 8号阿华, 7号小玲, 1号Claude, 2号a, 4号阿明, 6号阿杰, 9号阿鹏, 5号小红
```

实际玩家位置应该是：
- 1号阿华、2号小玲、3号Claude、4号a、5号阿明、6号阿杰、7号阿鹏、8号小红、9号小燕

**根本原因**：`ai/controller.js` 和 `engine/player.js` 多处直接使用 `id` 作为位置编号，而不是使用 `getPlayerDisplay` 方法。

**修复情况**：
- ✅ 已修改 `ai/controller.js`，导入并使用 `getPlayerDisplay` 方法
- ✅ 已修改 `engine/player.js`，导入并使用 `getPlayerDisplay` 方法
- ✅ 所有显示玩家名称的地方统一使用 `getPlayerDisplay(players, player)` 格式

### 2.2 AI Context 缺少关键信息 ✅ 已修复

**原始问题**：AI 看到的 context 结构存在多个问题：

1. **阵营显示问题** ~~（批注：由于人狼恋中好人一方不知道自己是否是人狼恋，这个阵营不能写明。）~~
   - ✅ 已修复：移除了阵营显示，狼人队友信息保留

2. **角色描述无用** ~~（批注：这句话是哪里来的，好像没啥用？这里应该放一些特殊规则，比如女巫仅首夜能自救，仅首夜有遗言等）~~
   - ✅ 已修复：删除 `ROLE_DESCRIPTIONS`，替换为 `SPECIAL_RULES`，包含：
     - 女巫仅首夜可以自救
     - 守卫不能连续守护同一人
     - 猎人被毒死不能开枪
     - 首夜死亡和白天死亡有遗言，第二夜及之后的夜晚死亡无遗言
     - 情侣一方死亡另一方殉情，人狼恋时情侣属于第三方阵营

3. **AI soul 未生效** ~~（批注：本来这里应该每个AI都有独特的灵魂的，为什么这里都读不出来）~~
   - ✅ 已修复：`server.js` 创建 AI player 时添加 `soul: profiles[0].soul`

**仍缺少的信息**（待后续优化）：
1. 存活玩家列表：AI 不知道当前还有谁活着
2. 预言家查验记录：预言家看不到自己之前的查验结果
3. 女巫药水状态：女巫看不到自己是否有解药/毒药
4. 守卫上晚守护对象：守卫看不到自己上晚守护了谁
5. 情侣信息：丘比特连的情侣看不到对方是谁

---

## 问题5：AI Context 信息传递分析

### 5.1 现有消息传递机制 ✅

消息通过 `visibility` 机制控制可见性：

| 角色 | 信息 | 消息类型 | visibility | 示例 |
|------|------|----------|------------|------|
| 预言家 | 查验结果 | `action` | `self` | `【技能】你查验了 3号阿明，TA是狼人` |
| 女巫 | 用药结果 | `action` | `self` | `【技能】你使用解药救了 5号小红` |
| 守卫 | 守护结果 | `action` | `self` | `【技能】你守护了 2号小玲` |
| 丘比特 | 连线结果 | `action` | `self` | `【技能】你连接了 1号阿华 和 4号a 为情侣` |
| 情侣 | 互相知道 | `action` | `couple` | `【技能】你和 4号a 是情侣` |

### 5.2 state.self 私有状态 ✅

```javascript
state.self = {
  seerChecks: [{ targetId: 3, result: 'wolf', night: 1 }, ...],  // 预言家查验历史
  witchHeal: 1,             // 女巫解药数量
  witchPoison: 1,           // 女巫毒药数量
  lastGuardTarget: 3,       // 守卫上一晚守护目标
  couplePartner: 5,         // 情侣对方 ID
}
```

### 5.3 问题：提示词未充分利用这些信息 ⚠️

| 信息 | 消息历史 | state.self | 阶段提示词 | 问题 |
|------|----------|------------|------------|------|
| 预言家查验历史 | ✅ 有单条记录 | ✅ 有数组 | ❌ 无汇总 | AI 需要从历史消息中提取 |
| 女巫药水 | - | ✅ 有 | ✅ 有显示 | 正常 |
| 守卫上晚守护 | ✅ 有单条记录 | ✅ 有 | ❌ 无显示 | AI 不知道不能连守谁 |
| 情侣身份 | ✅ 有连线消息 | ✅ 有 | ❌ 无显示 | AI 可能忘记情侣是谁 |

### 5.4 修复方案

1. **预言家**：在 `seer` 阶段提示词中添加已查验汇总
2. **守卫**：在 `guard` 阶段提示词中显示上一晚守护对象
3. **情侣**：在系统提示词中显示情侣信息

### 5.5 消息格式优化

当前消息格式存在冗余换行和格式不统一问题，需要优化为更紧凑的格式。

### 2.3 消息历史格式问题 ✅ 已修复

**现象**：某些消息类型显示不完整，例如：
```
[sheriff_candidates] 警上：1号阿华、4号a、7号阿鹏、8号小红、9号小燕 | 警下：...
```

**修复情况**：
- ✅ 已修改 `ai/agents/random.js`，添加 `sheriff_candidates` 消息类型处理
- ✅ 已修改 `ai/agents/llm.js`，同步添加所有消息类型处理

---

## 问题3：其他问题

### 3.1 竞选阶段缺少上下文 ⏸️ 无需修复

**现象**：AI 在决定是否竞选时，不知道当前有多少人已经竞选，缺少决策依据。

**建议**：在竞选阶段前，先广播当前竞选人数，或者在 `campaign` 阶段的 context 中包含已竞选玩家列表。

**批注**：不可以，竞选阶段本来就是盲竞选的，绝对不能包含这些信息。

**结论**：按批注要求，不修复此问题，保持盲竞选机制。

### 3.4 日志中 AI Context 输出问题 ✅ 已修复

**现象**：`random.js` 的 `logContext` 方法会输出完整的 context 到日志，导致日志非常长。

**建议**：考虑使用 `debug` 级别而非 `info` 级别，或者只在需要时开启详细日志。

**批注**：我觉得这个建议非常好！但是我不确定 debug 模式关闭的时候就不打印 debug 日志。

**修复情况**：
- ✅ 已修改 `utils/logger.js`，添加 `DEBUG_MODE` 环境变量开关
- ✅ `DEBUG` 级别日志在 `DEBUG_MODE=false`（默认）时不写入
- ✅ 日志级别规范：
  - **INFO**：玩家行为（发言、投票、技能使用）、阶段变更
  - **DEBUG**：工程调试信息（AI context、内部状态等）
  - **WARN/ERROR**：警告和错误
- ✅ 通过 `DEBUG=1 node server.js` 开启 DEBUG 日志

---

## 问题4：gameOverInfo 显示问题 ✅ 已修复

### 4.1 后端 gameOverInfo 缺少 display 字段 ✅ 已修复

**现象**：游戏结束时，前端和 cli_client.js 显示的玩家信息格式不正确。

**原因**：`engine/main.js` 第619-628行的 `gameOverInfo` 结构中缺少 `display` 字段。

**修复情况**：
- ✅ 已修改 `engine/main.js`，在 `gameOverInfo.players` 中添加 `display: getPlayerDisplay(this.players, p)`

### 4.2 前端/cli_client.js fallback 逻辑错误 ✅ 已修复

**现象**：当 `display` 字段缺失时，fallback 显示 `${p.id}号${p.name}`，但 `p.id` 是内部 ID，不是位置编号。

**修复情况**：
- ✅ 已修复 `cli_client.js` 第265行，使用 `getPlayerPos(p.id, state.players)` 计算位置编号
- ✅ 已修复 `public/app.js` 第911行，使用索引计算位置作为 fallback

---

## Context 结构参考

当前 AI 收到的 context 结构（来自 `random.js:logContext`）：

```
- 名字：{playerName}
- 位置：{position}号位
- 角色：{roleName}
- 狼队友：{teammates}  // 仅狼人

{soul}  // AI 人物设定

## 游戏规则
1. 女巫：仅首夜可以自救...
...

## 策略
首先整理目前已知确定性的信息和怀疑的信息。
对于事实性的事件，完全相信。
对于他人的发言，需要分情况分析，不可盲目轻信。
做出最能取得胜利的行动选项。

===== 消息历史 =====
[阶段标题]
[发言] X号{Name}：{content}
...

===== 当前阶段 =====
【阶段提示词】
```

**建议添加的字段**（待后续优化）：
```
- 存活玩家：{aliveCount}人
- 已查验：{seerChecks}  // 仅预言家
- 解药：{healCount}瓶  // 仅女巫
- 毒药：{poisonCount}瓶  // 仅女巫
- 上晚守护：{lastGuardTarget}  // 仅守卫
- 情侣：{couplePartner}  // 仅丘比特/情侣
```