# 板子（Preset）系统改造方案

## 背景

当前问题：
- 角色配置散落在 `engine/main.js assignRoles()`、`test/game.test.js createTestGame()`、`server.js` 三处，各自硬编码 `roles9`/`roles12`
- 前端只传 `playerCount`，无法表达"12人守丘白局"vs"12人双女巫局"等差异
- `ai/prompts.js` 的 `SPECIAL_RULES` 是硬编码字符串，与 `engine/config.js` 的 `RULES` 不同步（比如改了 config 的规则，AI prompt 里的规则描述不会跟着变）
- 规则没有面向玩家的展示文本
- `canShootIfPoisoned` 在 `config.RULES` 中定义了但从未被引用，`roles.js` 里猎人开枪判断是硬编码的 `deathReason === 'poison'`，配置形同虚设

## 核心设计：板子是规则和角色的唯一来源

**关键决策**：板子同时定义角色配置、规则覆写、规则描述。`config.js` 的 `RULES` 只保留引擎行为默认值（代码逻辑层面的 fallback），板子的 `rules` 字段覆盖默认值，板子的 `ruleDescriptions` 字段面向玩家/AI展示。

这样做的好处：
- 改板子规则不用改代码，只改配置
- AI prompt 和前端展示的规则描述天然同步（都从同一个板子读）
- `config.js RULES` 只是 fallback，板子未指定的规则用默认值

## 数据结构

### `engine/config.js` — BOARD_PRESETS

```js
const BOARD_PRESETS = {
  '9-standard': {
    name: '9人标准局',
    description: '入门局，适合新手',
    playerCount: 9,
    // 参考 RULES.md 10.4：3狼、预言家、女巫、猎人、3村民
    roles: ['werewolf','werewolf','werewolf','seer','witch','hunter','villager','villager','villager'],
    rules: {
      witch: { canSelfHeal: true, canUseBothSameNight: true },
      hunter: { canShootIfPoisoned: false },
      sheriff: { enabled: true, sheriffAssignOrder: true }
    },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言'
    ]
  },
  '12-hunter-idiot': {
    name: '12人预女猎白',
    description: '标准12人局，含白痴无守卫',
    playerCount: 12,
    // 参考 RULES.md 10.2：4狼、预言家、女巫、猎人、白痴、4平民
    roles: ['werewolf','werewolf','werewolf','werewolf','seer','witch','hunter','idiot','villager','villager','villager','villager'],
    rules: {
      witch: { canSelfHeal: true, canUseBothSameNight: true },
      hunter: { canShootIfPoisoned: false },
      sheriff: { enabled: true, sheriffAssignOrder: true }
    },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言'
    ]
  },
  '12-guard-cupid': {
    name: '12人守丘局',
    description: '含守卫丘比特，有情侣第三方',
    playerCount: 12,
    // 参考 RULES.md 10.5：4狼、预言家、女巫、守卫、猎人、丘比特、3村民
    roles: ['werewolf','werewolf','werewolf','werewolf','seer','witch','guard','hunter','cupid','villager','villager','villager'],
    rules: {
      witch: { canSelfHeal: true, canUseBothSameNight: true },
      guard: { allowRepeatGuard: false },
      hunter: { canShootIfPoisoned: false },
      sheriff: { enabled: true, sheriffAssignOrder: true }
    },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '守卫不可连守',
      '同守同救则死亡',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言',
      '情侣一方死亡另一方殉情'
    ]
  }
};
```

**与初版方案的修正点**：

1. `rules` 不应只写"与默认值相同"的字段，而应**完整声明该板子用到的所有规则**。理由：默认值是给没有板子的场景用的（如测试），板子的 rules 应该自包含，让人看板子就知道所有规则，不用去翻 config 默认值再对比差异。
2. `sheriff` 规则也要纳入板子（`phase.js:305` 已在读取 `RULES.sheriff`），未来可能出现无警长板子。
3. `ruleDescriptions` 里的"首夜/白天死亡有遗言"表述模糊，改为更准确的"首夜和白天死亡有遗言，后续夜晚死亡无遗言"。
4. 9人局和12人预女猎白局没有守卫，不需要写 `guard` 规则（没有守卫角色时该规则不会被引用），只写实际用到的规则。
5. 参考 RULES.md 第十节，将原来的"12人守丘白局"拆分为两个标准板子：12人预女猎白（10.2）和12人守丘局（10.5）。原代码中 12 人局的 roles 配置（4狼/预言家/女巫/猎人/守卫/丘比特/白痴/2民）不在任何标准板子中，应按 RULES.md 校正。
6. 12人守丘局增加了"同守同救则死亡"的 ruleDescription（RULES.md 3.1 明确规定），这在前一版方案中遗漏了。

### 规则合并逻辑

