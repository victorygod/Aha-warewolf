const { describe, it, run } = require('../../helpers/test-runner');
const { ACTION } = require('../../../engine/constants');
const { MessageManager } = require('../../../ai/agent/message_manager');
const { Agent } = require('../../../ai/agent/agent');

// ========== MessageManager.prepareLLMView ==========

describe('MessageManager.prepareLLMView - 提示词生成规则', () => {
  it('analyze 无 thinking 时只有 task', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始内容' }];
    
    const { llmView, persisted } = mm.prepareLLMView('analyze', { players: [], alivePlayers: [] }, {});
    
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('分析')) throw new Error('应包含 task');
    if (lastUser.content.includes('【行为逻辑】')) throw new Error('不应包含 thinking');
    if (persisted) throw new Error('analyze 不应持久化');
  });

  it('analyze 有 thinking 时包含 thinking + task', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始内容' }];
    
    const { llmView, persisted } = mm.prepareLLMView('analyze', { players: [], alivePlayers: [] }, { thinking: '思考逻辑' });
    
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('【行为逻辑】')) throw new Error('应包含 thinking');
    if (!lastUser.content.includes('分析')) throw new Error('应包含 task');
    if (persisted) throw new Error('analyze 不应持久化');
  });

  it('发言类包含 thinking + speaking + task', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始内容' }];
    
    const { llmView, persisted } = mm.prepareLLMView(
      ACTION.DAY_DISCUSS,
      { players: [], alivePlayers: [] },
      { thinking: '思考', speaking: '说话' }
    );
    
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('【行为逻辑】')) throw new Error('应包含 thinking');
    if (!lastUser.content.includes('【说话方式】')) throw new Error('应包含 speaking');
    if (!lastUser.content.includes('白天发言')) throw new Error('应包含 task');
    if (!persisted) throw new Error('发言类应持久化');
  });

  it('决策类包含 thinking + task', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始内容' }];
    
    const { llmView, persisted } = mm.prepareLLMView(
      ACTION.SEER,
      { players: [], alivePlayers: [] },
      { thinking: '思考', speaking: '说话' }
    );
    
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('【行为逻辑】')) throw new Error('应包含 thinking');
    if (lastUser.content.includes('【说话方式】')) throw new Error('不应包含 speaking');
    if (!lastUser.content.includes('预言家')) throw new Error('应包含 task');
    if (!persisted) throw new Error('决策类应持久化');
  });

  it('chat 包含 thinking + speaking + task', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始内容' }];
    
    const { llmView, persisted } = mm.prepareLLMView(
      ACTION.CHAT,
      { players: [], alivePlayers: [] },
      { thinking: '思考', speaking: '说话' }
    );
    
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('【行为逻辑】')) throw new Error('应包含 thinking');
    if (!lastUser.content.includes('【说话方式】')) throw new Error('应包含 speaking');
    if (!lastUser.content.includes('聊天室')) throw new Error('应包含 task');
    if (!persisted) throw new Error('chat 应持久化');
  });

  it('compact 无 thinking/speaking，只有 task', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始内容' }];
    
    const { llmView, persisted } = mm.prepareLLMView(
      'compact',
      { players: [], alivePlayers: [] },
      { thinking: '思考', speaking: '说话' }
    );
    
    const lastUser = llmView[llmView.length - 1];
    if (lastUser.content.includes('【行为逻辑】')) throw new Error('compact 不应包含 thinking');
    if (lastUser.content.includes('【说话方式】')) throw new Error('compact 不应包含 speaking');
    if (!persisted) throw new Error('compact 应持久化');
  });
});

// ========== buildLLMView: 模板拼接 ==========

