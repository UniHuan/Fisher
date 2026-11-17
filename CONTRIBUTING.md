# 贡献指南

## 开发流程

1. 从 `main` 创建分支，或 Fork 后创建分支。
2. 完成变更并补充测试。
3. 提交前运行相关检查。
4. 使用 `git commit -s` 签署 Developer Certificate of Origin 1.1。
5. 发起 Pull Request，说明变更内容、验证步骤和安全影响。

## 提交规范

提交信息使用 Conventional Commits，例如：

```text
feat(api): add spot detail endpoint
fix(admin): handle expired session
docs: update local setup guide
```

一个 PR 只处理一个主题。格式化、重命名和功能变更尽量分开，方便审查。

## 安全要求

- 不提交 `.env`、密钥、Token、证书或生产数据。
- 新增环境变量时同步更新 `.env.example`，真实值留空。
- 修改认证、CSRF、CORS、RBAC、上传、存储或日志时，说明安全影响并补充测试。
- 依赖变更后运行 `pnpm audit --prod`，并在 PR 中说明结果。
- 安全问题按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 Issue。

## 测试要求

- Bug 修复先补复现测试，再修改实现。
- 新功能补充单元测试或 e2e 测试。
- 涉及后台主链路时运行 `pnpm test:admin`。
- PR 合并前至少通过 `pnpm lint`、`pnpm typecheck` 和 `pnpm test`。

## 代码风格

使用仓库现有的 ESLint 和 Prettier 配置。不要顺手重构无关代码，保持改动聚焦。

## 许可证

贡献按 [Apache License 2.0](LICENSE) 授权。项目使用 DCO 1.1，不需要单独签署 CLA。
