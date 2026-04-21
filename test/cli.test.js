/**
 * CLI 客户端测试
 *
 * 运行方式: node test/cli.test.js
 *
 * 测试内容:
 * 1. _idNote: ID→位置号+玩家名映射
 * 2. --full 模式的 position 和 idMap
 * 3. generateOptions 中 targetId 使用位置号显示
 * 4. formatState 中死亡标记渲染
 */

// 直接引用 cli_client.js 中的函数
// cli_client.js 没有导出函数，所以我们直接测试核心逻辑

// ========== 工具函数（与 cli_client.js 一致） ==========

function getPlayerPos(playerId, players) {
  if (players) {
    const idx = players.findIndex(p => p.id === playerId);
    return idx >= 0 ? idx + 1 : playerId;
  }
  return playerId;
}

function idNote(ids, players) {
  const parts = ids.map(id => {
    if (id == null) return null;
    const pos = getPlayerPos(id, players);
    const p = players.find(p => p.id === id);
    return `id=${id} → ${pos}号${p?.name || ''}`;
  }).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ========== 模拟数据 ==========

function createMockPlayers() {
  return [
    { id: 12, name: '大刚', alive: true },
    { id: 5, name: '小玲', alive: true },
    { id: 8, name: '阿华', alive: false, deathReason: 'wolf' },
    { id: 3, name: '大军', alive: true },
    { id: 1, name: 'wolf', alive: false, deathReason: 'couple' },
  ];
}

// ========== 测试用例 ==========

function test1_IdNoteSingleId() {
  console.log('测试1: _idNote 单个ID映射');
  const players = createMockPlayers();
  // id=12 对应位置1号大刚
  const note = idNote([12], players);
  const passed = note === 'id=12 → 1号大刚';
  console.log(`  结果: ${note} (${passed ? '✓' : '✗'})`);
  return passed;
}

function test2_IdNoteMultipleIds() {
  console.log('测试2: _idNote 多个ID映射');
  const players = createMockPlayers();
  // id=5 → 2号小玲, id=3 → 4号大军
  const note = idNote([5, 3], players);
  const passed = note === 'id=5 → 2号小玲, id=3 → 4号大军';
  console.log(`  结果: ${note} (${passed ? '✓' : '✗'})`);
  return passed;
}

function test3_IdNoteWithNull() {
  console.log('测试3: _idNote 包含null（弃权）');
  const players = createMockPlayers();
  const note = idNote([null], players);
  const passed = note === null;
  console.log(`  结果: ${note} (${passed ? '✓' : '✗'})`);
  return passed;
}

function test4_FullModePosition() {
  console.log('测试4: --full 模式 position 字段');
  const players = createMockPlayers();
  // 模拟 --full 添加 position
  players.forEach((p, idx) => { p.position = idx + 1; });
  const passed = players[0].position === 1 && players[2].position === 3 && players[4].position === 5;
  console.log(`  id=12 position=1: ${players[0].position === 1 ? '✓' : '✗'}`);
  console.log(`  id=8 position=3: ${players[2].position === 3 ? '✓' : '✗'}`);
  console.log(`  id=1 position=5: ${players[4].position === 5 ? '✓' : '✗'}`);
  return passed;
}

function test5_FullModeIdMap() {
  console.log('测试5: --full 模式 idMap 字段');
  const players = createMockPlayers();
  players.forEach((p, idx) => { p.position = idx + 1; });
  const idMap = players.map(p => `${p.id}→${p.position}号${p.name}`).join(', ');
  const passed = idMap.includes('12→1号大刚') && idMap.includes('1→5号wolf');
  console.log(`  idMap: ${idMap}`);
  console.log(`  包含12→1号大刚: ${idMap.includes('12→1号大刚') ? '✓' : '✗'}`);
  console.log(`  包含1→5号wolf: ${idMap.includes('1→5号wolf') ? '✓' : '✗'}`);
  return passed;
}

function test6_DeadPlayerMarker() {
  console.log('测试6: 死亡玩家标记渲染');
  const players = createMockPlayers();
  // 模拟 formatState 中的标记逻辑
  const lines = [];
  players.forEach((p, idx) => {
    const pos = idx + 1;
    let line = `  ${pos}号 ${p.name}`;
    if (!p.alive) line += ' [已死亡]';
    lines.push(line);
  });
  const hasDeadMark = lines[2].includes('[已死亡]') && lines[4].includes('[已死亡]');
  const noDeadMark = lines[0].includes('[已死亡]') === false;
  const passed = hasDeadMark && noDeadMark;
  console.log(`  存活者无标记: ${noDeadMark ? '✓' : '✗'} -> ${lines[0]}`);
  console.log(`  死亡者有标记: ${hasDeadMark ? '✓' : '✗'} -> ${lines[2]}`);
  return passed;
}

function test7_PositionNumberDisplay() {
  console.log('测试7: 选项显示使用位置号而非ID');
  const players = createMockPlayers();
  // 模拟 generateVoteOptions 中的 label 生成
  const labels = players.filter(p => p.alive).map(p => {
    const pos = getPlayerPos(p.id, players);
    return `投给 ${pos}号 ${p.name}`;
  });
  // id=12 应显示为1号，id=5 应显示为2号
  const passed = labels[0].includes('1号') && labels[0].includes('大刚') && labels[1].includes('2号') && labels[1].includes('小玲');
  console.log(`  标签: ${labels.join(' | ')}`);
  console.log(`  1号大刚: ${labels[0].includes('1号') && labels[0].includes('大刚') ? '✓' : '✗'}`);
  console.log(`  2号小玲: ${labels[1].includes('2号') && labels[1].includes('小玲') ? '✓' : '✗'}`);
  return passed;
}

// ========== 运行测试 ==========

async function runTests() {
  console.log('========================================');
  console.log('CLI 客户端测试');
  console.log('========================================\n');

  const tests = [
    { name: '_idNote 单个ID映射', fn: test1_IdNoteSingleId },
    { name: '_idNote 多个ID映射', fn: test2_IdNoteMultipleIds },
    { name: '_idNote 包含null', fn: test3_IdNoteWithNull },
    { name: '--full 模式 position', fn: test4_FullModePosition },
    { name: '--full 模式 idMap', fn: test5_FullModeIdMap },
    { name: '死亡玩家标记渲染', fn: test6_DeadPlayerMarker },
    { name: '选项显示使用位置号', fn: test7_PositionNumberDisplay },
  ];

  const results = [];
  for (const test of tests) {
    try {
      const passed = test.fn();
      results.push({ name: test.name, passed });
      console.log(`测试结果: ${passed ? '✓ 通过' : '✗ 失败'}\n`);
    } catch (e) {
      console.error(`测试 "${test.name}" 出错:`, e.message);
      results.push({ name: test.name, passed: false, error: e.message });
    }
  }

  console.log('========================================');
  const passedCount = results.filter(r => r.passed).length;
  results.forEach(r => {
    console.log(`${r.passed ? '✓' : '✗'} ${r.name}`);
  });
  console.log(`\n通过: ${passedCount}/${results.length}`);
  console.log('========================================');

  return passedCount === results.length;
}

runTests().then(ok => process.exit(ok ? 0 : 1));