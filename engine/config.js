/**
 * 游戏配置 - 所有业务规则定义
 */

// 规则配置
const RULES = {
  guard: {
    allowRepeatGuard: false
  },
  witch: {
    canSelfHeal: true,  // 仅首夜可以自救
    canUseBothSameNight: true
  },
  hunter: {
    canShootIfPoisoned: false
  },
  sheriff: {
    enabled: true,
    sheriffAssignOrder: true
  }
};

// 标准胜利条件（屠边规则）
function createStandardCheckWin() {
  return (game) => {
    // 狼人胜利：屠边（神职全灭或村民全灭）
    const gods = game.players.filter(p => p.alive && p.role.type === 'god');
    const villagers = game.players.filter(p => p.alive && p.role.type === 'villager');
    if (gods.length === 0 || villagers.length === 0) return 'wolf';

    // 好人胜利：狼人全灭
    const wolves = game.players.filter(p => p.alive && p.role.camp === 'wolf');
    if (wolves.length === 0) return 'good';

    return null;
  };
}

// 守丘局胜利条件（支持人狼恋第三方）
function createCupidCheckWin() {
  return (game) => {
    // ===== 辅助函数 =====

    // 判断是否为人狼恋
    const isHumanWolfCouple = () => {
      if (!game.couples || game.couples.length < 2) return false;
      const coupleCamps = game.couples.map(id => {
        const p = game.players.find(pl => pl.id === id);
        return p ? p.role.camp : null;
      });
      return coupleCamps.includes('good') && coupleCamps.includes('wolf');
    };

    // 获取第三方成员ID（丘比特+情侣）
    const getThirdPartyIds = () => {
      const ids = [...game.couples];
      const cupid = game.players.find(p => p.role.id === 'cupid');
      if (cupid) ids.push(cupid.id);
      return ids;
    };

    // 获取实际阵营
    const getActualCamp = (player) => {
      // 非人狼恋，返回原始阵营
      if (!isHumanWolfCouple()) return player.role.camp;

      // 人狼恋：丘比特和情侣始终为第三方
      const thirdPartyIds = getThirdPartyIds();
      return thirdPartyIds.includes(player.id) ? 'third' : player.role.camp;
    };

    // ===== 胜利判断 =====

    // 第三方胜利：人狼恋且情侣或丘比特存活，其他人全死
    if (isHumanWolfCouple()) {
      const thirdPartyIds = getThirdPartyIds();

      // 情侣或丘比特至少有一个存活
      const thirdPartyAlive = thirdPartyIds.some(id => {
        const p = game.players.find(pl => pl.id === id);
        return p && p.alive;
      });
      // 其他人都死
      const othersDead = game.players.filter(p => !thirdPartyIds.includes(p.id)).every(p => !p.alive);

      if (thirdPartyAlive && othersDead) return 'third';
    }

    // 按实际阵营统计存活
    const alivePlayers = game.players.filter(p => p.alive);
    const aliveByCamp = {
      good: alivePlayers.filter(p => getActualCamp(p) === 'good').length,
      wolf: alivePlayers.filter(p => getActualCamp(p) === 'wolf').length,
      third: alivePlayers.filter(p => getActualCamp(p) === 'third').length
    };

    // 好人胜利：狼人和第三方都死光
    if (aliveByCamp.wolf === 0 && aliveByCamp.third === 0) return 'good';

    // 狼人胜利：屠边且第三方死光
    const gods = alivePlayers.filter(p => getActualCamp(p) !== 'third' && p.role.type === 'god');
    const villagers = alivePlayers.filter(p => getActualCamp(p) !== 'third' && p.role.type === 'villager');
    if ((gods.length === 0 || villagers.length === 0) && aliveByCamp.third === 0) return 'wolf';

    return null;
  };
}

// 获取玩家原始阵营
function getCamp(player, game) {
  return player.role.camp;
}

// 遗言规则
function hasLastWords(player, reason, game) {
  // 殉情死亡无遗言
  if (reason === 'couple') return false;

  // 白天死亡有遗言
  if (reason === 'vote' || reason === 'hunter') return true;

  // 首夜死亡有遗言
  if (game.nightCount === 0) return true;

  // 第二夜及之后的夜晚死亡无遗言
  return false;
}

