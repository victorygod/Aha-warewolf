/**
 * AI 控制器 - 处理所有 AI 行动
 */

const { ROLES } = require('../game/roles');
const { PHASES } = require('../game/engine');

// 调试模式开关
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || false;

class AIController {
  constructor() {
    this.agents = new Map();
  }

  getAgent(player, game) {
    if (!this.agents.has(player.id)) {
      const { AIAgent } = require('./agent');
      const agent = new AIAgent(player, game);
      agent.init(game.getAIContext(player.id));
      this.agents.set(player.id, agent);
    }
    return this.agents.get(player.id);
  }

  clear() {
    this.agents.clear();
  }

  async processAITurn(game, broadcast) {
    // 游戏结束，停止
    if (game.phase === PHASES.GAME_OVER) {
      console.log('[AI] 游戏结束');
      return;
    }

    const currentSpeaker = game.getCurrentSpeaker();

    // 发言阶段 - 只有当前发言者是 AI 时才处理
    if (currentSpeaker) {
      if (currentSpeaker.isAI && currentSpeaker.alive) {
        await this.handleSpeech(game, currentSpeaker, broadcast);
      } else {
        // 人类发言，等待人类操作
        console.log(`[AI] 等待 ${currentSpeaker.name} 发言`);
      }
      return;
    }

    // 遗言阶段
    if (game.phase === PHASES.LAST_WORDS) {
      await this.handleLastWords(game, broadcast);
      return;
    }

    // 猎人开枪阶段
    if (game.phase === PHASES.HUNTER_SHOOT) {
      await this.handleHunterShoot(game, broadcast);
      return;
    }

    // 没有当前发言者，处理投票/技能阶段
    if (game.phase === PHASES.NIGHT_WEREWOLF_VOTE || game.phase === PHASES.DAY_VOTE) {
      await this.handleVote(game, broadcast);
      return;
    }

    if (game.phase === PHASES.NIGHT_SEER) {
      await this.handleSkill(game, 'seer', broadcast);
      return;
    }

    if (game.phase === PHASES.NIGHT_WITCH) {
      await this.handleSkill(game, 'witch', broadcast);
      return;
    }

    if (game.phase === PHASES.NIGHT_GUARD) {
      await this.handleSkill(game, 'guard', broadcast);
      return;
    }

    console.log(`[AI] 等待行动：${game.phase}`);
  }

  async handleSpeech(game, player, broadcast) {
    const agent = this.getAgent(player, game);
    const context = game.getAIContext(player.id);

    console.log(`[AI] ${player.name} 发言阶段`);

    let action;
    try {
      action = await agent.getAction(context);
    } catch (e) {
      console.log(`[AI] ${player.name} 错误：${e.message}`);
      action = null;
    }

    const speech = (action && action.type === 'speech' && action.content)
      ? action.content
      : '过。';

    // 调试信息
    const debugInfo = DEBUG_MODE && action?._debug ? action._debug : null;

    try {
      game.speak(player.id, speech, debugInfo);
      broadcast('state_update', game.getState());
      console.log(`[AI] ${player.name}: ${speech}`);
    } catch (e) {
      console.error(`[AI] ${player.name} 发言失败：${e.message}`);
    }

    setTimeout(() => this.processAITurn(game, broadcast), 500);
  }

  async handleVote(game, broadcast) {
    const expectedVoters = game.phase === PHASES.NIGHT_WEREWOLF_VOTE
      ? game.players.filter(p => p.alive && p.role === ROLES.WEREWOLF)
      : game.players.filter(p => p.alive);

    const aiVoters = expectedVoters.filter(p => p.isAI && !game.votes[p.id]);
    if (aiVoters.length === 0) return;

    const startTime = Date.now();
    console.log(`[AI] 投票阶段：${aiVoters.length} 个 AI 并行请求`);

    const votePromises = aiVoters.map(async (aiPlayer) => {
      const agent = this.getAgent(aiPlayer, game);
      const context = game.getAIContext(aiPlayer.id);

      let action;
      try {
        action = await agent.getAction(context);
        console.log(`[AI] ${aiPlayer.name} 决策完成 (+${Date.now() - startTime}ms)`);
      } catch (e) {
        console.log(`[AI] ${aiPlayer.name} 投票错误：${e.message}`);
        action = null;
      }

      if (action && action.type === 'skip') {
        // 弃权
        console.log(`[AI] ${aiPlayer.name} 选择弃权`);
        return { voterId: aiPlayer.id, targetId: null };
      }

      if (action && action.type === 'vote' && action.target) {
        const target = game.players.find(p => p.name === action.target);
        if (target && target.alive) {
          console.log(`[AI] ${aiPlayer.name} 投票给 ${target.name}`);
          return { voterId: aiPlayer.id, targetId: target.id };
        } else {
          console.log(`[AI] ${aiPlayer.name} 找不到玩家 "${action.target}"，使用随机`);
        }
      }

      // 默认随机投票
      const targets = game.phase === PHASES.NIGHT_WEREWOLF_VOTE
        ? game.players.filter(p => p.alive && p.role !== ROLES.WEREWOLF)
        : game.players.filter(p => p.alive && p.id !== aiPlayer.id);

      if (targets.length > 0) {
        const t = targets[Math.floor(Math.random() * targets.length)];
        console.log(`[AI] ${aiPlayer.name} 随机投票给 ${t.name}`);
        return { voterId: aiPlayer.id, targetId: t.id };
      }
      return null;
    });

    const votes = (await Promise.all(votePromises)).filter(v => v);
    for (const { voterId, targetId } of votes) {
      try {
        game.vote(voterId, targetId);
      } catch (e) {}
    }

    broadcast('state_update', game.getState());
    setTimeout(() => this.processAITurn(game, broadcast), 500);
  }

