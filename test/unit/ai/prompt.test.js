const { describe, it, beforeEach, run } = require('../../helpers/test-runner');
const { buildSystemPrompt, getCurrentTask, isSpeech, ROLE_NAMES, DEFAULT_THINKING, getRandomProfiles, resetUsedNames } = require('../../../ai/agent/prompt');
const { ACTION } = require('../../../engine/constants');

describe('prompt - ROLE_NAMES', () => {
  it('包含关键角色名', () => {
    if (!ROLE_NAMES.seer) throw new Error('应有预言家');
    if (!ROLE_NAMES.werewolf) throw new Error('应有狼人');
    if (!ROLE_NAMES.witch) throw new Error('应有女巫');
    if (!ROLE_NAMES.hunter) throw new Error('应有猎人');
  });
});

describe('prompt - DEFAULT_THINKING', () => {
  it('是字符串', () => {
    if (typeof DEFAULT_THINKING !== 'string') throw new Error('DEFAULT_THINKING 应为字符串');
  });
});

describe('prompt - getRandomProfiles', () => {
  beforeEach(() => {
    resetUsedNames();
  });

  it('返回指定数量的配置', () => {
    const profiles = getRandomProfiles(3);
    if (profiles.length !== 3) throw new Error('应返回 3 个配置');
  });

  it('每个配置有 name/thinking/background/speaking 及元数据', () => {
    const profiles = getRandomProfiles(2);
    for (const p of profiles) {
      if (!p.name) throw new Error('配置应有 name');
      if (typeof p.background !== 'string') throw new Error('配置应有 background 字符串');
      if (typeof p.thinking !== 'string') throw new Error('配置应有 thinking 字符串');
      if (typeof p.speaking !== 'string') throw new Error('配置应有 speaking 字符串');
    }
    const fileProfiles = profiles.filter(p => p.englishName);
    if (fileProfiles.length > 0) {
      for (const p of fileProfiles) {
        if (!p.englishName) throw new Error('文件配置应有 englishName');
        if (!p.faction) throw new Error('文件配置应有 faction');
        if (!p.path) throw new Error('文件配置应有 path');
        if (!p.element) throw new Error('文件配置应有 element');
      }
    }
  });

  it('不重复名字', () => {
    const profiles = getRandomProfiles(5);
    const names = profiles.map(p => p.name);
    const unique = new Set(names);
    if (unique.size !== names.length) throw new Error('名字不应重复');
  });

  it('resetUsedNames 后名字池重置', () => {
    const p1 = getRandomProfiles(1);
    resetUsedNames();
    const p2 = getRandomProfiles(1);
    if (!p2[0].name) throw new Error('重置后应能获取名字');
  });
});

describe('prompt - buildSystemPrompt', () => {
  it('返回字符串', () => {
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {} };
    const game = { players: [], round: 1, effectiveRules: {} };
    const result = buildSystemPrompt(player, { game });
    if (typeof result !== 'string') throw new Error('应返回字符串');
  });

  it('包含角色信息', () => {
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {} };
    const game = { players: [], round: 1, effectiveRules: {} };
    const result = buildSystemPrompt(player, { game });
    if (!result.includes('预言家')) throw new Error('应包含角色名');
  });

  it('包含背景信息', () => {
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {}, background: '这是背景故事' };
    const game = { players: [], round: 1, effectiveRules: {} };
    const result = buildSystemPrompt(player, { game });
    if (!result.includes('这是背景故事')) throw new Error('应包含背景信息');
  });

  it('无背景时不添加背景段', () => {
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {}, background: '' };
    const game = { players: [], round: 1, effectiveRules: {} };
    const result = buildSystemPrompt(player, { game });
    if (result.includes('[背景]')) throw new Error('无背景时不应出现【背景】');
  });
});

describe('prompt - getCurrentTask', () => {
  it('返回已知阶段的提示', () => {
    const prompt = getCurrentTask('day_discuss', {});
    if (typeof prompt !== 'string') throw new Error('应返回字符串');
  });

  it('未知阶段返回空字符串或通用提示', () => {
    const prompt = getCurrentTask('unknown_phase', {});
    if (typeof prompt !== 'string') throw new Error('应返回字符串');
  });
});

describe('prompt - isSpeech', () => {
  it('发言类 action 返回 true', () => {
    if (!isSpeech(ACTION.DAY_DISCUSS)) throw new Error('DAY_DISCUSS 应为发言类');
    if (!isSpeech(ACTION.LAST_WORDS)) throw new Error('LAST_WORDS 应为发言类');
    if (!isSpeech(ACTION.SHERIFF_SPEECH)) throw new Error('SHERIFF_SPEECH 应为发言类');
    if (!isSpeech(ACTION.NIGHT_WEREWOLF_DISCUSS)) throw new Error('NIGHT_WEREWOLF_DISCUSS 应为发言类');
  });

  it('非发言类 action 返回 false', () => {
    if (isSpeech(ACTION.DAY_VOTE)) throw new Error('DAY_VOTE 不应为发言类');
    if (isSpeech(ACTION.SEER)) throw new Error('SEER 不应为发言类');
    if (isSpeech(ACTION.GUARD)) throw new Error('GUARD 不应为发言类');
    if (isSpeech(ACTION.WITCH)) throw new Error('WITCH 不应为发言类');
  });
});

run();
