const { describe, it, beforeEach, run } = require('../../helpers/test-runner');

describe('MessageManager - 基础结构', () => {
  it('MessageManager模块可导入', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    if (!MessageManager) throw new Error('MessageManager应可导入');
  });

  it('创建实例', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    if (!mm) throw new Error('应能创建实例');
  });

  it('初始状态无消息', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    if (mm.messages && mm.messages.length > 0) throw new Error('初始应无消息');
  });
});

describe('MessageManager - updateSystem', () => {
  it('更新系统消息', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {} };
    const game = { players: [], round: 1, effectiveRules: {} };
    mm.updateSystem(player, game);
    if (!mm.messages || mm.messages.length === 0) throw new Error('应有系统消息');
  });
});

describe('MessageManager - inject/flush', () => {
  it('inject + flush 追加消息到 messages', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {} };
    const game = { players: [], round: 1, effectiveRules: {} };
    mm.updateSystem(player, game);
    const beforeLen = mm.messages.length;
    mm.inject('测试消息1');
    mm.inject('测试消息2');
    const flushed = mm.flush();
    if (mm.messages.length <= beforeLen) throw new Error('消息应增加');
    if (mm.messages[mm.messages.length - 1].role !== 'user') throw new Error('flush 追加应为 user 消息');
    if (!flushed.includes('测试消息1')) throw new Error('flush 内容应包含注入的文本');
    if (!flushed.includes('测试消息2')) throw new Error('flush 内容应包含注入的文本');
  });

  it('inject 空内容不追加', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    mm.inject(null);
    mm.inject('');
    mm.inject(undefined);
    if (mm.pendingInject.length !== 0) throw new Error('空内容不应注入');
  });

  it('flush 无注入时返回 null', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    const result = mm.flush();
    if (result !== null) throw new Error('无注入时 flush 应返回 null');
  });
});

run();