  async handleSkill(game, role, broadcast) {
    const roleType = role === 'seer' ? ROLES.SEER : role === 'witch' ? ROLES.WITCH : ROLES.GUARD;
    const player = game.players.find(p => p.role === roleType && p.alive && p.isAI);

    if (!player) {
      // 检查是否有人类玩家需要操作
      const humanPlayer = game.players.find(p => p.role === roleType && p.alive && !p.isAI);
      if (humanPlayer) {
        console.log(`[AI] ${role} 阶段：等待人类玩家 ${humanPlayer.name} 操作`);
        // 人类玩家操作完成后会在 API 路由中触发 processAITurn
        return;
      }

      // 该角色已死亡或不存在，自动跳过
      console.log(`[AI] ${role} 阶段：无该角色玩家，自动跳过`);
      if (role === 'seer') {
        game.advancePhase();
      } else if (role === 'witch') {
        game.advancePhase();
      } else if (role === 'guard') {
        game.resolveNight();
        if (game.checkWinCondition()) {
          game.phase = PHASES.GAME_OVER;
        } else {
          game.phase = PHASES.DAY_DISCUSS;
          game.currentSpeakerIndex = 0;
          game.speeches = [];
        }
      }
      broadcast('state_update', game.getState());
      setTimeout(() => this.processAITurn(game, broadcast), 500);
      return;
    }

    console.log(`[AI] ${role} 阶段：${player.name}`);

    const agent = this.getAgent(player, game);
    const context = game.getAIContext(player.id);

    let action;
    try {
      action = await agent.getAction(context);
    } catch (e) {
      console.log(`[AI] ${player.name} ${role} 错误：${e.message}`);
      action = null;
    }

    try {
      if (role === 'seer' && action && action.type === 'vote' && action.target) {
        const target = game.players.find(p => p.name === action.target);
        if (target) {
          game.seerCheck(player.id, target.id);
          console.log(`[AI] 预言家 ${player.name} 查验 ${target.name}`);
        }
      } else if (role === 'witch') {
        // 女巫可能需要多次行动
        await this.executeWitchActions(game, player, agent, action);
      } else if (role === 'guard' && action && action.type === 'vote' && action.target) {
        const target = game.players.find(p => p.name === action.target);
        if (target) {
          game.guardProtect(player.id, target.id);
          console.log(`[AI] 守卫 ${player.name} 守护 ${target.name}`);
        }
      } else {
        // 默认行动
        this.executeDefaultSkill(game, player, role);
      }

      broadcast('state_update', game.getState());
    } catch (e) {
      console.error(`[AI] ${role} 错误：${e.message}`);
      try {
        this.executeDefaultSkill(game, player, role);
        broadcast('state_update', game.getState());
      } catch (err) {}
    }

    setTimeout(() => this.processAITurn(game, broadcast), 500);
  }

  // 执行女巫行动（可能多次）
  async executeWitchActions(game, player, agent, firstAction) {
    let action = firstAction;

    // 最多行动 2 次（解药 + 毒药）
    for (let i = 0; i < 2; i++) {
      // AI 明确选择 skip，直接结束
      if (action && action.action === 'skip') {
        game.witchAction(player.id, 'skip');
        return;
      }

      // 执行行动
      if (action && action.action) {
        try {
          // 将 target 名字转换为 id
          const targetId = action.target
            ? game.players.find(p => p.name === action.target)?.id
            : null;
          game.witchAction(player.id, action.action, targetId);
          console.log(`[AI] 女巫 ${player.name} ${action.action}${action.target ? ` ${action.target}` : ''}`);
        } catch (e) {
          console.log(`[AI] 女巫 ${player.name} 行动失败：${e.message}`);
        }
      }

      // 检查是否还能继续行动
      const canHeal = game.witchPotion.heal && game.werewolfTarget && !game.nightActions.healed;
      const canPoison = game.witchPotion.poison && !game.nightActions.poisonTarget;

      // 没有更多行动可能，结束
      if (!canHeal && !canPoison) {
        if (game.phase === 'night_witch') {
          game.witchAction(player.id, 'skip');
        }
        return;
      }

      // 如果还能行动，再次询问 AI
      if (game.phase === 'night_witch') {
        const context = game.getAIContext(player.id);
        try {
          action = await agent.getAction(context);
        } catch (e) {
          console.log(`[AI] 女巫 ${player.name} 再次决策失败：${e.message}`);
          game.witchAction(player.id, 'skip');
          return;
        }
      } else {
        return;
      }
    }

    // 确保最终跳过
    if (game.phase === 'night_witch') {
      game.witchAction(player.id, 'skip');
    }
  }

