const { describe, it, run } = require('../../helpers/test-runner');
const { MessageManager } = require('../../../ai/agent/message_manager');
const { RandomModel } = require('../../../ai/agent/models/random_model');

function makePlayer(overrides = {}) {
  return {
    id: 1,
    name: '张三',
    role: { id: 'seer', camp: 'good' },
    alive: true,
    ...overrides
  };
}

describe('_buildSummaryRequest', () => {
  it('game 模式返回游戏摘要提示词', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const result = mm._buildSummaryRequest('game');
    if (!result.includes('游戏')) throw new Error('game 模式应包含游戏');
    if (!result.includes('摘要')) throw new Error('应包含摘要');
  });

  it('chat 模式返回聊天摘要提示词', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const result = mm._buildSummaryRequest('chat');
    if (!result.includes('聊天')) throw new Error('chat 模式应包含聊天');
    if (!result.includes('摘要')) throw new Error('应包含摘要');
  });

  it('未知模式默认使用 game 提示词', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const result = mm._buildSummaryRequest('unknown');
    if (!result.includes('游戏')) throw new Error('未知模式应使用 game 提示词');
  });
});

describe('compact 整体流程', () => {
  it('compressionEnabled=false 时不压缩', async () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '消息' }
    ];

    await mm.compact(null, 'game');

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
  });

  it('只有 system 消息时不压缩', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' }
    ];

    await mm.compact(null, 'game');

    if (mm.messages.length !== 1) throw new Error(`messages.length 期望 1, 实际 ${mm.messages.length}`);
  });

  it('退化模型压缩为 system + summary_request + [[包裹的历史]]', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第1天发言' },
      { role: 'assistant', content: '3号可疑' }
    ];

    await mm.compact(new RandomModel(), 'game');

    if (mm.messages.length !== 3) throw new Error(`messages.length 期望 3, 实际 ${mm.messages.length}`);
    if (mm.messages[0].role !== 'system') throw new Error('第一条应为 system');
    if (mm.messages[1].role !== 'user') throw new Error('第二条应为 user（摘要请求）');
    if (!mm.messages[1].content.includes('摘要')) throw new Error('user 消息应为摘要请求');
    if (mm.messages[2].role !== 'assistant') throw new Error('第三条应为 assistant');
    if (!mm.messages[2].content.startsWith('[[')) throw new Error('退化压缩 assistant 应用 [[ 包裹');
    if (!mm.messages[2].content.includes('第1天发言')) throw new Error('退化压缩应保留历史内容');
    if (!mm.messages[2].content.includes('3号可疑')) throw new Error('退化压缩应保留历史内容');
  });

  it('有 LLM 时压缩为 system + summary_request + LLM 摘要', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第1天发言' },
      { role: 'assistant', content: '3号可疑' }
    ];

    const fakeLLM = {
      isAvailable: () => true,
      call: async () => ({ choices: [{ message: { content: '第1天总结：3号可疑' } }] })
    };

    await mm.compact(fakeLLM, 'game');

    if (mm.messages.length !== 3) throw new Error(`messages.length 期望 3, 实际 ${mm.messages.length}`);
    if (mm.messages[2].role !== 'assistant') throw new Error('第三条应为 assistant');
    if (mm.messages[2].content !== '第1天总结：3号可疑') {
      throw new Error(`assistant 应为 LLM 摘要，实际 "${mm.messages[2].content}"`);
    }
  });

  it('LLM 失败时 assistant 为空', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第1天发言' }
    ];

    const fakeLLM = {
      isAvailable: () => true,
      call: async () => ({ choices: [{ message: { content: null } }] })
    };

    await mm.compact(fakeLLM, 'game');

    if (mm.messages.length !== 3) throw new Error(`messages.length 期望 3, 实际 ${mm.messages.length}`);
    if (mm.messages[2].role !== 'assistant') throw new Error('第三条应为 assistant');
    if (mm.messages[2].content !== '') throw new Error(`LLM 失败时 assistant 应为空，实际 "${mm.messages[2].content}"`);
  });

  it('compact 前先 flush pendingInject', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' }
    ];
    mm.inject('待刷新内容');

    await mm.compact(new RandomModel(), 'game');

    if (mm.pendingInject.length !== 0) throw new Error('compact 后 pendingInject 应为空');
    if (mm.messages.length !== 3) throw new Error(`flush 再 compact 后应有 3 条消息，实际 ${mm.messages.length}`);
    const allContent = mm.messages.map(m => m.content).join('\n');
    if (!allContent.includes('待刷新内容')) throw new Error('compact 应包含 flush 的内容');
  });

  it('chat 模式使用 chat 提示词模板', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '聊天消息' },
      { role: 'assistant', content: '聊天回复' }
    ];

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (context) => {
        const msgs = Array.isArray(context) ? context : context._messagesForLLM;
        capturedPrompt = msgs[msgs.length - 1].content;
        return { choices: [{ message: { content: '聊天摘要' } }] };
      }
    };

    await mm.compact(fakeLLM, 'chat');

    if (!capturedPrompt.includes('聊天')) {
      throw new Error('chat 模式应使用聊天提示词模板');
    }
  });

  it('无 system 消息时退化压缩为 user + assistant([[...]])', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'user', content: '消息' },
      { role: 'assistant', content: '回复' }
    ];

    await mm.compact(new RandomModel(), 'game');

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[0].role !== 'user') throw new Error('第一条应为 user');
    if (mm.messages[1].role !== 'assistant') throw new Error('第二条应为 assistant');
    if (!mm.messages[1].content.startsWith('[[')) throw new Error('退化压缩应用 [[ 包裹');
    if (!mm.messages[1].content.includes('消息')) throw new Error('退化压缩应保留历史内容');
    if (!mm.messages[1].content.includes('回复')) throw new Error('退化压缩应保留历史内容');
  });
});