describe('buildLLMView - 模板拼接', () => {
  it('最后一条 user 时：thinking 在开头，task 在末尾，原始内容在中间', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '游戏事件' }
    ];
    const { llmView } = mm.prepareLLMView(
      ACTION.DAY_DISCUSS,
      { players: [], alivePlayers: [] },
      { thinking: '【行为逻辑】\n思考', speaking: '【说话方式】\n风格' }
    );
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.startsWith('【行为逻辑】')) throw new Error('thinking 应在开头');
    if (!lastUser.content.includes('游戏事件')) throw new Error('应保留原始内容');
    if (!lastUser.content.includes('【白天发言】')) throw new Error('应包含 task');
  });

  it('仅有 thinking 时，只插入 thinking 到开头', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '游戏事件' }];
    const { llmView } = mm.prepareLLMView(
      ACTION.SEER,
      { players: [], alivePlayers: [] },
      { thinking: '【行为逻辑】\n思考', speaking: '' }
    );
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.startsWith('【行为逻辑】')) throw new Error('thinking 应在开头');
    if (!lastUser.content.includes('游戏事件')) throw new Error('应保留原始内容');
  });

  it('仅有 task 时，追加到末尾', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '游戏事件' }];
    const { llmView } = mm.prepareLLMView(
      ACTION.SEER,
      { players: [], alivePlayers: [] },
      { thinking: '', speaking: '' }
    );
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.startsWith('游戏事件')) throw new Error('原始内容应在开头');
    if (!lastUser.content.includes('预言家')) throw new Error('task 应在末尾');
  });

  it('最后一条非 user 时，追加新 user', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'assistant', content: '分析内容' }
    ];
    const { llmView } = mm.prepareLLMView(
      ACTION.DAY_DISCUSS,
      { players: [], alivePlayers: [] },
      { thinking: '思考', speaking: '说话' }
    );
    if (llmView.length !== 3) throw new Error(`view 长度应为 3，实际 ${llmView.length}`);
    if (llmView[2].role !== 'user') throw new Error('追加的应为 user');
  });

  it('不修改原始 mm.messages', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始内容' }];
    const originalContent = mm.messages[0].content;

    // 使用_buildLLMViewInternal 测试不修改原始 messages
    const parts = { thinking: '思考', speaking: '说话', task: 'task' };
    mm._buildLLMViewInternal(parts);

    if (mm.messages[0].content !== originalContent) throw new Error('不应修改原始 messages');
  });

  it('空 self 时返回只含 task 的 view', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'user', content: '原始' }];
    const { llmView } = mm.prepareLLMView(
      ACTION.SEER,
      { players: [], alivePlayers: [] },
      {}
    );
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('原始')) throw new Error('应保留原始内容');
    if (lastUser.content.includes('【行为逻辑】')) throw new Error('不应有 thinking');
  });
});

// ========== 持久化 ==========

