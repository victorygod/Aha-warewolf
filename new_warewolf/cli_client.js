/**
 * 狼人杀游戏 CLI 客户端
 *
 * 注意：本客户端需要先启动游戏服务器才能正常使用！
 *   启动服务器：node server.js
 *   服务器地址：http://localhost:3000（可通过 WS_URL 环境变量修改）
 *
 * 使用方式：
 *   node cli_client.js --start --name <玩家名> [--players <人数>] [--role <调试角色>]
 *   node cli_client.js --status [--full]
 *   node cli_client.js --action <序号> [--action2 <序号>]
 *   node cli_client.js --speak "发言内容"
 *   node cli_client.js --reset
 *   node cli_client.js --stop
 *   node cli_client.js --refresh
 *   node cli_client.js --help
 */

const WebSocket = require('ws');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ========== 常量 ==========

const WS_URL = process.env.WS_URL || 'ws://localhost:3000';
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
const CAMP_NAMES = {
  wolf: '狼人阵营',
  good: '好人阵营',
  third: '第三方'
};
const PHASE_PROMPTS = {
  cupid: '丘比特正在选择情侣...',
  guard: '守卫正在守护...',
  night_werewolf_discuss: '狼人正在讨论...',
  night_werewolf_vote: '狼人正在投票...',
  witch: '女巫正在行动...',
  seer: '预言家正在查验...',
  night_resolve: '夜晚结算中...',
  sheriff_campaign: '警长竞选中...',
  sheriff_speech: '竞选发言中...',
  sheriff_vote: '警长投票中...',
  day_announce: '天亮了！',
  last_words: '遗言阶段...',
  day_discuss: '白天讨论中...',
  day_vote: '投票中...',
  post_vote: '放逐后处理中...',
  waiting: '等待玩家加入',
  game_over: '游戏结束'
};

// ========== 工具函数 ==========

function getPlayerPos(playerId, players) {
  if (players) {
    const idx = players.findIndex(p => p.id === playerId);
    return idx >= 0 ? idx + 1 : playerId;
  }
  return playerId;
}

function formatTime(date) {
  return date.toTimeString().split(' ')[0];
}

function getSocketPath(name) {
  return path.join(process.cwd(), `.werewolf_${name}.sock`);
}

