/**
 * formatter.js - 消息格式化模块（简化版）
 * 只做消息格式化，可见性过滤由 controller 的 getVisibleMessages() 完成
 */

const { ACTION, MSG, CAMP, DEATH_REASON } = require('../../engine/constants');

// 死亡原因中文映射
const DEATH_REASON_TEXT = {
  [DEATH_REASON.WEREWOLF]: '被狼人击杀',
  [DEATH_REASON.POISON]: '被女巫毒杀',
  [DEATH_REASON.VOTE]: '被放逐',
  [DEATH_REASON.HUNTER]: '被猎人带走',
  [DEATH_REASON.CONFLICT]: '同守同救',
  [DEATH_REASON.COUPLE]: '殉情'
};

// 获胜阵营中文映射
const WINNER_TEXT = {
  [CAMP.GOOD]: '好人阵营',
  [CAMP.WOLF]: '狼人阵营',
  [CAMP.THIRD]: '第三方阵营'
};

/**
 * 格式化游戏结束信息为文本
 * @param {Object} gameOverInfo - 游戏结束信息
 * @returns {string} 格式化后的玩家身份信息
 */
function formatGameOverInfo(gameOverInfo) {
  if (!gameOverInfo?.players) return '';
  return gameOverInfo.players.map(p => {
    const roleName = p.role?.name || p.role?.id || '未知角色';
    if (p.alive) return `${p.name}: ${roleName}`;
    const deathText = p.deathReason ? DEATH_REASON_TEXT[p.deathReason] || p.deathReason : '死亡';
    return `${p.name}: ${roleName} (已死亡 - ${deathText})`;
  }).join('\n');
}

/**
 * 获取获胜阵营中文名称
 * @param {string} winner - 获胜阵营ID
 * @returns {string} 中文阵营名称
 */
function getWinnerText(winner) {
  return WINNER_TEXT[winner] || '未知阵营';
}

function formatMessageHistory(messages, players, currentPlayer = null) {
  if (!messages || messages.length === 0) return '';

  const lines = [];

  for (const msg of messages) {
    if (msg.type === MSG.PHASE_START) continue;
    if (!msg.content) continue;
    lines.push(msg.content);
  }

  return lines.join('\n');
}

function getPlayerDisplay(id, players) {
  const p = players.find(x => x.id === id || x.id === parseInt(id));
  return p ? `${id}号${p.name}` : `${id}号`;
}

function buildToolResultMessage(toolName, action, context) {
  const players = context.players || [];
  const display = (id) => getPlayerDisplay(id, players);

  if (action.skip) {
    return '你选择弃权';
  }

  switch (toolName) {
    case ACTION.POST_VOTE:
      return action.target != null ? `你投票给了${display(action.target)}` : '你选择弃权';

    case ACTION.DAY_DISCUSS:
      return `你说：${action.content || ''}`;

    case ACTION.WITCH:
      if (action.action === 'heal') {
        const targetId = context.werewolfTarget?.id ?? context.werewolfTarget;
        return targetId ? `你使用解药救了${display(targetId)}` : '你使用了解药';
      }
      if (action.action === 'poison' && action.target != null) {
        return `你使用毒药毒杀了${display(action.target)}`;
      }
      return '你选择不使用技能';

    case ACTION.SEER:
      return action.target != null ? `你查验了${display(action.target)}` : '你选择不查验';

    case ACTION.GUARD:
      return action.target != null ? `你守护了${display(action.target)}` : '你选择不守护';

    case ACTION.CUPID:
      return action.targets?.length === 2
        ? `你将${display(action.targets[0])}和${display(action.targets[1])}连接为情侣`
        : '你选择不连线';

    case ACTION.SHOOT:
      return action.target != null ? `你开枪带走了${display(action.target)}` : '你选择放弃开枪';

    case ACTION.SHERIFF_CAMPAIGN:
      return action.run ? '你选择参与警长竞选' : '你选择不参与警长竞选';

    case ACTION.WITHDRAW:
      return action.withdraw ? '你选择退出警长竞选' : '你选择继续参与竞选';

    case ACTION.PASS_BADGE:
      return action.target != null ? `你将警徽传给了${display(action.target)}` : '你选择不传警徽';

    case ACTION.ASSIGN_ORDER:
      return action.target != null ? `你指定从${display(action.target)}开始发言` : '你选择不指定发言顺序';

    case ACTION.NIGHT_WEREWOLF_DISCUSS:
      return `你说：${action.content || ''}`;

    case ACTION.NIGHT_WEREWOLF_VOTE:
      return action.target != null ? `你想刀${display(action.target)}` : '你选择弃权';

    case ACTION.DAY_VOTE:
      return action.target != null ? `你投票给了${display(action.target)}` : '你选择弃权';

    case ACTION.SHERIFF_VOTE:
      return action.target != null ? `你投票给了${display(action.target)}` : '你选择弃权';

    case ACTION.SHERIFF_SPEECH:
      return `你说：${action.content || ''}`;

    case ACTION.LAST_WORDS:
      return `你说：${action.content || ''}`;

    case ACTION.CHAT:
      return `你说：${action.content || ''}`;

    case 'update_experience':
      return `经验已更新（板子: ${action.presetId}, 角色: ${action.roleId}）`;

    default:
      return '操作成功';
  }
}

function formatMessageToText(msg, selfId) {
  if (msg.type === MSG.CHAT || msg.event === 'chat') {
    if (msg.playerId === selfId && msg.isAI) return null;
    return `${msg.playerName}: ${msg.content}`;
  }
  if (msg.type === MSG.GAME_OVER) {
    return msg.content;
  }
  return msg.content || null;
}

module.exports = {
  getPlayerDisplay,
  formatMessageHistory,
  buildToolResultMessage,
  formatMessageToText,
  formatGameOverInfo,
  getWinnerText
};