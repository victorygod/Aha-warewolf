/**
 * LLM Agent parseResponse 单元测试
 * 不调用真实 API，只测试响应解析逻辑
 *
 * 运行方式: node test/llm.test.js
 */

const { LLMAgent } = require('../ai/agents/llm');
const { GameEngine } = require('../engine/main');
const { BOARD_PRESETS } = require('../engine/config');
const { createPlayerRole } = require('../engine/roles');

// 创建最小 game 实例（供 normalizeTarget 使用）
function createMinimalGame() {
  const preset = BOARD_PRESETS['9-standard'];
  const game = new GameEngine({ presetId: '9-standard' });
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
  return game;
}

// 创建 LLMAgent 实例（不调 API）
function createLLMAgent() {
  const game = createMinimalGame();
  return new LLMAgent(1, game);
}

// 辅助：构造 mock API response
function mockResponse(text) {
  return { choices: [{ message: { content: text } }] };
}

// 辅助：构造 mock context
function mockContext(overrides = {}) {
  return {
    phase: 'witch',
    alivePlayers: [],
    ...overrides
  };
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

// ========== 测试用例 ==========

function test1_HealResponse() {
  console.log('\n=== 测试1: 女巫 heal 响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('```json\n{"type": "heal"}\n```'),
    mockContext({ phase: 'witch' })
  );
  assert(result.type === 'heal', `type 应为 heal，实际: ${result.type}`);
}

function test2_PoisonResponse() {
  console.log('\n=== 测试2: 女巫 poison 响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "poison", "target": 3}'),
    mockContext({ phase: 'witch' })
  );
  assert(result.type === 'poison', `type 应为 poison，实际: ${result.type}`);
  assert(result.target != null, `target 不应为 null`);
}

function test3_SkipResponse() {
  console.log('\n=== 测试3: 跳过响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "skip"}'),
    mockContext({ phase: 'witch' })
  );
  assert(result.type === 'skip', `type 应为 skip，实际: ${result.type}`);
}

function test4_WitchLegacyFormat() {
  console.log('\n=== 测试4: 女巫旧格式 witch + action ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "witch", "action": "heal"}'),
    mockContext({ phase: 'witch' })
  );
  assert(result.type === 'witch', `type 应为 witch，实际: ${result.type}`);
  assert(result.action === 'heal', `action 应为 heal，实际: ${result.action}`);
}

function test5_VoteResponse() {
  console.log('\n=== 测试5: 投票响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "vote", "target": 5}'),
    mockContext({ phase: 'day_vote' })
  );
  assert(result.type === 'vote', `type 应为 vote，实际: ${result.type}`);
  assert(result.target != null, `target 不应为 null`);
}

function test6_SpeechResponse() {
  console.log('\n=== 测试6: 发言响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "speech", "content": "我怀疑3号"}'),
    mockContext({ phase: 'day_discuss' })
  );
  assert(result.type === 'speech', `type 应为 speech，实际: ${result.type}`);
  assert(result.content === '我怀疑3号', `content 应为 "我怀疑3号"，实际: ${result.content}`);
}

function test7_CampaignResponse() {
  console.log('\n=== 测试7: 竞选响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "campaign", "run": true}'),
    mockContext({ phase: 'sheriff_campaign' })
  );
  assert(result.type === 'campaign', `type 应为 campaign，实际: ${result.type}`);
  assert(result.run === true, `run 应为 true，实际: ${result.run}`);
}

function test8_WithdrawResponse() {
  console.log('\n=== 测试8: 退水响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "withdraw", "withdraw": true}'),
    mockContext({ phase: 'sheriff_speech' })
  );
  assert(result.type === 'withdraw', `type 应为 withdraw，实际: ${result.type}`);
  assert(result.withdraw === true, `withdraw 应为 true，实际: ${result.withdraw}`);
}

