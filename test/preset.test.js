/**
 * 板子（Preset）系统测试
 *
 * 运行方式: node test/preset.test.js
 *
 * 测试覆盖：
 * 1. BOARD_PRESETS 结构完整性
 * 2. getEffectiveRules 合并逻辑
 * 3. GameEngine preset 相关行为
 * 4. canShootIfPoisoned 配置生效
 * 5. AI prompt 与 preset ruleDescriptions 同步
 * 6. 守卫 allowRepeatGuard 配置生效
 * 7. 女巫 canSelfHeal 配置生效
 */

const { BOARD_PRESETS, getEffectiveRules, RULES } = require('../engine/config');
const { GameEngine } = require('../engine/main');
const { createPlayerRole } = require('../engine/roles');
const { PhaseManager } = require('../engine/phase');
const { AIManager } = require('../ai/controller');
const { buildSystemPrompt } = require('../ai/prompts');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(message);
    console.log(`  ✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    errors.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ========================
// 1. BOARD_PRESETS 结构完整性
// ========================
console.log('\n=== 1. BOARD_PRESETS 结构完整性 ===');

// 每个预设必须有 name, description, playerCount, roles, rules, ruleDescriptions
for (const [id, preset] of Object.entries(BOARD_PRESETS)) {
  assert(typeof preset.name === 'string' && preset.name.length > 0, `${id}: name 应为非空字符串`);
  assert(typeof preset.description === 'string' && preset.description.length > 0, `${id}: description 应为非空字符串`);
  assert(typeof preset.playerCount === 'number' && preset.playerCount > 0, `${id}: playerCount 应为正整数`);
  assert(Array.isArray(preset.roles) && preset.roles.length > 0, `${id}: roles 应为非空数组`);
  assertEqual(preset.roles.length, preset.playerCount, `${id}: roles 长度应等于 playerCount`);
  assert(typeof preset.rules === 'object' && preset.rules !== null, `${id}: rules 应为对象`);
  assert(Array.isArray(preset.ruleDescriptions) && preset.ruleDescriptions.length > 0, `${id}: ruleDescriptions 应为非空数组`);

  // roles 中的角色都应是合法角色
  const validRoles = ['werewolf', 'seer', 'witch', 'guard', 'hunter', 'villager', 'idiot', 'cupid'];
  for (const role of preset.roles) {
    assert(validRoles.includes(role), `${id}: 角色 "${role}" 应为合法角色`);
  }
}

// 预设 ID 格式检查
const presetIds = Object.keys(BOARD_PRESETS);
assert(presetIds.includes('9-standard'), '应包含 9-standard 预设');
assert(presetIds.includes('12-hunter-idiot'), '应包含 12-hunter-idiot 预设');
assert(presetIds.includes('12-guard-cupid'), '应包含 12-guard-cupid 预设');

// 9人标准局角色配置
const p9 = BOARD_PRESETS['9-standard'];
assertEqual(p9.playerCount, 9, '9人局 playerCount 应为 9');
const wolfCount9 = p9.roles.filter(r => r === 'werewolf').length;
assertEqual(wolfCount9, 3, '9人局应有3个狼人');
assert(p9.roles.includes('seer'), '9人局应有预言家');
assert(p9.roles.includes('witch'), '9人局应有女巫');
assert(p9.roles.includes('hunter'), '9人局应有猎人');
assert(!p9.roles.includes('guard'), '9人局不应有守卫');
assert(!p9.roles.includes('idiot'), '9人局不应有白痴');
assert(!p9.roles.includes('cupid'), '9人局不应有丘比特');

// 12人预女猎白角色配置
const p12hi = BOARD_PRESETS['12-hunter-idiot'];
assertEqual(p12hi.playerCount, 12, '12人预女猎白 playerCount 应为 12');
const wolfCount12hi = p12hi.roles.filter(r => r === 'werewolf').length;
assertEqual(wolfCount12hi, 4, '12人预女猎白应有4个狼人');
assert(p12hi.roles.includes('idiot'), '12人预女猎白应有白痴');
assert(!p12hi.roles.includes('guard'), '12人预女猎白不应有守卫');
assert(!p12hi.roles.includes('cupid'), '12人预女猎白不应有丘比特');

// 12人守丘局角色配置
const p12gc = BOARD_PRESETS['12-guard-cupid'];
assertEqual(p12gc.playerCount, 12, '12人守丘局 playerCount 应为 12');
const wolfCount12gc = p12gc.roles.filter(r => r === 'werewolf').length;
assertEqual(wolfCount12gc, 4, '12人守丘局应有4个狼人');
assert(p12gc.roles.includes('guard'), '12人守丘局应有守卫');
assert(p12gc.roles.includes('cupid'), '12人守丘局应有丘比特');
assert(!p12gc.roles.includes('idiot'), '12人守丘局不应有白痴');

// ========================
// 2. getEffectiveRules 合并逻辑
// ========================
console.log('\n=== 2. getEffectiveRules 合并逻辑 ===');

// 基本合并：preset rules 覆盖 RULES 默认值
const rules9 = getEffectiveRules(BOARD_PRESETS['9-standard']);
assertEqual(rules9.witch.canSelfHeal, true, '9人局: canSelfHeal 应为 true（preset 覆盖）');
assertEqual(rules9.hunter.canShootIfPoisoned, false, '9人局: canShootIfPoisoned 应为 false（preset 覆盖）');
assertEqual(rules9.sheriff.enabled, true, '9人局: sheriff.enabled 应为 true');

// 12人守丘局的守卫规则
const rules12gc = getEffectiveRules(BOARD_PRESETS['12-guard-cupid']);
assertEqual(rules12gc.guard.allowRepeatGuard, false, '12人守丘局: allowRepeatGuard 应为 false（preset 覆盖）');
assertEqual(rules12gc.hunter.canShootIfPoisoned, false, '12人守丘局: canShootIfPoisoned 应为 false');

// 未被覆盖的规则保持默认值
assertEqual(rules9.witch.canUseBothSameNight, true, '9人局: canUseBothSameNight 应保持 preset 值 true');

// preset 没有覆盖的 category 保持 RULES 默认值
// 9人局没有 guard 规则覆盖，应保持 RULES 默认值
assertEqual(rules9.guard.allowRepeatGuard, RULES.guard.allowRepeatGuard,
  '9人局: guard.allowRepeatGuard 应保持 RULES 默认值（因为 preset 无守卫角色不覆盖）');

// 深合并不影响其他字段
assertEqual(rules9.witch.canSelfHeal, true, '合并不应影响同 category 的其他字段');

// 空 rules 的 preset 应返回 RULES 的深拷贝
const emptyRulesPreset = { rules: {} };
const emptyRules = getEffectiveRules(emptyRulesPreset);
assertEqual(emptyRules.witch.canSelfHeal, RULES.witch.canSelfHeal,
  '空 rules 的 preset 应保持 RULES 默认值');

// 合并结果不应修改原 RULES
const originalCanSelfHeal = RULES.witch.canSelfHeal;
const customPreset = { rules: { witch: { canSelfHeal: false } } };
getEffectiveRules(customPreset);
assertEqual(RULES.witch.canSelfHeal, originalCanSelfHeal,
  'getEffectiveRules 不应修改原 RULES 对象');

// ========================
// 3. GameEngine preset 相关行为
// ========================
console.log('\n=== 3. GameEngine preset 相关行为 ===');

// 有 presetId 的 GameEngine
const game9 = new GameEngine({ presetId: '9-standard' });
assertEqual(game9.presetId, '9-standard', 'GameEngine 应存储 presetId');
assert(game9.preset !== null, 'GameEngine 应存储 preset 对象');
assertEqual(game9.preset.name, '9人标准局', 'GameEngine preset.name 应正确');
assertEqual(game9.playerCount, 9, '有 preset 时 playerCount 从 preset 派生');
assert(game9.effectiveRules !== null, 'GameEngine 应计算 effectiveRules');
assertEqual(game9.effectiveRules.hunter.canShootIfPoisoned, false,
  'GameEngine effectiveRules 应反映 preset 规则');

// 无 presetId 的 GameEngine
const gameNoPreset = new GameEngine();
assertEqual(gameNoPreset.presetId, null, '无 presetId 时 presetId 为 null');
assertEqual(gameNoPreset.preset, null, '无 presetId 时 preset 为 null');
assertEqual(gameNoPreset.playerCount, 9, '无 preset 时 playerCount 默认为 9');
assert(gameNoPreset.effectiveRules !== null, '无 preset 时也应计算 effectiveRules');
assertEqual(gameNoPreset.effectiveRules.witch.canSelfHeal, RULES.witch.canSelfHeal,
  '无 preset 时 effectiveRules 应为 RULES 的深拷贝');

// 手动设置 playerCount 优先于 preset
const gameOverride = new GameEngine({ presetId: '9-standard' });
gameOverride.playerCount = 7;
assertEqual(gameOverride.playerCount, 7, '手动设置 playerCount 应优先于 preset');

// 不存在的 presetId: GameEngine 不抛错，但 preset 为 null（BOARD_PRESETS['nonexistent'] = undefined）
const gameBad = new GameEngine({ presetId: 'nonexistent' });
assertEqual(gameBad.preset, undefined, '不存在的 presetId 时 preset 应为 undefined');
assertEqual(gameBad.presetId, 'nonexistent', 'presetId 仍存储传入的值');

// getState 返回 preset 信息
const gameForState = new GameEngine({ presetId: '9-standard' });
gameForState.players = [];
const state = gameForState.getState();
assert(state.preset !== null, 'getState 应返回 preset 信息');
assertEqual(state.preset.id, '9-standard', 'getState preset.id 应正确');
assertEqual(state.preset.name, '9人标准局', 'getState preset.name 应正确');
assert(typeof state.preset.ruleDescriptions !== 'undefined',
  'getState 应包含 ruleDescriptions');

// 12人局的 GameEngine
const game12 = new GameEngine({ presetId: '12-guard-cupid' });
assertEqual(game12.playerCount, 12, '12人局 playerCount 应为 12');
assertEqual(game12.effectiveRules.guard.allowRepeatGuard, false,
  '12人守丘局 effectiveRules 应包含守卫规则');

// ========================
// 4. canShootIfPoisoned 配置生效
// ========================
console.log('\n=== 4. canShootIfPoisoned 配置生效 ===');

// 创建一个 canShootIfPoisoned = true 的测试场景
function createTestGameWithRules(presetId, ruleOverrides) {
  const preset = BOARD_PRESETS[presetId];
  if (!preset) throw new Error(`未知的板子: ${presetId}`);
  const game = new GameEngine({ presetId });

  // 手动修改 effectiveRules 来测试
  if (ruleOverrides) {
    for (const [category, overrides] of Object.entries(ruleOverrides)) {
      game.effectiveRules[category] = { ...game.effectiveRules[category], ...overrides };
    }
  }

  for (let i = 0; i < preset.playerCount; i++) {
    const role = createPlayerRole(preset.roles[i]);
    game.players.push({
      id: i + 1,
      name: `玩家${i + 1}`,
      alive: true,
      isAI: true,
      role,
      state: role.state ? { ...role.state } : {}
    });
  }

  const aiManager = new AIManager(game);
  const mockAgents = {};
  game.players.forEach(p => {
    const controller = aiManager.createAI(p.id, { agentType: 'mock' });
    const mockAgent = controller.getMockAgent();
    mockAgent.setResponses({
      speak: { content: '过。' },
      last_words: { content: '过。' },
      sheriff_speech: { content: '过。' },
      vote: { targetId: 1 },
      wolf_vote: { targetId: 5 },
      sheriff_vote: { targetId: 1 },
      campaign: { run: false },
      withdraw: { withdraw: false },
      guard: { targetId: 1 },
      seer: { targetId: 1 },
      witch: { action: 'skip' },
      shoot: { targetId: 1 },
      passBadge: { targetId: null },
      cupid: { targetIds: [1, 2] },
      assignOrder: { target: 1 }
    });
    mockAgents[p.id] = mockAgent;
  });

  game.getAIController = (id) => aiManager.get(id);
  game.phaseManager = new PhaseManager(game);
  return { game, aiControllers: mockAgents };
}

// 默认9人局 canShootIfPoisoned = false，被毒不能开枪
{
  const { game } = createTestGameWithRules('9-standard', {});
  const hunter = game.players.find(p => p.role.id === 'hunter');
  assert(hunter !== undefined, '9人局应有猎人');

  // 模拟被毒
  hunter.alive = false;
  const canUse = hunter.role.skills.shoot.canUse(hunter, game, { deathReason: 'poison' });
  assertEqual(canUse, false, 'canShootIfPoisoned=false 时被毒不能开枪');
}

// canShootIfPoisoned = true 时被毒能开枪
{
  const { game } = createTestGameWithRules('9-standard', { hunter: { canShootIfPoisoned: true } });
  const hunter = game.players.find(p => p.role.id === 'hunter');

  hunter.alive = false;
  const canUse = hunter.role.skills.shoot.canUse(hunter, game, { deathReason: 'poison' });
  assertEqual(canUse, true, 'canShootIfPoisoned=true 时被毒能开枪');
}

// 被刀（非毒）时无论配置如何都能开枪
{
  const { game } = createTestGameWithRules('9-standard', {});
  const hunter = game.players.find(p => p.role.id === 'hunter');

  hunter.alive = false;
  const canUse = hunter.role.skills.shoot.canUse(hunter, game, { deathReason: 'werewolf' });
  assertEqual(canUse, true, '被刀时无论 canShootIfPoisoned 配置如何都能开枪');
}

// 被公投时能开枪
{
  const { game } = createTestGameWithRules('9-standard', {});
  const hunter = game.players.find(p => p.role.id === 'hunter');

  hunter.alive = false;
  const canUse = hunter.role.skills.shoot.canUse(hunter, game, { deathReason: 'vote' });
  assertEqual(canUse, true, '被公投时能开枪');
}

// ========================
// 5. AI prompt 与 preset ruleDescriptions 同步
// ========================
console.log('\n=== 5. AI prompt 与 preset ruleDescriptions 同步 ===');

// 有 preset 时 prompt 应包含 ruleDescriptions
{
  const game = new GameEngine({ presetId: '9-standard' });
  game.players = [{
    id: 1, name: '测试玩家', alive: true, isAI: true,
    role: createPlayerRole('werewolf'),
    state: { isWolf: true }
  }];
  const player = game.players[0];
  const prompt = buildSystemPrompt(player, game);
  assert(prompt.includes('规则:'), '有 preset 时 prompt 应包含 "规则:"');
  assert(prompt.includes('女巫仅首夜可自救'), '9人局 prompt 应包含女巫自救规则');
  assert(prompt.includes('猎人被毒不能开枪'), '9人局 prompt 应包含猎人开枪规则');
}

// 不同 preset 的 ruleDescriptions 不同
{
  const game9 = new GameEngine({ presetId: '9-standard' });
  game9.players = [{
    id: 1, name: '测试', alive: true, isAI: true,
    role: createPlayerRole('werewolf'), state: { isWolf: true }
  }];

  const game12gc = new GameEngine({ presetId: '12-guard-cupid' });
  game12gc.players = [{
    id: 1, name: '测试', alive: true, isAI: true,
    role: createPlayerRole('werewolf'), state: { isWolf: true }
  }];

  const prompt9 = buildSystemPrompt(game9.players[0], game9);
  const prompt12gc = buildSystemPrompt(game12gc.players[0], game12gc);

  assert(!prompt9.includes('守卫不可连守'), '9人局 prompt 不应包含守卫连守规则');
  assert(prompt12gc.includes('守卫不可连守'), '12人守丘局 prompt 应包含守卫连守规则');
  assert(prompt12gc.includes('同守同救则死亡'), '12人守丘局 prompt 应包含同守同救规则');
  assert(prompt12gc.includes('情侣一方死亡另一方殉情'), '12人守丘局 prompt 应包含情侣殉情规则');
}

// 无 preset 时 prompt 不应包含规则
{
  const game = new GameEngine({ presetId: '9-standard' });
  // 清除 preset 使其不包含规则描述
  game.preset = null;
  game.players = [{
    id: 1, name: '测试', alive: true, isAI: true,
    role: createPlayerRole('werewolf'), state: { isWolf: true }
  }];
  const prompt = buildSystemPrompt(game.players[0], game);
  assert(!prompt.includes('规则:'), '无 preset 时 prompt 不应包含 "规则:"');
}

// ========================
// 6. 守卫 allowRepeatGuard 配置生效
// ========================
console.log('\n=== 6. 守卫 allowRepeatGuard 配置生效 ===');

// 12人守丘局 allowRepeatGuard = false，不能连续守同一人
{
  const { game } = createTestGameWithRules('12-guard-cupid', {});
  const guard = game.players.find(p => p.role.id === 'guard');
  assert(guard !== undefined, '12人守丘局应有守卫');

  // 模拟上一轮守了1号
  guard.state.lastGuardTarget = 1;
  // 检查能否再守1号
  const target = game.players[0]; // 1号
  const canGuard = guard.role.skills.guard.validate(target, guard, game);
  assertEqual(canGuard, false, 'allowRepeatGuard=false 时不能连续守同一人');
}

// allowRepeatGuard = true 时能连续守同一人
{
  const { game } = createTestGameWithRules('12-guard-cupid', { guard: { allowRepeatGuard: true } });
  const guard = game.players.find(p => p.role.id === 'guard');

  guard.state.lastGuardTarget = 1;
  const target = game.players[0];
  const canGuard = guard.role.skills.guard.validate(target, guard, game);
  assertEqual(canGuard, true, 'allowRepeatGuard=true 时能连续守同一人');
}

// 守不同人无论配置都可以
{
  const { game } = createTestGameWithRules('12-guard-cupid', {});
  const guard = game.players.find(p => p.role.id === 'guard');

  guard.state.lastGuardTarget = 1;
  const target = game.players[1]; // 2号
  const canGuard = guard.role.skills.guard.validate(target, guard, game);
  assertEqual(canGuard, true, '守不同人无论配置都可以');
}

// ========================
// 7. 女巫 canSelfHeal 配置生效
// ========================
console.log('\n=== 7. 女巫 canSelfHeal 配置生效 ===');

// 9人局 canSelfHeal = true（首夜可自救）
{
  const game = new GameEngine({ presetId: '9-standard' });
  assertEqual(game.effectiveRules.witch.canSelfHeal, true,
    '9人局 canSelfHeal 应为 true');
}

// canSelfHeal = false 时不能自救
{
  const { game } = createTestGameWithRules('9-standard', { witch: { canSelfHeal: false } });
  const witch = game.players.find(p => p.role.id === 'witch');
  assert(witch !== undefined, '9人局应有女巫');

  // canSelfHeal=false 时，即使首夜也不能自救
  game.nightCount = 1;
  const canSelfHeal = game.effectiveRules.witch.canSelfHeal;
  assertEqual(canSelfHeal, false, 'canSelfHeal=false 时不能自救');
}

// canSelfHeal=true 时首夜可自救（实际行为由 phase.js 控制）
{
  const game = new GameEngine({ presetId: '9-standard' });
  assertEqual(game.effectiveRules.witch.canSelfHeal, true,
    '9人局 canSelfHeal 默认为 true');
}

// ========================
// 汇总
// ========================
console.log('\n============================');
console.log(`通过: ${passed}, 失败: ${failed}`);
if (errors.length > 0) {
  console.log('\n失败详情:');
  errors.forEach(e => console.log(`  - ${e}`));
  process.exit(1);
} else {
  console.log('全部通过!');
}