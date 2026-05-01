# 前端重设计：二相乐园 × 欢愉狼人杀

## 核心美学

二相乐园（4.0版本）的关键视觉要素：
- **面具/假面** — 欢愉杀的入场券，8枚面具，身份隐藏与揭示
- **二次元/漫画风** — 二维市、粗描边、对话框、漫画分镜
- **欢愉霓虹** — 粉紫撞色、荧光青、全息光效
- **游戏化一切** — 冲突也变成游戏，HUD化、成就弹窗
- **满月/幻月** — 夜晚的核心意象，阿哈的注视
- **阿哈的笑** — 标志性面具笑脸

与狼人杀的天然契合：狼人杀本身就是面具游戏、身份博弈、夜晚与白天的轮转。

---

## 1. 色彩体系 — 欢愉命途

```css
:root {
  /* 主色 — 欢愉粉紫 */
  --elation-pink: #ff6b9d;
  --elation-purple: #c77dff;
  --elation-cyan: #7df9ff;
  --elation-gold: #ffd166;

  /* 背景 — 二相乐园夜空 */
  --bg-deep: #0d0a1a;
  --bg-mid: #1a1035;
  --bg-surface: rgba(255, 107, 157, 0.06);

  /* 功能色 */
  --wolf-crimson: #ff4d6a;
  --good-cyan: #7df9ff;
  --death-purple: #9b59b6;
  --vote-gold: #ffd166;
  --sheriff-gold: #f0c040;

  /* 操作色 */
  --action-default: #c77dff;      /* 技能/投票/通用按钮，统一欢愉紫 */

  /* 文字 */
  --text-primary: #f0e6ff;
  --text-secondary: #a89cc8;
  --text-muted: #6b5f8a;
}
```

---

## 2. 整体布局 — 两侧玩家列 + 中间消息区（方案A-双列）

移动端竖屏下，放弃「顶部横排玩家列表 → 下方消息区」的传统布局，
改为**左右两侧竖排玩家列 + 中间消息/操作区**的三栏布局。

玩家按座位号从左上角1开始，左侧列从上往下排满后，右侧列接着往下排。

### 布局示意（9人局）

```
┌───────────────────────────────────────────┐
│       ◉ 欢愉杀 · 第2夜            ▾    │  ← 顶部状态栏
├──────┬─────────────────────────┬──────────┤
│  🎭  │                         │  🎭     │
│ 1花火│  ── 第2夜 · 幻月之下 ── │ 6三月   │
│  🎭  │                         │  🎭     │
│ 2流萤│  🎭 3号黑鹅              │ 7忘归   │
│  🎭  │  我觉得1号很可疑...       │  🎭     │
│ 3黑鹅│                         │ 8爻光   │
│  🎭  │  💀 昨夜4号大塔死亡       │  🎭     │
│ 4大塔│                         │ 9空位   │
│  🎭  │  🎭 6号三月              │         │
│ 5银狼│  同意                    │         │
│      │                         │         │
│      ├─────────────────────────┤         │
│      │  🔮 请选择查验目标        │         │
│      │  [花火] [黑鹅] [跳过]    │         │
└──────┴─────────────────────────┴──────────┘
```

### 排列规则

- 左列从1开始，从上到下依次排列
- 左列排满后（9人局左5右4，12人局左6右6），右列接着排
- 座位号与位置映射：`Math.ceil(playerCount / 2)` 人分左列，剩余分右列
- 示例（9人）：左列 1,2,3,4,5 ｜ 右列 6,7,8,9
- 示例（12人）：左列 1,2,3,4,5,6 ｜ 右列 7,8,9,10,11,12

### 为什么选方案A双列

1. **圆桌感**：两侧对称布局，天然模拟狼人杀圆桌围坐
2. **视觉平衡**：左右对称，不再一侧偏重
3. **头像始终可见**：两侧固定列，不用滚动就能看到所有玩家状态
4. **发言者关联直觉**：消息中的名字和两侧头像位置天然对应
5. **消息区最大化**：中间区域专注消息流，不被头像挤压
6. **面具游戏契合**：两侧列就是「面具墙」，翻牌/碎裂/发光等状态一目了然
7. **操作区目标对应**：投票/技能按钮的目标就是两侧的玩家，视觉上直接对应

