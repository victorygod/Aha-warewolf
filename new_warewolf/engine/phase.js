/**
 * 阶段执行器 - 简单的 for 循环执行列表
 * 每个元素就是一个执行步骤，包含实际的执行逻辑
 */

const { getCamp } = require('./config');

/**
 * 阶段执行列表 - 一个 for 循环从头执行到尾
 * 每个元素包含：id、名称、执行逻辑
 */
const PHASE_FLOW = [
  // ========== 第一夜 ==========

  // 丘比特连线
  {
    id: 'cupid',
    name: '丘比特连线',
    firstNight: true,
    condition: (game) => game.players.some(p => p.role.id === 'cupid'),
    execute: async (game) => {
      // 丘比特选择两名玩家成为情侣
      const cupid = game.players.find(p => p.role.id === 'cupid' && p.alive);
      if (!cupid) return;

      // 推送消息让丘比特选择
      await game.notifyPlayer(cupid.id, { type: 'choose_target', count: 2 });
      // 等待丘比特选择...

      // 这里应该等待玩家操作，暂时先跳过
    }
  },

  // 守卫守护
  {
    id: 'guard',
    name: '守卫守护',
    firstNight: true,
    condition: (game) => game.players.some(p => p.role.id === 'guard'),
    execute: async (game) => {
      const guard = game.players.find(p => p.role.id === 'guard' && p.alive);
      if (!guard) return;

      if (guard.isAI) {
        await game.callSkill(guard.id);
      } else {
        // 推送消息让守卫选择，并等待选择
        await game.notifyPlayer(guard.id, { type: 'choose_target', count: 1 });
        await game.waitForAction(guard.id);
      }
    }
  },

  // 狼人讨论 - 循环让每个狼人发言
  {
    id: 'night_werewolf_discuss',
    name: '狼人讨论',
    firstNight: true,
    execute: async (game) => {
      // 获取所有存活狼人
      const wolves = game.players.filter(p => getCamp(p, game) === 'wolf' && p.alive);

      // 循环让每个狼人发言
      for (const wolf of wolves) {
        if (wolf.isAI) {
          // AI 直接调用 speech 方法
          await game.callSpeech(wolf.id);
        } else {
          // 推送消息让玩家发言，并等待玩家完成
          await game.notifyPlayer(wolf.id, { type: 'speak' });
          await game.waitForAction(wolf.id);  // 等待玩家发言
        }
      }
    }
  },

  // 狼人投票
  {
    id: 'night_werewolf_vote',
    name: '狼人投票',
    firstNight: true,
    execute: async (game) => {
      const wolves = game.players.filter(p => getCamp(p, game) === 'wolf' && p.alive);

      // 同时通知所有狼人投票（并行）
      const promises = wolves.map(wolf => {
        if (wolf.isAI) {
          return game.callVote(wolf.id);
        } else {
          return game.notifyPlayer(wolf.id, { type: 'vote' });
        }
      });
      await Promise.all(promises);

      // 等待所有人投票完成
      await game.waitForVotes(wolves.length);
    }
  },

  // 女巫技能
  {
    id: 'witch',
    name: '女巫技能',
    firstNight: true,
    condition: (game) => game.players.some(p => p.role.id === 'witch'),
    execute: async (game) => {
      const witch = game.players.find(p => p.role.id === 'witch' && p.alive);
      if (!witch) return;

      // 推送消息让女巫选择
      if (witch.isAI) {
        await game.callSkill(witch.id);
      } else {
        await game.notifyPlayer(witch.id, { type: 'skill' });
      }
    }
  },

  // 预言家查验
  {
    id: 'seer',
    name: '预言家查验',
    firstNight: true,
    condition: (game) => game.players.some(p => p.role.id === 'seer'),
    execute: async (game) => {
      const seer = game.players.find(p => p.role.id === 'seer' && p.alive);
      if (!seer) return;

      if (seer.isAI) {
        await game.callSkill(seer.id);
      } else {
        await game.notifyPlayer(seer.id, { type: 'choose_target' });
      }
    }
  },

  // 夜晚结算
  {
    id: 'night_resolve',
    name: '夜晚结算',
    execute: async (game) => {
      // 计算死亡，不广播
      game.resolveNight();
      game.processDeaths();
      game.nightCount++;
      // dayCount 在进入白天时更新
    }
  },

  // ========== 第一天 - 警长竞选 ==========

  // 警长竞选发言
  {
    id: 'sheriff_campaign',
    name: '警长竞选',
    firstDay: true,
    execute: async (game) => {
      // 所有存活玩家依次发言，表达是否竞选警长
      const candidates = game.players.filter(p => p.alive);

      for (const player of candidates) {
        if (player.isAI) {
          await game.callSpeech(player.id);
        } else {
          await game.notifyPlayer(player.id, { type: 'speak' });
        }
      }
    }
  },

  // 警长竞选发言（已报名者）
  {
    id: 'sheriff_speech',
    name: '警长竞选发言',
    firstDay: true,
    execute: async (game) => {
      const candidates = game.players.filter(p => p.state?.isCandidate && !p.state?.withdrew);

      for (const player of candidates) {
        if (player.isAI) {
          await game.callSpeech(player.id);
        } else {
          await game.notifyPlayer(player.id, { type: 'speak' });
        }
      }
    }
  },

  // 警长退水
  {
    id: 'sheriff_withdraw',
    name: '警长退水',
    firstDay: true,
    execute: async (game) => {
      // 推送消息让候选人选择是否退水
      const candidates = game.players.filter(p => p.state?.isCandidate && !p.state?.withdrew);

      for (const player of candidates) {
        if (player.isAI) {
          await game.callSkill(player.id);
        } else {
          await game.notifyPlayer(player.id, { type: 'withdraw' });
        }
      }
    }
  },

  // 警长投票
  {
    id: 'sheriff_vote',
    name: '警长投票',
    firstDay: true,
    execute: async (game) => {
      const voters = game.players.filter(p => !p.state?.isCandidate && p.alive);

      // 并行通知所有投票者
      const promises = voters.map(voter => {
        if (voter.isAI) {
          return game.callVote(voter.id);
        } else {
          return game.notifyPlayer(voter.id, { type: 'vote' });
        }
      });
      await Promise.all(promises);

      await game.waitForVotes(voters.length);
    }
  },

  // ========== 白天 ==========

  // 公布死讯
  {
    id: 'day_announce',
    name: '公布死讯',
    execute: async (game) => {
      // 更新天数（第一天从1开始，之后每过一夜+1）
      if (game.dayCount === 0) {
        game.dayCount = 1;
      }

      // 记录本轮死亡的第一位玩家（用于下一轮发言顺序）
      game.recordLastDeath();

      // 广播昨夜死亡情况
      if (game.deathQueue?.length > 0) {
        game.broadcast({
          type: 'death_announce',
          deaths: game.deathQueue.map(p => ({
            name: p.name,
            reason: game.getDeathReason(p)
          }))
        });
      }
    }
  },

  // 遗言阶段
  {
    id: 'last_words',
    name: '遗言',
    condition: (game) => game.deathQueue?.length > 0,
    execute: async (game) => {
      // 死亡玩家依次发表遗言
      for (const player of game.deathQueue) {
        if (player.isAI) {
          await game.callSpeech(player.id);
        } else {
          await game.notifyPlayer(player.id, { type: 'last_words' });
          await game.waitForAction(player.id);  // 等待玩家遗言
        }
      }
    }
  },

  // 白天讨论 - 循环让每个存活玩家发言
  {
    id: 'day_discuss',
    name: '白天讨论',
    execute: async (game) => {
      // 检查是否需要警长指定发言顺序
      const config = game.config.hooks?.RULES?.sheriff || { enabled: true, sheriffAssignOrder: true };
      if (config.enabled && config.sheriffAssignOrder && game.sheriff && !game.sheriffAssignOrder) {
        const sheriff = game.players.find(p => p.id === game.sheriff);
        if (sheriff?.alive) {
          if (sheriff.isAI) {
            // AI 警长自动指定顺序
            const alivePlayers = game.players.filter(p => game.canSpeak(p));
            game.setSheriffOrder(alivePlayers.map(p => p.id));
          } else {
            // 推送消息让警长选择发言顺序
            await game.notifyPlayer(sheriff.id, { type: 'choose_speaker_order' });
            await game.waitForAction(sheriff.id);  // 等待警长选择
          }
        }
      }

      // 获取发言顺序（警长指定或自动计算）
      const speakers = game.getSpeakerOrder();

      // 循环让每个玩家发言
      for (const player of speakers) {
        if (!game.canSpeak(player)) continue;

        if (player.isAI) {
          // AI 直接调用 speech 方法
          await game.callSpeech(player.id);
        } else {
          // 推送消息让玩家发言，并等待玩家完成
          await game.notifyPlayer(player.id, { type: 'speak' });
          await game.waitForAction(player.id);  // 等待玩家发言
        }
      }
    }
  },

  // 白天投票
  {
    id: 'day_vote',
    name: '白天投票',
    execute: async (game) => {
      const voters = game.players.filter(p => p.alive);

      // 并行通知所有投票者
      const promises = voters.map(voter => {
        if (voter.isAI) {
          return game.callVote(voter.id);
        } else {
          return game.notifyPlayer(voter.id, { type: 'vote' });
        }
      });
      await Promise.all(promises);

      // 等待所有人投票完成
      await game.waitForVotes(voters.length);
    }
  },

  // 公布放逐死讯
  {
    id: 'vote_result',
    name: '公布投票结果',
    execute: async (game) => {
      // resolveVote 已经在 day_vote 执行时调用了
      // 这里只需要检查是否有死亡，有则公布
      if (game.lastWordsPlayer) {
        game.broadcast({
          type: 'death_announce',
          deaths: [{
            name: game.lastWordsPlayer.name,
            reason: 'vote'
          }]
        });
      }
    }
  }
];

