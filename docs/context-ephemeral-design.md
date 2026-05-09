# Agent 上下文分层持久化设计

## 问题

当前 `buildCurrentTurn` 把三部分拼成一个字符串，整体作为 ephemeral 追加到 LLMView，成功后只持久化 `assistant + tool`：

```
buildCurrentTurn → "【白天发言】…\n\n【行为逻辑】…\n\n【说话方式】…"  // 一个字符串
buildLLMView(ephemeral) → clone(messages) + push(user, ephemeral)   // 整体 ephemeral
成功后 → mm.messages.push(assistant, tool)                          // task prompt 丢失
```

三个问题：
1. **历史语义断裂**：assistant 回复缺少对应的 user 锚点，LLM 无法从历史推断"为什么做了这个动作"
2. **analyze 走错路径**：controller 传入 `ACTION.DAY_DISCUSS` 而非 `'analyze'`，导致 analyze 走决策流程（带 tool），而非纯文本分析
3. **persona 位置不当**：thinking/speaking 在 task 之后，LLM 最后看到的是性格描述而非任务指令

---

## 核心设计：双路

answer 开始时，flush 已执行（游戏事件已 push 到 mm.messages）。此时走两条路：

```
flush → mm.messages 最后一条是 user（游戏事件）

answer(context):
  parts = buildCurrentTurn(action, context, profile)

  1. buildLLMView(parts)  — 只读，clone 原始 mm.messages，插入 persona + task
  2. 持久化路             — 修改 mm.messages，合并 task
  3. LLM 调用
  4. 成功后 push assistant + tool
```

**buildLLMView 必须在持久化路之前**，这样它是纯函数，不依赖持久化路的副作用。

### 步骤1：buildLLMView（只读）

```js
buildLLMView(parts) {
  const view = clone(this.messages);  // clone 原始 mm.messages
  const last = view[view.length - 1];
  const persona = parts.filter(p => p.ephemeral).map(p => p.content).join('\n');
  const task = parts.filter(p => !p.ephemeral).map(p => p.content).join('\n');

  if (last?.role === 'user') {
    let content = last.content;
    if (task) content += '\n' + task;
    if (persona) content = persona + '\n' + content;
    last.content = content;
  } else {
    const all = [persona, task].filter(Boolean).join('\n');
    if (all) view.push({ role: 'user', content: all });
  }
  return view;
}
```

LLMView 最后一条 user：`persona + 游戏事件 + task`

### 步骤2：持久化路（修改 mm.messages）

```js
const task = parts.filter(p => !p.ephemeral).map(p => p.content).join('\n');
if (task) {
  const last = this.mm.messages[this.mm.messages.length - 1];
  if (last?.role === 'user') {
    last.content += '\n' + task;
  } else {
    this.mm.messages.push({ role: 'user', content: task });
  }
}
```

持久化后 mm.messages 最后一条 user：`游戏事件 + task`

### 步骤3-4：LLM 调用 + 成功后持久化

```js
// 决策类成功后
this.mm.messages.push(assistantMsg, toolMsg);

// 分析类成功后
this.mm.messages.push(assistantMsg);
```

不需要再 push user 消息，task 已在步骤2合并。

### 两条路的关系

| | buildLLMView | 持久化路 |
|---|---|---|
| 时机 | 先执行 | 后执行 |
| 操作 | clone + 修改视图 | 修改 mm.messages |
| persona | 插入最后一条 user 开头 | 不涉及 |
| task | 追加到最后一条 user 末尾 | 合并到最后一条 user 末尾 |
| 副作用 | 无（纯函数） | 修改 mm.messages |

两条路独立：buildLLMView 不依赖持久化路的结果，持久化路不依赖 buildLLMView。

---

## TurnParts 数据结构

```js
function buildCurrentTurn(action, context, profile) {
  const task = getCurrentTask(action, context);
  const parts = [];

  if (profile?.thinking) {
    parts.push({ content: `【行为逻辑】\n${profile.thinking}`, ephemeral: true });
  }
  if (isSpeech(action) && profile?.speaking) {
    parts.push({ content: `【说话方式】\n${profile.speaking}`, ephemeral: true });
  }

  parts.push({ content: task, ephemeral: action === 'analyze' });

  return parts;
}
```

| 场景 | parts |
|---|---|
| 白天发言 | `[{c: "【行为逻辑】…", e: true}, {c: "【说话方式】…", e: true}, {c: "【白天发言】…", e: false}]` |
| 预言家查验 | `[{c: "【行为逻辑】…", e: true}, {c: "【预言家】可选玩家：…", e: false}]` |
| analyze | `[{c: "【行为逻辑】…", e: true}, {c: "请分析本条发言…", e: true}]` |
| 聊天室 | `[{c: "【行为逻辑】…", e: true}, {c: "【说话方式】…", e: true}, {c: "【有人@你】…", e: false}]` |

---

## 分类定义

### 发言类 — 追加【说话方式】

| action | task prompt | 说话方式 |
|---|---|---|
| `action_day_discuss` | 【白天发言】轮到你发言了… | 有 |
| `action_last_words` | 【遗言】你被放逐了… | 有 |
| `action_sheriff_speech` | 【警长竞选发言】… | 有 |
| `action_night_werewolf_discuss` | 【狼人讨论】轮到你发言了… | 有 |
| `action_chat` | 【聊天室】/【有人@你】/【游戏结束】 | 有 |

### 决策类 — 只有【行为逻辑】

