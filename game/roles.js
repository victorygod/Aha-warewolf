/**
 * 角色定义和游戏配置
 */

// 角色类型
const ROLES = {
  WEREWOLF: 'werewolf',
  SEER: 'seer',
  WITCH: 'witch',
  GUARD: 'guard',
  HUNTER: 'hunter',
  VILLAGER: 'villager'
};

// 角色中文名
const ROLE_NAMES = {
  [ROLES.WEREWOLF]: '狼人',
  [ROLES.SEER]: '预言家',
  [ROLES.WITCH]: '女巫',
  [ROLES.GUARD]: '守卫',
  [ROLES.HUNTER]: '猎人',
  [ROLES.VILLAGER]: '村民'
};

// 角色阵营
const CAMPS = {
  [ROLES.WEREWOLF]: 'wolf',
  [ROLES.SEER]: 'god',
  [ROLES.WITCH]: 'god',
  [ROLES.GUARD]: 'god',
  [ROLES.HUNTER]: 'god',
  [ROLES.VILLAGER]: 'villager'
};

// 游戏配置（9/12/16人）
const GAME_CONFIGS = {
  9: {
    total: 9,
    roles: {
      [ROLES.WEREWOLF]: 3,
      [ROLES.SEER]: 1,
      [ROLES.WITCH]: 1,
      [ROLES.HUNTER]: 1,
      [ROLES.VILLAGER]: 3
    }
  },
  12: {
    total: 12,
    roles: {
      [ROLES.WEREWOLF]: 4,
      [ROLES.SEER]: 1,
      [ROLES.WITCH]: 1,
      [ROLES.GUARD]: 1,
      [ROLES.HUNTER]: 1,
      [ROLES.VILLAGER]: 4
    }
  },
  16: {
    total: 16,
    roles: {
      [ROLES.WEREWOLF]: 5,
      [ROLES.SEER]: 1,
      [ROLES.WITCH]: 1,
      [ROLES.GUARD]: 1,
      [ROLES.HUNTER]: 1,
      [ROLES.VILLAGER]: 7
    }
  }
};

/**
 * 根据配置生成角色列表
 */
function generateRoles(playerCount) {
  const config = GAME_CONFIGS[playerCount];
  if (!config) throw new Error(`不支持 ${playerCount} 人局`);

  const roles = [];
  for (const [role, count] of Object.entries(config.roles)) {
    for (let i = 0; i < count; i++) {
      roles.push(role);
    }
  }
  return shuffleArray(roles);
}

/**
 * 洗牌算法
 */
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  ROLES,
  ROLE_NAMES,
  CAMPS,
  GAME_CONFIGS,
  generateRoles,
  shuffleArray
};