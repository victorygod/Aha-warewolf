/**
 * 提示词统一管理
 */

const fs = require('fs');
const path = require('path');

// 角色名称
const ROLE_NAMES = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  hunter: '猎人',
  villager: '村民',
  idiot: '白痴',
  cupid: '丘比特'
};

/**
 * 读取角色攻略
 * @param {string} presetId - 板子ID，如 '12-hunter-idiot'
 * @param {string} roleId - 角色ID，如 'witch'
 * @returns {string} 攻略内容，文件不存在则返回空
 */
function loadStrategyGuide(presetId, roleId) {
  if (!presetId || !roleId) return '';

  const strategyPath = path.join(__dirname, 'strategy', presetId, `${roleId}.md`);
  try {
    if (fs.existsSync(strategyPath)) {
      return fs.readFileSync(strategyPath, 'utf-8');
    }
  } catch (err) {
    // 忽略读取错误
  }
  return '';
}

// 生成系统提示词
function buildSystemPrompt(player, game) {
  const role = player.role;
  const roleId = role.id || role;
  const roleName = ROLE_NAMES[roleId] || roleId;
  const position = (game.players || []).findIndex(p => p.id === player.id) + 1;
  const soul = player.soul || '你是一个普通的玩家。';

  // 狼人队友信息（仅狼人可见）
  let wolfTeammates = '';
  if (role.camp === 'wolf') {
    const teammates = (game.players || [])
      .filter(p => p.id !== player.id && p.role?.camp === 'wolf')
      .map(p => {
        const pos = (game.players || []).findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号${p.name}`;
      });
    if (teammates.length > 0) {
      wolfTeammates = ` 队友:${teammates.join(',')}`;
    }
  }

  // 从板子预设动态获取规则描述
  const ruleDescs = game.preset?.ruleDescriptions || [];
  const rulesText = ruleDescs.length > 0
    ? '规则:' + ruleDescs.join('|')
    : '';

  // 读取角色攻略
  const presetId = game.presetId || game.preset?.name?.replace('人', '-') || '';
  const strategyGuide = loadStrategyGuide(presetId, roleId);
  const strategyText = strategyGuide ? `\n\n${strategyGuide}` : '';

  return `名字:${player.name} 位置:${position}号位 角色:${roleName}${wolfTeammates}
${soul}
${rulesText}
【角色攻略】
${strategyText}`;
}

/**
 * 使用压缩历史格式化消息（纯函数）
 * @param {string} compressedSummary - 压缩后的摘要
 * @param {Array} newMsgs - 新增的消息
 * @param {Array} players - 玩家列表
 * @returns {string} 格式化后的历史
 */
function formatWithCompression(compressedSummary, newMsgs, players) {
  const lines = ['【历史摘要】', compressedSummary || '（无）'];

  if (newMsgs && newMsgs.length > 0) {
    // 动态导入避免循环依赖
    const { formatMessageHistory } = require('./context');
    lines.push('', '【最新动态】');
    lines.push(formatMessageHistory(newMsgs, players));
  }

  return lines.join('\n');
}

/**
 * 构建压缩提示词（纯函数）
 * @param {Array} newMessages - 新增的消息
 * @param {Object} player - 当前玩家
 * @param {Array} players - 玩家列表
 * @param {string} prevSummary - 上次压缩的摘要
 * @returns {string} 压缩提示词
 */
function buildCompressPrompt(newMessages, player, players, prevSummary) {
  const role = player.role;
  const roleId = role?.id || role;
  const roleName = ROLE_NAMES[roleId] || roleId;
  const position = players.findIndex(p => p.id === player.id) + 1;

  // 狼人队友信息
  let wolfTeammates = '';
  if (roleId === 'werewolf') {
    const teammates = players.filter(p =>
      p.alive && p.id !== player.id && p.role?.id === 'werewolf'
    );
    if (teammates.length > 0) {
      const positions = teammates.map(p => players.findIndex(gp => gp.id === p.id) + 1 + '号').join('、');
      wolfTeammates = `\n你的队友: ${positions}`;
    }
  }

  // 动态导入避免循环依赖
  const { formatMessageHistory } = require('./context');
  const newMessagesText = formatMessageHistory(newMessages, players, player);
  const identityInfo = `名字:${player.name || '未知'} 位置:${position}号位 角色:${roleName}${wolfTeammates}`;

  return `你是狼人杀游戏分析师。请将以下游戏历史压缩为300字以内的局势摘要。

## 你的身份
${identityInfo}

## 上次压缩摘要
${prevSummary || '（无）'}

## 新增消息（从上次压缩点到当前）
${newMessagesText}

请生成简洁的局势摘要，包含：
1. 当前存活人数和阵营分布
2. 关键信息和可疑玩家
3. 可能的局势走向

直接输出摘要，不要有其他内容。`;
}

// 阶段提示词（统一要求 JSON 格式返回）
const PHASE_PROMPTS = {
  night_werewolf_discuss: () => '【狼人讨论】轮到你发言了，请与同伴讨论今晚的目标，100字以内。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  night_werewolf_vote: (aliveList) => `【狼人投票】可选玩家：\n${aliveList}\n请选择今晚要击杀的玩家。无废话，以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`,
  seer: (aliveList) => `【预言家】可选玩家：\n${aliveList}\n请选择要查验的玩家。无废话，以JSON格式返回: {"type": "target", "target": 位置编号}`,
  guard: (aliveList) => `【守卫】可选玩家：\n${aliveList}\n请选择要守护的玩家。无废话，以JSON格式返回: {"type": "target", "target": 位置编号}`,
  day_discuss: () => '【白天发言】轮到你发言了，请分析局势，简要发言，100字以内。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  day_vote: (aliveList, context) => {
    // 使用 allowedTargets 显示实际可选玩家（排除自己）
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【白天投票】可选玩家：\n${targetList}\n请选择要放逐的玩家，注意票型会公开。无废话，以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`;
  },
  // 放逐后处理（PK投票等）
  post_vote: (aliveList, context) => {
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【PK投票】可选玩家：\n${targetList}\n请选择要放逐的玩家，注意票型会公开。无废话，以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`;
  },
  last_words: () => '【遗言】你即将死亡，请发表遗言，100字以内。以JSON格式返回: {"type": "speech", "content": "你的遗言"}',
  witch: (aliveList, context) => {
    // 兼容 context.players 和 context.game.players 两种写法
    const players = context.players || context.game?.players || [];
    // werewolfTarget 可能是玩家ID（数字）或玩家对象，需要兼容处理
    const targetId = context.werewolfTarget?.id ?? context.werewolfTarget;
    const killedPlayer = targetId ? players.find(p => p.id === targetId) : null;
    const killedName = killedPlayer?.name || '无人';
    const killedPos = killedPlayer ? players.findIndex(p => p.id === targetId) + 1 : '';
    const healAvailable = context.witchPotion?.heal ? '可用' : '已用完';
    const poisonAvailable = context.witchPotion?.poison ? '可用' : '已用完';
    return `【女巫】可选玩家：\n${aliveList}\n今晚 ${killedPos}号${killedName} 被狼人杀害。解药：${healAvailable}，毒药：${poisonAvailable}。无废话，以JSON格式返回: {"type": "heal"} 或 {"type": "poison", "target": 编号} 或 {"type": "skip"}`;
  },
  // 警长竞选相关
  campaign: () => '【警长竞选】是否参与警长竞选？无废话，以JSON格式返回: {"type": "campaign", "run": true/false}',
  withdraw: () => '【退水】是否退出警长竞选？无废话，以JSON格式返回: {"type": "withdraw", "withdraw": true/false}',
  sheriff_speech: () => '【警长竞选发言】轮到你发言了，请说明为什么应该选你当警长，100字以内。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  sheriff_vote: (aliveList, context) => {
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【警长投票】可选候选人：\n${targetList}\n请选择要投票的候选人，注意票型会公开。无废话，以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`;
  },
  // 技能相关
  cupid: (aliveList) => `【丘比特】可选玩家：\n${aliveList}\n请选择两名玩家连接为情侣。无废话，以JSON格式返回: {"type": "cupid", "targets": [位置编号1, 位置编号2]}`,
  shoot: (aliveList) => `【猎人开枪】可选玩家：\n${aliveList}\n你已死亡，可以选择开枪带走一名玩家。无废话，以JSON格式返回: {"type": "shoot", "target": 位置编号} 或 {"type": "skip"} 放弃开枪`,
  passBadge: (aliveList) => `【传警徽】可选玩家：\n${aliveList}\n你是警长，已死亡。请选择将警徽传给谁。无废话，以JSON格式返回: {"type": "passBadge", "target": 位置编号} 或 {"type": "skip"} 不传`,
  assignOrder: (aliveList, context) => {
    // 使用 allowedTargets 排除自己
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【指定发言顺序】可选玩家：\n${targetList}\n你是警长，请指定从哪位玩家开始发言。无废话，以JSON格式返回: {"type": "assignOrder", "target": 位置编号}`;
  }
};

// 获取阶段提示词
function getPhasePrompt(phase, context) {
  // 兼容 context.players 和 context.game.players 两种写法
  const players = context.players || context.game?.players || [];
  const aliveList = context.alivePlayers.map(p => {
    const pos = players.findIndex(gp => gp.id === p.id) + 1;
    return `${pos}号: ${p.name}`;
  }).join('\n');

  const promptFn = PHASE_PROMPTS[phase];
  if (promptFn) {
    return promptFn(aliveList, context);
  }
  return '请行动。';
}

// AI 人物设定
// const AI_PROFILES = [
//   { name: '阿明', soul: '你是一个直爽的人，说话直接，不喜欢拐弯抹角。你相信直觉，做事果断。' },
//   { name: '小红', soul: '你是一个细心的人，善于观察细节。你说话温和，但逻辑清晰。' },
//   { name: '大刚', soul: '你是一个豪爽的人，喜欢带头说话。你比较有主见，不轻易改变想法。' },
//   { name: '小丽', soul: '你是一个谨慎的人，不会轻易表态。你喜欢先观察再发言。' },
//   { name: '阿华', soul: '你是一个理性的人，喜欢分析局势。你说话有条理，喜欢列举理由。' },
//   { name: '小芳', soul: '你是一个敏感的人，容易察觉他人的情绪变化。你说话比较委婉。' },
//   { name: '小娟', soul: '你是一个稳重的人，做事有分寸。你说话不多但很有分量。' },
//   { name: '阿伟', soul: '你是一个聪明的人，反应快。你善于抓住别人话语中的漏洞。' },
//   { name: '小燕', soul: '你是一个活泼的人，喜欢互动。你说话轻松幽默，能活跃气氛。' },
//   { name: '大军', soul: '你是一个沉稳的人，不慌不忙。你说话慢但很有说服力。' },
//   { name: '小玲', soul: '你是一个机灵的人，反应敏捷。你善于随机应变，说话灵活。' },
//   { name: '阿鹏', soul: '你是一个正直的人，看不惯虚伪。你说话直接，敢于指出问题。' },
//   { name: '小霞', soul: '你是一个温柔的人，不喜欢冲突。你说话柔和，善于调解矛盾。' },
//   { name: '阿杰', soul: '你是一个深沉的人，心思缜密。你说话不多但每句都经过思考。' },
//   { name: '小云', soul: '你是一个随和的人，不争不抢。你说话轻松，不喜欢压力。' }
// ];

const AI_PROFILES = [
  { name: '阿明', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小红', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '大刚', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小丽', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '阿华', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小芳', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小娟', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '阿伟', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小燕', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '大军', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小玲', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '阿鹏', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小霞', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '阿杰', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' },
  { name: '小云', soul: '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。' }
];

let usedNames = new Set();

function resetUsedNames() {
  usedNames = new Set();
}

function getRandomProfiles(count) {
  const available = AI_PROFILES.filter(p => !usedNames.has(p.name));
  const shuffled = available.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);
  selected.forEach(p => usedNames.add(p.name));
  return selected;
}

module.exports = {
  ROLE_NAMES,
  buildSystemPrompt,
  getPhasePrompt,
  getRandomProfiles,
  resetUsedNames,
  formatWithCompression,
  buildCompressPrompt
};