// 行动目标过滤规则（用于 buildActionData）
const ACTION_FILTERS = {
  // 守卫：不能连续守护同一人、不能守护死亡玩家（可以守护自己）
  guard: (game, player) => {
    const lastTarget = player.state?.lastGuardTarget;
    return game.players
      .filter(p => p.alive && p.id !== lastTarget)
      .map(p => p.id);
  },

  // 女巫毒药：不能毒自己、不能毒被狼刀的人、不能毒死亡玩家
  witch_poison: (game, player, extraData) => {
    const werewolfTarget = extraData?.werewolfTarget;
    return game.players
      .filter(p => p.id !== player.id && p.id !== werewolfTarget && p.alive)
      .map(p => p.id);
  },

  // 预言家：不能查验自己、不能查验已查验的、不能查验死亡玩家
  seer: (game, player) => {
    const checkedIds = (player.state?.seerChecks || []).map(c => c.targetId);
    return game.players
      .filter(p => p.id !== player.id && p.alive && !checkedIds.includes(p.id))
      .map(p => p.id);
  },

  // 白天投票：不能投自己、只能投存活玩家
  vote: (game, player) => {
    return game.players
      .filter(p => p.alive && p.id !== player.id)
      .map(p => p.id);
  },

  // 狼人投票：所有存活玩家（包括自己阵营的狼人）
  wolf_vote: (game, player) => {
    return game.players
      .filter(p => p.alive)
      .map(p => p.id);
  },

  // 猎人射击：不能射自己、只能射存活玩家
  shoot: (game, player) => {
    return game.players
      .filter(p => p.alive && p.id !== player.id)
      .map(p => p.id);
  },

  // 警长传徽：不能传给自己、只能传给存活玩家
  passBadge: (game, player) => {
    return game.players
      .filter(p => p.id !== player.id && p.alive)
      .map(p => p.id);
  }
};

// 钩子函数
const HOOKS = {
  getCamp,
  getVoteWeight: (player, game) => game.sheriff === player.id ? 1.5 : 1,
  hasLastWords,
  RULES,
  ACTION_FILTERS,
  checkWin: (game) => {
    // 使用板子的 checkWin 函数
    const preset = game.preset || BOARD_PRESETS[game.presetId];
    if (preset && preset.checkWin) {
      return preset.checkWin(game);
    }
    // 默认使用标准规则
    return createStandardCheckWin()(game);
  }
};

// 板子预设配置
const BOARD_PRESETS = {
  '9-standard': {
    name: '9人标准局',
    description: '预女猎3神3民3狼',
    playerCount: 9,
    // 参考 RULES.md 10.4：3狼、预言家、女巫、猎人、3村民
    roles: ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'],
    rules: {
      witch: { canSelfHeal: true, canUseBothSameNight: true },
      hunter: { canShootIfPoisoned: false },
      sheriff: { enabled: true, sheriffAssignOrder: true }
    },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言',
      '狼人屠边（屠神或屠民）获胜'
    ],
    checkWin: createStandardCheckWin()
  },
  '12-hunter-idiot': {
    name: '12人预女猎白',
    description: '标准12人局，含白痴无守卫',
    playerCount: 12,
    // 参考 RULES.md 10.2：4狼、预言家、女巫、猎人、白痴、4平民
    roles: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'idiot', 'villager', 'villager', 'villager', 'villager'],
    rules: {
      witch: { canSelfHeal: true, canUseBothSameNight: true },
      hunter: { canShootIfPoisoned: false },
      sheriff: { enabled: true, sheriffAssignOrder: true }
    },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言',
      '狼人屠边（屠神或屠民）获胜'
    ],
    checkWin: createStandardCheckWin()
  },
  '12-guard-cupid': {
    name: '12人守丘局',
    description: '含守卫丘比特，有情侣第三方',
    playerCount: 12,
    // 参考 RULES.md 10.5：4狼、预言家、女巫、守卫、猎人、丘比特、3村民
    roles: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'guard', 'hunter', 'cupid', 'villager', 'villager', 'villager'],
    rules: {
      witch: { canSelfHeal: true, canUseBothSameNight: true },
      guard: { allowRepeatGuard: false },
      hunter: { canShootIfPoisoned: false },
      sheriff: { enabled: true, sheriffAssignOrder: true }
    },
    ruleDescriptions: [
      '女巫仅首夜可自救',
      '守卫不可连守',
      '同守同救则死亡',
      '猎人被毒不能开枪',
      '首夜和白天死亡有遗言，后续夜晚死亡无遗言',
      '情侣一方死亡另一方殉情',
      '狼人屠边获胜；好人需清理所有狼人',
      '人狼恋时，好人/狼人都需清理情侣+丘比特才能获胜',
      '人狼恋胜利：情侣+丘比特存活，其他人全死'
    ],
    checkWin: createCupidCheckWin()
  }
};

// 合并规则：板子 rules 覆盖 config RULES 默认值
function getEffectiveRules(preset) {
  const merged = JSON.parse(JSON.stringify(RULES));
  for (const [category, overrides] of Object.entries(preset.rules || {})) {
    merged[category] = { ...merged[category], ...overrides };
  }
  return merged;
}

module.exports = {
  RULES,
  HOOKS,
  getCamp,
  BOARD_PRESETS,
  getEffectiveRules
};