function test9_ShootResponse() {
  console.log('\n=== 测试9: 猎人开枪响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "shoot", "target": 4}'),
    mockContext({ phase: 'shoot' })
  );
  assert(result.type === 'shoot', `type 应为 shoot，实际: ${result.type}`);
  assert(result.target != null, `target 不应为 null`);
}

function test10_PassBadgeResponse() {
  console.log('\n=== 测试10: 传警徽响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "passBadge", "target": 7}'),
    mockContext({ phase: 'passBadge' })
  );
  assert(result.type === 'passBadge', `type 应为 passBadge，实际: ${result.type}`);
  assert(result.target != null, `target 不应为 null`);
}

function test11_AssignOrderResponse() {
  console.log('\n=== 测试11: 指定发言顺序响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "assignOrder", "target": 2}'),
    mockContext({ phase: 'assignOrder' })
  );
  assert(result.type === 'assignOrder', `type 应为 assignOrder，实际: ${result.type}`);
  assert(result.target != null, `target 不应为 null`);
}

function test12_CupidResponse() {
  console.log('\n=== 测试12: 丘比特连线响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "cupid", "targets": [3, 7]}'),
    mockContext({ phase: 'cupid' })
  );
  assert(result.type === 'cupid', `type 应为 cupid，实际: ${result.type}`);
  assert(result.targetIds?.length === 2, `targetIds 长度应为 2，实际: ${result.targetIds?.length}`);
}

function test13_TargetResponse() {
  console.log('\n=== 测试13: target 类型响应 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('{"type": "target", "target": 6}'),
    mockContext({ phase: 'seer' })
  );
  assert(result.type === 'target', `type 应为 target，实际: ${result.type}`);
  assert(result.target != null, `target 不应为 null`);
}

function test14_FallbackSpeech() {
  console.log('\n=== 测试14: 无法解析时发言阶段回退 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('我觉得3号很可疑'),
    mockContext({ phase: 'day_discuss' })
  );
  assert(result.type === 'speech', `type 应为 speech（回退），实际: ${result.type}`);
}

function test15_FallbackSkip() {
  console.log('\n=== 测试15: 无法解析时非发言阶段回退 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('随便吧'),
    mockContext({ phase: 'witch' })
  );
  assert(result.type === 'skip', `type 应为 skip（回退），实际: ${result.type}`);
}

function test16_HealWithMarkdown() {
  console.log('\n=== 测试16: heal 响应带 markdown 代码块 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('```json\n{"type": "heal"}\n```'),
    mockContext({ phase: 'witch' })
  );
  assert(result.type === 'heal', `type 应为 heal，实际: ${result.type}`);
}

function test17_PoisonWithMarkdown() {
  console.log('\n=== 测试17: poison 响应带 markdown 代码块 ===');
  const agent = createLLMAgent();
  const result = agent.parseResponse(
    mockResponse('```json\n{"type": "poison", "target": 5}\n```'),
    mockContext({ phase: 'witch' })
  );
  assert(result.type === 'poison', `type 应为 poison，实际: ${result.type}`);
  assert(result.target != null, `target 不应为 null`);
}

// ========== 运行 ==========

console.log('========================================');
console.log('LLM Agent parseResponse 单元测试');
console.log('（不调用真实 API）');
console.log('========================================');

test1_HealResponse();
test2_PoisonResponse();
test3_SkipResponse();
test4_WitchLegacyFormat();
test5_VoteResponse();
test6_SpeechResponse();
test7_CampaignResponse();
test8_WithdrawResponse();
test9_ShootResponse();
test10_PassBadgeResponse();
test11_AssignOrderResponse();
test12_CupidResponse();
test13_TargetResponse();
test14_FallbackSpeech();
test15_FallbackSkip();
test16_HealWithMarkdown();
test17_PoisonWithMarkdown();

console.log('\n========================================');
console.log(`通过: ${passed}/${passed + failed}`);
if (failed > 0) {
  console.log(`失败: ${failed}`);
  process.exit(1);
}
console.log('========================================');