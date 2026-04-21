# 狼人杀项目代码问题清单

## 需要修复的 Bug

### 1. 遗言顺序逻辑分散
- **位置**: `engine/phase.js`
- **问题**: 夜间死亡遗言在 `day_announce` 阶段处理，白天放逐遗言在 `post_vote` 阶段处理，逻辑分散在两处
- **影响**: 维护困难，可能出现顺序问题
- **建议**: 统一到 `post_vote` 阶段处理，或提取通用遗言处理函数

---

## 痛点问题

### 2. 重连时消息同步不完整
- **位置**: `public/controller.js:87-103`
- **问题**: 前端重连时只增量更新消息（`m.id > lastId`），不会重新同步完整历史
- **影响**: 断线重连后可能丢失消息
- **建议**: 重连时请求服务端同步完整消息历史

### 3. 重复代码 - 选项生成逻辑
- **位置**: `cli_client.js` 和 `public/app.js`
- **问题**: 前后端各自实现了一套选项生成逻辑
  - `generateVoteOptions` / `renderVoteButtons`
  - `generateWitchOptions` / `renderWitchButtons`
  - `generateGuardOptions` / `renderTargetButtons`
- **影响**: 维护成本高，容易出现前后端不一致
- **建议**: 提取共享模块 `engine/options.js`，统一由后端生成选项

### 4. 日志输出不统一
- **位置**: `server.js:14, 25, 380`
- **问题**: 使用了 `console.log/console.error`，应统一使用 `logger`
- **影响**: 日志分散在两个系统，难以追踪
- **建议**: 将 server.js 中的 console.log 替换为 `getLogger()`

---

## 低优先级问题

### 5. 未使用的方法
- **位置**: `public/controller.js`
- **问题**: `vote`, `abstain`, `useSkill` 方法未被外部调用
- **影响**: 代码冗余
- **建议**: 确认后删除或保留作为内部方法

### 6. WebSocket 广播防抖
- **位置**: `server.js:162-170`
- **问题**: 100ms 防抖可能不够，游戏高峰期仍有消息风暴
- **影响**: 低 - 已有防抖机制
- **建议**: 可考虑增加到 200ms 或优化广播策略