### 两侧玩家列规格

- 每侧宽度：68px（头像36px + 左右padding 16px）
- 每个玩家条目：圆形头像 + 名字（截断6字符）+ 状态标记
- 座位号从1开始，左列从上到下排满后右列接着排
- 9人局：左5右4，左列1-5号，右列6-9号
- 12人局：左6右6，左列1-6号，右列7-12号
- 超出时两侧列独立滚动，消息区不受影响
- 点击玩家头像 → 弹出半屏详情：AI 玩家显示立绘背景 + profile 信息 + 角色介绍，人类玩家显示头像大图 + 名字 + 座位号

### 响应式适配

- **竖屏手机（< 480px）**：每侧 56px，头像 32px，名字字号 10px
- **横屏/平板（≥ 768px）**：每侧 76px，头像 44px，名字字号 12px
- **桌面（≥ 1024px）**：保持三栏，整体 max-width 680px 居中

---

## 3. 玩家卡片 — 面具系统

每个玩家是两侧列中的一张面具条目：

- **存活时**：显示角色圆形头像（AI 玩家加载 `/profiles/{profileName}/{icon}`，人类玩家使用默认头像 `public/assets/masks/aeon_aha.webp`），外圈是欢愉命途色光环
- **死亡时**：面具碎裂动画（CSS clip-path + grayscale），头像变灰 + 对角裂纹
- **当前发言者**：头像外圈脉冲发光（@keyframes elationPulse，粉紫渐变），名字高亮
- **自己**：头像右下角有「你」标记，欢愉粉底色
- **警长**：头像左上角悬浮金色警徽光效
- **未加入/空位**：显示阿哈面具剪影轮廓（`public/assets/masks/aeon_aha.webp`），虚线描边，点击区域扩大至整个条目（至少 44×44px 触控区），下方文字「+AI」
- **情侣标记**：💕 替换为命途粉心光效
- **夜晚阶段**：两侧列整体加半透明深紫遮罩（opacity 0.3），存活玩家头像微亮，营造「天黑闭眼」氛围
- **死亡状态层次**：已死亡玩家 opacity 0.4 + 灰度，在侧栏中视觉退到最底层，不干扰存活玩家阅读
- **准备状态**：等待阶段在玩家条目右侧显示 ✓（欢愉绿）或 ⏳（等待灰），游戏中隐藏
- **观战者**：不在两侧玩家列中显示，消息区顶部小字提示"👁 X人观战"，可切换视角
- **点击 AI 头像**：弹出半屏详情弹窗，背景为该角色 splash_art.webp 立绘（半透明），前景显示 profile.json 信息（名称、阵营[HSR阵营]、命途[HSR命途]、属性）和 background.md 的角色介绍

头像加载：profile.json 中包含 `icon` 和 `splashArt` 相对路径字段，后端将 profile 内容随玩家状态推送，前端拼接 `/profiles/{profileName}/{icon}` 加载图片。

```css
/* 两侧玩家列 */
#players-left, #players-right {
  position: fixed;
  top: 48px;          /* 状态栏高度 */
  bottom: 0;
  width: 68px;
  background: rgba(13, 10, 26, 0.92);
  overflow-y: auto;
  z-index: 50;
  -webkit-overflow-scrolling: touch;
  /* 操作区弹出时，侧栏底部上移避免遮挡按钮 */
  transition: bottom 0.2s ease;
}

/* 当操作区激活时，侧栏底部上移 */
body.has-action #players-left,
body.has-action #players-right {
  bottom: 80px;       /* 操作区大致高度 */
}

#players-left {
  left: 0;
  border-right: 1px solid rgba(199, 125, 255, 0.15);
}

#players-right {
  right: 0;
  border-left: 1px solid rgba(199, 125, 255, 0.15);
}

/* 主内容区居中 */
#main-content {
  margin-left: 68px;
  margin-right: 68px;
}

.player-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--elation-purple);
  object-fit: cover;
  background: var(--bg-deep);
}

.player-card.dead .player-avatar {
  filter: grayscale(1) brightness(0.5);
  border-color: var(--text-muted);
  clip-path: polygon(0 0, 45% 0, 50% 48%, 55% 0, 100% 0,
                     100% 100%, 55% 100%, 50% 52%, 45% 100%, 0 100%);
}

.player-card.current .player-avatar {
  animation: elationPulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 12px var(--elation-pink), 0 0 24px var(--elation-purple);
}

.player-card.current .player-name {
  color: var(--elation-pink);
  text-shadow: 0 0 8px rgba(255, 107, 157, 0.5);
}

@keyframes elationPulse {
  0%, 100% { box-shadow: 0 0 12px var(--elation-pink), 0 0 24px var(--elation-purple); }
  50% { box-shadow: 0 0 20px var(--elation-pink), 0 0 40px var(--elation-purple); }
}

/* 响应式 */
@media (max-width: 480px) {
  #players-left, #players-right { width: 56px; }
  #main-content { margin-left: 56px; margin-right: 56px; }
  .player-avatar { width: 32px; height: 32px; }
  .player-name { font-size: 10px; }
}

@media (min-width: 768px) {
  #players-left, #players-right { width: 76px; }
  #main-content { margin-left: 76px; margin-right: 76px; }
  .player-avatar { width: 44px; height: 44px; }
  .player-name { font-size: 12px; }
}
```

