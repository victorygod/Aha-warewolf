# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **Werewolf (狼人杀) game** with a configurable rule engine, AI players, web frontend, and WebSocket server.

## Commands

```bash
npm start                 # Start server at http://localhost:3000
npm run dev               # Hot reload (Node.js --watch)
node test/game.test.js    # Run main test suite (70+ cases)
node test/*.js            # Run all test files
node server.js --debug    # Enable debug mode (allows role selection)
```

## CLI Client (Simulation Testing)

`cli_client.js` allows simulating a human player via command line for testing

## Architecture

**Config-Driven Design**: Business rules in `config.js` and `roles.js`, not in engine code.

- **GameEngine** (`engine/main.js`): Pure state driver with low-level APIs (`callSpeech`, `callVote`, `callSkill`, `handleDeath`)
- **PhaseManager** (`engine/phase.js`): Executes game flow via `PHASE_FLOW` array
- **config.js**: ALL business rules—roles, camps, win conditions, hooks (`getCamp`, `getVoteWeight`, `hasLastWords`, `ACTION_FILTERS`)
- **roles.js**: Role definitions with skills, constraints, event listeners

**Data Flow**: `Phase → GameEngine → PlayerController → AIController/HumanController → MessageManager → Client`

**Key Patterns**:
- AI and human controllers have identical method signatures (`getSpeechResult`, `getVoteResult`, `useSkill`)
- Roles subscribe to events (`player:death`, `player:vote`) via `events` property; return `{ cancel: true }` to cancel
- Human players use `game.requestAction()` for WebSocket-based interaction

**Skill Types**: `target` (single), `double_target` (two), `choice` (multi-choice), `instant` (immediate)

## Phase Flow

**First Night**: cupid → guard → werewolf_discuss/vote → witch → seer → hunter_night
**Other Nights**: guard → werewolf_discuss/vote → witch → seer → hunter_night
**First Day**: sheriff_campaign → sheriff_speech → sheriff_vote → day_announce → day_discuss → day_vote → post_vote
**Other Days**: day_announce → day_discuss → day_vote → post_vote

## AI Configuration

Create `api_key.conf` for LLM-based AI:
```json
{ "base_url": "https://api.example.com/v1", "auth_token": "your-token", "model": "model-name" }
```
Without this file, AI uses `RandomAgent` (random decisions).

## Testing

Tests use `MockAgent` for deterministic behavior:
```javascript
const { game, aiControllers } = createTestGame(9);
setAI(aiControllers, playerId, 'vote', targetId);
await game.phaseManager.executePhase('day_vote');
```

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express + WebSocket entry |
| `engine/main.js` | GameEngine (state driver) |
| `engine/phase.js` | PhaseManager + PHASE_FLOW |
| `engine/config.js` | Business rules |
| `engine/roles.js` | Role definitions |
| `engine/player.js` | PlayerController + HumanController |
| `ai/controller.js` | AIController (LLM/Random/Mock) |
| `test/*.js` | 70+ test cases |

## Mention

1. 总是保证每个测试用例都能跑通
2. 文档不要有大段代码，用自然语言或伪代码描述逻辑
3. 正式代码里的日志都要靠utils/logger.js来输出，禁止console.log
4. 用cli_client.js玩的时候，多看看后端日志和后端代码，时刻留心什么不合理的地方，记录文档并自己分析代码看看是否需要修复
5. 创建AI,0.001s就能创建完
6. 等待随机AI的行动一般 0.01s就能全部结束
