# 房间系统设计方案

## 核心变更：去掉登录页，进入即入房

当前流程：选板子 → 输名字 → 点准备 → 连接 WebSocket → 加入房间

新流程：打开页面 → 自动加入房间 → 在房间内完成所有操作

没有登录页，没有页面切换，所有人进入后直接在房间里。

## 等待阶段 UI

等待阶段不使用双列侧栏布局（侧栏太窄放不下操作），中间区域全屏展示房间配置和玩家列表：

```
┌──────────────────────────────────────┐
│  欢愉杀  │ 9人标准局 ▾ │ 3/9 已准备  │  ← 顶栏：板子名称可点击展开/切换
├──────────────────────────────────────┤
│  1号 大刚      [改名][选角*][✓准备] │
│  2号 小玲      [改名][选角*][ 准备 ] │  ← 玩家卡片，自己可操作
│  3号 AI-花火   [选角*][✓准备]       │  ← AI 自动准备
│  4号 (空位)    [+AI]                   │
│  ...                                  │
│  观战: 张三 [👁村民] [切换视角]           │  ← 观战区
│                                           │
│  * 选角仅 debug 模式下显示                │
├──────────────────────────────────────┤
│  消息区                               │
└──────────────────────────────────────┘
```

游戏开始后，改名字、选角、准备按钮等操作项隐藏，恢复正常游戏布局。

## 配置变更：任何人可改，无房主

- 任何玩家都可以切换板子、修改配置
- 不同意的玩家取消准备即可
- 不需要投票、不需要房主审批
- 局域网场景，信任关系足够，不需要冲突解决机制

配置变更后，所有人的板子选择 UI 同步更新（通过 WebSocket 推送），已准备的玩家自动取消准备状态（因为配置变了，需要重新确认）。

## 准备机制

- 每个人点"准备"（UI 上显示为「入梦」）表示确认当前配置
- 所有人准备后才开局，不再人满即开
- 准备后：角色选择锁定，不可再改
- 取消准备后：恢复可编辑状态
- 配置被任何人修改后：所有已准备的玩家自动取消准备

## Debug 模式与角色选择

- Debug 模式由服务端 `--debug` 参数决定，全局生效
- Debug 模式下，每个玩家（包括 AI）在准备前可选择自己想要的角色
- 点了准备后角色选择锁定
- 非 Debug 模式下不显示角色选择

## 观战席

### 基本规则

- 观战者独立存储在 `game.spectators` 数组，不进入 `game.players`，游戏逻辑零改动
- 观战者不占游戏名额（不计入 playerCount），数量无上限
- 观战者不参与游戏行动（不能投票、使用技能、发言、准备）
- 观战席不允许添加 AI（只有真人可以观战）
- 游戏开始后新连接自动进入观战席

### 身份切换（仅等待阶段，准备前）

- 打开页面默认加入游戏区（非观战）
- 玩家 → 观战者：未准备的玩家可点击「去观战」切换到观战席
- 观战者 → 玩家：游戏区有空位时，观战者可点击「加入游戏」切换到游戏区
- 已准备的玩家需先取消准备才能切换到观战
- 观战者不需要准备，无准备按钮
- 游戏开始后不可切换

### 视角模式

| 模式 | 可见内容 | 切换方式 |
|------|----------|----------|
| 村民视角 | 仅公开消息（白天讨论、投票结果、死亡公告等） | 默认 |
| 狼人视角 | 公开消息 + 狼人频道消息 | 观战者可随时切换 |
| 上帝视角 | 所有消息（全部私密消息） | 观战者可随时切换 |

- 观战者可随时在三种视角之间切换，不需要 Debug 模式
- **后端始终发送上帝视角消息给观战者，前端根据视角过滤显示**
- 后端无需为每种视角单独构建状态，简化实现

### 加入观战

- 打开页面默认加入游戏区，不直接进入观战
- 游戏进行中新连接自动进入观战席
- 观战者数量无上限

### 游戏中观战者显示

