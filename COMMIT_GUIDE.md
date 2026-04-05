# Commit 规范指南

本项目使用 Commitlint + Husky 强制执行约定式提交规范。

## 📝 提交消息格式

```
<type>: <subject>

[optional body]

[optional footer(s)]
```

## 🎯 Type 类型

| Type       | 说明                     | 版本影响                  |
| ---------- | ------------------------ | ------------------------- |
| `feat`     | 新功能                   | minor (1.0.0 → 1.**1**.0) |
| `fix`      | 修复 bug                 | patch (1.0.0 → 1.0.**1**) |
| `docs`     | 文档更新                 | -                         |
| `style`    | 代码格式（空格、分号等） | -                         |
| `refactor` | 代码重构                 | -                         |
| `perf`     | 性能优化                 | patch                     |
| `test`     | 测试相关                 | -                         |
| `build`    | 构建系统或依赖           | -                         |
| `ci`       | CI 配置                  | -                         |
| `chore`    | 其他不修改源代码的更改   | -                         |
| `revert`   | 回退提交                 | -                         |

## ✅ 正确示例

```bash
# 简单提交
git commit -m "feat: 添加用户登录功能"

# 修复 bug
git commit -m "fix: 修复登录表单验证问题"

# 带 scope
git commit -m "feat(auth): 添加 OAuth2 支持"

# 带 body
git commit -m "fix: 修复空指针异常

当用户未设置头像时会触发此错误"

# 破坏性变更（触发大版本更新）
git commit -m "feat!: 重构 API 接口"
# 或
git commit -m "feat: 重构 API 接口

BREAKING CHANGE: API v1 不再支持"
```

## ❌ 错误示例

```bash
# ❌ 类型大写
git commit -m "Feat: 添加功能"

# ❌ 缺少 subject
git commit -m "feat:"

# ❌ subject 以句号结尾
git commit -m "feat: 添加功能."

# ❌ 使用无效类型
git commit -m "update: 更新代码"

# ❌ 消息过长（>100字符）
git commit -m "feat: 添加一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的功能描述"
```

## 🔧 验证规则

- ✅ type 必须是小写
- ✅ type 必须在允许的列表中
- ✅ subject 不能为空
- ✅ subject 不能以句号结尾
- ✅ 标题最多 100 个字符

## 🚀 完整提交流程

```bash
# 1. 添加文件
git add .

# 2. 提交（husky 会自动检查格式）
git commit -m "feat: 添加新功能"

# 如果格式错误，会被拦截并提示
# ❌ git commit -m "update: something"  # 会被拒绝
```

## 💡 提示

- 使用 `feat!:` 或 `BREAKING CHANGE:` 标记破坏性变更
- Scope 是可选的，如 `feat(auth): ...`
- 推荐使用中文 subject
- 保持提交信息简洁明了