```js
// 合并规则：板子 rules 覆盖 config RULES 默认值
function getEffectiveRules(preset) {
  const merged = JSON.parse(JSON.stringify(RULES));
  for (const [category, overrides] of Object.entries(preset.rules || {})) {
    merged[category] = { ...merged[category], ...overrides };
  }
  return merged;
}
```

### 现有代码中规则引用的问题

当前 `rules.js` 和 `phase.js` 对规则的引用方式不统一，改造时需一并修正：

| 位置 | 当前写法 | 问题 | 改造后 |
|------|---------|------|--------|
| `roles.js:82` | `RULES.witch.canSelfHeal` | 直接引用 config 默认值，不感知板子 | `game.effectiveRules.witch.canSelfHeal` |
| `roles.js:190` | `RULES.guard.allowRepeatGuard` | 同上 | `game.effectiveRules.guard.allowRepeatGuard` |
| `phase.js:124` | `game.config.hooks?.RULES?.witch?.canSelfHeal` | 通过 hooks 间接引用，且逻辑重复（自己又判断了 `nightCount === 1`） | `game.effectiveRules.witch.canSelfHeal`，自救判断逻辑统一 |
| `phase.js:305` | `game.config.hooks?.RULES?.sheriff` | 同上 | `game.effectiveRules.sheriff` |
| `roles.js:133` | `deathReason === 'poison'` 硬编码 | `canShootIfPoisoned` 配置从未生效 | 改为读取 `game.effectiveRules.hunter.canShootIfPoisoned` |

改造方式：GameEngine 构造时计算 `this.effectiveRules = getEffectiveRules(preset)`，所有代码统一从 `game.effectiveRules` 读取规则。

### AI prompt 同步

`ai/prompts.js` 删除硬编码 `SPECIAL_RULES`，改为从 game 实例读取：

```js
// 之前：硬编码
const SPECIAL_RULES = '规则:女巫仅首夜可自救|...';

// 之后：从 game 的 preset 动态获取
function buildSystemPrompt(player, game) {
  const ruleDescs = game.preset?.ruleDescriptions || [];
  const rulesText = ruleDescs.length > 0
    ? '规则:' + ruleDescs.join('|')
    : '';
  // ... 拼接到 prompt
}
```

## 板子锁定机制

**第一个点"准备"的玩家唯一决定板子配置。**

流程：
1. 所有玩家进入房间时，前端展示板子列表供选择
2. 第一个玩家点"准备"时，携带 `presetId`，服务端锁定 `currentPresetId`
3. `currentPresetId` 锁定后：
   - 前端：其他玩家的板子选择器禁用/隐藏，显示"已锁定为 XX 局"
   - 服务端：后续 join/add_ai 忽略 presetId，使用已锁定的板子
4. reset 后 `currentPresetId = null`，解锁

服务端实现：
```js
let currentPresetId = null;

function handleJoin(ws, msg) {
  if (!game) {
    // 第一个玩家：锁定板子
    currentPresetId = msg.presetId || '9-standard';
    const preset = BOARD_PRESETS[currentPresetId];
    game = new GameEngine({ presetId: currentPresetId });
    // ...
  }
  // 后续玩家：忽略 msg.presetId，使用 currentPresetId
}

function handleReset() {
  currentPresetId = null;
  // ...
}
```

### 锁定状态的前端同步

板子锁定信息需要通过 state 下发给前端：

- waiting 状态新增 `presetId` 和 `presetLocked` 字段
- 前端据此决定：选择器是否可交互、显示锁定提示
- 后加入的玩家连接时，从 state 中读取已锁定的板子信息

## 改动清单

### 1. `engine/config.js`
- 新增 `BOARD_PRESETS` 定义
- 新增 `getEffectiveRules(preset)` 函数
- 导出 `BOARD_PRESETS`、`getEffectiveRules`
- `RULES` 保留作为引擎默认值，不删除

### 2. `engine/main.js`
- 构造函数接收 `presetId`，存为 `this.preset`（从 BOARD_PRESETS 取完整对象）
- 构造时计算 `this.effectiveRules = getEffectiveRules(this.preset)`
- `this.playerCount` 改为从 `this.preset.playerCount` 派生（保留 getter 兼容）
- `assignRoles()` 从 `this.preset.roles` 取角色配置，删除硬编码 `roles9`/`roles12`
- `getState()` 返回 preset 信息（name、description、playerCount、roleSummary、ruleDescriptions）

### 3. `engine/roles.js`
- 所有 `RULES.xxx` 引用改为 `game.effectiveRules.xxx`
- 猎人被毒不能开枪的逻辑从硬编码 `deathReason === 'poison'` 改为读取 `game.effectiveRules.hunter.canShootIfPoisoned`

