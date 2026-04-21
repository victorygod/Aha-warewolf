/**
 * Agent 策略层导出
 */

const { RandomAgent } = require('./random');
const { LLMAgent } = require('./llm');
const { MockAgent } = require('./mock');

module.exports = {
  RandomAgent,
  LLMAgent,
  MockAgent
};