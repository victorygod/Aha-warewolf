/**
 * 事件系统 - 发布订阅模式
 */

class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  // 订阅事件
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  // 触发事件，返回是否被取消
  emit(event, data) {
    if (!this.listeners.has(event)) return false;
    for (const handler of this.listeners.get(event)) {
      const result = handler(data);
      if (result?.cancel) return true; // 事件被取消
    }
    return false;
  }
}

module.exports = { EventEmitter };