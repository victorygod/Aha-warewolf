const { describe, it, run } = require('../../helpers/test-runner');
const { getCurrentTask, isSpeech } = require('../../../ai/agent/prompt');
const { ACTION } = require('../../../engine/constants');

describe('Agent - analyze 场景 task 拼接', () => {
  it('analyze 时 task 包含分析提示', () => {
    const task = getCurrentTask('analyze', {});
    if (!task.includes('分析')) throw new Error('analyze task 应包含分析提示');
  });

  it('决策时 task 对应阶段提示', () => {
    const task = getCurrentTask('action_day_discuss', {});
    if (!task.includes('白天发言')) throw new Error('day_discuss task 应包含白天发言');
  });

  it('analyze 无 thinking/speaking', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent({ mockOptions: {} });
    const { llmView, persisted } = agent.mm.prepareLLMView('analyze', { players: [], alivePlayers: [] }, {});
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('分析')) throw new Error('应包含分析提示');
    if (persisted) throw new Error('analyze 不应持久化');
  });

  it('发言类包含 thinking 和 speaking', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent({ mockOptions: {} });
    const { llmView, persisted } = agent.mm.prepareLLMView(
      'action_day_discuss',
      { players: [], alivePlayers: [] },
      { thinking: '我是思考逻辑', speaking: '我是说话风格' }
    );
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('【行为逻辑】')) throw new Error('应包含 thinking');
    if (!lastUser.content.includes('【说话方式】')) throw new Error('应包含 speaking');
    if (!persisted) throw new Error('发言类应持久化');
  });

  it('非发言类包含 thinking 不含 speaking', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent({ mockOptions: {} });
    const { llmView, persisted } = agent.mm.prepareLLMView(
      'action_day_vote',
      { players: [], alivePlayers: [] },
      { thinking: '我是思考逻辑', speaking: '我是说话风格' }
    );
    const lastUser = llmView[llmView.length - 1];
    if (!lastUser.content.includes('【行为逻辑】')) throw new Error('应包含 thinking');
    if (lastUser.content.includes('【说话方式】')) throw new Error('不应包含 speaking');
    if (!persisted) throw new Error('非发言类应持久化');
  });
});

describe('Agent - 模块导入', () => {
  it('Agent 可导入', () => {
    const { Agent } = require('../../../ai/agent/agent');
    if (!Agent) throw new Error('Agent 应可导入');
  });
});

describe('Agent - 创建实例', () => {
  it('无 API 配置时使用 MockModel', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent({ mockOptions: {} });
    if (!agent) throw new Error('应能创建 Agent');
  });

  it('有 mm.messages 属性', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent({ mockOptions: {} });
    if (!Array.isArray(agent.mm.messages)) throw new Error('mm 应有 messages 数组');
  });
});

run();