---

## 4. 阶段分割线 — 幻月幕布

- **夜晚**：满月图案 + 深紫幕布 + 星点 + 「第N夜 · 幻月之下」
- **白天**：日轮图案 + 暖金幕布 + 光粒子 + 「第N天 · 聚光灯下」
- 分割线两侧用阿哈面具弧线装饰（✧ ⟡ ✦）

```css
.phase-divider.night span {
  background: linear-gradient(135deg, var(--bg-deep), #2a1a4a);
  color: var(--elation-cyan);
  border: 1px solid rgba(125, 249, 255, 0.2);
}

.phase-divider.day span {
  background: linear-gradient(135deg, #2a1f0a, #1a1520);
  color: var(--elation-gold);
  border: 1px solid rgba(255, 209, 102, 0.2);
}
```

---

## 5. 消息气泡 — 漫画对话框

二相乐园是二次元/漫画世界，消息用漫画对话框风格：

- **发言消息**：消息气泡左侧带小头像（24px，与两侧列同一角色头像），名字+内容，背景半透明粉紫，左侧欢愉紫竖条
- **系统消息**：居中，全息面板风格，顶部渐变光条，无头像
- **死亡消息**：红色光条 + 面具碎裂标记，居中
- **狼人频道**：暗紫底 + 虚空紫光晕，暗网通讯感，左侧红色竖条
- **遗言**：opacity 0.85 + 斜体，灵魂消散感
- **私密消息**：虚线边框 + 🔒 图标，加密通讯风

消息内嵌小头像与两侧玩家列的对应关系：
- 两侧列的玩家头像始终可见，消息气泡内的小头像作为辅助确认
- 当前发言者：两侧列中对应头像发光脉冲 + 消息气泡左侧色条高亮，双重关联

---

## 6. 操作区 — 技能面板

所有技能按钮统一使用欢愉紫描边 + 微光（不区分角色颜色，避免泄露身份信息）：

- 守卫 = 欢愉紫边框 + 盾牌图标
- 预言家 = 欢愉紫边框 + 眼睛图标
- 女巫 = 欢愉紫边框 + 药瓶图标
- 猎人 = 欢愉紫边框 + 箭头图标
- 丘比特 = 欢愉紫边框 + 爱心图标
- 投票 = 欢愉紫边框 + 面具图标
- 输入框：底部固定「梦境终端」风格，荧光边框
- 「准备」按钮 → 「入梦」按钮，入场动画
- **目标选择按钮带小头像**：投票/技能按钮内嵌 20px 圆形头像，与两侧列头像一致，增强视觉关联

---

## 7. 等待阶段 — 进入即入房

> 与房间系统设计（room_system_design.md）对齐：去掉独立登录页，进入即入房。

打开页面 → 自动建立 WebSocket → 收到房间状态 → 直接进入房间。无 setup-panel。

### 等待阶段布局

等待阶段**不使用双列侧栏布局**（侧栏太窄放不下操作），中间区域全屏展示房间配置和玩家列表：