  executeDefaultSkill(game, player, role) {
    console.log(`[AI] ${player.name} 默认 ${role} 技能`);

    if (role === 'seer') {
      const targets = game.players.filter(p => p.alive && p.id !== player.id);
      if (targets.length > 0) {
        game.seerCheck(player.id, targets[Math.floor(Math.random() * targets.length)].id);
      }
    } else if (role === 'witch') {
      game.witchAction(player.id, 'skip');
    } else if (role === 'guard') {
      const targets = game.players.filter(p => p.alive && p.id !== game.lastGuardTarget);
      if (targets.length > 0) {
        game.guardProtect(player.id, targets[Math.floor(Math.random() * targets.length)].id);
      }
    }
  }

  // 处理遗言
  async handleLastWords(game, broadcast) {
    const lastWordsPlayer = game.lastWordsPlayer;
    if (!lastWordsPlayer) {
      // 没有遗言玩家，跳过
      game.finishDeathPhase();
      broadcast('state_update', game.getState());
      setTimeout(() => this.processAITurn(game, broadcast), 500);
      return;
    }

    // 检查是否是人类玩家
    if (!lastWordsPlayer.isAI) {
      console.log(`[AI] 等待 ${lastWordsPlayer.name} 发表遗言`);
      return;
    }

    console.log(`[AI] ${lastWordsPlayer.name} 发表遗言`);

    const agent = this.getAgent(lastWordsPlayer, game);
    const context = game.getAIContext(lastWordsPlayer.id);

    let content;
    try {
      const action = await agent.getAction(context);
      if (action && action.type === 'speech' && action.content) {
        content = action.content;
        console.log(`[AI] ${lastWordsPlayer.name} 遗言: ${content}`);
      } else {
        // 随机遗言
        const speeches = [
          '我是好人，大家加油！',
          '我没什么好说的，相信自己的判断。',
          '我死得太冤了，大家一定要找出狼人！'
        ];
        content = speeches[Math.floor(Math.random() * speeches.length)];
      }
    } catch (e) {
      console.log(`[AI] ${lastWordsPlayer.name} 遗言错误：${e.message}`);
      content = '我没什么好说的。';
    }

    try {
      game.lastWords(lastWordsPlayer.id, content);
      broadcast('state_update', game.getState());
    } catch (e) {
      console.error(`[AI] 遗言失败：${e.message}`);
    }

    setTimeout(() => this.processAITurn(game, broadcast), 500);
  }

  // 处理猎人开枪
  async handleHunterShoot(game, broadcast) {
    // 找到可以开枪的猎人
    const hunter = game.players.find(p =>
      p.role === ROLES.HUNTER &&
      !p.alive &&
      p.deathReason &&
      p.deathReason !== 'poison'
    );

    if (!hunter) {
      console.log('[AI] 没有可以开枪的猎人');
      game.finishDeathPhase();
      broadcast('state_update', game.getState());
      setTimeout(() => this.processAITurn(game, broadcast), 500);
      return;
    }

    // 检查是否是人类玩家
    if (!hunter.isAI) {
      console.log(`[AI] 等待猎人 ${hunter.name} 决定是否开枪`);
      return;
    }

    console.log(`[AI] 猎人 ${hunter.name} 决定是否开枪`);

    // AI 猎人决策：50% 概率开枪
    if (Math.random() < 0.5) {
      // 选择一个存活的目标（优先狼人，如果知道的话）
      const targets = game.players.filter(p => p.alive);
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        console.log(`[AI] 猎人 ${hunter.name} 开枪带走 ${target.name}`);
        try {
          game.hunterShoot(hunter.id, target.id);
        } catch (e) {
          console.error(`[AI] 开枪失败：${e.message}`);
          game.hunterSkip(hunter.id);
        }
      } else {
        game.hunterSkip(hunter.id);
      }
    } else {
      console.log(`[AI] 猎人 ${hunter.name} 选择不开枪`);
      game.hunterSkip(hunter.id);
    }

    broadcast('state_update', game.getState());
    setTimeout(() => this.processAITurn(game, broadcast), 500);
  }
}

module.exports = { AIController };