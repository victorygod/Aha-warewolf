# 欢愉杀

> **我，即是欢愉。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![English](https://img.shields.io/badge/README-English-blue.svg)](README_EN.md)

<p align="center">
  <img src="public/assets/characters/huahuo.png" alt="花火" width="720">
</p>

你听见了吗？那是命途的低语。

当阿哈的笑声回荡在星穹之间，当花火在面具之后露出意味不明的微笑——

**想和崩坏：星穹铁道里的人物，一起来一场酣畅淋漓的狼人杀吗？**

那么就来 **欢愉杀** 吧，体验欢愉！

---

## 这是什么

欢愉杀是一款 AI 驱动的狼人杀游戏。每一位 AI 玩家都拥有完整的崩铁角色人格——他们不是套了个名字的随机发言机器，而是真正以角色的方式思考、发言、投票、博弈。

花火会在发言时演戏，卡芙卡会用沉默施压，银狼会吐槽你的逻辑漏洞，三月七会第一个跳出来保护你。

## 游戏截图

<p align="center">
  <img src="public/assets/snapshot/game.png" alt="游戏界面" width="45%">
  &nbsp;&nbsp;
  <img src="public/assets/snapshot/chat_room.png" alt="聊天室" width="45%">
</p>

## 你会遇到谁

| 角色 | 身份 | 一句话 |
|------|------|--------|
| 花火 | 假面愚者 | 「这个世界就是我的舞台，而你——只是观众。」 |
| 火花 | 假面愚者 | 「谁被看见，谁就是答案。」 |
| 黑天鹅 | 流光忆庭 | 「记忆不会说谎，但我也不打算告诉你真相。」 |
| 卡芙卡 | 星核猎手 | 「恐惧，是理解开始的地方。」 |
| 银狼 | 星核猎手 | 「这局难度太低了，能不能来点硬的？」 |
| 流萤 | 星核猎手 | 「我想以自己的方式，活在当下。」 |
| 三月七 | 星穹列车 | 「咱虽然不记得过去，但咱有你们呀！」 |
| 姬子 | 星穹列车 | 「先行动，再解释。走了。」 |
| 丹恒 | 星穹列车 | 「我不是任何人的影子。」 |
| 星期日 | 星穹列车 | 「坠落，本是飞翔的别名。」 |
| 大黑塔 | 天才俱乐部 #83 | 「你的编号是多少？算了，不重要。」 |
| 阮·梅 | 天才俱乐部 #81 | 「不加速，也不推迟死亡，生命总会枯萎。」 |
| 大丽花 | 永火官邸 | 「背叛是这世上最美的舞步。」 |
| 长夜月 | 黄金裔 | 「我愿燃尽自己，只为照亮你的夜。」 |
| 忘归人 | 仙舟联盟 | 「小女子已无归处，但恩公的方向，便是前路。」 |
| 爻光 | 仙舟联盟 | 「将军的琴弦，弹的是天下太平。」 |

每位 AI 角色都拥有独立的人格档案——包括背景故事、思维方式、发言风格，让他们的每一次决策都带有鲜明的角色印记。

## 怎么玩

### 安装

要求 Node.js >= 18。

```bash
npm install
```

### 配置 AI

```bash
cp api_key.conf.example api_key.conf
```

编辑 `api_key.conf`，填入你的 LLM API 配置：

```json
{
  "base_url": "https://your-api-endpoint/v1",
  "auth_token": "your-api-key",
  "model": "your-model-name"
}
```

没有 API Key？没关系，AI 会自动降级为随机模式，你依然可以体验完整游戏流程。

### 启动

```bash
npm start
```

打开 http://localhost:3000，加入房间，开始游戏。

### CLI 客户端

除了浏览器，你也可以用命令行客户端体验游戏，适合调试和快速模拟：

```bash
node cli_client.js --start --name MyName --preset 9-standard
node cli_client.js --status          # 查看当前状态
node cli_client.js --action <number> # 执行操作
node cli_client.js --speak "message" # 发言
```

## 调试模式

```bash
node server.js --debug
```

调试模式开放两个能力：

- **自选角色** — 你可以指定自己和其他玩家的身份，想当预言家就当预言家，想让花火当狼人就让花火当狼人
- **窥视 AI 思维** — 日志中会输出每个 AI 角色的完整上下文，包括它看到了什么信息、如何推理、为什么做出这个决定。你可以看到卡芙卡是如何编织话术的，也可以看到银狼在投票前的内心吐槽

## 项目结构

```
├── server.js            # 入口
├── server-core.js       # WebSocket 服务器，玩家管理
├── cli_client.js        # 命令行客户端
├── engine/              # 游戏引擎（纯逻辑，无网络/AI依赖）
│   ├── main.js          #   GameEngine
│   ├── phase.js         #   PhaseManager + 阶段流程
│   ├── player.js        #   PlayerController
│   ├── roles.js         #   角色定义
│   ├── config.js        #   板子配置、规则、胜负判定
│   ├── constants.js     #   枚举常量
│   ├── vote.js          #   投票管理
│   └── message.js       #   消息与可见性
├── ai/                  # AI 系统
│   ├── controller.js    #   AIController + AIManager
│   ├── agent/           #   Agent 核心（LLM 调用、工具、上下文压缩）
│   ├── profiles/        #   角色人格档案（background/thinking/speaking）
│   └── strategy/        #   各板子角色策略
├── public/              # 前端（原生 JS + CSS）
└── test/                # 测试（自建框架）
```

## 技术栈

- **后端**: Node.js + Express + WebSocket
- **前端**: 原生 JavaScript + SSE
- **AI**: 大语言模型（兼容 OpenAI 接口），自动降级至随机模式
- **依赖**: express ^4.18.2, ws ^8.20.0（仅两个运行时依赖）

## 常见问题

**没有配置 API Key 会怎样？**

AI 会自动降级为随机模式，所有决策随机生成。一般用于调试。

**端口 3000 被占用怎么办？**

```bash
bash stop_server.sh
```

**支持哪些 LLM？**

任何兼容 OpenAI `/chat/completions` 接口的模型均可使用，包括 OpenAI、DeepSeek、GLM 等。在 `api_key.conf` 中配置 `base_url` 和 `model` 即可。

## Roadmap

- [ ] 更多角色人格
- [ ] 更多板子配置
- [ ] 在线多人模式（房间系统）
- [ ] 游戏回放与复盘
- [ ] 观战系统

---

## 版权声明

本项目仅供学习和二次创作之目的，禁止用于任何商业用途。

本项目中的头像和立绘素材来源于 Fandom Wiki，图片及角色背景设定均来自网络及《崩坏：星穹铁道》官方内容。如有侵权，请联系删除。

本项目的角色蒸馏技术受 [huashu-nuwa](https://github.com/alchaincyf/nuwa-skill) 技能启发。

---
> *「既然命途注定无趣，不如与我一同，在欢愉中燃烧。」*
>
> ——花火