### 4. `engine/phase.js`
- 所有 `game.config.hooks?.RULES?.xxx` 引用改为 `game.effectiveRules.xxx`
- 女巫自救判断逻辑统一（当前 phase.js:124 自己又拼了 `nightCount === 1` 的逻辑，应统一走 effectiveRules）

### 5. `ai/prompts.js`
- 删除硬编码 `SPECIAL_RULES` 常量
- `buildSystemPrompt` 从 `game.preset.ruleDescriptions` 动态构建规则文本
- 删除 `SPECIAL_RULES` 导出

### 6. `server.js`
- 新增 HTTP 接口 `GET /api/presets`，返回 `BOARD_PRESETS` 列表
- 新增全局 `currentPresetId = null`
- `handleJoin`: 接收 `presetId`，第一个玩家锁定板子
- `handleAddAI`: 使用已锁定的 `currentPresetId`
- `handleReset`: 清除 `currentPresetId`
- `broadcastState` / 初始状态: 返回 preset 信息和锁定状态（`presetId`、`presetLocked`）
- 删除所有硬编码 `playerCount: 9`

### 7. 前端 `public/app.js` + `public/controller.js`
- 页面加载时 `fetch('/api/presets')` 获取板子列表
- 渲染板子选择器（替代原人数下拉框），展示 name + description + 角色概览 + ruleDescriptions
- `controller.join(name, presetId)` 替代 `join(name, playerCount)`
- `connect()` 的 `send('join', ...)` 携带 `presetId`
- 板子锁定后：禁用选择器，显示"已锁定为 XX 局"
- 游戏中头部显示板子名称 + ruleDescriptions
- `autoJoin` 从 URL 读 `preset` 参数

### 8. `cli_client.js`
- `--preset` 参数，值为 presetId（如 `9-standard`、`12-hunter-idiot`、`12-guard-cupid`）
- `--players` 保留做向后兼容，但 12 人局有多个板子时无法自动映射，需提示用户用 `--preset`：
  - `--players 9` → 自动映射 `--preset 9-standard`
  - `--players 12` → 报错提示"12人局有多个板子，请使用 --preset 指定"，并列出可选 presetId
- `--help` 输出中列出所有可用板子及其 name/description/角色配置
- 新增 `--list-presets` 命令，详细展示板子信息（角色列表、规则描述）
- Daemon 的 join 消息携带 `presetId`
- 状态显示中展示板子名称

### 9. 测试改造

#### `test/game.test.js`

**`createTestGame` 改造**：

```js
// 之前
function createTestGame(playerCount = 9) {
  const game = new GameEngine();
  game.playerCount = playerCount;
  const roles9 = ['werewolf', 'werewolf', ...];
  const roles12 = ['werewolf', 'werewolf', ...];
  const roles = playerCount <= 9 ? roles9.slice(0, playerCount) : roles12.slice(0, playerCount);
  // ...
}

// 之后
function createTestGame(presetId = '9-standard') {
  const preset = BOARD_PRESETS[presetId];
  const game = new GameEngine({ presetId });
  // game.playerCount 由 preset 派生，无需手动设置
  // game.effectiveRules 由 GameEngine 构造时计算
  const roles = preset.roles;
  // ... 后续创建玩家、MockAgent 逻辑不变
}
```

**`createGameWithMockAgents` 改造**：

当前该函数接收 `playerCount` 和自定义 `roles` 数组，用于构造特定角色组合的测试场景（如特定角色死亡的测试）。改造后：

```js
// 之前
function createGameWithMockAgents(playerCount, roles) {
  const game = new GameEngine();
  game.playerCount = playerCount;
  // 用传入的 roles 创建玩家
}

// 之后
function createGameWithMockAgents(presetId, roleOverrides) {
  const preset = BOARD_PRESETS[presetId];
  const game = new GameEngine({ presetId });
  // roleOverrides: 可选，覆写 preset.roles 中的部分角色（用于特殊测试场景）
  const roles = roleOverrides || preset.roles;
  // ... 后续逻辑不变
}
```

**现有用例迁移**：

- `createTestGame(9)` → `createTestGame('9-standard')`，约30处
- `createTestGame(12)` → 需逐个判断用哪个板子：
  - 涉及守卫/丘比特的用例 → `createTestGame('12-guard-cupid')`
  - 只涉及白痴的用例 → `createTestGame('12-hunter-idiot')`
  - 当前代码 `createTestGame(12)` 用的是硬编码 `roles12`（含守卫+丘比特+白痴+2民），这个组合不在任何标准板子中，需逐个审视：
    - 测试守卫/丘比特 → 迁移到 `'12-guard-cupid'`（注意该板子无白痴，如有白痴相关断言需调整）
    - 测试白痴 → 迁移到 `'12-hunter-idiot'`（注意该板子无守卫/丘比特，如有相关断言需调整）
    - 同时依赖守卫+丘比特+白痴的用例 → 暂用 `'12-guard-cupid'` 并单独补充白痴角色（通过 `createGameWithMockAgents`）