```
┌───────────────────────────────────────────┐
│       ◉ 欢愉杀 · 9人标准局           ▾   │  ← 顶栏：板子名称可点击切换
├───────────────────────────────────────────┤
│                                           │
│   ┌─────────────────────────────────┐     │
│   │ 🎭 1号 大刚     [改名][选角*][✓准备] │     │
│   │ 🎭 2号 小玲     [改名][选角*][ 准备 ] │     │
│   │ 🎭 3号 AI-花火  [选角*][✓准备]       │  ← AI 自动准备
│   │ 🎭 4号 (空位)   [+AI]               │     │
│   │ ...                                │     │
│   └─────────────────────────────────┘     │
│                                           │
│   观战: 张三 [👁村民] [切换视角]           │  ← 观战区（无准备按钮）
│                                           │
│   * 选角仅 debug 模式下显示                │
│                                           │
│   消息区                                   │
└───────────────────────────────────────────┘
```

- 玩家卡片：水平布局，头像 + 名字 + 操作按钮，漫画分镜风格
- 板子选择：顶栏点击展开，选中时欢愉紫发光
- 准备按钮：欢愉粉渐变，准备后显示 ✓
- AI 玩家自动准备（加入即 ✓）
- 选角：仅在 debug 模式下显示（由服务端 `--debug` 参数全局控制，通过 WebSocket state.debugMode 推送）
- **默认加入游戏区**：打开页面自动加入游戏区（非观战）
- **游戏区 → 观战区**：未准备的玩家可点击「去观战」切换到观战席
- **观战区 → 游戏区**：观战者看到游戏区有空位时，可点击「加入游戏」切换到游戏区
- 观战者不需要准备，也不显示准备按钮
- 观战者可随时切换村民/狼人/上帝视角
- 游戏开始后新连接自动进入观战席
- 配置变更后全员自动取消准备（与房间系统一致）

### 等待阶段 → 游戏中过渡

游戏区人数满 + 所有游戏区玩家已准备（AI 自动准备）→ 3秒倒计时（中间区域显示倒计时动画）→ 切换到双列侧栏 + 中间消息区布局

---

## 8. 日夜视觉切换

```css
body.phase-night {
  background: linear-gradient(170deg, #0d0a1a 0%, #1a1035 50%, #0d0a1a 100%);
}
body.phase-night::before {
  content: '';
  position: fixed;
  top: -20vh;
  right: -10vw;
  width: 40vw;
  height: 40vw;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(125,249,255,0.08) 0%, transparent 70%);
  pointer-events: none;
}

body.phase-day {
  background: linear-gradient(170deg, #1a1520 0%, #2a1f2a 50%, #1a1520 100%);
}
```

---

## 9. 游戏结算 — 命途启示

- 胜利阵营：阵营色大字 + Emoji 面具动画
  - 好人胜：🎭 + 微笑文字动画 + `--good-cyan` 色
  - 狼人胜：🎭 + 哭泣文字动画 + `--wolf-crimson` 色
  - 第三方胜（人狼恋）：🎭 + 诡异笑脸动画 + `--elation-purple` 色
- 玩家列表：头像 + 名字 + 身份文字揭示（预言家/狼人等），面具碎裂动画
- 「返回房间」按钮：欢愉风格，返回等待阶段（AI 保留 + 自动准备，人类重置为未准备，观战者保留在观战席）
- **结算时两侧玩家列隐藏，消息区全屏展示结算卡片**

---

## 10. 发言立绘 — 顶层滑入滑出

白天发言阶段，当前发言者的立绘（splash_art.webp）在最顶层滑入展示，短暂停留后滑出。

### 交互设计

- 当玩家开始发言时，立绘从右侧滑入覆盖屏幕，停留 1.5 秒后向左滑出
- 立绘全屏展示，使用 `position: fixed` + `z-index: 100`，在最顶层
- 滑入动画：从右侧 `translateX(100%)` 滑到居中，300ms ease-out
- 停留 1.5 秒后滑出：从居中滑到左侧 `translateX(-100%)`，300ms ease-in
- 立绘下滑出后消息区正常显示，不再作为背景
- 非发言阶段（系统消息、投票等）：不显示立绘
- 夜晚阶段：不显示立绘，保持幻月氛围
- 只有 AI 玩家显示立绘（有 splash_art.webp），人类玩家不显示

