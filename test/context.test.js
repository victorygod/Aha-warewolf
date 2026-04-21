/**
 * 上下文格式化测试
 *
 * 运行方式: node test/context.test.js
 *
 * 测试场景:
 * === 阶段合并测试 ===
 * 1. 夜晚阶段合并为 "第N夜"
 * 2. 白天阶段合并为 "第N天"
 * 3. 子阶段标题：[狼人]、[警长竞选]、[发言]
 *
 * === 结构化数据优先测试 ===
 * 4. 死亡公告使用 deaths 数组
 * 5. 狼人投票使用 voteDetails 数组
 * 6. 技能动作优先使用 metadata
 * 7. 警长竞选使用 metadata
 *
 * === 格式化测试 ===
 * 8. 发言格式
 * 9. 技能动作格式
 * 10. 投票结果格式
 */

const assert = require('assert');
const {
  formatMessageHistory,
  formatSpeech,
  formatDeath,
  formatAction,
  formatWolfVoteResult,
  formatVoteResult,
  formatSheriffCandidates,
  getPlayerPosition,
  buildFullContext
} = require('../ai/context');
const { buildSystemPrompt, getPhasePrompt } = require('../ai/prompts');

// 测试用的玩家列表
const mockPlayers = [
  { id: 1, name: '小明', role: { id: 'seer', camp: 'good' } },
  { id: 2, name: '小红', role: { id: 'villager', camp: 'good' } },
  { id: 3, name: '小刚', role: { id: 'werewolf', camp: 'wolf' } },
  { id: 4, name: '小丽', role: { id: 'werewolf', camp: 'wolf' } },
  { id: 5, name: '小华', role: { id: 'witch', camp: 'good' } }
];

// ========== 测试工具 ==========

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failCount++;
  }
}

// ========== 阶段合并测试 ==========

console.log('\n=== 阶段合并测试 ===\n');

test('1. 夜晚阶段合并为 "第N夜"', () => {
  const messages = [
    { type: 'phase_start', content: '丘比特连线', phase: 'cupid' },
    { type: 'phase_start', content: '守卫守护', phase: 'guard' },
    { type: 'phase_start', content: '狼人讨论', phase: 'night_werewolf_discuss' },
    { type: 'wolf_speech', playerId: 3, playerName: '小刚', content: '刀5号吧' },
    { type: 'phase_start', content: '狼人投票', phase: 'night_werewolf_vote' },
    { type: 'wolf_vote_result', content: '狼人选择击杀 5号小华', voteDetails: [{ voter: '3号小刚', target: '5号小华' }] }
  ];

  // 模拟狼人玩家
  const wolfPlayer = mockPlayers.find(p => p.id === 3);
  const result = formatMessageHistory(messages, mockPlayers, wolfPlayer);

  // 只出现一次 "第1夜"
  const nightCount = (result.match(/第1夜/g) || []).length;
  assert.strictEqual(nightCount, 1, '应该只出现一次第1夜');

  // 不应该出现其他阶段标题
  assert(!result.includes('丘比特连线'), '不应出现丘比特连线');
  assert(!result.includes('守卫守护'), '不应出现守卫守护');
  assert(!result.includes('狼人投票'), '不应出现狼人投票');

  // 应该有 [狼人] 子标题（狼人玩家才显示）
  assert(result.includes('[狼人]'), '应该有 [狼人] 子标题');
});

test('2. 白天阶段合并为 "第N天"', () => {
  const messages = [
    { type: 'phase_start', content: '公布死讯', phase: 'day_announce' },
    { type: 'death_announce', content: '5号小华 死亡', deaths: [{ id: 5, name: '小华' }] },
    { type: 'phase_start', content: '警长竞选', phase: 'sheriff_campaign' },
    { type: 'sheriff_candidates', content: '警上：1号小明 | 警下：2号小红', meta: { onStage: [{ id: 1, name: '小明' }], offStage: [{ id: 2, name: '小红' }] } }
  ];

  const result = formatMessageHistory(messages, mockPlayers);

  // 只出现一次 "第1天"
  const dayCount = (result.match(/第1天/g) || []).length;
  assert.strictEqual(dayCount, 1, '应该只出现一次第1天');

  // 应该有 [警长竞选] 子标题
  assert(result.includes('[警长竞选]'), '应该有 [警长竞选] 子标题');
});

test('3. 多个夜晚/白天正确计数', () => {
  const messages = [
    { type: 'phase_start', content: '狼人讨论', phase: 'night_werewolf_discuss' },
    { type: 'phase_start', content: '白天发言', phase: 'day_discuss' },
    { type: 'phase_start', content: '狼人讨论', phase: 'night_werewolf_discuss' },
    { type: 'phase_start', content: '白天发言', phase: 'day_discuss' }
  ];

  const result = formatMessageHistory(messages, mockPlayers);

  assert(result.includes('第1夜'), '应该有第1夜');
  assert(result.includes('第1天'), '应该有第1天');
  assert(result.includes('第2夜'), '应该有第2夜');
  assert(result.includes('第2天'), '应该有第2天');
});