describe('inject/flush', () => {
  it('inject 追加内容到 pendingInject', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.inject('内容1');
    mm.inject('内容2');
    if (mm.pendingInject.length !== 2) throw new Error('pendingInject 应有 2 条');
    if (mm.messages.length !== 0) throw new Error('inject 不应直接修改 messages');
  });

  it('flush 将 pendingInject 合并为 user 消息并清空', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.inject('内容1');
    mm.inject('内容2');
    const content = mm.flush();
    if (mm.messages.length !== 1) throw new Error('flush 后应有 1 条消息');
    if (mm.messages[0].role !== 'user') throw new Error('flush 后消息应为 user 角色');
    if (mm.pendingInject.length !== 0) throw new Error('flush 后 pendingInject 应为空');
    if (!content.includes('内容1') || !content.includes('内容2')) throw new Error('flush 内容应包含所有注入文本');
  });

  it('空内容不注入', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.inject(null);
    mm.inject('');
    mm.inject(undefined);
    if (mm.pendingInject.length !== 0) throw new Error('空内容不应注入');
  });

  it('flush 无注入时返回 null', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const result = mm.flush();
    if (result !== null) throw new Error('无注入时 flush 应返回 null');
  });
});

describe('_buildLLMViewInternal', () => {
  it('无 parts 时返回 messages 的深拷贝', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '消息' }
    ];
    const view = mm._buildLLMViewInternal();
    if (view.length !== 2) throw new Error('view 长度应为 2');
    if (view === mm.messages) throw new Error('view 应为深拷贝');
  });

  it('有 parts 时：thinking 在开头，task 在末尾，原始内容在中间', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '游戏事件' }
    ];
    const parts = {
      thinking: '【行为逻辑】\n思考',
      speaking: '',
      task: '【白天发言】轮到你发言了'
    };
    const view = mm._buildLLMViewInternal(parts);
    if (view.length !== 2) throw new Error('view 长度应为 2');
    if (!view[1].content.startsWith('【行为逻辑】')) throw new Error('thinking 应在开头');
    if (!view[1].content.includes('游戏事件')) throw new Error('应包含原始内容');
    if (!view[1].content.includes('【白天发言】')) throw new Error('应包含 task');
    if (mm.messages[1].content !== '游戏事件') throw new Error('不应修改原始 messages');
  });

  it('仅有 thinking 时，只插入 thinking 到开头', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'user', content: '游戏事件' }
    ];
    const parts = {
      thinking: '【行为逻辑】\n思考',
      speaking: '',
      task: ''
    };
    const view = mm._buildLLMViewInternal(parts);
    if (view.length !== 1) throw new Error('view 长度应为 1');
    if (!view[0].content.startsWith('【行为逻辑】')) throw new Error('thinking 应在开头');
    if (!view[0].content.includes('游戏事件')) throw new Error('应包含原始内容');
  });

  it('最后一条非 user 时追加新 user', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'assistant', content: '分析' }
    ];
    const parts = {
      thinking: '【行为逻辑】\n思考',
      speaking: '',
      task: '【白天发言】轮到你发言了'
    };
    const view = mm._buildLLMViewInternal(parts);
    if (view.length !== 3) throw new Error('view 长度应为 3');
    if (view[2].role !== 'user') throw new Error('应追加 user');
  });
});

describe('destroy', () => {
  it('destroy 清空 messages 和 pendingInject', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [{ role: 'system', content: 'test' }];
    mm.inject('pending');
    mm._currentMode = 'game';

    mm.destroy();

    if (mm.messages.length !== 0) throw new Error('destroy 后 messages 应为空');
    if (mm.pendingInject.length !== 0) throw new Error('destroy 后 pendingInject 应为空');
    if (mm._currentMode !== 'chat') throw new Error('destroy 后 _currentMode 应为 chat');
  });
});

describe('updateSystem 与 _currentMode', () => {
  it('game 模式成功时设置 _currentMode', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const player = makePlayer();
    const game = { players: [], round: 1, effectiveRules: {} };

    mm.updateSystem(player, game, 'game');

    if (mm._currentMode !== 'game') throw new Error(`_currentMode 期望 'game', 实际 '${mm._currentMode}'`);
  });

  it('chat 模式成功时设置 _currentMode', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const player = makePlayer();

    mm.updateSystem(player, null, 'chat');

    if (mm._currentMode !== 'chat') throw new Error(`_currentMode 期望 'chat', 实际 '${mm._currentMode}'`);
  });

  it('game 模式无 role 时不更新 system 也不改 _currentMode', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm._currentMode = 'chat';
    const player = makePlayer({ role: null });

    mm.updateSystem(player, { players: [] }, 'game');

    if (mm._currentMode !== 'chat') throw new Error('game 模式无 role 时 _currentMode 应保持不变');
    if (mm.messages.length !== 0) throw new Error('game 模式无 role 时不应添加 system 消息');
  });

  it('无 player 时不更新', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm._currentMode = 'chat';

    mm.updateSystem(null, null, 'game');

    if (mm._currentMode !== 'chat') throw new Error('无 player 时 _currentMode 应保持不变');
    if (mm.messages.length !== 0) throw new Error('无 player 时不应添加 system 消息');
  });
});

run();