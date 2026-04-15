# CLI 客户端使用指南

## 前置条件

启动游戏服务器：
```bash
node server.js
```

## 基本命令

| 命令 | 说明 |
|------|------|
| `--start --name <名字>` | 启动后台进程并加入游戏 |
| `--status` | 查看游戏状态 |
| `--action <字母>` | 执行选项（A/B/C...） |
| `--speak "内容"` | 发言 |
| `--stop` | 停止后台进程 |

## 完整流程示例

```bash
# 1. 启动游戏（9人局）
node cli_client.js --start --name Alice --players 9

# 2. 查看状态
node cli_client.js --status --name Alice

# 3. 添加 AI 玩家（重复执行直到人满）
node cli_client.js --action A --name Alice

# 4. 游戏中按提示操作
# 发言
node cli_client.js --speak "我是好人" --name Alice

# 投票/选择目标
node cli_client.js --action B --name Alice

# 5. 游戏结束后再来一局
node cli_client.js --action A --name Alice

# 6. 退出
node cli_client.js --stop --name Alice
```

## 调试模式

指定角色（需服务器启动时加 `--debug`）：
```bash
node cli_client.js --start --name Alice --role seer
```

可选角色：`werewolf`, `seer`, `witch`, `guard`, `hunter`, `villager`, `idiot`, `cupid`

## 状态显示说明

```
=== 游戏状态 ===
阶段: 白天讨论中... | 第1天
角色: 预言家 (好人阵营)

玩家:
  1号 小红
  2号 阿伟 [警长]
  3号 Alice (预言家) ← 你
  4号 小玲 [已死亡]

消息历史:
  [14:30:01] === 白天讨论 ===
  [14:30:02] 1号 小红: 我是好人
  [14:30:05] 投票结果
1号小红 → 2号阿伟

=== 可操作 ===
请投票:
[A] 投给 1号 小红
[B] 投给 2号 阿伟 [警长]
[C] 弃权
```

## 多选操作

丘比特连线等需要两个目标时：
```bash
node cli_client.js --action A --action2 C --name Alice
```

## 最佳实践

1. **一个终端一个玩家**：每次只用一个 `--name`，避免多个后台进程冲突

2. **先查状态再操作**：用 `--status` 确认当前阶段和可选操作

3. **快速添加 AI**：人不够时循环添加
   ```bash
   for i in {1..8}; do node cli_client.js --action A --name Alice; sleep 0.3; done
   ```

4. **断线重连**：连接断开时用 `--refresh`
   ```bash
   node cli_client.js --refresh --name Alice
   ```

5. **清理残留**：异常退出后重新启动
   ```bash
   node cli_client.js --stop --name Alice
   node cli_client.js --start --name Alice
   ```

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| "后台进程未运行" | 先执行 `--start` |
| "服务器未启动" | 执行 `node server.js` |
| "已有其他后台进程" | 先 `--stop` 或换一个 `--name` |
| 选项字母无效 | 用 `--status` 查看当前可选字母范围 |