test('4. [发言] 子标题只在白天发言时出现', () => {
  const messages = [
    { type: 'phase_start', content: '白天发言', phase: 'day_discuss' },
    { type: 'speech', playerId: 1, playerName: '小明', content: '我是预言家' }
  ];

  const result = formatMessageHistory(messages, mockPlayers);

  assert(result.includes('[发言]'), '应该有 [发言] 子标题');
  assert(result.includes('1号小明:我是预言家'), '发言格式正确');
});

// ========== 结构化数据优先测试 ==========

console.log('\n=== 结构化数据优先测试 ===\n');

test('5. 死亡公告使用 deaths 数组', () => {
  const msg = {
    type: 'death_announce',
    content: '5号小华 死亡',
    deaths: [{ id: 5, name: '小华' }]
  };
  const result = formatDeath(msg, mockPlayers);
  assert.strictEqual(result, '[死亡公告]5号小华');
});

test('6. 多人死亡使用 deaths 数组', () => {
  const msg = {
    type: 'death_announce',
    content: '多人死亡',
    deaths: [{ id: 3, name: '小刚' }, { id: 5, name: '小华' }]
  };
  const result = formatDeath(msg, mockPlayers);
  assert.strictEqual(result, '[死亡公告]3号小刚、5号小华');
});

test('7. 狼人投票使用 voteDetails 数组', () => {
  const msg = {
    type: 'wolf_vote_result',
    content: '狼人选择击杀 5号小华',
    voteDetails: [
      { voter: '3号小刚', target: '5号小华' },
      { voter: '4号小丽', target: '5号小华' },
      { voter: '7号阿鹏', target: '1号小明' }
    ]
  };
  const result = formatWolfVoteResult(msg, mockPlayers);

  assert(result.includes('票型：'), '应该包含票型');
  assert(result.includes('5号小华（3号小刚、4号小丽）'), '应该显示投票者');
  assert(result.includes('最终击杀：5号小华'), '应该显示最终击杀');
});

test('8. 技能动作优先使用 metadata - 预言家查验', () => {
  const msg = {
    type: 'action',
    content: '你查验了 3号小刚，TA是狼人',
    playerId: 1,
    metadata: { targetId: 3, result: 'wolf' }
  };
  const result = formatAction(msg, mockPlayers);
  assert.strictEqual(result, '[预言家]1号小明:3号小刚=狼人');
});

test('9. 技能动作无 metadata 时使用文本匹配 - 守卫守护', () => {
  const msg = {
    type: 'action',
    content: '你守护了 2号小红',
    playerId: 2
  };
  const result = formatAction(msg, mockPlayers);
  assert.strictEqual(result, '[守卫]2号小红:守护2号小红');
});

test('10. 警长竞选使用 metadata', () => {
  const msg = {
    type: 'sheriff_candidates',
    content: '警上：1号小明 | 警下：2号小红',
    metadata: {
      onStage: [{ id: 1, name: '小明' }],
      offStage: [{ id: 2, name: '小红' }]
    }
  };
  const result = formatSheriffCandidates(msg, mockPlayers);
  assert.strictEqual(result, '上:1号小明 下:2号小红');
});

// ========== 格式化测试 ==========

console.log('\n=== 格式化测试 ===\n');

test('11. 发言格式：3号小刚:我是好人', () => {
  const msg = { type: 'speech', playerId: 3, playerName: '小刚', content: '我是好人' };
  const result = formatSpeech(msg, mockPlayers);
  assert.strictEqual(result, '3号小刚:我是好人');
});

test('12. 遗言格式：[遗言]3号小刚:我是狼', () => {
  const messages = [
    { type: 'last_words', playerId: 3, playerName: '小刚', content: '我是狼' }
  ];
  const result = formatMessageHistory(messages, mockPlayers);
  assert.strictEqual(result, '[遗言]3号小刚:我是狼');
});

test('13. 技能动作 - 女巫救人', () => {
  const msg = { type: 'action', content: '你使用解药救了 5号小华', playerId: 5 };
  const result = formatAction(msg, mockPlayers);
  assert.strictEqual(result, '[女巫]5号小华:救5号小华');
});

test('14. 技能动作 - 女巫毒人', () => {
  const msg = { type: 'action', content: '你毒杀了 3号小刚', playerId: 5 };
  const result = formatAction(msg, mockPlayers);
  assert.strictEqual(result, '[女巫]5号小华:毒3号小刚');
});