function getPidPath(name) {
  return path.join(process.cwd(), `.werewolf_${name}.pid`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// 查找所有运行中的后台进程
function findAllRunningDaemons() {
  const daemons = [];
  const files = fs.readdirSync(process.cwd());
  for (const file of files) {
    const match = file.match(/^\.werewolf_(.+)\.pid$/);
    if (match) {
      const name = match[1];
      const pidPath = path.join(process.cwd(), file);
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
      if (!isNaN(pid) && isProcessAlive(pid)) {
        daemons.push({ name, pid, pidPath });
      } else {
        // 清理死进程的残留文件
        try {
          fs.unlinkSync(pidPath);
          const socketPath = path.join(process.cwd(), `.werewolf_${name}.sock`);
          if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        } catch (e) {
          // 忽略清理错误
        }
      }
    }
  }
  return daemons;
}

// ========== 状态格式化 ==========

function formatState(state, options) {
  const lines = [];
  const myId = state.self?.id;
  const myPlayer = state.players?.find(p => p.id === myId);

  // 阶段信息
  const phaseName = PHASE_PROMPTS[state.phase] || state.phase;
  if (state.phase === 'waiting') {
    const current = state.players?.length || 0;
    const total = state.playerCount || 9;
    lines.push(`=== 游戏状态 ===`);
    lines.push(`阶段: 等待玩家加入 (${current}/${total})`);
  } else if (state.phase === 'game_over') {
    const winnerText = {
      wolf: '狼人阵营获胜！',
      good: '好人阵营获胜！',
      third: '第三方（情侣）获胜！'
    }[state.winner] || '游戏结束';
    lines.push(`=== 游戏状态 ===`);
    lines.push(`阶段: 游戏结束`);
    lines.push(`获胜方: ${winnerText}`);
  } else {
    const dayNight = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer', 'night_resolve'].includes(state.phase) ? '夜' : '天';
    lines.push(`=== 游戏状态 ===`);
    lines.push(`阶段: ${phaseName} | 第${state.dayCount}${dayNight}`);
  }

  // 角色信息
  if (state.self?.role) {
    const roleId = state.self.role.id || state.self.role;
    const roleName = ROLE_NAMES[roleId] || roleId;
    const campName = CAMP_NAMES[state.self.role.camp] || state.self.role.camp;
    const deadMark = myPlayer && !myPlayer.alive ? ' [已死亡]' : '';
    lines.push(`角色: ${roleName} (${campName})${deadMark}`);

    // 额外信息
    if (state.self.seerChecks?.length > 0) {
      const checks = state.self.seerChecks.map(c => {
        const target = state.players?.find(p => p.id === c.targetId);
        const pos = getPlayerPos(c.targetId, state.players);
        const result = c.result === 'good' ? '好人' : '狼人';
        return `${pos}号(${result})`;
      }).join(', ');
      lines.push(`已查验: ${checks}`);
    }
    if (state.self.witchHeal !== undefined || state.self.witchPoison !== undefined) {
      lines.push(`解药: ${state.self.witchHeal || 0}瓶 | 毒药: ${state.self.witchPoison || 0}瓶`);
    }
    if (state.self.lastGuardTarget) {
      const pos = getPlayerPos(state.self.lastGuardTarget, state.players);
      lines.push(`上晚守护: ${pos}号`);
    }
    if (state.self.isCouple && state.self.couplePartner) {
      const pos = getPlayerPos(state.self.couplePartner, state.players);
      lines.push(`情侣: ${pos}号`);
    }
  }

  // 玩家列表
  if (state.players?.length > 0) {
    lines.push('');
    lines.push('玩家:');
    state.players.forEach((p, idx) => {
      const pos = idx + 1;
      let line = `  ${pos}号 ${p.name}`;

      // 角色（仅自己、狼人队友、游戏结束可见）
      if (state.phase === 'game_over' && p.role) {
        const roleId = p.role.id || p.role;
        line += ` (${ROLE_NAMES[roleId] || roleId})`;
      } else if (p.id === myId && state.self?.role) {
        const roleId = state.self.role.id || state.self.role;
        line += ` (${ROLE_NAMES[roleId] || roleId})`;
      } else if (state.self?.role?.camp === 'wolf' && p.role?.camp === 'wolf') {
        const roleId = p.role.id || p.role;
        line += ` (${ROLE_NAMES[roleId] || roleId})`;
      }

      // 标记
      const marks = [];
      if (state.sheriff === p.id) marks.push('[警长]');
      if (!p.alive) marks.push('[已死亡]');
      if (p.id === myId) marks.push('← 你');
      if (state.self?.role?.camp === 'wolf' && p.role?.camp === 'wolf' && p.id !== myId) {
        marks.push('[队友]');
      }
      if (marks.length > 0) {
        line += ' ' + marks.join(' ');
      }

      lines.push(line);
    });
  }

  // 消息历史
  if (state.messages && state.messages.length > 0) {
    lines.push('');
    lines.push('消息历史:');
    // 只显示最近 20 条消息
    const recentMessages = state.messages.slice(-20);
    recentMessages.forEach(msg => {
      let msgLine = '';
      const time = msg.timestamp ? formatTime(new Date(msg.timestamp)) : '';

      switch (msg.type) {
        case 'speech':
        case 'sheriff_speech':
          const speaker = state.players?.find(p => p.id === msg.playerId);
          const speakerPos = speaker ? getPlayerPos(speaker.id, state.players) : '?';
          msgLine = `  [${time}] ${speakerPos}号 ${speaker?.name || '?'}: ${msg.content}`;
          break;
        case 'system':
          msgLine = `  [${time}] 系统: ${msg.content}`;
          break;
        case 'phase_start':
          msgLine = `  [${time}] === ${msg.content} ===`;
          break;
        case 'vote_result':
          msgLine = `  [${time}] ${msg.content || ''}`;
          break;
        case 'death':
          msgLine = `  [${time}] ${msg.content}`;
          break;
        case 'action':
          msgLine = `  [${time}] ${msg.content}`;
          break;
        default:
          if (msg.content) {
            msgLine = `  [${time}] ${msg.content}`;
          }
      }
      if (msgLine) {
        lines.push(msgLine);
      }
    });
  }

  // 游戏结束显示所有身份
  if (state.phase === 'game_over' && state.gameOverInfo?.players) {
    lines.push('');
    lines.push('玩家身份:');
    state.gameOverInfo.players.forEach(p => {
      const pos = state.players ? getPlayerPos(p.id, state.players) : p.id;
      const display = p.display || `${pos}号${p.name}`;
      const roleName = p.role ? ROLE_NAMES[p.role.id] || p.role.id : '未知';
      const deathInfo = p.alive ? '存活' : (p.deathReason ? `死亡(${p.deathReason})` : '死亡');
      const sheriffMark = p.isSheriff ? ' [警长]' : '';
      lines.push(`  ${display}: ${roleName} - ${deathInfo}${sheriffMark}`);
    });
  }

  return lines.join('\n');
}

// ========== 选项生成 ==========

function generateOptions(state, pendingAction) {
  if (!pendingAction) return null;

  const { action, requestId, ...data } = pendingAction;
  const myPlayer = state.players?.find(p => p.id === state.self?.id);
  const myId = state.self?.id;

  switch (action) {
    case 'speak':
    case 'last_words':
      return {
        type: 'input',
        prompt: action === 'last_words' ? '轮到你留遗言' : '轮到你发言',
        requestId
      };

    case 'vote':
    case 'wolf_vote':
    case 'sheriff_vote':
      return generateVoteOptions(state, myPlayer, data, requestId, action);

    case 'guard':
      return generateGuardOptions(state, myPlayer, data, requestId);

    case 'seer':
      return generateSeerOptions(state, myPlayer, data, requestId);

    case 'witch':
      return generateWitchOptions(state, myPlayer, data, requestId);

    case 'cupid':
      return generateCupidOptions(state, myPlayer, data, requestId);

    case 'shoot':
      return generateShootOptions(state, myPlayer, data, requestId);

    case 'campaign':
      return generateCampaignOptions(requestId);

    case 'withdraw':
      return generateWithdrawOptions(requestId);

    case 'assignOrder':
    case 'pass_badge':
    case 'passBadge':
      return generateTargetOptions(state, myPlayer, data, requestId, action);

    case 'choose_target':
      return generateChooseTargetOptions(state, myPlayer, data, requestId);

    default:
      return null;
  }
}

function generateVoteOptions(state, myPlayer, data, requestId, actionType) {
  const { allowedTargets } = data;
  const candidates = allowedTargets
    ? state.players.filter(p => p.alive && allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive && p.id !== myPlayer?.id);

  const isWolfVote = actionType === 'wolf_vote';
  const isWolf = state.self?.role?.camp === 'wolf';

  const options = candidates.map(p => {
    const pos = getPlayerPos(p.id, state.players);
    const isTeammate = p.role?.camp === 'wolf';
    const sheriffMark = state.sheriff === p.id ? ' [警长]' : '';
    const label = isWolfVote && isWolf && isTeammate
      ? `刀 ${pos}号 ${p.name} [队友]${sheriffMark}`
      : `投给 ${pos}号 ${p.name}${sheriffMark}`;
    return { label, data: { targetId: p.id } };
  });

  options.push({ label: '弃权', data: { targetId: null } });

  const prompt = isWolfVote ? '请选择刀人目标:' : (actionType === 'sheriff_vote' ? '请投票选警长:' : '请投票:');
  return { type: 'select', prompt, options, requestId };
}

function generateGuardOptions(state, myPlayer, data, requestId) {
  const { lastGuardTarget, allowedTargets } = data;
  const candidates = allowedTargets
    ? state.players.filter(p => allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive);

  const options = [];
  candidates.forEach(p => {
    if (p.id === lastGuardTarget) return; // 不能连守
    const pos = getPlayerPos(p.id, state.players);
    options.push({ label: `守护 ${pos}号 ${p.name}`, data: { targetId: p.id } });
  });

  options.push({ label: '跳过', data: { targetId: null } });

  let prompt = '请选择守护目标:';
  if (lastGuardTarget) {
    const pos = getPlayerPos(lastGuardTarget, state.players);
    prompt += ` (上晚守护: ${pos}号)`;
  }
  return { type: 'select', prompt, options, requestId };
}

function generateSeerOptions(state, myPlayer, data, requestId) {
  const { allowedTargets } = data;
  const candidates = allowedTargets
    ? state.players.filter(p => allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive && p.id !== myPlayer?.id);

  const options = candidates.map(p => {
    const pos = getPlayerPos(p.id, state.players);
    return { label: `查验 ${pos}号 ${p.name}`, data: { targetId: p.id } };
  });

  options.push({ label: '跳过', data: { targetId: null } });

  // 显示已查验记录
  const checks = state.self?.seerChecks || [];
  const extra = checks.length > 0
    ? '已查验: ' + checks.map(c => {
        const pos = getPlayerPos(c.targetId, state.players);
        const result = c.result === 'good' ? '好人' : '狼人';
        return `${pos}号(${result})`;
      }).join(', ')
    : null;

  return { type: 'select', prompt: '请选择查验目标:', options, requestId, extra };
}

function generateWitchOptions(state, myPlayer, data, requestId) {
  const { werewolfTarget, healAvailable, poisonAvailable, canSelfHeal, poisonTargets } = data;
  const options = [];
  let prompt = '女巫行动';

  // 显示被杀者
  if (werewolfTarget) {
    const target = state.players.find(p => p.id === werewolfTarget);
    const pos = getPlayerPos(werewolfTarget, state.players);
    const isSelf = werewolfTarget === myPlayer?.id;
    if (isSelf && !canSelfHeal) {
      prompt = `今晚 ${pos}号${target?.name || ''} 被狼人杀害！（非首夜不能自救）`;
    } else {
      prompt = `今晚 ${pos}号${target?.name || ''} 被狼人杀害！`;
    }

    // 解药
    if (healAvailable && !(isSelf && !canSelfHeal)) {
      options.push({ label: `救 ${pos}号 ${target?.name || ''}`, data: { action: 'heal' } });
    }
  } else {
    prompt = '今晚没有人被狼人杀害。';
  }

  // 毒药
  if (poisonAvailable && poisonTargets?.length > 0) {
    poisonTargets.forEach(id => {
      const p = state.players.find(p => p.id === id);
      if (p) {
        const pos = getPlayerPos(id, state.players);
        options.push({ label: `毒杀 ${pos}号 ${p.name}`, data: { action: 'poison', targetId: id } });
      }
    });
  }

  options.push({ label: '跳过', data: { action: 'skip' } });

  return { type: 'select', prompt, options, requestId };
}

function generateCupidOptions(state, myPlayer, data, requestId) {
  const candidates = state.players?.filter(p => p.alive) || [];

  const options = candidates.map(p => {
    const pos = getPlayerPos(p.id, state.players);
    return { label: `${pos}号 ${p.name}`, data: { targetId: p.id } };
  });

  return {
    type: 'multi',
    prompt: '请选择两名玩家连接为情侣:',
    options,
    requestId,
    count: 2,
    hint: '执行: node cli_client.js --action <第一人> --action2 <第二人>\n注意: 两个序号不能相同'
  };
}

function generateShootOptions(state, myPlayer, data, requestId) {
  const { allowedTargets } = data;
  const candidates = allowedTargets
    ? state.players.filter(p => allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive && p.id !== myPlayer?.id);

  const options = candidates.map(p => {
    const pos = getPlayerPos(p.id, state.players);
    return { label: `🔫 ${pos}号 ${p.name}`, data: { targetId: p.id } };
  });

  options.push({ label: '放弃开枪', data: { targetId: null } });

  return { type: 'select', prompt: '猎人请选择开枪目标:', options, requestId };
}

function generateCampaignOptions(requestId) {
  return {
    type: 'select',
    prompt: '是否竞选警长？',
    options: [
      { label: '竞选', data: { run: true } },
      { label: '不竞选', data: { run: false } }
    ],
    requestId
  };
}

function generateWithdrawOptions(requestId) {
  return {
    type: 'select',
    prompt: '是否退水？',
    options: [
      { label: '退水', data: { withdraw: true } },
      { label: '继续竞选', data: { withdraw: false } }
    ],
    requestId
  };
}

function generateTargetOptions(state, myPlayer, data, requestId, action) {
  const { allowedTargets } = data;
  const candidates = allowedTargets
    ? state.players.filter(p => allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive && p.id !== myPlayer?.id);

  const prompts = {
    assignOrder: '请指定发言顺序:',
    pass_badge: '警长请选择传警徽对象:',
    passBadge: '警长请选择传警徽对象:'
  };

  const options = candidates.map(p => {
    const pos = getPlayerPos(p.id, state.players);
    const sheriffMark = state.sheriff === p.id ? ' [警长]' : '';
    if (action === 'pass_badge' || action === 'passBadge') {
      return { label: `传给 ${pos}号 ${p.name}${sheriffMark}`, data: { targetId: p.id } };
    }
    return { label: `${pos}号 ${p.name}`, data: { targetId: p.id } };
  });

  if (action === 'pass_badge' || action === 'passBadge') {
    options.push({ label: '不传警徽', data: { targetId: null } });
  }

  return { type: 'select', prompt: prompts[action] || '请选择目标:', options, requestId };
}

function generateChooseTargetOptions(state, myPlayer, data, requestId) {
  const { count, allowedTargets, disabledIds } = data;
  const candidates = allowedTargets
    ? state.players.filter(p => allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive && p.id !== myPlayer?.id);

  const options = [];
  candidates.forEach(p => {
    if (disabledIds?.includes(p.id)) return;
    const pos = getPlayerPos(p.id, state.players);
    options.push({ label: `${pos}号 ${p.name}`, data: { targetId: p.id } });
  });

  if (count === 1) {
    options.push({ label: '跳过', data: { targetId: null } });
    return { type: 'select', prompt: '请选择目标:', options, requestId };
  } else {
    return {
      type: 'multi',
      prompt: `请选择 ${count} 个目标:`,
      options,
      requestId,
      count,
      hint: `执行: node cli_client.js --action <第一人> --action2 <第二人>`
    };
  }
}

// ========== 格式化选项输出 ==========

function indexToLetter(idx) {
  return String.fromCharCode(65 + idx); // 0->A, 1->B, ...
}

function letterToIndex(letter) {
  const upper = letter.toUpperCase();
  if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
    return upper.charCodeAt(0) - 65; // A->0, B->1, ...
  }
  return -1;
}

function formatOptions(optionsData) {
  if (!optionsData) return null;

  const lines = [];
  lines.push('');
  lines.push('=== 可操作 ===');

  if (optionsData.type === 'input') {
    lines.push(optionsData.prompt);
    lines.push('');
    lines.push('执行: node cli_client.js --speak "内容"');
  } else if (optionsData.type === 'select') {
    lines.push(optionsData.prompt);
    lines.push('');
    optionsData.options.forEach((opt, idx) => {
      lines.push(`[${indexToLetter(idx)}] ${opt.label}`);
    });
    lines.push('');
    lines.push('执行: node cli_client.js --action <字母>');
  } else if (optionsData.type === 'multi') {
    lines.push(optionsData.prompt);
    lines.push('');
    optionsData.options.forEach((opt, idx) => {
      lines.push(`[${indexToLetter(idx)}] ${opt.label}`);
    });
    lines.push('');
    if (optionsData.hint) {
      lines.push(optionsData.hint);
    }
  }

  if (optionsData.extra) {
    lines.push('');
    lines.push(optionsData.extra);
  }

  return lines.join('\n');
}

// ========== CLI 客户端 ==========

class CLIClient {
  constructor(name) {
    this.name = name;
    this.socketPath = getSocketPath(name);
    this.pidPath = getPidPath(name);
  }

  // 检查后台进程是否运行
  isDaemonRunning() {
    if (!fs.existsSync(this.pidPath)) {
      return false;
    }
    const pid = parseInt(fs.readFileSync(this.pidPath, 'utf8').trim(), 10);
    if (isNaN(pid)) {
      return false;
    }
    return isProcessAlive(pid);
  }

  // 启动后台进程
  startDaemon(players, role) {
    // 检查当前用户的后台进程
    if (this.isDaemonRunning()) {
      console.log(JSON.stringify({ error: '后台进程已运行，请先使用 --stop 停止' }, null, 2));
      process.exit(1);
    }

    // 检查是否有其他后台进程在运行（确保唯一性）
    const allDaemons = findAllRunningDaemons();
    if (allDaemons.length > 0) {
      const other = allDaemons.find(d => d.name !== this.name);
      if (other) {
        console.log(JSON.stringify({
          error: `已有其他后台进程运行中: ${other.name} (PID: ${other.pid})`,
          hint: `请先停止: node cli_client.js --stop --name ${other.name}`
        }, null, 2));
        process.exit(1);
      }
    }

    // 清理残留文件
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    // fork 后台进程
    const args = [__filename, '--daemon', '--name', this.name];
    if (players) args.push('--players', players);
    if (role) args.push('--role', role);

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // 等待 socket 创建
    let retries = 0;
    const checkReady = () => {
      if (fs.existsSync(this.socketPath)) {
        console.log(JSON.stringify({ success: true, message: '后台进程已启动' }, null, 2));
      } else if (retries < 50) {
        retries++;
        setTimeout(checkReady, 100);
      } else {
        console.log(JSON.stringify({ error: '后台进程启动超时' }, null, 2));
        process.exit(1);
      }
    };
    checkReady();
  }

  // 停止后台进程
  stopDaemon() {
    if (!this.isDaemonRunning()) {
      console.log(JSON.stringify({ error: '后台进程未运行' }, null, 2));
      process.exit(1);
    }

    const pid = parseInt(fs.readFileSync(this.pidPath, 'utf8').trim(), 10);
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      // 忽略
    }

    // 清理文件
    setTimeout(() => {
      if (fs.existsSync(this.pidPath)) fs.unlinkSync(this.pidPath);
      if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath);
      console.log(JSON.stringify({ success: true, message: '后台进程已停止' }, null, 2));
    }, 100);
  }

  // 发送命令到后台进程
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.isDaemonRunning()) {
        resolve({ error: '后台进程未运行，请先使用 --start 启动' });
        return;
      }

      const client = net.createConnection(this.socketPath, () => {
        client.write(JSON.stringify(command));
        client.end(); // 发送完毕，关闭写端
      });

      let data = '';
      client.on('data', chunk => {
        data += chunk;
      });

      client.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: '响应解析失败' });
        }
      });

      client.on('error', err => {
        resolve({ error: `连接失败: ${err.message}` });
      });

      // 超时
      setTimeout(() => {
        client.destroy();
        resolve({ error: '连接超时' });
      }, 5000);
    });
  }

  // 查询状态
  async status(full) {
    const result = await this.sendCommand({ type: 'status' });
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }, null, 2));
      return;
    }

    if (full) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // 检查连接状态
    if (!result.connected) {
      let errorMsg = result.connectError || '未连接到游戏服务器';
      // 解析常见错误
      if (errorMsg.includes('ECONNREFUSED')) {
        errorMsg = '服务器未启动或地址错误';
      } else if (errorMsg.includes('ENOTFOUND')) {
        errorMsg = '服务器地址无法解析';
      }
      console.log(JSON.stringify({
        error: errorMsg,
        server: WS_URL,
        hint: '请确保服务器已启动 (node server.js)，或使用 --refresh 重连'
      }, null, 2));
      return;
    }

    // 格式化输出
    const state = result.state;
    if (!state) {
      console.log(JSON.stringify({
        error: '无状态数据',
        hint: '可能正在连接中，请稍后再试'
      }, null, 2));
      return;
    }

    const lines = [];
    lines.push(formatState(state));

    // 生成选项
    const optionsData = generateOptions(state, state.pendingAction);
    const optionsText = formatOptions(optionsData);
    if (optionsText) {
      lines.push(optionsText);
    } else if (!state.pendingAction) {
      // 无待处理行动时显示阶段提示
      lines.push('');
      lines.push('=== 可操作 ===');
      if (state.phase === 'waiting') {
        const current = state.players?.length || 0;
        const total = state.playerCount || 9;
        lines.push(current < total ? `等待玩家加入... (${current}/${total})` : '人已齐，即将开始...');
        lines.push('');
        lines.push('[A] 添加 AI');
        lines.push('');
        lines.push('执行: node cli_client.js --action A');
      } else if (state.phase === 'game_over') {
        lines.push('[A] 再来一局');
        lines.push('');
        lines.push('执行: node cli_client.js --action A');
      } else if (state.self && !state.self.alive && state.phase !== 'last_words' && state.phase !== 'post_vote') {
        lines.push('你已死亡，观战中...');
      } else {
        lines.push(PHASE_PROMPTS[state.phase] || '等待中...');
      }
    }

    lines.push('');
    lines.push(`时间: ${formatTime(new Date(result.timestamp))}`);

    console.log(lines.join('\n'));
  }

  // 执行操作
  async action(index, index2) {
    const result = await this.sendCommand({ type: 'action', index, index2 });
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }, null, 2));
    } else {
      console.log(JSON.stringify({ success: true, sent: result.sent }, null, 2));
    }
  }

  // 发言
  async speak(content) {
    const result = await this.sendCommand({ type: 'speak', content });
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }, null, 2));
    } else {
      console.log(JSON.stringify({ success: true, sent: result.sent }, null, 2));
    }
  }

  // 重置
  async reset() {
    const result = await this.sendCommand({ type: 'reset' });
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }, null, 2));
    } else {
      console.log(JSON.stringify({ success: true }, null, 2));
    }
  }

  // 刷新
  async refresh() {
    const result = await this.sendCommand({ type: 'refresh' });
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }, null, 2));
    } else {
      console.log(JSON.stringify({ success: true, message: '已重新连接' }, null, 2));
    }
  }
}