- `createGameWithMockAgents(12, roles)` → `createGameWithMockAgents('12-guard-cupid', roles)` 或 `'12-hunter-idiot'`，约5处，同上逐个判断

**新增测试**：

- 板子系统本身：验证 `getEffectiveRules` 合并逻辑、`BOARD_PRESETS` 结构完整性
- `createTestGame` 传入不存在的 presetId 应报错
- `game.effectiveRules` 正确反映板子规则覆写

#### `test/context.test.js`

该文件有自己的 `createTestGame`（仅用 9 人），同样改为接收 `presetId`。`createGameWithLLMAgent` 同理。

#### `test/websocket.test.js` / `test/human-player.test.js`

这两个文件直接 `new GameEngine()` + `game.playerCount = 9`，改为 `new GameEngine({ presetId: '9-standard' })`，删除 `game.playerCount` 赋值。

#### `test/compression.test.js`

该文件不涉及 GameEngine 创建，无需改动。

## 前端展示示例

### 选板子阶段（板子未锁定）

```
┌──────────────────────────────────────────┐
│  选择板子                                 │
│                                          │
│  ● 9人标准局                              │
│    入门局，适合新手                        │
│    3狼 / 预言家 / 女巫 / 猎人 / 3民       │
│    · 女巫仅首夜可自救                      │
│    · 猎人被毒不能开枪                      │
│    · 首夜和白天死亡有遗言，后续夜晚无遗言   │
│                                          │
│  ○ 12人预女猎白                            │
│    标准12人局，含白痴无守卫                 │
│    4狼 / 预言家 / 女巫 / 猎人 / 白痴 / 4民 │
│    · 女巫仅首夜可自救                      │
│    · 猎人被毒不能开枪                      │
│    · 首夜和白天死亡有遗言，后续夜晚无遗言   │
│                                          │
│  ○ 12人守丘局                              │
│    含守卫丘比特，有情侣第三方               │
│    4狼 / 预言家 / 女巫 / 守卫 / 猎人 /    │
│    丘比特 / 3民                            │
│    · 女巫仅首夜可自救                      │
│    · 守卫不可连守                          │
│    · 同守同救则死亡                        │
│    · 猎人被毒不能开枪                      │
│    · 首夜和白天死亡有遗言，后续夜晚无遗言   │
│    · 情侣一方死亡另一方殉情                │
│                                          │
│  [准备]                                   │
└──────────────────────────────────────────┘
```

### 板子已锁定（非首位玩家）

```
┌──────────────────────────────────────────┐
│  板子已锁定: 12人守丘局                     │
│  4狼 / 预言家 / 女巫 / 守卫 / 猎人 /       │
│  丘比特 / 3民                              │
│  · 女巫仅首夜可自救                        │
│  · 守卫不可连守                            │
│  · 猎人被毒不能开枪                        │
│                                          │
│  [准备]                                   │
└──────────────────────────────────────────┘
```

### 游戏中头部

```
12人守丘局 | 第2天 | 女巫仅首夜可自救 · 守卫不可连守 · 猎人被毒不能开枪
```

## 改造中需同步修复的问题

### 1. `canShootIfPoisoned` 配置从未生效

`config.RULES.hunter.canShootIfPoisoned = false` 定义了但无人使用。`roles.js` 猎人开枪判断直接硬编码 `deathReason === 'poison'`。改造时需让 `game.effectiveRules.hunter.canShootIfPoisoned` 真正生效。

### 2. 女巫自救逻辑散落两处

- `phase.js:124` 自己拼了 `game.config.hooks?.RULES?.witch?.canSelfHeal !== false && game.nightCount === 1`
- `roles.js:82` 用 `extraData?.canSelfHeal ?? RULES.witch.canSelfHeal`
- `main.js:171` 又有 `canSelfHeal: extraData?.canSelfHeal ?? (this.nightCount === 1)`

三处逻辑重复且不一致。改造时应统一：`effectiveRules.witch.canSelfHeal` 只控制"女巫能否自救"这个规则开关，"仅首夜"这个条件属于规则描述的一部分（`ruleDescriptions` 里写"仅首夜可自救"），引擎层面由 `nightCount` 判断，不再重复配置。

### 3. `hasLastWords` 未纳入板子规则

`config.js` 的 `hasLastWords` 函数是硬编码的逻辑，没有通过 `RULES` 配置化。当前无法通过板子配置"无遗言"或"所有死亡都有遗言"。这是已有局限，本次改造暂不处理（需较大重构），但 `ruleDescriptions` 中应准确描述遗言规则。