test('15. 技能动作 - 猎人开枪', () => {
  const msg = { type: 'action', content: '猎人 3号小刚 开枪带走了 7号阿鹏', playerId: 3 };
  const result = formatAction(msg, mockPlayers);
  assert.strictEqual(result, '[猎人]3号小刚:枪杀7号阿鹏');
});

test('16. 技能动作 - 丘比特连线', () => {
  const msg = { type: 'action', content: '你连接了 1号 和 4号 为情侣', playerId: 8 };
  const result = formatAction(msg, mockPlayers);
  assert.strictEqual(result, '[丘比特]?号:1号↔4号');
});

test('17. 投票结果格式', () => {
  const msg = {
    type: 'vote_result',
    content: '投票结果',
    voteDetails: [
      { voter: '1号小明', target: '3号小刚' },
      { voter: '2号小红', target: '3号小刚' },
      { voter: '4号小丽', target: '5号小华' }
    ]
  };
  const result = formatVoteResult(msg, mockPlayers);
  assert(result.includes('票型：'), '应该包含票型');
  assert(result.includes('3号小刚(1号小明,2号小红)'), '应该显示投票者');
});

test('17.1 女巫提示 - werewolfTarget为ID', () => {
  // 模拟 werewolfTarget 是玩家ID（数字）的情况
  const context = {
    game: { players: mockPlayers },
    alivePlayers: mockPlayers,
    werewolfTarget: 3,  // 玩家ID（数字）
    witchPotion: { heal: true, poison: true }
  };
  const result = getPhasePrompt('witch', context);
  assert(result.includes('3号小刚'), '应该显示被杀玩家名字');
  assert(result.includes('被狼人杀害'), '应该显示被狼人杀害');
});

test('17.2 女巫提示 - werewolfTarget为对象', () => {
  // 模拟 werewolfTarget 是玩家对象的情况
  const context = {
    game: { players: mockPlayers },
    alivePlayers: mockPlayers,
    werewolfTarget: { id: 3, name: '小刚' },  // 玩家对象
    witchPotion: { heal: true, poison: true }
  };
  const result = getPhasePrompt('witch', context);
  assert(result.includes('3号小刚'), '应该显示被杀玩家名字');
  assert(result.includes('被狼人杀害'), '应该显示被狼人杀害');
});

test('17.3 女巫提示 - werewolfTarget为空', () => {
  // 模拟没有被杀玩家的情况（平安夜）
  const context = {
    game: { players: mockPlayers },
    alivePlayers: mockPlayers,
    werewolfTarget: null,
    witchPotion: { heal: true, poison: true }
  };
  const result = getPhasePrompt('witch', context);
  assert(result.includes('无人'), '应该显示无人');
  assert(result.includes('被狼人杀害'), '应该显示被狼人杀害');
});

test('18. 系统消息 - 情侣信息', () => {
  const messages = [
    { type: 'system', content: '你和 4号 是情侣', playerId: 1 }
  ];
  const result = formatMessageHistory(messages, mockPlayers);
  assert(result.includes('[情侣]'), '应该包含情侣标签');
});

test('19. 系统消息 - 无人竞选警长', () => {
  const messages = [
    { type: 'system', content: '无人竞选警长' }
  ];
  const result = formatMessageHistory(messages, mockPlayers);
  assert(result.includes('[系统]无人竞选警长'), '应该包含系统消息');
});

test('20. 游戏结束', () => {
  const messages = [
    { type: 'game_over', content: '游戏结束，好人阵营获胜', winner: 'good' }
  ];
  const result = formatMessageHistory(messages, mockPlayers);
  assert(result.includes('[游戏结束]'), '应该包含游戏结束标签');
  assert(result.includes('好人阵营获胜'), '应该包含获胜信息');
});

// ========== 完整流程测试 ==========

console.log('\n=== 完整流程测试 ===\n');

