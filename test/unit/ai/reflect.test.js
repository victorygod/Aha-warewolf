const { describe, it, run } = require('../../helpers/test-runner');
const fs = require('fs');
const path = require('path');
const { getTool, getToolsForAction } = require('../../../ai/agent/tools');
const { loadExperience, getCurrentTask, ROLE_NAMES } = require('../../../ai/agent/prompt');
const { Agent } = require('../../../ai/agent/agent');
const { MSG, ACTION, CAMP } = require('../../../engine/constants');

const PROFILE_DIR = path.join(__dirname, '..', '..', '..', 'ai', 'profiles');

describe('experience - loadExperience', () => {
  it('无 experience.json 时返回空字符串', () => {
    const result = loadExperience('9-standard', 'werewolf', '__nonexistent_profile__');
    if (result !== '') throw new Error('应返回空字符串');
  });

  it('缺少参数时返回空字符串', () => {
    if (loadExperience(null, 'werewolf', 'yaoguang') !== '') throw new Error('null presetId 应返回空');
    if (loadExperience('9-standard', null, 'yaoguang') !== '') throw new Error('null roleId 应返回空');
    if (loadExperience('9-standard', 'werewolf', null) !== '') throw new Error('null profileName 应返回空');
  });

  it('读取已有 experience.json 中的经验内容', () => {
    const tmpDir = path.join(PROFILE_DIR, '__test_reflect__');
    const expFile = path.join(tmpDir, 'experience.json');
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(expFile, JSON.stringify({
        '9-standard': { werewolf: '作为狼人要隐藏身份', seer: '作为预言家要查验' }
      }, null, 2), 'utf-8');

      const result = loadExperience('9-standard', 'werewolf', '__test_reflect__');
      if (result !== '作为狼人要隐藏身份') throw new Error(`应返回正确经验，实际: ${result}`);

      const result2 = loadExperience('9-standard', 'seer', '__test_reflect__');
      if (result2 !== '作为预言家要查验') throw new Error(`应返回正确经验，实际: ${result2}`);

      const result3 = loadExperience('12-hunter-idiot', 'werewolf', '__test_reflect__');
      if (result3 !== '') throw new Error('不存在的板子应返回空');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('experience - update_experience tool', () => {
  const tmpDir = path.join(PROFILE_DIR, '__test_reflect_tool__');
  const expFile = path.join(tmpDir, 'experience.json');

  it('getTool 返回 update_experience 工具', () => {
    const tool = getTool('update_experience');
    if (!tool || !tool.execute) throw new Error('应返回 update_experience 工具');
  });

  it('getToolsForAction reflect 返回 update_experience 工具', () => {
    const tools = getToolsForAction('reflect', {
      self: { role: { id: 'werewolf', camp: CAMP.WOLF } },
      presetId: '9-standard'
    });
    if (!Array.isArray(tools) || tools.length !== 1) throw new Error('应返回单元素数组');
    if (tools[0].function.name !== 'update_experience') throw new Error('工具名应为 update_experience');
  });

  it('buildSchema 包含 roleId 和 content 参数', () => {
    const tool = getTool('update_experience');
    const schema = tool.buildSchema({
      self: { role: { id: 'werewolf', camp: CAMP.WOLF } },
      presetId: '9-standard'
    });
    if (!schema.parameters.properties.roleId) throw new Error('应有 roleId 参数');
    if (!schema.parameters.properties.content) throw new Error('应有 content 参数');
    if (!schema.parameters.properties.roleId.enum) throw new Error('roleId 应有 enum 限制');
  });

  it('execute 写入 experience.json', () => {
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const tool = getTool('update_experience');
      const context = {
        self: { profileName: '__test_reflect_tool__', role: { id: 'werewolf', camp: CAMP.WOLF } },
        presetId: '9-standard'
      };
      const result = tool.execute({ roleId: 'werewolf', content: '新经验内容' }, context);
      if (!result.success) throw new Error(`应成功: ${result.error}`);

      const data = JSON.parse(fs.readFileSync(expFile, 'utf-8'));
      if (data['9-standard']['werewolf'] !== '新经验内容') throw new Error('经验内容应被写入');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('execute 全量替换已有经验', () => {
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(expFile, JSON.stringify({
        '9-standard': { werewolf: '旧经验', seer: '预言家经验' }
      }, null, 2), 'utf-8');

      const tool = getTool('update_experience');
      const context = {
        self: { profileName: '__test_reflect_tool__', role: { id: 'werewolf', camp: CAMP.WOLF } },
        presetId: '9-standard'
      };
      const result = tool.execute({ roleId: 'werewolf', content: '替换后的经验' }, context);
      if (!result.success) throw new Error(`应成功: ${result.error}`);

      const data = JSON.parse(fs.readFileSync(expFile, 'utf-8'));
      if (data['9-standard']['werewolf'] !== '替换后的经验') throw new Error('经验应被全量替换');
      if (data['9-standard']['seer'] !== '预言家经验') throw new Error('其他角色经验应保留');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('execute 缺少必填参数返回错误', () => {
    const tool = getTool('update_experience');
    const context = {
      self: { profileName: '__test__', role: { id: 'werewolf' } },
      presetId: '9-standard'
    };
    const r1 = tool.execute({ content: '内容' }, context);
    if (r1.success) throw new Error('缺少 roleId 应失败');

    const r2 = tool.execute({ roleId: 'werewolf' }, context);
    if (r2.success) throw new Error('缺少 content 应失败');

    const r3 = tool.execute({ roleId: 'werewolf', content: '' }, context);
    if (r3.success) throw new Error('空 content 应失败');
  });

  it('execute 缺少上下文返回错误', () => {
    const tool = getTool('update_experience');
    const r1 = tool.execute({ roleId: 'werewolf', content: '内容' }, { self: {}, presetId: '9-standard' });
    if (r1.success) throw new Error('缺少 profileName 应失败');

    const r2 = tool.execute({ roleId: 'werewolf', content: '内容' }, { self: { profileName: 'test' } });
    if (r2.success) throw new Error('缺少 presetId 应失败');
  });
});

describe('experience - reflect task prompt', () => {
  it('reflect 任务生成提示词', () => {
    const context = {
      self: { role: { id: 'werewolf', camp: CAMP.WOLF } },
      presetId: '9-standard',
      winner: CAMP.WOLF,
      currentExperience: '之前的经验内容'
    };
    const task = getCurrentTask('reflect', context);
    if (!task.includes('经验沉淀')) throw new Error('应包含经验沉淀关键词');
    if (!task.includes('werewolf')) throw new Error('应包含角色ID');
    if (!task.includes('9-standard')) throw new Error('应包含板子ID');
    if (!task.includes('之前的经验内容')) throw new Error('应包含当前经验内容');
    if (!task.includes('update_experience')) throw new Error('应提及工具名');
  });

  it('reflect 无经验时提示词正常', () => {
    const context = {
      self: { role: { id: 'seer', camp: CAMP.GOOD } },
      presetId: '9-standard',
      winner: CAMP.WOLF,
      currentExperience: ''
    };
    const task = getCurrentTask('reflect', context);
    if (!task.includes('没有该角色的个人经验')) throw new Error('应提示无经验');
  });

  it('reflect 包含胜负信息', () => {
    const winContext = {
      self: { role: { id: 'werewolf', camp: CAMP.WOLF } },
      presetId: '9-standard',
      winner: CAMP.WOLF,
      currentExperience: ''
    };
    const winTask = getCurrentTask('reflect', winContext);
    if (!winTask.includes('获胜')) throw new Error('应包含获胜信息');

    const loseContext = {
      self: { role: { id: 'seer', camp: CAMP.GOOD } },
      presetId: '9-standard',
      winner: CAMP.WOLF,
      currentExperience: ''
    };
    const loseTask = getCurrentTask('reflect', loseContext);
    if (!loseTask.includes('失败')) throw new Error('应包含失败信息');
  });
});

describe('experience - GAME_OVER reflect queue item', () => {
  it('GAME_OVER 消息包含 reflect decision 队列项', () => {
    const agent = new Agent({ mockOptions: {} });
    const context = {
      self: { id: 1, name: '测试', role: { id: 'werewolf', camp: CAMP.WOLF }, alive: false },
      players: [],
      alivePlayers: [],
      presetId: '9-standard',
      winner: CAMP.WOLF,
      extraData: {}
    };
    const msg = { type: MSG.GAME_OVER, content: '游戏结束' };
    const { items } = agent.derive({ msg, context });

    const decisions = items.filter(item => item.type === 'decision');
    const reflectItem = decisions.find(d => d.context?.action === 'reflect');
    if (!reflectItem) throw new Error('GAME_OVER 应包含 action=reflect 的 decision');

    const chatItem = decisions.find(d => d.context?.action === ACTION.CHAT);
    const chatIndex = items.indexOf(chatItem);
    const reflectIndex = items.indexOf(reflectItem);
    const compactIndex = items.findIndex(item => item.type === 'compact');

    if (chatIndex >= reflectIndex) throw new Error('reflect 应在 chat decision 之后');
    if (reflectIndex >= compactIndex) throw new Error('reflect 应在 compact 之前');
  });

  it('reflect decision 包含 currentExperience', () => {
    const agent = new Agent({ mockOptions: {} });
    const context = {
      self: { id: 1, name: '测试', role: { id: 'werewolf', camp: CAMP.WOLF }, alive: false, profileName: 'yaoguang' },
      players: [],
      alivePlayers: [],
      presetId: '9-standard',
      winner: CAMP.WOLF,
      extraData: {}
    };
    const msg = { type: MSG.GAME_OVER, content: '游戏结束' };
    const { items } = agent.derive({ msg, context });

    const reflectItem = items.filter(item => item.type === 'decision').find(d => d.context?.action === 'reflect');
    if (!reflectItem) throw new Error('应包含 reflect decision');
    if (!('currentExperience' in reflectItem.context)) throw new Error('reflect context 应包含 currentExperience');
  });
});

describe('experience - reflect ephemeral task', () => {
  it('reflect 任务的 task 不持久化到 messages', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'system', content: '系统' }, { role: 'user', content: '游戏事件' }];

    const self = { thinking: '思考', speaking: '说话' };
    const context = {
      action: 'reflect',
      self: { role: { id: 'werewolf', camp: CAMP.WOLF } },
      presetId: '9-standard',
      winner: CAMP.WOLF,
      currentExperience: '经验'
    };

    const { llmView, persisted } = mm.prepareLLMView('reflect', context, self);
    if (persisted) throw new Error('reflect 任务不应持久化到 messages');
  });

  it('reflect 任务包含 thinking 不含 speaking', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'system', content: '系统' }, { role: 'user', content: '游戏事件' }];

    const self = { thinking: '我的思考逻辑', speaking: '我的说话风格' };
    const context = {
      action: 'reflect',
      self: { role: { id: 'werewolf', camp: CAMP.WOLF } },
      presetId: '9-standard',
      winner: CAMP.WOLF,
      currentExperience: '经验'
    };

    const { llmView } = mm.prepareLLMView('reflect', context, self);
    const lastUser = llmView.filter(m => m.role === 'user').pop();
    if (!lastUser) throw new Error('应有 user 消息');
    if (!lastUser.content.includes('我的思考逻辑')) throw new Error('reflect 应包含 thinking');
    if (lastUser.content.includes('我的说话风格')) throw new Error('reflect 不应包含 speaking');
  });
});

describe('experience - reflect via answer', () => {
  it('reflect action 通过 answer 正常完成', async () => {
    const agent = new Agent({
      mockOptions: {
        customStrategies: {
          reflect: () => ({ content: '反思完成' })
        }
      }
    });

    const context = {
      self: { id: 1, name: '测试', profileName: '__test__', role: { id: 'werewolf', camp: CAMP.WOLF }, alive: false, thinking: '思考' },
      players: [],
      alivePlayers: [],
      presetId: '9-standard',
      winner: CAMP.WOLF,
      action: 'reflect',
      currentExperience: '',
      extraData: {}
    };

    agent.mm.updateSystem(context.self, { players: [], round: 1, presetId: '9-standard' }, 'game');

    const result = await agent.answer(context);
    if (typeof result !== 'string') throw new Error('reflect 应返回文本内容');
  });
});

run();