- 观战者不显示在游戏两侧玩家列中
- 消息区顶部小字提示"👁 X人观战"
- 观战者可正常看到消息流和阶段变化

### 开局条件

- 游戏区人数满（players.length === playerCount）且所有游戏区玩家已准备
- AI 玩家自动准备（加入即 ready）
- 观战者不影响开局条件
- 条件：游戏区已准备玩家数 === playerCount

### 数据结构

```javascript
// 观战者对象（独立数组，不在 players 内）
{
  id: 'spectator_1',    // 唯一标识，用于 WebSocket 映射
  name: '张三',
  view: 'villager'       // 'villager' | 'werewolf' | 'god'
}

// GameEngine 新增
game.spectators = [];    // 独立数组，不影响 players 相关逻辑

// getState() 对观战者始终发送上帝视角消息
// 前端根据 view 字段过滤显示
state.spectators = game.spectators.map(s => ({
  id: s.id,
  name: s.name,
  view: s.view
}));
```

### 服务端改动

1. **`game.spectators` 数组**：独立于 `game.players`，不影响任何现有游戏逻辑
2. **`handleSpectate` 消息处理**：新消息类型，创建观战者并加入 spectators
3. **`broadcastState` 扩展**：向 spectators 推送状态，消息始终为上帝视角（不过滤）
4. **`switch_view` 消息**：观战者切换视角（仅更新 view 字段，前端过滤）
5. **`switch_role` 消息**：等待阶段准备前，观战者↔玩家切换
6. **观战者不参与**：`callSpeech`、`callVote`、`callSkill` 等均不向观战者发送 `pendingAction`
7. **游戏开始后新连接**：自动加入 spectators 而非拒绝
8. **开局条件**：只检查非观战已准备玩家数 === playerCount

### 前端视角过滤

后端发给观战者的消息始终是上帝视角（全量），前端根据 `view` 字段过滤：

| 视角 | 显示规则 |
|------|----------|
| villager | visibility=PUBLIC 的消息 |
| werewolf | visibility=PUBLIC + CAMP(wolf) 的消息 |
| god | 所有消息 |

## 技术实现要点

### 状态同步：WebSocket 全量替代轮询

当前架构的问题：登录页没有 WebSocket 连接，板子锁定状态只能靠 `/api/presets` 轮询（2秒一次）来同步。这是补丁式修复，有延迟且浪费请求。

新方案：页面加载时立即建立 WebSocket 连接并发送 `join`，所有状态变更（板子锁定、准备状态、配置变更等）均通过 WebSocket 实时推送，不再需要任何轮询。

**可删除的代码：**
- 前端 `init()` 中的 `_presetPollTimer` 轮询逻辑
- `/api/presets` 接口中的 `currentPresetId` 字段（改为 WebSocket 推送）
- 前端 `loadPresets()` 中对 `lockedPresetId` 的处理（改为从 WebSocket state 中获取）

**状态推送机制：** 服务端在任何房间状态变更时（有人加入/离开、有人准备/取消准备、有人改板子、有人改名字等）统一调用 `broadcastState()`，前端通过 `onStateChange` 回调更新 UI。与游戏中状态推送完全一致，不需要额外机制。

### 服务端改动

1. **WebSocket 连接提前**：页面加载时立即建立连接，`join` 时不再需要选板子（板子选择作为房间内操作）
2. **新增 `spectate` 消息类型**：观战者加入
3. **`ready` / `unready` 消息**：替代当前自动开始的逻辑
4. **`change_preset` 消息**：房间内切换板子，服务端广播新配置并清除全员准备状态
5. **`change_name` 消息**：房间内修改名字
6. **配置变更广播**：任何人改板子后，广播新配置给所有人，并清除所有人的准备状态
7. **开局条件**：所有非观战玩家都已准备 + 人数满

### 前端改动