test('21. 完整夜晚流程', () => {
  const messages = [
    { type: 'phase_start', content: '狼人讨论', phase: 'night_werewolf_discuss' },
    { type: 'wolf_speech', playerId: 3, playerName: '小刚', content: '刀5号吧' },
    { type: 'wolf_speech', playerId: 4, playerName: '小丽', content: '同意' },
    { type: 'phase_start', content: '狼人投票', phase: 'night_werewolf_vote' },
    { type: 'wolf_vote_result', content: '狼人选择击杀 5号小华', voteDetails: [
      { voter: '3号小刚', target: '5号小华' },
      { voter: '4号小丽', target: '5号小华' }
    ]},
    { type: 'phase_start', content: '女巫技能', phase: 'witch' },
    { type: 'action', content: '你使用解药救了 5号小华', playerId: 5 },
    { type: 'phase_start', content: '预言家查验', phase: 'seer' },
    { type: 'action', content: '你查验了 3号小刚，TA是狼人', playerId: 1, metadata: { targetId: 3, result: 'wolf' } }
  ];

  // 模拟狼人玩家，传入 currentPlayer
  const wolfPlayer = mockPlayers.find(p => p.id === 3);
  const result = formatMessageHistory(messages, mockPlayers, wolfPlayer);

  // 验证阶段合并
  const nightCount = (result.match(/第1夜/g) || []).length;
  assert.strictEqual(nightCount, 1, '应该只有一个第1夜');

  // 验证子标题（狼人玩家才显示）
  assert(result.includes('[狼人]'), '狼人玩家应该有 [狼人] 子标题');

  // 验证内容
  assert(result.includes('3号小刚:刀5号吧'), '狼人发言');
  assert(result.includes('票型：'), '票型');
  assert(result.includes('最终击杀：5号小华'), '最终击杀');
  assert(result.includes('[女巫]5号小华:救5号小华'), '女巫救人');
  assert(result.includes('[预言家]1号小明:3号小刚=狼人'), '预言家查验');

  // 不应该出现的标题
  assert(!result.includes('狼人投票'), '不应出现狼人投票标题');
  assert(!result.includes('女巫技能'), '不应出现女巫技能标题');
  assert(!result.includes('预言家查验'), '不应出现预言家查验标题');
});

test('22. 完整白天流程', () => {
  const messages = [
    { type: 'phase_start', content: '公布死讯', phase: 'day_announce' },
    { type: 'death_announce', content: '5号小华 死亡', deaths: [{ id: 5, name: '小华' }] },
    { type: 'phase_start', content: '警长竞选', phase: 'sheriff_campaign' },
    { type: 'sheriff_candidates', content: '警上：1号小明 | 警下：2号小红', metadata: {
      onStage: [{ id: 1, name: '小明' }],
      offStage: [{ id: 2, name: '小红' }]
    }},
    { type: 'speech', playerId: 1, playerName: '小明', content: '我是预言家' },
    { type: 'vote_result', content: '投票结果', voteDetails: [
      { voter: '2号小红', target: '1号小明' }
    ]},
    { type: 'sheriff_elected', content: '1号小明 当选警长', sheriffId: 1 },
    { type: 'phase_start', content: '白天发言', phase: 'day_discuss' },
    { type: 'speech', playerId: 1, playerName: '小明', content: '我验了3号是狼' }
  ];

  const result = formatMessageHistory(messages, mockPlayers);

  // 验证阶段合并
  const dayCount = (result.match(/第1天/g) || []).length;
  assert.strictEqual(dayCount, 1, '应该只有一个第1天');

  // 验证内容
  assert(result.includes('[死亡公告]5号小华'), '死亡公告');
  assert(result.includes('[警长竞选]'), '警长竞选子标题');
  assert(result.includes('上:1号小明 下:2号小红'), '警上警下');
  assert(result.includes('1号小明:我是预言家'), '竞选发言');
  assert(result.includes('[警长]1号小明当选'), '警长当选');
  assert(result.includes('[发言]'), '发言子标题');
  assert(result.includes('1号小明:我验了3号是狼'), '白天发言');
});

// ========== getPlayerPosition 测试 ==========

console.log('\n=== getPlayerPosition 测试 ===\n');

test('23. getPlayerPosition 正确获取位置', () => {
  assert.strictEqual(getPlayerPosition(1, mockPlayers), 1);
  assert.strictEqual(getPlayerPosition(3, mockPlayers), 3);
  assert.strictEqual(getPlayerPosition(5, mockPlayers), 5);
  assert.strictEqual(getPlayerPosition(99, mockPlayers), '?');
  assert.strictEqual(getPlayerPosition(null, mockPlayers), '?');
});

// ========== buildFullContext 测试 ==========

console.log('\n=== buildFullContext 测试 ===\n');

test('24. buildFullContext 返回完整上下文', () => {
  const player = mockPlayers[0];
  const game = { players: mockPlayers };
  const context = {
    phase: 'day_discuss',
    messages: [
      { type: 'phase_start', content: '白天发言', phase: 'day_discuss' },
      { type: 'speech', playerId: 2, playerName: '小红', content: '我是好人' }
    ],
    alivePlayers: mockPlayers
  };

  const result = buildFullContext(player, game, context);

  assert(result.systemPrompt, '应包含系统提示词');
  assert(result.historyText, '应包含消息历史');
  assert(result.phasePrompt, '应包含阶段提示词');
  assert(result.fullText, '应包含完整文本');
});

test('25. 空消息历史返回空字符串', () => {
  const result = formatMessageHistory([], mockPlayers);
  assert.strictEqual(result, '');
});

// ========== 输出测试结果 ==========

console.log('\n===================');
console.log(`测试完成: ${passCount} 通过, ${failCount} 失败`);
console.log('===================\n');

process.exit(failCount > 0 ? 1 : 0);