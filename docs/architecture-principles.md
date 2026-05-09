# 架构理念

项目核心设计原则，指导架构演进与代码重构。

---

## 一、职责分离

### Server 调度，Agent 执行

**Server** 决定"什么时候做什么"——游戏生命周期、玩家管理、消息路由。

**Agent** 决定"怎么做"——如何构建上下文、如何调用 LLM、如何压缩记忆。

**边界**：Server 不访问 Agent 内部状态，不直接操作 mm.messages，不关心压缩是否完成。

### Engine 独立

Engine 不持有 AIManager 引用，通过回调获取 AI 控制器。

Engine 不知道 AI 的存在，只知道有些玩家需要外部提供控制器。

### 不越界

各层只提供原子 API，策略留在调用方。

- Engine 提供移除玩家的 API，踢人策略（先踢 AI 还是人类）留在 ServerCore
- AIManager 提供遍历 API，业务逻辑在 AIController
- 测试层不替引擎层做验证，全栈层不替单元层做断言

消除猴子补丁——不直接操作他层内部字段，不向他层注入依赖。

---

## 二、数据连续性

### 上下文是一条不中断的流

Agent 的 `mm.messages` 从创建到销毁始终延续。

场景切换只改"我在做什么"（system prompt），不改"我知道什么"（messages）。

压缩是有损折叠，不是清空重建。

增量推送——只追加 Agent 没看过的新消息，不重新灌入完整历史。

### 绝不替换

任何操作都不应该用外部内容替换 `mm.messages` 中 system 之后的内容。

只有压缩可以折叠消息，且产出格式一致。

### 只持久化真实对话

不持久化系统提示和失败尝试。

LLM 看到完整迭代历史，但存档只保留成功结果。

先调用后存档——历史写入发生在 LLM 调用成功之后，避免失败时留下孤儿消息。

---

## 三、正交设计

### inject 存事实，answer 产观点

**inject**：外部内容进入系统的唯一入口。

**answer**：思考的唯一出口。

两者独立：inject 可单独存在（只需知道、不需回应），answer 必须在 inject 之后（先有内容才能思考）。

### 队列项平级

inject、answer、compact、action 串行处理，不存在嵌套 await。

无死锁设计——answer 内部不嵌套 await compact，callback 在队列外触发。

### 事件驱动 vs 请求驱动

两条路径不能合并，覆盖不同场景：

- **事件驱动**：消息产生 → inject → 可选 answer（@提及、分析）
- **请求驱动**：PhaseManager → answer(callback=resolve)（发言、投票、技能）

### 可扩展性

AI 主动说话能力内置——inject + answer 正交分离，只需加 shouldRespond 判断，推送机制不变。

当前 AI 只在被 @提及时回应（被动触发），未来可根据 inject 内容、沉默时间、对话节奏判断是否主动回应。

---

## 四、压缩理念

### 压缩是对话的自然延续

压缩不是把内容抽出来喂给新上下文做提取，而是在原对话流中追加一条 user 消息（请求总结），LLM 返回 assistant 摘要，然后删除旧消息。

压缩产出是自然的对话轮次（user 问 → assistant 答），语义连贯。

Agent 就像一个真人，被问"我们刚才聊了什么"时会自然回顾。他不需要被塞一份别人写的会议纪要，他自己回忆，用自己的话总结。

### 统一压缩

所有压缩场景共用一个函数，不同场景仅通过提示词模板区分。

场景差异只在 user 消息内容——问什么决定了总结什么，但"追问→回答→忘掉细节"这个动作始终一样。

重复压缩自然合并——前次摘要已在对话历史中，LLM 看到完整历史自然产出合并摘要。

### 上下文连续性

压缩后的摘要作为后续所有场景（游戏、聊天室）的背景上下文。

---

## 五、生命周期

### 对齐玩家会话

Agent 的生命周期对齐「玩家会话」，而非「一局游戏」。

模式切换是 Agent 上的显式操作，不是销毁重建。

### drain 队列

生命周期切换时，丢弃旧阶段未处理的 pending inject/answer，避免脏数据污染新阶段。

### 自包含消息

game_over 消息本身含胜负结果 + 所有玩家角色信息，inject 时格式化即可，无需额外补充。

---

## 六、测试理念

### 分层

- **单元测试**：直接构造状态测分支
- **引擎集成**：PhaseManager 驱动多阶段
- **全栈集成**：真实 WebSocket 测交互

### 只 Mock 边界，不 Mock 逻辑

被测系统内部的状态转换、分支判定、事件传播就是测试目标，Mock 它们等于跳过测试。

只 Mock 外部不可控的边界：LLM 调用（用 MockModel）、WebSocket（用 server-harness）。

### 超时即 Bug

MockAI 响应极快（<10ms），测试中出现超时说明逻辑卡死或死循环，应该查 bug 而不是调大 timeout。

等待状态变化用 waitFor 主动检测，不用 delay 盲等。

### 隔离

测试日志与后端日志完全隔离。

测试运行时重定向 engine 层 logger，避免污染后端日志。

---

## 七、关键决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 消息管理 | MessageManager 封装 | 职责单一 |
| 分支判断 | expectedAction | analyze 是无 tool 的 decide |
| suffix | 不保存 | 避免污染摘要 |
| 失败迭代 | 不保存 | 避免持久化实现细节 |
| 历史写入 | LLM 成功后 | 避免孤儿消息 |
| 压缩后 | 立即替换 | 所见即所得 |
| Server 边界 | 只调公开 API | 可维护性 |
| Agent 生命周期 | 对齐会话 | 上下文连续 |

---

## 八、相关文档

- `server-core-boundary-design.md` — ServerCore 边界治理
- `compact-refactor-design.md` — 对话 Compact 改造
- `chat-compression-design.md` — 聊天室压缩设计
- `agent_context_design.md` — Agent 上下文构建
- `agent-lifecycle-design.md` — Agent 生命周期
- `unit-test-framework-plan.md` — 单元测试框架