// ========== 后台进程 ==========

class Daemon {
  constructor(name, players, role) {
    this.name = name;
    this.players = players;
    this.role = role;
    this.socketPath = getSocketPath(name);
    this.pidPath = getPidPath(name);
    this.ws = null;
    this.state = null;
    this.timestamp = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.server = null;
    this.playerId = null;
  }

  start() {
    // 写入 PID
    fs.writeFileSync(this.pidPath, process.pid.toString());

    // 创建 Unix Socket 服务器
    this.server = net.createServer(client => {
      let data = '';
      client.on('data', chunk => {
        data += chunk;
      });
      client.on('end', () => {
        this.handleCommand(data, client);
      });
    });

    // 清理残留 socket 文件
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.server.listen(this.socketPath, () => {
      // 连接 WebSocket
      this.connect();
    });

    // 退出时清理
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
    }
    if (this.server) {
      this.server.close();
    }
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }
    if (fs.existsSync(this.pidPath)) {
      fs.unlinkSync(this.pidPath);
    }
    process.exit(0);
  }

  connect() {
    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => {
        this.connected = true;
        this.connectError = null;
        // 发送 join 消息
        const joinMsg = { type: 'join', name: this.name };
        if (this.players) joinMsg.playerCount = parseInt(this.players, 10);
        if (this.role) joinMsg.debugRole = this.role;
        this.ws.send(JSON.stringify(joinMsg));
      });

      this.ws.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          // 忽略解析错误
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.connected = false;
        this.connectError = err.message || '连接失败';
        this.scheduleReconnect();
      });
    } catch (err) {
      this.connected = false;
      this.connectError = err.message || '连接失败';
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected) {
        this.connect();
      }
    }, 3000);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        this.state = msg.data;
        this.timestamp = new Date();
        if (msg.data?.self?.id) {
          this.playerId = msg.data.self.id;
        }
        break;
      case 'error':
        // 错误消息也更新时间戳
        this.timestamp = new Date();
        break;
    }
  }

  handleCommand(data, client) {
    let cmd;
    try {
      cmd = JSON.parse(data);
    } catch (e) {
      client.end(JSON.stringify({ error: '无效命令' }));
      return;
    }

    switch (cmd.type) {
      case 'status':
        this.cmdStatus(client);
        break;
      case 'action':
        this.cmdAction(client, cmd.index, cmd.index2);
        break;
      case 'speak':
        this.cmdSpeak(client, cmd.content);
        break;
      case 'reset':
        this.cmdReset(client);
        break;
      case 'refresh':
        this.cmdRefresh(client);
        break;
      default:
        client.end(JSON.stringify({ error: '未知命令' }));
    }
  }

  cmdStatus(client) {
    client.end(JSON.stringify({
      connected: this.connected,
      connectError: this.connectError,
      timestamp: this.timestamp,
      playerId: this.playerId,
      playerName: this.name,
      state: this.state
    }));
  }

  cmdAction(client, index, index2) {
    if (!this.connected) {
      client.end(JSON.stringify({ error: '未连接服务器' }));
      return;
    }

    // 处理等待阶段和游戏结束阶段的特殊操作
    if (!this.state?.pendingAction) {
      const phase = this.state?.phase;
      const idx = letterToIndex(index);

      if (phase === 'waiting' && idx === 0) {
        // 添加 AI（选项 A）
        const msg = { type: 'add_ai' };
        this.ws.send(JSON.stringify(msg));
        client.end(JSON.stringify({ success: true, sent: msg }));
        return;
      }
      if (phase === 'game_over' && idx === 0) {
        // 再来一局（选项 A）
        const msg = { type: 'reset' };
        this.ws.send(JSON.stringify(msg));
        this.state = null;
        this.timestamp = null;
        client.end(JSON.stringify({ success: true, sent: msg }));
        return;
      }
      client.end(JSON.stringify({ error: '当前无待处理行动，请使用 --status 查看状态' }));
      return;
    }

    const optionsData = generateOptions(this.state, this.state.pendingAction);
    if (!optionsData) {
      client.end(JSON.stringify({ error: '无法生成选项' }));
      return;
    }

    // 校验参数（字母转索引）
    const idx = letterToIndex(index);
    if (idx < 0 || idx >= optionsData.options.length) {
      const lastLetter = indexToLetter(optionsData.options.length - 1);
      client.end(JSON.stringify({ error: `参数不合法，选项必须是 A-${lastLetter} 之间的字母` }));
      return;
    }

    const { requestId } = optionsData;

    if (optionsData.type === 'multi') {
      // 多选
      if (!index2) {
        client.end(JSON.stringify({ error: '请提供两个选项字母，使用 --action <第一人> --action2 <第二人>' }));
        return;
      }
      const idx2 = letterToIndex(index2);
      if (idx2 < 0 || idx2 >= optionsData.options.length) {
        const lastLetter = indexToLetter(optionsData.options.length - 1);
        client.end(JSON.stringify({ error: `第二个参数不合法，选项必须是 A-${lastLetter} 之间的字母` }));
        return;
      }
      if (idx === idx2) {
        client.end(JSON.stringify({ error: '两个选项字母不能相同' }));
        return;
      }
      const id1 = optionsData.options[idx].data.targetId;
      const id2 = optionsData.options[idx2].data.targetId;
      const msg = { type: 'response', requestId, targetIds: [id1, id2] };
      this.ws.send(JSON.stringify(msg));
      client.end(JSON.stringify({ success: true, sent: msg }));
    } else {
      // 单选
      const opt = optionsData.options[idx];
      const msg = { type: 'response', requestId, ...opt.data };
      this.ws.send(JSON.stringify(msg));
      client.end(JSON.stringify({ success: true, sent: msg }));
    }
  }

  cmdSpeak(client, content) {
    if (!this.connected) {
      client.end(JSON.stringify({ error: '未连接服务器' }));
      return;
    }
    if (!content || !content.trim()) {
      client.end(JSON.stringify({ error: '发言内容不能为空' }));
      return;
    }
    if (!this.state?.pendingAction) {
      client.end(JSON.stringify({ error: '当前无待处理行动' }));
      return;
    }

    const { action, requestId } = this.state.pendingAction;
    if (action !== 'speak' && action !== 'last_words') {
      client.end(JSON.stringify({ error: '当前不是发言阶段' }));
      return;
    }

    const msg = { type: 'response', requestId, content };
    this.ws.send(JSON.stringify(msg));
    client.end(JSON.stringify({ success: true, sent: msg }));
  }

  cmdReset(client) {
    if (!this.connected) {
      client.end(JSON.stringify({ error: '未连接服务器' }));
      return;
    }

    const msg = { type: 'reset' };
    this.ws.send(JSON.stringify(msg));
    this.state = null;
    this.timestamp = null;
    client.end(JSON.stringify({ success: true }));
  }

  cmdRefresh(client) {
    if (this.ws) {
      this.ws.close();
    }
    this.connected = false;
    this.connect();
    client.end(JSON.stringify({ success: true }));
  }
}