1. **去掉 setup-panel 登录面板**：进入页面直接在房间内
2. **去掉 `/api/presets` 轮询**：板子列表可保留 HTTP 接口获取（只在页面加载时调一次），板子锁定和状态变更全部走 WebSocket
3. **玩家卡片内嵌操作**：名字输入、角色选择（仅 debug 模式）、准备按钮都在卡片上
4. **板子选择保留在顶栏**：点击板子名称展开选择，与当前交互一致
5. **观战入口**：默认加入游戏区，未准备时可切换到观战；游戏中新连接自动观战
6. **游戏开始后隐藏操作项**：改名字、选角、准备按钮等消失，恢复游戏 UI

### 数据结构

```javascript
// 玩家对象新增字段
{
  id: 1,
  name: '大刚',
  alive: true,
  isAI: false,
  ready: false,              // 新增：是否已准备
  debugRole: null,           // 已有：debug 选角
  role: null,
  state: {}
}

// 观战者独立数组（见观战席章节）
game.spectators = [];
```

## 游戏结束后返回房间

- 游戏结束后，"再来一局"改为"返回房间"
- 点击后回到等待阶段，人类需要重新准备才能开局
- **AI 玩家保留**，不会被清理，且自动准备（ready: true）
- 人类玩家重置为未准备
- 观战者保留在观战席，不自动转为玩家，可在等待阶段手动切换
- 配置（板子选择）保留上一局的设置，可由任何人修改
- 角色分配清空，回到可编辑状态（debug 模式下可重新选角色）

## 设计 Review：发现的问题与补充

### 问题 1：游戏中加入的 bug

**现状**：`handleJoin` 只检查 `players.length >= playerCount`（房间满），不检查游戏是否已开始。如果游戏进行中房间未满（如 9 人局只来了 7 人就开局），新连接会被当作玩家 push 进 players，但 `assignRoles` 已执行过，新玩家 `role: null`，游戏逻辑会崩溃。

**修复**：游戏开始后（`game.phase !== 'waiting'`），所有新连接一律进入 spectators，不管房间是否满员。等待阶段才允许加入 players。

### 问题 2：观战者 reconnection

**现状**：reconnection 通过名字匹配 `game.players` 中的非 AI 玩家。观战者在 `game.spectators` 中，不在 players 里，所以断线重连会走 handleJoin 新建玩家而非恢复观战。

**修复**：reconnection 需要同时检查 `game.spectators`。匹配顺序：先查 players（恢复玩家），再查 spectators（恢复观战者），都未匹配则新建。

### 问题 3：观战者 WebSocket 映射

**现状**：`this.clients` 映射 ws → `{playerId, name}`，`this.playerClients` 映射 playerId → ws。观战者没有 playerId，当前映射机制无法容纳。

**修复**：`this.clients` 的 value 结构改为 `{playerId, name, isSpectator, spectatorId}`。观战者 playerId 为 null，spectatorId 有值。broadcastState 时根据 isSpectator 决定调用 `getState(playerId)` 还是 `getStateForSpectator()`。

### 问题 4：getState() 不支持观战者

**现状**：`getState(playerId)` 中 playerId 找不到玩家时，`self` 为 undefined，`messages` 为空数组。观战者调用会拿到空消息。

**修复**：新增 `getStateForSpectator()` 方法，返回全量消息（不过滤），`self` 为 null，`players` 中角色信息全量返回（上帝视角）。前端根据 view 字段过滤。

### 问题 5：角色信息泄露

**现状**：`getState()` 的 `players` 数组包含每个玩家的完整 `role` 对象（包括 camp），前端根据 myPlayer 判断是否显示。观战者没有 myPlayer，当前逻辑下 `myPlayer` 为 null 时只显示 game_over 阶段的角色。

**修复**：后端对观战者始终发送全量角色信息（上帝视角），前端根据 view 字段决定显示哪些角色：
- villager：隐藏所有角色（同当前无 myPlayer 的行为）
- werewolf：显示狼人阵营角色
- god：显示所有角色

### 问题 6：情侣信息在观战者视角下缺失

**现状**：`getState()` 中 `isCouple` 和 `couplePartner` 仅在双方都是情侣时才设为 true。观战者没有 playerId，`couples` 数组只在 `state.self` 是情侣时才返回。上帝视角应能看到谁是一对。

