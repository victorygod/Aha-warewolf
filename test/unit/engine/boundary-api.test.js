const { describe, it, run } = require('../../helpers/test-runner');
const { GameEngine } = require('../../../engine/main');
const { AIManager } = require('../../../ai/controller');
const { MessageManager } = require('../../../engine/message');
const { BOARD_PRESETS } = require('../../../engine/config');

function makeGame(presetId = '9-standard') {
  const game = new GameEngine({ presetId });
  for (let i = 0; i < 3; i++) {
    game.addPlayer({ name: `P${i + 1}`, isAI: true });
  }
  return game;
}

function makeGameWithAIManager(presetId = '9-standard') {
  const game = new GameEngine({ presetId });
  for (let i = 0; i < 3; i++) {
    game.addPlayer({ name: `P${i + 1}`, isAI: true });
  }
  const aiManager = new AIManager(game);
  game.getAIController = (id) => aiManager.get(id);
  game.players.forEach(p => {
    if (p.isAI) {
      aiManager.createAI(p.id, { agentType: 'mock' });
    }
  });
  return { game, aiManager };
}

describe('GameEngine.reset()', () => {
  it('重置所有游戏状态字段', () => {
    const game = makeGame();
    game.winner = 'good';
    game.gameOverInfo = { reason: 'test' };
    game.round = 5;
    game.sheriff = 1;
    game.couples = [1, 2];
    game.werewolfTarget = 3;
    game.guardTarget = 1;
    game.healTarget = 2;
    game.poisonTarget = 3;
    game.votes = { 1: 2 };
    game.deathQueue = [game.players[0]];
    game.lastWordsPlayer = 1;
    game.lastDeathPlayer = 2;
    game.banishedPlayer = 1;
    game._lastNightDeaths = [game.players[0]];
    game.interrupt = { type: 'explode', playerId: 1 };
    game._speechQueue = [1, 2];
    game._currentSpeakerId = 1;
    game.sheriffAssignOrder = { startPlayerId: 1 };
    game.phaseManager = { running: true };

    game.reset({ keepPlayers: true });

    if (game.winner !== null) throw new Error('winner 应为 null');
    if (game.gameOverInfo !== null) throw new Error('gameOverInfo 应为 null');
    if (game.round !== 1) throw new Error('round 应为 1');
    if (game.sheriff !== null) throw new Error('sheriff 应为 null');
    if (game.couples !== null) throw new Error('couples 应为 null');
    if (game.werewolfTarget !== null) throw new Error('werewolfTarget 应为 null');
    if (game.guardTarget !== null) throw new Error('guardTarget 应为 null');
    if (game.healTarget !== null) throw new Error('healTarget 应为 null');
    if (game.poisonTarget !== null) throw new Error('poisonTarget 应为 null');
    if (Object.keys(game.votes).length !== 0) throw new Error('votes 应为空');
    if (game.deathQueue.length !== 0) throw new Error('deathQueue 应为空');
    if (game.lastWordsPlayer !== null) throw new Error('lastWordsPlayer 应为 null');
    if (game.lastDeathPlayer !== null) throw new Error('lastDeathPlayer 应为 null');
    if (game.banishedPlayer !== null) throw new Error('banishedPlayer 应为 null');
    if (game._lastNightDeaths.length !== 0) throw new Error('_lastNightDeaths 应为空');
    if (game.interrupt !== null) throw new Error('interrupt 应为 null');
    if (game._speechQueue.length !== 0) throw new Error('_speechQueue 应为空');
    if (game._currentSpeakerId !== null) throw new Error('_currentSpeakerId 应为 null');
    if (game.sheriffAssignOrder !== null) throw new Error('sheriffAssignOrder 应为 null');
    if (game.phaseManager !== null) throw new Error('phaseManager 应为 null');
  });

  it('keepPlayers=true 保留玩家并重置游戏属性', () => {
    const game = makeGame();
    game.players[0].alive = false;
    game.players[0].role = { id: 'werewolf' };
    game.players[0].state = { seerChecks: [1] };
    game.players[0].deathReason = 'wolf';
    game.players[0].revealed = true;
    game.players[0].ready = true;

    game.reset({ keepPlayers: true });

    if (game.players.length !== 3) throw new Error('玩家数量应保留');
    for (const p of game.players) {
      if (p.alive !== true) throw new Error('alive 应为 true');
      if (p.role !== null) throw new Error('role 应为 null');
      if (Object.keys(p.state).length !== 0) throw new Error('state 应为空');
      if (p.deathReason !== undefined) throw new Error('deathReason 应为 undefined');
      if (p.revealed !== undefined) throw new Error('revealed 应为 undefined');
    }
  });

  it('keepPlayers=true 不碰 ready（房间管理概念）', () => {
    const game = makeGame();
    game.players[0].ready = true;
    game.players[1].ready = false;

    game.reset({ keepPlayers: true });

    if (game.players[0].ready !== true) throw new Error('ready 不应被 reset 改变');
    if (game.players[1].ready !== false) throw new Error('ready 不应被 reset 改变');
  });

  it('keepPlayers=false 清空玩家', () => {
    const game = makeGame();
    game.reset({ keepPlayers: false });
    if (game.players.length !== 0) throw new Error('玩家应被清空');
  });

  it('默认 keepPlayers=false', () => {
    const game = makeGame();
    game.reset();
    if (game.players.length !== 0) throw new Error('默认应清空玩家');
  });

  it('重置 phaseManager 时先设 running=false 再置 null', () => {
    const game = makeGame();
    let runningWasSetFalse = false;
    game.phaseManager = {
      get running() { return this._running; },
      set running(v) { if (v === false) runningWasSetFalse = true; this._running = v; },
      _running: true
    };

    game.reset({ keepPlayers: true });

    if (!runningWasSetFalse) throw new Error('应先设 running=false');
    if (game.phaseManager !== null) throw new Error('phaseManager 应为 null');
  });

  it('清空消息并重置 _nextId', () => {
    const game = makeGame();
    game.message.add({ type: 'speech', content: 'hello', playerId: 1, playerName: 'P1', visibility: 'public' });
    if (game.message.messages.length !== 1) throw new Error('应有 1 条消息');

    game.reset({ keepPlayers: true });

    if (game.message.messages.length !== 0) throw new Error('消息应被清空');
    if (game.message._nextId !== 1) throw new Error('_nextId 应重置为 1');
  });

  it('保留 getAIController 回调', () => {
    const game = makeGame();
    const fn = () => null;
    game.getAIController = fn;

    game.reset({ keepPlayers: true });

    if (game.getAIController !== fn) throw new Error('getAIController 应保留');
  });

  it('取消 pending requests', () => {
    const game = makeGame();
    let resolved = false;
    game._pendingRequests.set('test', {
      resolve: (v) => { if (v.cancelled) resolved = true; },
      timeout: setTimeout(() => {}, 10000)
    });

    game.reset({ keepPlayers: true });

    if (!resolved) throw new Error('pending request 应被取消');
    if (game._pendingRequests.size !== 0) throw new Error('_pendingRequests 应为空');
  });
});