// ========== 主函数 ==========

function parseArgs(argv) {
  const args = {
    start: false,
    stop: false,
    refresh: false,
    status: false,
    full: false,
    action: null,
    action2: null,
    speak: null,
    reset: false,
    help: false,
    name: null,
    players: null,
    role: null,
    daemon: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--start':
        args.start = true;
        break;
      case '--stop':
        args.stop = true;
        break;
      case '--refresh':
        args.refresh = true;
        break;
      case '--status':
        args.status = true;
        break;
      case '--full':
        args.full = true;
        break;
      case '--action':
        args.action = argv[++i];
        break;
      case '--action2':
        args.action2 = argv[++i];
        break;
      case '--speak':
        args.speak = argv[++i];
        break;
      case '--reset':
        args.reset = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--name':
        args.name = argv[++i];
        break;
      case '--players':
        args.players = argv[++i];
        break;
      case '--role':
        args.role = argv[++i];
        break;
      case '--daemon':
        args.daemon = true;
        break;
    }
  }

  return args;
}

function showHelp() {
  console.log(`
狼人杀游戏 CLI 客户端

注意：本客户端需要先启动游戏服务器才能正常使用！
  启动服务器：node server.js
  服务器地址：http://localhost:3000（可通过 WS_URL 环境变量修改）

命令：
  --start --name <玩家名> [--players <人数>] [--role <调试角色>]
      启动后台进程并加入游戏
      --players: 设置游戏人数（默认 9 人）
      --role: 调试模式下指定角色（werewolf/seer/witch/guard/hunter/villager/idiot/cupid）

  --status [--full]
      查看当前游戏状态
      --full: 以 JSON 格式输出完整状态

  --action <序号> [--action2 <序号>]
      执行操作（选择选项）
      等待阶段：[1] 添加 AI
      游戏结束：[1] 再来一局
      游戏中：根据提示选择

  --speak "发言内容"
      发言

  --reset
      重置游戏

  --refresh
      重新连接服务器

  --stop
      停止后台进程

  --help, -h
      显示帮助信息

示例：
  # 启动新游戏
  node cli_client.js --start --name Alice --players 9

  # 查看状态
  node cli_client.js --status --name Alice

  # 添加 AI（等待阶段）
  node cli_client.js --action A --name Alice

  # 投票
  node cli_client.js --action B --name Alice

  # 发言
  node cli_client.js --speak "我是好人" --name Alice

  # 停止
  node cli_client.js --stop --name Alice
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 显示帮助
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // 后台进程模式
  if (args.daemon) {
    if (!args.name) {
      console.error('后台进程需要 --name 参数');
      process.exit(1);
    }
    const daemon = new Daemon(args.name, args.players, args.role);
    daemon.start();
    return;
  }

  // 需要 name 参数
  if (!args.name) {
    console.log(JSON.stringify({
      error: '--name 参数是必需的',
      hint: '使用 --help 查看帮助信息'
    }, null, 2));
    process.exit(1);
  }

  const client = new CLIClient(args.name);

  // 处理命令
  if (args.start) {
    client.startDaemon(args.players, args.role);
  } else if (args.stop) {
    client.stopDaemon();
  } else if (args.refresh) {
    await client.refresh();
  } else if (args.status) {
    await client.status(args.full);
  } else if (args.action) {
    await client.action(args.action, args.action2);
  } else if (args.speak) {
    await client.speak(args.speak);
  } else if (args.reset) {
    await client.reset();
  } else {
    // 默认显示状态
    await client.status(false);
  }
}

main().catch(err => {
  console.log(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});