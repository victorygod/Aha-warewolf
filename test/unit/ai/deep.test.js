const { describe, it, run } = require('../../helpers/test-runner');
const { RandomModel, ANALYSIS_TEMPLATES } = require('../../../ai/agent/models/random_model');
const { MockModel } = require('../../../ai/agent/models/mock_model');
const { Agent } = require('../../../ai/agent/agent');
const { AIController, ANALYSIS_NODES } = require('../../../ai/controller');
const { VISIBILITY, CAMP } = require('../../../engine/constants');

const alivePlayers = [
  { id: 1, name: '张三', alive: true },
  { id: 2, name: '李四', alive: true },
  { id: 3, name: '王五', alive: true },
  { id: 4, name: '赵六', alive: true }
];

function makeContext(action, extra = {}) {
  return {
    action,
    alivePlayers,
    extraData: extra.extraData || {},
    self: extra.self || { id: 1 },
    _tools: [{ type: 'function', function: { name: action, parameters: {} } }],
    _messagesForLLM: [],
    ...extra
  };
}

describe('RandomModel - 基础', () => {
  it('isAvailable 返回 true', () => {
    const model = new RandomModel(1);
    if (model.isAvailable() !== true) throw new Error('应返回 true');
  });

  it('无 tool 时返回分析文本', () => {
    const model = new RandomModel(1);
    const result = model.call({ action: 'analyze', _tools: [], _messagesForLLM: [] });
    if (!result?.raw?.content || typeof result.raw.content !== 'string') {
      throw new Error('无 tool 应返回 { raw: { content: string } } 格式');
    }
  });

  it('ANALYSIS_TEMPLATES 非空', () => {
    if (!Array.isArray(ANALYSIS_TEMPLATES) || ANALYSIS_TEMPLATES.length === 0) {
      throw new Error('ANALYSIS_TEMPLATES 应为非空数组');
    }
  });
});

describe('RandomModel - 各 action 决策', () => {
  it('speechAction 返回 content', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_day_discuss'));
    if (!result?.raw?.tool_calls) throw new Error('应返回 tool_calls');
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (!args.content) throw new Error('应包含 content');
  });

  it('voteAction 返回 target 或 skip', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_day_vote'));
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (!args.target && args.skip !== true) throw new Error('应返回 target 或 skip');
  });

  it('seerAction 排除自己', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_seer');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (parseInt(args.target) === ctx.self.id) throw new Error('不应查验自己');
  });

  it('seerAction 排除已查验', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_seer', {
      self: { id: 1, seerChecks: [{ targetId: 2 }] }
    });
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (parseInt(args.target) === 2) throw new Error('不应重复查验已查验的玩家');
  });

  it('guardAction 排除上次守护', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_guard', {
      self: { id: 1, lastGuardTarget: 2 }
    });
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (parseInt(args.target) === 2) throw new Error('不应重复守护同一人');
  });

  it('witchAction 有解药可救', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_witch', {
      self: { id: 1, witchHeal: 1, witchPoison: 0 },
      werewolfTarget: 2
    });
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (!['heal', 'poison', 'skip'].includes(args.action)) throw new Error('应返回 heal/poison/skip');
  });

  it('witchAction 无解药不救', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_witch', {
      self: { id: 1, witchHeal: 0, witchPoison: 0 },
      werewolfTarget: 2
    });
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (args.action !== 'skip') throw new Error('无解药应返回 skip');
  });

  it('cupidAction 选两人', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_cupid');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (!args.targets || args.targets.length !== 2) throw new Error('应选择两人');
  });

  it('hunterAction 返回 target 或 skip', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_shoot');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (!args.target && args.skip !== true) throw new Error('应返回 target 或 skip');
  });

  it('campaignAction 返回 run 布尔', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_sheriff_campaign');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (typeof args.run !== 'boolean') throw new Error('run 应为布尔');
  });

  it('withdrawAction 返回 withdraw 布尔', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_withdraw');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (typeof args.withdraw !== 'boolean') throw new Error('withdraw 应为布尔');
  });

  it('assignOrderAction 返回 target', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_assignOrder');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (!args.target) throw new Error('应返回 target');
  });

  it('passBadgeAction 返回 target', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_passBadge');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (!args.target) throw new Error('应返回 target');
  });

  it('未知 action 返回 skip', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('unknown_action');
    const result = model.call(ctx);
    const args = JSON.parse(result.raw.tool_calls[0].function.arguments);
    if (args.skip !== true) throw new Error('未知 action 应返回 skip');
  });
});