/**
 * 阶段管理器 - 简单的 for 循环执行
 */
class PhaseManager {
  constructor(game) {
    this.game = game;
    this.currentPhase = null;
    this.phaseIndex = -1;
    this.running = false;
  }

  // 开始执行流程 - 整个游戏就是循环执行所有阶段
  async start() {
    this.running = true;
    this.phaseIndex = 0;

    while (this.running) {
      const phase = PHASE_FLOW[this.phaseIndex];

      // 检查条件
      if (phase.condition && !phase.condition(this.game)) {
        this.phaseIndex = (this.phaseIndex + 1) % PHASE_FLOW.length;
        continue;
      }

      // 检查第一夜/第一天限制
      if (phase.firstNight && this.game.nightCount > 1) {
        this.phaseIndex = (this.phaseIndex + 1) % PHASE_FLOW.length;
        continue;
      }
      if (phase.firstDay && this.game.dayCount > 1) {
        this.phaseIndex = (this.phaseIndex + 1) % PHASE_FLOW.length;
        continue;
      }

      // 执行阶段
      this.currentPhase = phase;
      this.game.emit('phase:enter', { phase: phase.id });

      try {
        await phase.execute(this.game);
      } catch (e) {
        console.error(`[Phase] 执行阶段 ${phase.id} 失败:`, e);
      }

      this.game.emit('phase:leave', { phase: phase.id });

      // 检查胜负
      const winner = this.game.config.hooks.checkWin(this.game);
      if (winner) {
        this.game.winner = winner;
        break;
      }

      // 移动到下一个阶段，循环
      this.phaseIndex = (this.phaseIndex + 1) % PHASE_FLOW.length;
    }

    this.running = false;
  }

  // 停止执行
  stop() {
    this.running = false;
  }

  // 获取当前阶段
  getCurrentPhase() {
    return this.currentPhase;
  }
}

module.exports = { PhaseManager, PHASE_FLOW };