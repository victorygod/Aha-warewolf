# AI Profile 创建流程

## 概述

为一个崩铁角色创建完整的 AI profile，分三步依次执行。顺序有意义：先深度调研（perspective），再从调研中提炼（profile 文件），最后补齐资源（图片）。调研是源头，profile 文件是蒸馏结果，图片是收尾。

## 步骤一：用 huashu-nuwa skill 调研角色

输入角色名，指定输出到 `ai/profiles/<角色名_汉语拼音>/<角色名>-perspective/`

**调研内容必须覆盖：**
人物设定、背景、性格、说话风格、行为方式、经历、人际关系、近期剧情

**不要调研：** 战斗机制、抽取建议、养成攻略、配队推荐

skill 会生成：
- `SKILL.md` — 完整思维框架（心智模型、决策启发式、角色扮演规则、表达DNA）
- `references/research/` — 6 份调研笔记：
  - `01-writings.md` 角色文本
  - `02-conversations.md` 对话素材
  - `03-expression-dna.md` 表达风格
  - `04-external-views.md` 外部评价
  - `05-decisions.md` 决策模式
  - `06-timeline.md` 时间线

## 步骤二：从 perspective 抽象 profile 文件

基于步骤一的产出，参考已有角色目录的结构，提炼生成以下文件。不是照搬，是从调研中蒸馏。

### profile.json

填写角色元信息。字段参考已有角色，如：

```json
{
  "name": "火花",
  "englishName": "Sparxie",
  "faction": "假面愚者",
  "path": "欢愉",
  "element": "火",
  "icon": "icon.webp",
  "splashArt": "splash_art.webp"
}
```

### background.md

内容：背景故事（童年、转折事件、加入阵营）、关键剧情（版本事件）、人际关系（每个角色一段，含原文引用）。精简版，保留关键信息，去掉调研中的分析过程。

### speaking.md

内容：句式特征、高频词与意象、语气特征、节奏、自称与称呼方式、禁忌（不说什么）、语气模式（不同话题下的语气变化）、关键引用（最体现角色的原话）。这是角色扮演时最直接的参考，要具体到可执行。

### thinking.md

内容：3-5 个心智模型（每个含核心逻辑、适用场景、局限）、决策启发式（if-then 规则）、价值观优先级、拒绝的（不会做的事）、未想清楚的矛盾。这是角色做判断时的内核。

## 步骤三：下载图片

从 Fandom Wiki 通过 MediaWiki API 获取图片直链并下载。

### 文件名规则

英文名 PascalCase，空格用下划线：

| 类型 | Wiki 文件名 | 本地文件 | 尺寸 |
|------|------------|---------|------|
| 头像 | `Character_{Name}_Icon.png` | `icon.webp` | 160×160 |
| 立绘 | `Character_{Name}_Splash_Art.png` | `splash_art.webp` | 2048×2048 |

### 查询与下载

```bash
# 查询（返回 JSON 中 imageinfo[0].url 即直链）
curl -s "https://honkai-star-rail.fandom.com/api.php?action=query&titles=File:Character_{Name}_Icon.png&prop=imageinfo&iiprop=url|size&format=json"

# 下载（Wiki 返回的 .png 实际是 WebP，直接改扩展名即可）
curl -sL -o /tmp/<name>_icon.png "<url>"
cp /tmp/<name>_icon.png ai/profiles/<角色名>/icon.webp
```

验证：`sips -g pixelWidth -g pixelHeight -g format <file>`

### 踩坑记录

- Wiki 返回的 `.png` 实际是 WebP 格式（`file` 命令显示 `RIFF Web/P image`），不需要格式转换，直接改扩展名
- 文件名不对时搜 `Category:{Name}_Images`，或在角色 Wiki 页面找
- macOS 自带 `sips` 可查看图片尺寸和格式，但**不能输出 webp**（只能读取）。如果需要转换格式，需安装 `cwebp`（`brew install webp`）或用 Pillow
- 本例中 Wiki 的 icon 和 splash art 本身就是 webp，所以无需转换