# 死代码清理清单

> 逐项代码验证后的结论。标记 ✅ = 确认可安全删除，⚠️ = 需连带修改，❌ = 分析有误不能删，🗑️ = 已清理

## 已清理

| # | 死代码 | 改动 |
|---|--------|------|
| 1 | server.js `buildActionData()` 独立函数 | 🗑️ 重构为 GameEngine 类方法 |
| 2 | server.js `getStateWithDebug()` 函数 | 🗑️ 已删除 |
| 3 | server.js `game.on('vote:complete', ...)` | 🗑️ 已删除 |
| 4 | main.js `nightActions` 暴露给所有玩家 | 🗑️ 已删除 |
| 5 | main.js `p.hasLastWords` 属性读取 | 🗑️ 改为调用 config hook |
| 6 | main.js `assignRoles` 无 preset fallback | 🗑️ 已删除，同步修复测试 |
| 7 | main.js/roles.js `sheriffDied` | 🗑️ 已删除 |
| 8 | main.js/context.js/test `hunter_night` 引用 | 🗑️ 已删除 |
| 9 | cli_client.js/app.js `night_resolve` 映射 | 🗑️ 已删除 |
| 10 | night.js `getDeathReason` fallback | 🗑️ 已删除 |
| 11 | main.js `cancelPendingRequests(playerId)` | 🗑️ 已删除 |
| 12 | config.js cupid filter in ACTION_FILTERS | 🗑️ 已删除 |
| 13 | roles.js 7个角色的 `constraints` | 🗑️ 已删除 |
| 14 | main.js/cli_client.js/app.js/prompts.js `choose_target` | 🗑️ 已删除 |
| 27 | roles.js hunter 残留 `constraints` | 🗑️ 已删除 |
| 28 | roles.js 警长 ATTACHMENTS 空 `player:death` 事件 | 🗑️ 已删除 |
| 15a | config.js `CAMPS` 常量 + 导出 | 🗑️ 已删除 |
| 15b | config.js `WIN_CONDITIONS` 导出 | 🗑️ 已删除 |
| 16a | roles.js `getAttachment` 函数 + 导出 | 🗑️ 已删除 |
| 16b | roles.js `ROLES` 导出 | 🗑️ 已删除 |
| 16c | roles.js `getRole` 导出 | 🗑️ 已删除 |
| 17a | prompts.js `CAMP_NAMES` 常量 + 导出 | 🗑️ 已删除 |
| 17b | prompts.js `AI_PROFILES` 导出 | 🗑️ 已删除 |
| 18 | message.js `VisibilityRules` 导出 | 🗑️ 已删除 |
| 19 | utils.js 5个零调用函数 + 3个内部函数导出 | 🗑️ 已删除 |
| 20 | mock.js/index.js 4个 helper 函数 + 导出 | 🗑️ 已删除 |
| 21a | event.js `once()` 方法 | 🗑️ 已删除 |
| 21b | event.js `off()` 方法 | 🗑️ 已删除 |
| 22 | message.js `getAll()` 方法 | 🗑️ 已删除 |
| 24 | config.js `canVote` hook | 🗑️ 已删除 |
| 25 | vote.js `bubble: true` 属性 | 🗑️ 已删除 |
| 26 | controller.js JSDoc `mockBehaviors` | 🗑️ 已修正为 `mockOptions` |

## 非死代码

| # | 文件 | 代码 | 理由 |
|---|------|------|------|
| 23 | controller.js:45 | `getMockAgent()` 方法 | ❌ 不是死代码。test/game.test.js:76,132,2253、test/preset.test.js:229、test/compression.test.js:37 均在使用 |

## 已修复

| # | 文件 | 代码 | 改动 |
|---|------|------|------|
| 29 | cli_client.js | `--players` 参数 | 🗑️ 已删除，统一使用 `--preset` |
| 30 | main.js | `gameOverInfo` 重复计算 | 🗑️ getState() 改为复用 `this.gameOverInfo` |