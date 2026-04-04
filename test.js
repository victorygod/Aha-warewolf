/**
 * 狼人杀游戏 API 测试脚本
 * 测试人类玩家和 AI 玩家的各种行为
 */

const BASE_URL = 'http://localhost:3000';

// 测试工具函数
async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();
  return { status: res.status, data };
}

function log(name, result) {
  console.log(`\n=== ${name} ===`);
  console.log(`状态码: ${result.status}`);
  console.log(`响应:`, JSON.stringify(result.data, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 测试用例 ==========

async function testReset() {
  const result = await request('POST', '/api/reset');
  log('重置游戏', result);
  return result.data.success;
}

async function testJoin(playerName) {
  const result = await request('POST', '/api/join', { playerName });
  log(`玩家加入: ${playerName}`, result);
  return result.data;
}

async function testReady(playerName, playerCount = 9, aiCount = 8) {
  const result = await request('POST', '/api/ready', { playerName, playerCount, aiCount });
  log(`玩家准备: ${playerName}`, result);
  return result.data;
}

async function testGetState(playerName = null) {
  const url = playerName ? `/api/state?name=${encodeURIComponent(playerName)}` : '/api/state';
  const result = await request('GET', url);
  log('获取游戏状态', result);
  return result.data;
}

async function testSpeak(playerId, content) {
  const result = await request('POST', '/api/speak', { playerId, content });
  log(`发言: ${content}`, result);
  return result.data;
}

async function testVote(playerId, targetId) {
  const result = await request('POST', '/api/vote', { voterId: playerId, targetId });
  log(`投票`, result);
  return result.data;
}

async function testSeerCheck(seerId, targetId) {
  const result = await request('POST', '/api/seer-check', { seerId, targetId });
  log(`预言家查验`, result);
  return result.data;
}

async function testWitchAction(witchId, action, targetId = null) {
  const result = await request('POST', '/api/witch-action', { witchId, action, targetId });
  log(`女巫行动: ${action}`, result);
  return result.data;
}

async function testGuardProtect(guardId, targetId) {
  const result = await request('POST', '/api/guard-protect', { guardId, targetId });
  log(`守卫守护`, result);
  return result.data;
}

// ========== 完整游戏流程测试 ==========

async function testFullGame() {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     狼人杀游戏 API 完整流程测试        ║');
  console.log('╚════════════════════════════════════════╝');

  // 1. 重置游戏
  console.log('\n【步骤 1】重置游戏');
  await testReset();

  // 2. 玩家加入并准备
  console.log('\n【步骤 2】玩家加入并准备');
  const readyResult = await testReady('测试玩家', 9, 8);

  if (!readyResult.success) {
    console.log('准备失败，测试终止');
    return;
  }

  const playerId = readyResult.playerId;
  const state = readyResult.state;

  console.log(`\n玩家 ID: ${playerId}`);
  console.log(`当前阶段: ${state.phase}`);
  console.log(`玩家数量: ${state.players.length}`);

  // 显示所有玩家
  console.log('\n玩家列表:');
  state.players.forEach(p => {
    const roleInfo = p.role ? ` [${p.role}]` : '';
    const status = p.alive ? '存活' : '死亡';
    const type = p.isAI ? 'AI' : '人类';
    console.log(`  - ${p.name}${roleInfo} (${type}, ${status})`);
  });

  // 3. 等待游戏进行
  console.log('\n【步骤 3】等待游戏自动进行...');
  console.log('(AI 会自动行动，等待 10 秒观察)\n');

  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const currentState = await testGetState('测试玩家');
    process.stdout.write(`\r[${i + 1}s] 阶段: ${currentState.phase}  `);
  }
  console.log('\n');

  // 4. 获取最终状态
  console.log('\n【步骤 4】获取最终状态');
  const finalState = await testGetState('测试玩家');

  console.log('\n消息历史:');
  finalState.messages?.slice(-10).forEach(msg => {
    console.log(`  [${msg.type}] ${msg.content?.substring(0, 50)}${msg.content?.length > 50 ? '...' : ''}`);
  });
}

// ========== 人类玩家行为测试 ==========

async function testHumanActions() {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║        人类玩家行为测试                ║');
  console.log('╚════════════════════════════════════════╝');

  // 重置
  await testReset();

  // 准备
  const readyResult = await testReady('人类测试者', 9, 8);
  const playerId = readyResult.playerId;
  const state = readyResult.state;

  // 找到自己的角色
  const myPlayer = state.players.find(p => p.id === playerId);
  console.log(`\n你的角色: ${myPlayer?.role || '未知'}`);

  // 根据角色测试不同行为
  if (myPlayer?.role === 'werewolf') {
    console.log('\n--- 狼人行为测试 ---');
    // 狼人发言（如果是发言阶段）
    if (state.phase === 'night_werewolf_discuss') {
      await testSpeak(playerId, '我是狼人，我们要小心行动');
    }
  }

  // 获取更新后的状态
  await sleep(2000);
  const newState = await testGetState('人类测试者');
  console.log(`\n当前阶段: ${newState.phase}`);
}

// ========== AI 行为测试 ==========

async function testAIActions() {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║          AI 玩家行为测试               ║');
  console.log('╚════════════════════════════════════════╝');

  // 重置
  await testReset();

  // 只加入 AI，观察 AI 行为
  console.log('\n创建全是 AI 的游戏...');

  // 先加入一个人类玩家
  const readyResult = await testReady('观察者', 9, 8);

  console.log('\n等待 AI 自动行动 15 秒...\n');

  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const state = await testGetState('观察者');
    const aliveCount = state.players?.filter(p => p.alive).length || 0;
    process.stdout.write(`\r[${i + 1}s] 阶段: ${(state.phase || '').padEnd(25)} 存活: ${aliveCount}  `);
  }
  console.log('\n');

  const finalState = await testGetState('观察者');
  console.log('\n游戏状态:');
  console.log(`  阶段: ${finalState.phase}`);
  console.log(`  胜者: ${finalState.winner || '未结束'}`);

  console.log('\n玩家状态:');
  finalState.players?.forEach(p => {
    const role = finalState.phase === 'game_over' ? p.role : '?';
    console.log(`  ${p.name}: ${p.alive ? '存活' : '死亡'} [${role || '未知'}]`);
  });
}

// ========== 消息系统测试 ==========

async function testMessageSystem() {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║          消息系统测试                  ║');
  console.log('╚════════════════════════════════════════╝');

  await testReset();
  await testReady('消息测试者', 9, 8);

  console.log('\n等待游戏进行 5 秒...');
  await sleep(5000);

  const state = await testGetState('消息测试者');

  console.log('\n消息列表 (按类型):');
  const messagesByType = {};
  state.messages?.forEach(msg => {
    if (!messagesByType[msg.type]) {
      messagesByType[msg.type] = [];
    }
    messagesByType[msg.type].push(msg);
  });

  Object.entries(messagesByType).forEach(([type, msgs]) => {
    console.log(`\n[${type}] (${msgs.length} 条)`);
    msgs.slice(0, 3).forEach(msg => {
      const content = msg.content?.substring(0, 60) || '';
      console.log(`  - ${content}${msg.content?.length > 60 ? '...' : ''}`);
    });
    if (msgs.length > 3) {
      console.log(`  ... 还有 ${msgs.length - 3} 条`);
    }
  });
}

// ========== 主函数 ==========

async function main() {
  const args = process.argv.slice(2);
  const testType = args[0] || 'full';

  try {
    switch (testType) {
      case 'full':
        await testFullGame();
        break;
      case 'human':
        await testHumanActions();
        break;
      case 'ai':
        await testAIActions();
        break;
      case 'message':
        await testMessageSystem();
        break;
      case 'all':
        await testHumanActions();
        await testAIActions();
        await testMessageSystem();
        break;
      default:
        console.log('用法: node test.js [full|human|ai|message|all]');
        console.log('  full    - 完整游戏流程测试 (默认)');
        console.log('  human   - 人类玩家行为测试');
        console.log('  ai      - AI 玩家行为测试');
        console.log('  message - 消息系统测试');
        console.log('  all     - 运行所有测试');
    }
  } catch (error) {
    console.error('\n测试出错:', error.message);
    console.log('\n请确保服务器已启动: node server.js');
  }
}

main();