| action | task prompt | 说话方式 |
|---|---|---|
| `action_seer` | 【预言家】可选玩家：… | 无 |
| `action_guard` | 【守卫】可选玩家：… | 无 |
| `action_witch` | 【女巫】今晚X号被刀… | 无 |
| `action_day_vote` | 【白天投票】可选玩家：… | 无 |
| `action_night_werewolf_vote` | 【狼人投票】可选玩家：… | 无 |
| `action_cupid` | 【丘比特】可选玩家：… | 无 |
| `action_shoot` | 【猎人开枪】可选玩家：… | 无 |
| `action_sheriff_campaign` | 【警长竞选】… | 无 |
| `action_withdraw` | 【退水】… | 无 |
| `action_pass_badge` | 【传警徽】… | 无 |
| `action_assign_order` | 【指定发言顺序】… | 无 |
| `action_sheriff_vote` | 【警长竞选投票】… | 无 |
| `action_post_vote` | 【PK投票】可选玩家：… | 无 |

### 分析类 — ephemeral + 无 tool

| action | task 持久化 | 说话方式 | tool |
|---|---|---|---|
| `analyze` | ephemeral | 无 | 无 |

---

## persona 位置的可配置性

thinking/speaking 目前放在最后一条 user 消息开头，后续可能调整到 system prompt 等位置。只需改 `buildLLMView` 中 persona 的插入逻辑，不影响持久化路和 TurnParts 数据结构。

---

## 改造前后对比

### 场景：预言家查验

**改造前：**
```
mm.messages:
  user: "[系统]第1夜"

LLMView 最后一条 user（ephemeral，不持久化）:
  "【预言家】可选玩家：…\n\n【行为逻辑】\n…"

成功后 mm.messages:
  user: "[系统]第1夜"
  assistant: (tool: action_seer, target: 3)     ← 为什么查验？无锚点
  tool: "你查验了3号王五"
```

**改造后：**
```
持久化路（answer 开始时）:
  user: "[系统]第1夜" → user: "[系统]第1夜\n【预言家】可选玩家：…"

LLMView（发给 LLM）:
  user: "【行为逻辑】\n…\n[系统]第1夜\n【预言家】可选玩家：…"

成功后 mm.messages:
  user: "[系统]第1夜\n【预言家】可选玩家：…"
  assistant: (tool: action_seer, target: 3)
  tool: "你查验了3号王五"
```

### 场景：白天发言（有 analyze）

**改造前：**
```
mm.messages:
  user: "[发言|1号张三]5号可疑"
  assistant: (tool: action_day_discuss, "1号说听到动静")   ← analyze 走了发言 tool，语义错误
  tool: "你说：1号说听到动静"
  user: "[发言|2号李四]我同意1号"

LLMView 最后一条 user（ephemeral）:
  "【白天发言】轮到你发言了…\n\n【行为逻辑】\n…\n\n【说话方式】\n…"
```

**改造后：**
```
mm.messages（持久化路逐步演进）:
  user: "[发言|1号张三]5号可疑"                            ← flush
  assistant: "1号逻辑矛盾，村民不可能听到动静"              ← analyze 纯文本，无 tool
  user: "[发言|2号李四]我同意1号"                            ← flush
  → 同一条消息被持久化路修改为: "[发言|2号李四]我同意1号\n【白天发言】轮到你发言了…"
  assistant: (tool: action_day_discuss, "2号跟风1号…")
  tool: "你说：2号跟风1号…"

LLMView（发给 LLM 的最后一条 user）:
  "【行为逻辑】\n…\n【说话方式】\n…\n[发言|2号李四]我同意1号\n【白天发言】轮到你发言了…"
```

### 场景：聊天室被 @

**改造前：**
```
mm.messages:
  user: "李四: @银狼 你好"
  assistant: (tool: action_chat, "你好呀")     ← 为什么回复？无锚点
  tool: "你说：你好呀"
```

**改造后：**
```
mm.messages:
  user: "李四: @银狼 你好\n【有人@你】李四 提到了你：@银狼 你好"   ← 持久化路合并 task
  assistant: (tool: action_chat, "你好呀")
  tool: "你说：你好呀"

LLMView（发给 LLM 的最后一条 user）:
  "【行为逻辑】\n…\n【说话方式】\n…\n李四: @银狼 你好\n【有人@你】李四 提到了你：@银狼 你好"
```

---

## 改造涉及的文件

### `prompt.js`

- `buildCurrentTurn` 返回 `TurnPart[]`，每个 part 带 `ephemeral` 标志
- 顺序：thinking → speaking → task

### `message_manager.js`

- `buildLLMView(parts)` 接收 `TurnPart[]`，在最后一条 user 开头插入 persona、末尾追加 task。纯函数，不修改 mm.messages

### `agent.js`

- `answer()` 流程：buildCurrentTurn → buildLLMView（只读）→ 持久化路（合并 task）→ LLM 调用 → 成功后 push assistant + tool
- parts 需要从 `answer()` 传递到 `_agentLoop()`，可通过参数传递

### `controller.js`

- `_shouldAnalyzeAfterInject` 中 `actionType` 从 `ACTION.DAY_DISCUSS` 改为 `'analyze'`
- 激活 `prompt.js` 中已有的 `analyze` 任务词和 `agent.js` 中已有的 `context.action === 'analyze'` 分支

---

## 待确认

1. **analyze 的 assistant 在历史中无对应 user**：analyze 的 task 是 ephemeral，持久化路不会合并任何内容，历史中 assistant 前面直接是 flush 的游戏事件 user。这是否可接受？

2. **聊天室自由发言**：`sendChatMessage` 主动触发的聊天，task prompt 是否也持久化？如果 AI 主动发言且没有 flush 产生的 user，持久化路会 push 一条新 user。