**修复**：`getStateForSpectator()` 中，god 视角始终返回 `couples` 数组；werewolf 和 villager 视角不返回。

### 问题 7：前端消息过滤能力缺失

**现状**：前端 `displayMessage()` 只检查 `visibility === 'self'` 来加 `[私密]` 前缀，不按 visibility 过滤消息。所有过滤依赖后端 `getVisibleTo()`。

**修复**：前端需新增消息过滤逻辑。观战者收到全量消息后，根据 view 字段过滤：
- villager：只显示 `visibility === 'public'` 的消息
- werewolf：显示 `visibility === 'public'` 或（`visibility === 'camp'` 且发送者是狼人）的消息
- god：显示所有消息

### 问题 8：观战者断线清理

**现状**：`_handleDisconnect` 只清理 `this.clients` 和 `this.playerClients`。观战者断线需要从 `game.spectators` 中移除。

**修复**：`_handleDisconnect` 中增加：如果断线的是观战者，从 `game.spectators` 中移除，然后 broadcastState。

### 问题 9：switch_role 的座位号管理

**现状**：playerId 通过 `players.length + 1` 生成。如果玩家 A（id=3）切换为观战者，再切回来，id 会变成 `players.length + 1`（更大），而不是恢复原来的 3。

**修复**：切换为观战者时，从 players 数组中移除该玩家，后续玩家 id 不重排（保持现有 id 不变）。切回玩家时，分配新 id（`players.length + 1`）。id 只是标识符，不需要连续。

### 问题 10：游戏开始后观战者能否加入

**设计说**"游戏开始后新连接自动进入观战席"，但需要明确：游戏结束后的观战者怎么办？返回房间时是否保留？

**补充**：游戏结束后返回房间时，观战者保留在 spectators 中，不自动转为玩家。观战者可在等待阶段手动切换为玩家。

### 问题 11：准备机制尚未实现

**现状**：当前代码没有 ready/unready 机制，`handleAddAI` 中房间满员即自动开始。设计文档要求"游戏区人数满 + 所有游戏区玩家已准备后才开局"，AI 自动准备。

**补充**：准备机制是本次改造的前置依赖，必须在观战系统之前实现。玩家对象需增加 `ready` 字段，AI 加入即 `ready: true`，人类默认 `ready: false`。开局条件改为：`players.length === playerCount && players.every(p => p.ready)`。

### 问题 12：观战者视角切换时消息历史

**现状**：后端对观战者始终发上帝视角消息。观战者切换视角时（如从村民切到上帝），前端需要重新过滤已缓存的消息历史。

**补充**：前端 `messageHistory` 需要保存全量消息（不过滤），每次视角切换时重新根据 view 字段过滤并重新渲染消息列表。不能只过滤新消息。

### 问题 13：broadcastState 的观战者路径

**现状**：`broadcastState` 遍历 `this.clients`，对每个 client 调用 `this.game.getState(info.playerId)`。观战者的 playerId 为 null。

**修复**：broadcastState 中判断 `isSpectator`，观战者调用 `this.game.getStateForSpectator()` 而非 `getState(null)`。

## 开局流程

```
玩家打开页面
  → WebSocket 连接
  → 收到房间状态（板子、玩家列表、准备状态）
  → 默认加入游戏区
  → 加入后：
      - 可改名字、选角（debug）
      - 可切换板子（触发全员取消准备）
      - 未准备时可切换到观战席
      - 观战席有空位时可切换回游戏区
      - 点准备（AI 自动准备）
  → 游戏区人数满 + 所有游戏区玩家已准备 → 3秒倒计时 → 开局

游戏进行中
  → 新连接自动进入观战席
  → 观战者可随时切换视角（村民/狼人/上帝）

游戏结束
  → 点击"返回房间"
  → AI 玩家保留且自动准备，人类重置为未准备
  → 观战者保留在观战席
  → 回到等待阶段，重新准备 → 开局
```