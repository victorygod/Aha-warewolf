const { describe, it, run } = require('../../helpers/test-runner');
const { AIController, AIManager } = require('../../../ai/controller');
const { Agent } = require('../../../ai/agent/agent');
const { MessageManager } = require('../../../ai/agent/message_manager');
const { GameEngine } = require('../../../engine/main');
const { BOARD_PRESETS } = require('../../../engine/config');
const { createPlayerRole } = require('../../../engine/roles');
const { MSG } = require('../../../engine/constants');

function createTestGame(presetId = '9-standard') {
  const preset = BOARD_PRESETS[presetId];
  const game = new GameEngine({ presetId });

  for (let i = 0; i < preset.playerCount; i++) {
    const role = createPlayerRole(preset.roles[i]);
    game.players.push({
      id: i + 1,
      name: `玩家${i + 1}`,
      alive: true,
      isAI: true,
      role: role,
      state: role.state ? { ...role.state } : {}
    });
  }

  game.phase = 'day_discuss';
  game.round = 1;

  return game;
}

describe('Agent 生命周期：GAME_START / GAME_OVER', () => {
  it('inject(GAME_START) 排空已有队列', () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    let decisionResolved = false;
    // 添加一个 decision 类型的队列项
    controller.agent.requestQueue.push({
      type: 'decision',
      context: {},
      resolve: () => { decisionResolved = true; }
    });
    controller.agent.isProcessing = true;

    controller.inject({ type: MSG.GAME_START });

    // GAME_START 消息触发 _drainDecisionsAndCompacts
    // 丢弃 decision 和 compact 类型的项，并 resolve 被丢弃的 decision
    if (!decisionResolved) throw new Error('GAME_START 应排空 decision 队列并 resolve');
  });

  it('inject(GAME_OVER) 排空队列并排入 game-over 回复和 chat 切换', () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });

    controller.inject({ type: MSG.GAME_OVER });

    if (controller.agent.requestQueue.length === 0) throw new Error('GAME_OVER 后应有排入的请求');
  });
});

describe('Agent 生命周期：destroy', () => {
  it('destroy 清空 messages', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.mm.messages.push({ role: 'system', content: 'test' });
    agent.mm.messages.push({ role: 'user', content: 'hello' });

    agent.destroy();

    if (agent.mm.messages.length !== 0) throw new Error('destroy 后 messages 应为空');
  });

  it('destroy 清空请求队列', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.requestQueue.push({ type: 'answer', context: {}, callback: () => {} });

    agent.destroy();

    if (agent.requestQueue.length !== 0) throw new Error('destroy 后 requestQueue 应为空');
  });

  it('destroy 重置 isProcessing', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.isProcessing = true;

    agent.destroy();

    if (agent.isProcessing) throw new Error('destroy 后 isProcessing 应为 false');
  });

  it('destroy 对 pending callback 传 null', () => {
    const agent = new Agent({ mockOptions: {} });
    let callbackResult = 'not_called';
    agent.requestQueue.push({ type: 'answer', context: {}, callback: (r) => { callbackResult = r; } });

    agent.destroy();

    if (callbackResult !== null) throw new Error('pending callback 应收到 null');
  });
});

describe('Agent 生命周期：_drainQueue', () => {
  it('drainQueue 清空队列并重置 isProcessing', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.requestQueue.push({ type: 'answer', context: {}, callback: () => {} });
    agent.isProcessing = true;

    agent._drainQueue();

    if (agent.requestQueue.length !== 0) throw new Error('队列应为空');
    if (agent.isProcessing) throw new Error('isProcessing 应为 false');
  });
});

describe('playerId 冗余消除', () => {
  it('Agent 不存储 playerId', () => {
    const agent = new Agent({ mockOptions: {} });
    if ('playerId' in agent) throw new Error('Agent 不应有 playerId 属性');
  });

  it('MessageManager 不存储 playerId', () => {
    const mm = new MessageManager();
    if ('playerId' in mm) throw new Error('MessageManager 不应有 playerId 属性');
  });

  it('AIController 存储 playerId', () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    if (controller.playerId !== 1) throw new Error('AIController 应存储 playerId');
  });

  it('inject 通过 context.self.id 定位自己', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_day_discuss: '测试' } }
    });

    const result = await controller.getSpeechResult('public', 'action_day_discuss');
    if (!result.content) throw new Error('决策应成功完成，说明 context.self.id 正确传递');
  });
});