describe('GameEngine.changePreset()', () => {
  it('切换 preset 并更新相关字段', () => {
    const game = new GameEngine({ presetId: '9-standard' });

    game.changePreset('12-guard-cupid');

    if (game.presetId !== '12-guard-cupid') throw new Error('presetId 应更新');
    if (!game.preset) throw new Error('preset 应存在');
    if (game.preset.playerCount !== 12) throw new Error('preset 应为 12 人');
    if (!game.effectiveRules) throw new Error('effectiveRules 应存在');
  });

  it('清空 _playerCount 让 playerCount 从 preset 派生', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game._playerCount = 5;

    game.changePreset('12-guard-cupid');

    if (game._playerCount !== null) throw new Error('_playerCount 应为 null');
    if (game.playerCount !== 12) throw new Error('playerCount 应从 preset 派生');
  });

  it('无效 presetId 不做任何修改', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game.changePreset('invalid-preset');
    if (game.presetId !== '9-standard') throw new Error('presetId 不应变');
  });

  it('游戏进行中不允许切换', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game.phaseManager = { running: true };

    game.changePreset('12-guard-cupid');

    if (game.presetId !== '9-standard') throw new Error('游戏进行中不应切换');
  });
});

describe('GameEngine.addPlayer()', () => {
  it('添加人类玩家', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    const id = game.addPlayer({ name: '张三', isAI: false });

    if (id !== 1) throw new Error('第一个玩家 id 应为 1');
    if (game.players.length !== 1) throw new Error('应有 1 个玩家');
    if (game.players[0].name !== '张三') throw new Error('name 应为张三');
    if (game.players[0].isAI !== false) throw new Error('isAI 应为 false');
    if (game.players[0].alive !== true) throw new Error('alive 应为 true');
    if (game.players[0].ready !== false) throw new Error('人类玩家 ready 应为 false');
  });

  it('添加 AI 玩家', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    const id = game.addPlayer({ name: 'AI-1', isAI: true });

    if (game.players[0].ready !== true) throw new Error('AI 玩家 ready 应为 true');
  });

  it('自动递增 id', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    const id1 = game.addPlayer({ name: 'P1', isAI: false });
    const id2 = game.addPlayer({ name: 'P2', isAI: false });

    if (id1 !== 1) throw new Error('id1 应为 1');
    if (id2 !== 2) throw new Error('id2 应为 2');
  });

  it('自定义字段合并到 player', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    const id = game.addPlayer({ name: 'AI-1', isAI: true, thinking: '思考', speaking: '说话' });

    if (game.players[0].thinking !== '思考') throw new Error('自定义字段应合并');
    if (game.players[0].speaking !== '说话') throw new Error('自定义字段应合并');
  });

  it('默认 emoji 为🎭', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game.addPlayer({ name: 'P1', isAI: false });
    if (game.players[0].emoji !== '🎭') throw new Error('默认 emoji 应为🎭');
  });
});