### 背景纹理

页面背景加细微纹理（星空点），增加层次感：

```css
body {
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(199, 125, 255, 0.15), transparent),
    radial-gradient(1px 1px at 80% 70%, rgba(125, 249, 255, 0.1), transparent),
    radial-gradient(1px 1px at 50% 10%, rgba(255, 107, 157, 0.08), transparent);
  background-size: 200px 200px, 300px 300px, 250px 250px;
}

/* 发言者立绘 — 顶层滑入滑出 */
#speaker-art {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 100;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(13, 10, 26, 0.6);
}

#speaker-art img {
  max-height: 90vh;
  max-width: 90vw;
  object-fit: contain;
}

#speaker-art.slide-in {
  animation: speakerSlideIn 0.3s ease-out forwards;
}

#speaker-art.slide-out {
  animation: speakerSlideOut 0.3s ease-in forwards;
}

@keyframes speakerSlideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes speakerSlideOut {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
```

---

## 11. 实施优先级

| 阶段 | 内容 | 工作量 | 冲击力 |
|------|------|--------|--------|
| P0 | 色彩体系 + 背景渐变 + 纹理底 + 日夜切换 | 小 | 极高 |
| P0 | 两侧玩家列布局 + 面具卡片 + 头像显示 | 大 | 极高 |
| P0 | 阶段分割线幻月化 | 小 | 高 |
| P1 | 消息气泡漫画风 | 中 | 高 |
| P1 | 操作区统一色改造 | 中 | 高 |
| P1 | 等待阶段布局（进入即入房） | 中 | 中 |
| P2 | 发言立绘滑入滑出 | 中 | 高 |
| P2 | 微交互动画 | 大 | 中 |

---

## 后端配合

- profile.json 增加 `icon` 和 `splashArt` 字段（值为相对路径如 `"icon.webp"`、`"splash_art.webp"`），后端将 profile 内容随玩家状态推送
- 前端根据 `profileName`（目录名）+ profile 中的图片路径拼接完整 URL：`/profiles/{profileName}/{icon}`
- 静态文件服务 ai/profiles/*/ 目录
- state.players 中每个 AI 玩家增加 profileName 和 profile 字段（profile 包含 name/icon/splashArt 等展示信息，人类玩家为 null）
- 发言消息附带发言者 profileName，前端据此触发发言立绘滑入滑出
- 人类玩家默认头像使用 `public/assets/masks/aeon_aha.webp`
- 点击 AI 头像弹窗：背景为 splash_art.webp 立绘（半透明），前景显示 profile.json 信息 + background.md 角色介绍
- 与房间系统（room_system_design.md）对齐：
  - 去掉 setup-panel，页面加载即建立 WebSocket 并加入房间
  - 打开页面默认加入游戏区（非观战）
  - 新增 ready/unready/spectate/switch_view/switch_role/change_preset/change_name 消息类型
  - 观战者独立于 players 数组，存储在 state.spectators，数量无上限
  - 观战者不需要准备，无准备按钮
  - AI 玩家自动准备（加入即 ready）
  - 开局条件：游戏区人数满 + 所有游戏区玩家已准备
  - 后端对观战者始终发送上帝视角消息，前端根据 view 字段过滤（villager/werewolf/god）
  - 游戏开始后新连接自动加入观战席
  - 等待阶段玩家对象增加 ready 字段
  - 游戏结束后「返回房间」而非重新加载页面

## 布局状态切换

| 游戏阶段 | 两侧玩家列 | 中间消息区 | 操作区 |
|---------|-----------|-----------|--------|
| 等待阶段 | 隐藏 | 全屏：玩家列表+配置+操作 | 无（操作嵌在玩家卡片内） |
| 倒计时 | 隐藏 | 倒计时动画 | 无 |
| 白天发言 | 显示 | 消息流 + 发言立绘滑入 | 按需显示 |
| 白天其他 | 显示 | 消息流 | 按需显示 |
| 夜晚阶段 | 显示（加暗紫遮罩） | 消息流（无立绘） | 按需显示 |
| 游戏结算 | 隐藏 | 全屏结算卡片 | 返回房间按钮 |