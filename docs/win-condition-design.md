# 胜利判断系统设计

## 一、问题分析

### 1.1 当前问题

1. **胜利条件硬编码**：所有板子共用一套胜利条件，无法适配不同规则
2. **判断顺序固定**：good → wolf → third 的顺序无法处理复杂场景
3. **第三方阻断缺失**：人狼恋存在时，狼人屠边不应直接胜利
4. **扩展性差**：后续加入更多第三方角色难以支持

### 1.2 需求场景

| 板子 | 胜利条件 |
|-----|---------|
| 9人标准局 | 狼人屠边（屠神或屠民） |
| 12人预女猎白 | 狼人屠边 |
| 12人守丘局 | 人狼恋存在时，狼人屠边需检查第三方是否存活；丘比特归属第三方时需一并清理 |

---

## 二、核心设计

### 2.1 设计思路

**每个板子独立定义胜利判断函数**，放入 `BOARD_PRESETS` 配置中：

```javascript
const BOARD_PRESETS = {
  '9-standard': {
    name: '9人标准局',
    roles: [...],
    checkWin: (game) => { ... }  // 该板子专用的胜利判断
  },
  '12-guard-cupid': {
    name: '12人守丘局',
    roles: [...],
    checkWin: (game) => { ... }  // 带人狼恋判断
  }
};
```

**优点**：
- 高度灵活，每个板子完全自定义
- 无需复杂的阻断机制和优先级系统
- 新增板子无需修改现有逻辑

### 2.2 阵营状态

玩家阵营分为 **原始阵营** 和 **实际阵营**：

| 角色 | 原始阵营 | 实际阵营（人狼恋时） |
|-----|---------|-------------------|
| 普通好人 | good | good |
| 普通狼人 | wolf | wolf |
| 人狼恋中的狼人 | wolf | **third** |
| 人狼恋中的好人 | good | **third** |
| 丘比特(人狼恋) | good | **third** |

**关键**：胜利条件判断基于实际阵营，而非原始阵营。

---

## 三、数据结构

### 3.1 板子配置