describe('AIController.reassignToGame', () => {
  it('reassignToGame 更新 game 引用', () => {
    const game1 = createTestGame();
    const game2 = createTestGame();
    const controller = new AIController(1, game1, { agentType: 'mock' });

    controller.reassignToGame(game2);

    if (controller.game !== game2) throw new Error('game 引用应更新为新 game');
  });

  it('reassignToGame 保留同一个 Agent 实例', () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const originalAgent = controller.agent;

    controller.reassignToGame(game);

    if (controller.agent !== originalAgent) throw new Error('应保留同一个 Agent 实例');
  });

  it('reassignToGame 保留 mockModel 配置', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_day_vote: 3 } }
    });

    controller.reassignToGame(game);

    if (!controller.agent.mockModel) throw new Error('mockModel 应保留');
    const result = await controller.getVoteResult('action_day_vote', { allowedTargets: [2, 3] });
    if (result.targetId !== 3) throw new Error('mockModel 配置应保留，投票给 3 号');
  });
});

describe('AIManager.reassignToGame', () => {
  it('reassignToGame 更新所有 controller 的 game 引用', () => {
    const game1 = createTestGame();
    const game2 = createTestGame();
    const aiManager = new AIManager(game1);

    const ctrl1 = aiManager.createAI(1, { agentType: 'mock' });
    const ctrl2 = aiManager.createAI(2, { agentType: 'mock' });

    aiManager.reassignToGame(game2);

    if (ctrl1.game !== game2) throw new Error('ctrl1 game 应更新');
    if (ctrl2.game !== game2) throw new Error('ctrl2 game 应更新');
    if (aiManager.game !== game2) throw new Error('aiManager.game 应更新');
  });

  it('reassignToGame 保留所有 Agent 实例', () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);

    const ctrl1 = aiManager.createAI(1, { agentType: 'mock' });
    const ctrl2 = aiManager.createAI(2, { agentType: 'mock' });
    const agent1 = ctrl1.agent;
    const agent2 = ctrl2.agent;

    aiManager.reassignToGame(game);

    if (ctrl1.agent !== agent1) throw new Error('ctrl1 Agent 应保留');
    if (ctrl2.agent !== agent2) throw new Error('ctrl2 Agent 应保留');
  });
});

describe('AIManager.onMessage', () => {
  it('onMessage 向所有 controller 注入消息', async () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    const ctrl1 = aiManager.createAI(1, { agentType: 'mock' });
    const ctrl2 = aiManager.createAI(2, { agentType: 'mock' });

    const msg = { type: MSG.SPEECH, content: '测试发言', visibility: 'public', playerId: 3 };
    aiManager.onMessage(msg);

    // 等待队列处理完成
    await new Promise(resolve => setTimeout(resolve, 100));

    const injectPresent1 = ctrl1.agent.mm.pendingInject.some(m => m.includes('测试发言'));
    const injectPresent2 = ctrl2.agent.mm.pendingInject.some(m => m.includes('测试发言'));
    if (!injectPresent1 && !injectPresent2) {
      throw new Error('至少一个 controller 应接收并注入消息');
    }
  });
});

describe('EventEmitter.off', () => {
  it('off 移除指定 handler', () => {
    const { EventEmitter } = require('../../../engine/event');
    const emitter = new EventEmitter();
    let called = false;
    const handler = () => { called = true; };

    emitter.on('test', handler);
    emitter.off('test', handler);
    emitter.emit('test', {});

    if (called) throw new Error('off 后 handler 不应被调用');
  });

  it('off 只移除指定 handler，不影响其他 handler', () => {
    const { EventEmitter } = require('../../../engine/event');
    const emitter = new EventEmitter();
    let called1 = false;
    let called2 = false;
    const handler1 = () => { called1 = true; };
    const handler2 = () => { called2 = true; };

    emitter.on('test', handler1);
    emitter.on('test', handler2);
    emitter.off('test', handler1);
    emitter.emit('test', {});

    if (called1) throw new Error('被 off 的 handler 不应被调用');
    if (!called2) throw new Error('未被 off 的 handler 应被调用');
  });

  it('off 不存在的事件不报错', () => {
    const { EventEmitter } = require('../../../engine/event');
    const emitter = new EventEmitter();
    emitter.off('nonexistent', () => {});
  });
});

describe('MessageManager._buildLLMViewInternal', () => {
  it('parts 不修改原始 messages', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'system', content: '系统提示' }, { role: 'user', content: '游戏事件' }];
    const parts = {
      thinking: '【行为逻辑】\n思考',
      speaking: '',
      task: '【白天发言】'
    };
    const view = mm._buildLLMViewInternal(parts);
    if (mm.messages[1].content !== '游戏事件') throw new Error('原始 messages 不应被修改');
  });
});

describe('跨游戏生命周期模拟', () => {
  it('游戏→GAME_OVER：Agent 保持同一实例', () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const originalAgent = controller.agent;

    controller.inject({ type: MSG.GAME_OVER });

    if (controller.agent !== originalAgent) throw new Error('Agent 应保持同一实例');
  });
});

run();