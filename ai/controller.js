const { PlayerController } = require('../engine/player');
const { Agent } = require('./agent/agent');
const { createLogger } = require('../utils/logger');
const { getPlayerDisplay } = require('../engine/utils');
const { ACTION, VISIBILITY, MSG } = require('../engine/constants');

const ANALYSIS_NODES = ['speech'];

let backendLogger = null;
const getLogger = () => backendLogger || (global.backendLogger || createLogger('backend.log'));

class AIController extends PlayerController {
  constructor(playerId, game, options = {}) {
    super(playerId, game);

    const player = this.getPlayer();
    this.playerName = player?.name;
    this.chatBroadcastFn = null;

    const context = this.buildContext({});
    const agentOptions = {
      initContext: context
    };
    if (options.agentType === 'llm') {
      agentOptions.useLLM = true;
      agentOptions.compressionEnabled = true;
    } else if (options.agentType === 'mock') {
      agentOptions.mockOptions = options.mockOptions;
    }
    this.agent = new Agent(agentOptions);
  }

  /**
   * 创建广播回调（用于聊天室@回复等场景）
   */
  _createBroadcastCallback(event = 'mentioned') {
    if (!this.chatBroadcastFn) return null;
    return (result) => {
      if (!result || result.skip) return;
      const content = result.content?.trim();
      if (!content) return;
      const player = this.getPlayer();
      this.chatBroadcastFn(player, content, event);
    };
  }

  inject(msg) {
    const isGameOver = msg.type === MSG.GAME_OVER;
    const extraData = isGameOver
      ? { actionType: ACTION.CHAT, callback: this._createBroadcastCallback('game_over') }
      : { callback: this._createBroadcastCallback() };
    const context = this.buildContext(extraData);
    this.agent.receive({ msg, context });
  }

  buildContext(extraData = {}) {
    const state = this.getState();
    const player = this.getPlayer();

    return {
      phase: state.phase,
      players: state.players,
      alivePlayers: this.game?.players?.filter(p => p.alive) || [],
      self: state.self,
      dayCount: this.game?.round || 0,
      werewolfTarget: this.game?.werewolfTarget,
      witchPotion: {
        heal: state.self?.witchHeal > 0,
        poison: state.self?.witchPoison > 0
      },
      presetId: this.game?.presetId || null,
      preset: this.game?.preset || null,
      winner: this.game?.winner || null,
      phaseManagerRunning: this.game?.phaseManager?.running || false,
      action: extraData.actionType,
      extraData
    };
  }

  async getSpeechResult(visibility = VISIBILITY.PUBLIC, actionType) {
    const player = this.getPlayer();
    const context = this.buildContext({ actionType });

    const action = await this.agent.receive({ msg: null, context });

    const content = action?.skip ? '过。' : (action?.content || '过。');
    getLogger().info(`[AI] ${player?.name} 发言：${content}`);
    return { content, visibility };
  }

  async getVoteResult(actionType = ACTION.DAY_VOTE, extraData = {}) {
    const player = this.getPlayer();
    const context = this.buildContext({ ...extraData, actionType });

    const action = await this.agent.receive({ msg: null, context });

    const isSkipping = action?.skip === true;
    let targetId = action?.target != null ? parseInt(action.target) : (action?.targetId != null ? parseInt(action.targetId) : null);

    if (!isSkipping && !targetId && extraData?.allowedTargets?.length > 0) {
      targetId = extraData.allowedTargets[Math.floor(Math.random() * extraData.allowedTargets.length)];
    }

    if (extraData?.allowedTargets?.length > 0) {
      const targetsStr = extraData.allowedTargets.map(id => {
        const p = this.game.players.find(x => x.id === id);
        return p ? getPlayerDisplay(this.game.players, p) : `${id}号`;
      }).join(', ');
      getLogger().info(`[AI] ${player?.name} 可选投票范围：${targetsStr}`);
    }

    if (targetId) {
      const target = this.game.players.find(p => p.id === targetId);
      getLogger().info(`[AI] ${player?.name} 投票给 ${getPlayerDisplay(this.game.players, target)}`);
    } else {
      getLogger().info(`[AI] ${player?.name} 选择弃权`);
    }

    return { targetId };
  }

  async useSkill(actionType, extraData = {}) {
    const player = this.getPlayer();
    if (!player) return { success: false, message: '玩家不存在' };

    const skill = this.getSkill(actionType);
    if (!skill) return { success: false, message: '技能不存在' };

    const validation = this.canUseSkill(skill, extraData);
    if (!validation.ok) return { success: false, message: validation.message };

    const context = this.buildContext({ ...extraData, actionType });

    const action = await this.agent.receive({ msg: null, context });

    const targetsStr = this.formatAllowedTargets(actionType, extraData);
    getLogger().info(`[AI] ${player.name} 使用技能 ${actionType}, 可选：${targetsStr} → ${JSON.stringify(action)}`);

    if (action?.skip === true) {
      if (skill.type === 'target' && (actionType === ACTION.SHOOT || actionType === ACTION.PASS_BADGE)) {
        return this.executeSkill(skill, { target: null, targetId: null }, extraData);
      }
      return { success: true, skipped: true };
    }

    return this.executeSkill(skill, action, extraData);
  }

  async reassignToGame(newGame) {
    this.game = newGame;
  }

  destroy() {
    this.agent.destroy();
  }
}

class AIManager {
  constructor(gameEngine) {
    this.game = gameEngine;
    this.controllers = new Map();
    this.chatBroadcastFn = null;
  }

  createAI(playerId, options = {}) {
    const controller = new AIController(playerId, this.game, options);
    controller.chatBroadcastFn = this.chatBroadcastFn;
    controller.agent.chatBroadcastFn = this.chatBroadcastFn;
    this.controllers.set(playerId, controller);
    return controller;
  }

  get(playerId) {
    return this.controllers.get(playerId);
  }

  reassignToGame(newGame) {
    this.game = newGame;
    for (const controller of this.controllers.values()) {
      controller.reassignToGame(newGame);
    }
  }

  onMessage(msg) {
    for (const controller of this.controllers.values()) {
      // 可见性过滤：AI 只能看到自己该看到的消息
      const player = controller.getPlayer();
      if (this.game.message.canSee(player, msg, this.game)) {
        controller.inject(msg);
      }
    }
  }

  remove(playerId) {
    const controller = this.controllers.get(playerId);
    if (controller) {
      controller.destroy();
      this.controllers.delete(playerId);
    }
  }

  forEach(fn) {
    for (const controller of this.controllers.values()) {
      fn(controller);
    }
  }

  remapPlayerIds() {
    const newControllers = new Map();
    for (const player of this.game.players) {
      if (player.isAI) {
        for (const [oldId, controller] of this.controllers) {
          if (controller.playerName === player.name) {
            controller.playerId = player.id;
            newControllers.set(player.id, controller);
            break;
          }
        }
      }
    }
    this.controllers = newControllers;

    // 重新分配后，由 Agent 在下次 receive 时自行更新 system message
  }
}

module.exports = { AIController, AIManager, ANALYSIS_NODES };