```javascript
const BOARD_PRESETS = {
  '9-standard': {
    name: '9人标准局',
    description: '预女猎3神3民3狼',
    playerCount: 9,
    roles: ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'],
    rules: { ... },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言',
      '狼人屠边（屠神或屠民）获胜'
    ],
    checkWin: (game) => {
      // 狼人胜利：屠边
      const gods = game.players.filter(p => p.alive && p.role.type === 'god');
      const villagers = game.players.filter(p => p.alive && p.role.type === 'villager');
      if (gods.length === 0 || villagers.length === 0) return 'wolf';
      
      // 好人胜利：狼人全灭
      const wolves = game.players.filter(p => p.alive && p.role.camp === 'wolf');
      if (wolves.length === 0) return 'good';
      
      return null;
    }
  },
  
  '12-hunter-idiot': {
    name: '12人预女猎白',
    description: '标准12人局，含白痴无守卫',
    playerCount: 12,
    roles: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'idiot', 'villager', 'villager', 'villager', 'villager'],
    rules: { ... },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言',
      '狼人屠边（屠神或屠民）获胜'
    ],
    checkWin: (game) => {
      // 与9人标准局相同，屠边规则
      const gods = game.players.filter(p => p.alive && p.role.type === 'god');
      const villagers = game.players.filter(p => p.alive && p.role.type === 'villager');
      if (gods.length === 0 || villagers.length === 0) return 'wolf';
      
      const wolves = game.players.filter(p => p.alive && p.role.camp === 'wolf');
      if (wolves.length === 0) return 'good';
      
      return null;
    }
  },
  
  '12-guard-cupid': {
    name: '12人守丘局',
    description: '含守卫丘比特，有情侣第三方',
    playerCount: 12,
    roles: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'guard', 'hunter', 'cupid', 'villager', 'villager', 'villager'],
    rules: { ... },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '守卫不可连守',
      '同守同救则死亡',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言',
      '狼人屠边获胜；好人需清理所有狼人',
      '人狼恋时，好人/狼人都需清理情侣+丘比特才能获胜',
      '人狼恋胜利：情侣+丘比特存活，其他人全死'
    ],
    checkWin: (game) => {
      // ===== 辅助函数 =====
      
      // 判断是否为人狼恋
      const isHumanWolfCouple = () => {
        if (!game.couples || game.couples.length < 2) return false;
        const coupleCamps = game.couples.map(id => {
          const p = game.players.find(pl => pl.id === id);
          return p.role.camp;
        });
        return coupleCamps.includes('good') && coupleCamps.includes('wolf');
      };
      
      // 获取第三方成员ID（丘比特+情侣）
      const getThirdPartyIds = () => {
        const ids = [...game.couples];
        const cupid = game.players.find(p => p.role.id === 'cupid');
        if (cupid) ids.push(cupid.id);
        return ids;
      };
      
      // 获取实际阵营
      const getActualCamp = (player) => {
        // 非人狼恋，返回原始阵营
        if (!isHumanWolfCouple()) return player.role.camp;
        
        // 人狼恋：丘比特和情侣始终为第三方
        const thirdPartyIds = getThirdPartyIds();
        return thirdPartyIds.includes(player.id) ? 'third' : player.role.camp;
      };
      
      // ===== 胜利判断 =====
      
      // 第三方胜利：人狼恋且情侣+丘比特都存活，其他人全死
      if (isHumanWolfCouple()) {
        const thirdPartyIds = getThirdPartyIds();
        
        // 情侣+丘比特都存活
        const thirdPartyAlive = thirdPartyIds.every(id => {
          const p = game.players.find(pl => pl.id === id);
          return p && p.alive;
        });
        // 其他人都死
        const othersDead = game.players.filter(p => !thirdPartyIds.includes(p.id)).every(p => !p.alive);
        
        if (thirdPartyAlive && othersDead) return 'third';
      }
      
      // 按实际阵营统计存活
      const alivePlayers = game.players.filter(p => p.alive);
      const aliveByCamp = {
        good: alivePlayers.filter(p => getActualCamp(p) === 'good').length,
        wolf: alivePlayers.filter(p => getActualCamp(p) === 'wolf').length,
        third: alivePlayers.filter(p => getActualCamp(p) === 'third').length
      };
      
      // 好人胜利：狼人和第三方都死光
      if (aliveByCamp.wolf === 0 && aliveByCamp.third === 0) return 'good';
      
      // 狼人胜利：屠边且第三方死光
      const gods = alivePlayers.filter(p => getActualCamp(p) !== 'third' && p.role.type === 'god');
      const villagers = alivePlayers.filter(p => getActualCamp(p) !== 'third' && p.role.type === 'villager');
      if ((gods.length === 0 || villagers.length === 0) && aliveByCamp.third === 0) return 'wolf';
      
      return null;
    }
  }
};
```

### 3.2 调用方式

```javascript
// phase.js 中调用
function checkWin(game) {
  const preset = BOARD_PRESETS[game.preset];
  return preset.checkWin(game);
}
```

---

## 四、人狼恋场景推演

### 4.1 场景：丘比特连接好人+狼人

**初始状态**：
- 丘比特（好人阵营）连接玩家A（好人）和玩家B（狼人）
- 形成人狼恋 → 第三方阵营：丘比特 + A + B

**胜利条件判断**：

| 场景 | 判断结果 |
|-----|---------|
| 狼人屠边，但情侣或丘比特存活 | 狼人不胜，游戏继续 |
| 狼人屠边，情侣+丘比特已死 | 狼人胜 |
| 情侣+丘比特存活，其他人全死 | 第三方胜 |
| 好人杀光狼人，但情侣或丘比特存活 | 好人不胜，游戏继续 |
| 好人杀光狼人和情侣+丘比特 | 好人胜 |

### 4.2 关键点

1. **第三方成员**：人狼恋成立后，丘比特+情侣都归属第三方
2. **阻断条件**：情侣或丘比特有存活，则第三方存在，阻断好人/狼人胜利
3. **胜利条件**：好人/狼人需清理全部第三方（情侣+丘比特）才能获胜

---

## 五、总结

| 设计要点 | 说明 |
|---------|-----|
| **板子独立配置** | 每个板子定义自己的 `checkWin` 函数 |
| **实际阵营** | 人狼恋改变玩家实际阵营，丘比特也归属第三方 |
| **高度灵活** | 新增板子无需修改现有逻辑 |