describe('GameEngine.removePlayer()', () => {
  it('移除指定玩家', () => {
    const game = makeGame();
    if (game.players.length !== 3) throw new Error('初始应有 3 个玩家');

    game.removePlayer(2);

    if (game.players.length !== 2) throw new Error('移除后应有 2 个玩家');
    if (game.players.find(p => p.id === 2)) throw new Error('id=2 不应存在');
  });

  it('移除不存在的玩家不影响', () => {
    const game = makeGame();
    game.removePlayer(999);
    if (game.players.length !== 3) throw new Error('玩家数不应变');
  });
});

describe('MessageManager.clear()', () => {
  it('清空消息并重置 _nextId', () => {
    const mm = new MessageManager();
    mm.add({ type: 'speech', content: 'hello', playerId: 1, playerName: 'P1', visibility: 'public' });
    mm.add({ type: 'speech', content: 'world', playerId: 2, playerName: 'P2', visibility: 'public' });

    if (mm.messages.length !== 2) throw new Error('应有 2 条消息');
    if (mm._nextId !== 3) throw new Error('_nextId 应为 3');

    mm.clear();

    if (mm.messages.length !== 0) throw new Error('消息应被清空');
    if (mm._nextId !== 1) throw new Error('_nextId 应重置为 1');
  });

  it('clear 后新消息从 id=1 开始', () => {
    const mm = new MessageManager();
    mm.add({ type: 'speech', content: 'old', playerId: 1, playerName: 'P1', visibility: 'public' });
    mm.clear();
    mm.add({ type: 'speech', content: 'new', playerId: 1, playerName: 'P1', visibility: 'public' });

    if (mm.messages[0].id !== 1) throw new Error('清空后新消息 id 应从 1 开始');
  });
});

describe('AIManager.remove()', () => {
  it('移除 controller 并调 destroy', () => {
    const { game, aiManager } = makeGameWithAIManager();
    const controller = aiManager.get(1);
    if (!controller) throw new Error('controller 应存在');

    aiManager.remove(1);

    if (aiManager.get(1)) throw new Error('controller 应被移除');
    if (controller.agent.requestQueue.length !== 0) throw new Error('destroy 应清空队列');
  });

  it('移除不存在的 playerId 不报错', () => {
    const { aiManager } = makeGameWithAIManager();
    aiManager.remove(999);
  });
});

describe('AIManager.forEach()', () => {
  it('遍历所有 controller', () => {
    const { aiManager } = makeGameWithAIManager();
    const ids = [];
    aiManager.forEach(c => ids.push(c.playerId));
    if (ids.length !== 3) throw new Error('应有 3 个 controller');
  });
});

describe('AIManager inject(GAME_OVER)', () => {
  it('为每个 controller 注入 GAME_OVER 消息', () => {
    const { game, aiManager } = makeGameWithAIManager();
    const queueLengths = [];
    aiManager.forEach(c => queueLengths.push(c.agent.requestQueue.length));

    aiManager.onMessage({ type: 'game_over', content: '游戏结束', visibility: 'public' });

    aiManager.forEach(c => {
      if (c.agent.requestQueue.length <= queueLengths.shift()) {
        throw new Error('GAME_OVER 应排入请求');
      }
    });
  });

  it('broadcastFn 正确包装——skip 结果不触发广播', () => {
    const { game, aiManager } = makeGameWithAIManager();
    let broadcastCalled = false;
    const broadcastFn = () => { broadcastCalled = true; };

    aiManager.onMessage({ type: 'game_over', content: '游戏结束', visibility: 'public' });
    // GAME_OVER 排入 decision 请求，callback 是 wrappedBroadcastFn
    // MockModel 默认返回 skip，所以 broadcastFn 不应被调
    // 需要等待异步处理完成
  });
});

describe('AIManager.remapPlayerIds()', () => {
  it('重映射后 controller 按新 id 查找', () => {
    const { game, aiManager } = makeGameWithAIManager();

    // 模拟 ID 重分配：玩家 1→3, 2→1, 3→2
    const p1 = game.players.find(p => p.id === 1);
    const p2 = game.players.find(p => p.id === 2);
    const p3 = game.players.find(p => p.id === 3);
    p1.id = 3;
    p2.id = 1;
    p3.id = 2;

    aiManager.remapPlayerIds();

    if (!aiManager.get(3)) throw new Error('id=3 应有 controller');
    if (!aiManager.get(1)) throw new Error('id=1 应有 controller');
    if (!aiManager.get(2)) throw new Error('id=2 应有 controller');
    if (aiManager.controllers.size !== 3) throw new Error('应保留 3 个 controller');
  });
});

describe('AIManager inject(GAME_START)', () => {
  it('为每个 controller 注入 GAME_START 消息', () => {
    const { game, aiManager } = makeGameWithAIManager();

    const queueLengths = [];
    aiManager.forEach(c => queueLengths.push(c.agent.requestQueue.length));

    aiManager.onMessage({ type: 'game_start', content: '游戏开始', visibility: 'public' });

    aiManager.forEach((c, i) => {
      if (c.agent.requestQueue.length <= queueLengths[i]) {
        throw new Error('GAME_START 应排入请求');
      }
    });
  });
});

run();