# AI Profile 目录化与策略建议系统计划

## 一、AI Profile 目录化

### 1.1 设计调整

直接扫描 `ai/profiles/` 目录动态加载，不需要预先定义 AI_PROFILES 数组。

### 1.2 目录结构

```
ai/profiles/
├── 阿明/
│   ├── SKILL.md          # 必含：人格描述
│   └── reference/        # 可选：按需加载的参考资料
│       └── ...
├── 小红/
│   └── SKILL.md
└── ...
```

### 1.3 加载逻辑

```javascript
// 扫描目录获取可用 AI 列表
function scanProfiles() {
  const profilesDir = path.join(__dirname, 'profiles');
  const dirs = fs.readdirSync(profilesDir).filter(f =>
    fs.statSync(path.join(profilesDir, f)).isDirectory()
  );
  return dirs.map(dir => ({
    name: dir,
    soul: fs.readFileSync(path.join(profilesDir, dir, 'SKILL.md'), 'utf-8')
  }));
}
```
