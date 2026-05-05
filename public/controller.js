/**
 * 前端 Controller - WebSocket 版本
 * 与 AI Controller 接口对齐
 */

class Controller {
  constructor() {
    this.playerId = null;
    this.playerName = null;

    // 自己看到的消息历史
    this.messageHistory = [];

    // 自己的状态缓存
    this.cachedState = null;

    // WebSocket 连接
    this.ws = null;

    // 状态变更回调
    this.onStateChange = null;

    // 行动请求回调
    this.onActionRequired = null;

    // 是否是观战者
    this.isSpectator = false;

    // 观战者视角
    this.spectatorView = 'villager';
  }

  // 连接 WebSocket
  connect(name, presetId = null, debugRole = null) {
    this.playerName = name;
    this.presetId = presetId;
    this.debugRole = debugRole;
    const wsUrl = `ws://${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    // 设置前端日志的 WebSocket 实例
    if (window.setFrontendLoggerWs) {
      window.setFrontendLoggerWs(this.ws);
    }

    this.ws.onopen = () => {
      if (window.frontendLogger) {
        window.frontendLogger.debug('[WS] 连接成功');
      }
      // 发送加入消息
      this.send('join', { name, presetId, debugRole });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {
        if (window.frontendLogger) {
          window.frontendLogger.error(`[WS] 消息解析错误: ${err}`);
        }
      }
    };

    this.ws.onclose = () => {
      if (window.frontendLogger) {
        window.frontendLogger.debug('[WS] 连接关闭');
      }
      // 尝试重连
      setTimeout(() => {
        if (this.playerName) {
          this.connect(this.playerName);
        }
      }, 3000);
    };

    this.ws.onerror = (err) => {
      if (window.frontendLogger) {
        window.frontendLogger.error(`[WS] 错误: ${err}`);
      }
    };
  }

  // 处理服务器消息
  handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        if (window.frontendLogger) {
          window.frontendLogger.info(`[WS] state: ${JSON.stringify(msg.data)}`);
        }
        this.cachedState = msg.data;
        if (msg.data?.self) {
          this.playerId = msg.data.self.id;
          this.isSpectator = false;
        } else {
          this.playerId = null;
        }
        if (msg.data?.spectators) {
          const me = msg.data.spectators.find(s => s.name === this.playerName);
          if (me) {
            this.isSpectator = true;
            this.spectatorView = me.view || 'villager';
          } else if (!msg.data?.self) {
            this.isSpectator = false;
          }
        }

        // 同步消息：服务器 displayMessages 是唯一真相源，直接替换
        if (msg.data?.messages) {
          this.messageHistory = msg.data.messages;
        }

        // 触发回调
        if (this.onStateChange) {
          this.onStateChange(msg.data);
        }

        // 检查 pendingAction，触发行动请求回调
        if (msg.data?.pendingAction && this.onActionRequired) {
          this.onActionRequired({ data: msg.data.pendingAction });
        }
        break;

      case 'error':
        if (window.frontendLogger) {
          window.frontendLogger.error(`[WS] 服务器错误: ${msg.message}`);
        }
        if (this.onStateChange) {
          this.onStateChange({ ...this.cachedState, error: msg.message });
        }
        break;

      case 'phase_start':
        if (window.frontendLogger) {
          window.frontendLogger.debug(`[WS] 阶段开始: ${msg.phase} ${msg.phaseName || ''}`);
        }
        // phase_start 消息会通过 state.messages 同步，不需要手动添加
        if (this.onStateChange) {
          this.onStateChange(this.cachedState);
        }
        break;

      case 'phase_end':
        if (window.frontendLogger) {
          window.frontendLogger.debug(`[WS] 阶段结束: ${msg.phase}`);
        }
        break;

      case 'death_announce':
        if (window.frontendLogger) {
          window.frontendLogger.info(`[WS] 死亡公告: ${JSON.stringify(msg.deaths)}`);
        }
        if (this.onStateChange) {
          this.onStateChange(this.cachedState);
        }
        break;

      case 'game_ready':
        if (this.onGameReady) {
          this.onGameReady();
        }
        break;

      default:
        if (msg.type === 'spectator_assigned') {
          this.isSpectator = true;
          this.spectatorView = msg.view || 'villager';
        } else if (msg.type === 'player_assigned') {
          this.isSpectator = false;
          this.playerId = msg.playerId;
        } else if (window.frontendLogger) {
          window.frontendLogger.warn(`[WS] 未知消息类型: ${msg.type}`);
        }
    }
  }

  // 发送消息
  send(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  // 响应行动请求
  respond(requestId, data = {}) {
    this.send('response', { requestId, ...data });
  }

  // 加入游戏
  async join(name, presetId, debugRole = null) {
    this.playerName = name;
    this.connect(name, presetId, debugRole);

    return new Promise((resolve) => {
      const checkState = () => {
        if (this.cachedState) {
          resolve({
            success: true,
            playerId: this.playerId,
            state: this.cachedState,
            gameStarted: this.cachedState.phase !== 'waiting'
          });
        } else {
          setTimeout(checkState, 100);
        }
      };
      checkState();
    });
  }

  // 获取当前状态（接口对齐）
  getState() {
    return this.cachedState;
  }

  // 获取消息历史
  getMessageHistory() {
    return this.messageHistory;
  }

  // 发言（接口对齐）
  async speak(content) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('speak', { content });
    return { success: true };
  }

  // 投票（接口对齐）
  async vote(targetId) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('vote', { targetId });
    return { success: true };
  }

  // 弃权（接口对齐）
  abstain() {
    return this.vote(null);
  }

  // 使用技能（接口对齐）
  async useSkill(data) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('skill', data);
    return { success: true };
  }

  // 使用全局能力（接口对齐）
  async useGlobalAbility(abilityId, data) {
    if (!this.playerId) return { error: '未加入游戏' };
    // 暂不支持
    return { error: '暂不支持' };
  }

  // 警长指定发言起始位置
  async setSheriffOrder(startPlayerId) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('sheriff_order', { startPlayerId });
    return { success: true };
  }

  // 添加 AI
  async addAI() {
    this.send('add_ai');
    return { success: true };
  }

  // 踢出 AI
  async removeAI(playerId) {
    this.send('remove_ai', { playerId });
    return { success: true };
  }

  // 准备
  sendReady() {
    this.send('ready');
  }

  // 取消准备
  sendUnready() {
    this.send('unready');
  }

  // 切换板子
  sendChangePreset(presetId) {
    this.send('change_preset', { presetId });
  }

  // 改名
  sendChangeName(name) {
    this.send('change_name', { name });
    this.playerName = name;
  }

  // 改 emoji
  sendChangeEmoji(emoji) {
    this.send('change_emoji', { emoji });
  }

  // 修改 Debug 角色
  sendChangeDebugRole(role) {
    this.send('change_debug_role', { role });
  }

  // 加入观战
  sendSpectate() {
    this.send('spectate');
  }

  // 切换视角
  sendSwitchView(view) {
    this.send('switch_view', { view });
  }

  // 切换身份（玩家↔观战者）
  sendSwitchRole(role) {
    this.send('switch_role', { role });
  }

  // 发送聊天消息
  sendChat(content) {
    this.send('chat', { content });
  }

  // 请求开始游戏（全AI就绪时）
  sendStartGame() {
    this.send('start_game');
  }

  // 重置游戏（返回房间）
  async reset() {
    this.send('reset');
    this.messageHistory = [];
    this.cachedState = null;
    return { success: true };
  }

  // 获取玩家位置（ID = 位置编号）
  getPlayerPosition(playerId) {
    return playerId;
  }

  // 获取当前玩家
  getMyPlayer() {
    if (!this.cachedState?.players || !this.playerName) return null;
    return this.cachedState.players.find(p => p.name === this.playerName && !p.isAI);
  }

  // 获取过滤后的消息（观战者根据视角过滤）
  getFilteredMessages() {
    const messages = this.messageHistory;
    if (!this.isSpectator) return messages;

    const view = this.spectatorView;
    if (view === 'god') return messages;

    return messages.filter(msg => {
      if (!msg.visibility) return true;
      if (msg.visibility === 'public') return true;
      if (view === 'werewolf' && msg.visibility === 'camp') {
        const state = this.cachedState;
        if (state?.players) {
          const sender = state.players.find(p => p.id === msg.playerId);
          if (sender?.role?.camp === 'wolf' || sender?.role?.id === 'werewolf') return true;
        }
        return false;
      }
      return false;
    });
  }
}

// 单例
const controller = new Controller();

// 浏览器环境导出
if (typeof window !== 'undefined') {
  window.controller = controller;
}