describe('MockModel - 行为序列', () => {
  it('wildcard 行为不推进序列索引', () => {
    const model = new MockModel(null, {
      behaviors: [{ phase: 'day_discuss', wildcard: true, response: { content: 'X' } }]
    });
    model.call({ action: 'action_day_discuss', phase: 'day_discuss' });
    const call1 = model.call({ action: 'action_day_discuss', phase: 'day_discuss' });
    model.call({ action: 'action_day_discuss', phase: 'day_discuss' });
    const call2 = model.call({ action: 'action_day_discuss', phase: 'day_discuss' });
    if (JSON.stringify(call1) !== JSON.stringify(call2)) throw new Error('wildcard 应返回相同结果');
  });

  it('非 wildcard 行为推进序列索引', async () => {
    const model = new MockModel(null);
    model.setBehaviorSequence([
      { phase: 'day_discuss', wildcard: false, response: { content: 'A' } },
      { phase: 'day_discuss', wildcard: false, response: { content: 'B' } }
    ]);
    const call1 = await model.call({ action: 'action_day_discuss', phase: 'day_discuss', _tools: [] });
    const call2 = await model.call({ action: 'action_day_discuss', phase: 'day_discuss', _tools: [] });
    if (call1.raw.content === call2.raw.content) throw new Error('非 wildcard 应推进索引');
  });

  it('enqueue 后 isProcessing 为 true（队列开始处理）', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.enqueue({ type: 'message', msg: { type: 'chat', content: 'test' } });
    if (agent.isProcessing !== true) throw new Error('enqueue 后 isProcessing 应为 true');
  });

  it('Agent 有 requestQueue 属性', () => {
    const agent = new Agent({ mockOptions: {} });
    if (!Array.isArray(agent.requestQueue)) throw new Error('requestQueue 应为数组');
  });

  it('Agent 有 mm.messages 属性', () => {
    const agent = new Agent({ mockOptions: {} });
    if (!Array.isArray(agent.mm.messages)) throw new Error('mm.messages 应为数组');
  });

  it('compressionEnabled=false 不压缩', async () => {
    const agent = new Agent({ mockOptions: {}, compressionEnabled: false });
    agent.mm.updateSystem({ name: 'P1', role: { id: 'villager', camp: 'good' }, background: '' }, {
      players: [{ id: 1, name: 'P1', role: { id: 'villager', camp: 'good' } }],
      presetId: 'test',
      preset: { ruleDescriptions: [] }
    }, 'game');
    agent.mm.inject('x'.repeat(5000));
    agent.mm.flush();
    await agent.mm.compact({ isAvailable: () => false }, 'game');
    if (agent.mm.messages.length > 2) throw new Error('compressionEnabled=false 不应压缩');
  });

  it('inject 和 flush 工作正常', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.mm.inject('test content');
    if (agent.mm.pendingInject.length !== 1) throw new Error('inject 应添加到 pendingInject');
    const flushed = agent.mm.flush();
    if (flushed !== 'test content') throw new Error('flush 应返回注入的内容');
    if (agent.mm.pendingInject.length !== 0) throw new Error('flush 后 pendingInject 应为空');
    if (agent.mm.messages.length !== 1) throw new Error('flush 后 messages 应有 1 条消息');
  });
});

run();