describe('Agent - 持久化', () => {
  it('决策类 answer 合并 task 到最后一条 user', async () => {
    const agent = new Agent({ mockOptions: {
      presetResponses: { action_day_discuss: { content: '发言内容' } }
    }});
    agent.mm.updateSystem({ name: '测试', role: { id: 'villager', camp: 'good' }, background: '' }, {
      players: [{ id: 1, name: 'P1', role: { id: 'villager', camp: 'good' }, alive: true }],
      presetId: 'test',
      preset: { ruleDescriptions: [] }
    }, 'game');
    agent.mm.inject('[系统] 第 1 天');
    agent.mm.flush();

    const context = {
      action: 'action_day_discuss',
      phase: 'day_discuss',
      players: [{ id: 1, name: 'P1', role: { id: 'villager', camp: 'good' }, alive: true, position: 1 }],
      alivePlayers: [{ id: 1, name: 'P1', role: { id: 'villager', camp: 'good' }, alive: true }],
      self: { id: 1, name: 'P1', thinking: '思考', speaking: '风格', role: { id: 'villager', camp: 'good' }, alive: true, seerChecks: [], witchHeal: 0, witchPoison: 0 },
      dayCount: 1,
      werewolfTarget: null,
      witchPotion: { heal: false, poison: false },
      extraData: { actionType: 'action_day_discuss' }
    };

    await agent.answer(context);

    const userWithTask = agent.mm.messages.find(m => m.role === 'user' && m.content.includes('【白天发言】'));
    if (!userWithTask) throw new Error('应有一条包含 task prompt 的 user 消息');
    if (userWithTask.content.includes('【行为逻辑】')) throw new Error('持久化的 user 不应包含 persona');
    if (!userWithTask.content.includes('[系统] 第 1 天')) throw new Error('task 应合并到 flush 的 user 消息中');
  });

  it('analyze 不合并 task 到 mm.messages', async () => {
    const agent = new Agent({ mockOptions: {
      presetResponses: { analyze: { content: '分析内容' } }
    }});
    agent.mm.updateSystem({ name: '测试', role: { id: 'villager', camp: 'good' }, background: '' }, {
      players: [{ id: 1, name: 'P1', role: { id: 'villager', camp: 'good' }, alive: true }],
      presetId: 'test',
      preset: { ruleDescriptions: [] }
    }, 'game');
    agent.mm.inject('[发言|1 号 P1] 我是好人');
    agent.mm.flush();

    const context = {
      action: 'analyze',
      phase: 'day_discuss',
      players: [{ id: 1, name: 'P1', role: { id: 'villager', camp: 'good' }, alive: true }],
      alivePlayers: [{ id: 1, name: 'P1', role: { id: 'villager', camp: 'good' }, alive: true }],
      self: { id: 1, name: 'P1', thinking: '思考', speaking: '风格', role: { id: 'villager', camp: 'good' }, alive: true, seerChecks: [], witchHeal: 0, witchPoison: 0 },
      dayCount: 1,
      werewolfTarget: null,
      witchPotion: { heal: false, poison: false },
      extraData: { actionType: 'analyze' }
    };

    await agent.answer(context);

    const lastMsg = agent.mm.messages[agent.mm.messages.length - 1];
    if (lastMsg.role !== 'assistant') throw new Error('analyze 应持久化 assistant');
    if (lastMsg.content !== '分析内容') throw new Error('analyze 内容应正确');

    const lastUser = agent.mm.messages[agent.mm.messages.length - 2];
    if (!lastUser.content.includes('我是好人')) throw new Error('最后一条 user 应是 flush 的游戏事件');
    if (lastUser.content.includes('分析')) throw new Error('analyze 的 task 不应合并到 user');
  });

  it('LLMView 包含 persona，mm.messages 不包含', async () => {
    const agent = new Agent({ mockOptions: {
      presetResponses: { action_seer: { target: 2 } }
    }});
    agent.mm.updateSystem({ name: '测试', role: { id: 'seer', camp: 'good' }, background: '' }, {
      players: [
        { id: 1, name: 'P1', role: { id: 'seer', camp: 'good' }, alive: true },
        { id: 2, name: 'P2', role: { id: 'werewolf', camp: 'wolf' }, alive: true }
      ],
      presetId: 'test',
      preset: { ruleDescriptions: [] }
    }, 'game');
    agent.mm.inject('[系统] 第 1 夜');
    agent.mm.flush();

    const context = {
      action: 'action_seer',
      phase: 'seer',
      players: [
        { id: 1, name: 'P1', role: { id: 'seer', camp: 'good' }, alive: true },
        { id: 2, name: 'P2', role: { id: 'werewolf', camp: 'wolf' }, alive: true }
      ],
      alivePlayers: [
        { id: 1, name: 'P1', role: { id: 'seer', camp: 'good' }, alive: true },
        { id: 2, name: 'P2', role: { id: 'werewolf', camp: 'wolf' }, alive: true }
      ],
      self: { id: 1, name: 'P1', thinking: '我是思考逻辑', speaking: '我是说话风格', role: { id: 'seer', camp: 'good' }, alive: true, seerChecks: [], witchHeal: 0, witchPoison: 0 },
      dayCount: 1,
      werewolfTarget: null,
      witchPotion: { heal: false, poison: false },
      extraData: { actionType: 'action_seer' }
    };

    const originalPrepareLLMView = agent.mm.prepareLLMView.bind(agent.mm);
    let capturedLLMView = null;
    agent.mm.prepareLLMView = function(action, ctx, self) {
      const result = originalPrepareLLMView(action, ctx, self);
      capturedLLMView = result.llmView;
      return result;
    };

    await agent.answer(context);

    if (!capturedLLMView) throw new Error('应捕获到 LLMView');

    const llmUserMsgs = capturedLLMView.filter(m => m.role === 'user');
    const llmLastUser = llmUserMsgs[llmUserMsgs.length - 1];
    if (!llmLastUser.content.includes('我是思考逻辑')) throw new Error('LLMView 应包含 persona（thinking）');

    const mmLastUser = agent.mm.messages.find(m => m.role === 'user' && m.content.includes('【预言家】'));
    if (!mmLastUser) throw new Error('mm.messages 应包含 task prompt');
    if (mmLastUser.content.includes('我是思考逻辑')) throw new Error('mm.messages 不应包含 persona');
  });
});

run();
