module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // 新功能
        "fix", // 修复 bug
        "docs", // 文档更新
        "style", // 代码格式（不影响代码运行）
        "refactor", // 代码重构
        "perf", // 性能优化
        "test", // 测试相关
        "build", // 构建系统或外部依赖
        "ci", // CI 配置
        "chore", // 其他不修改 src/test 的更改
        "revert", // 回退提交
      ],
    ],
    "type-case": [2, "always", "lower-case"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
  },
};
