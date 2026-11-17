## 变更说明

<!-- 说明这个 PR 解决什么问题，以及为什么采用当前方案。 -->

## 验证

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] 涉及集成链路时已运行 `pnpm test:integration`
- [ ] 涉及后台主链路时已运行 `pnpm test:admin`

## 安全自查

- [ ] 没有提交真实密钥、Token、证书、生产数据或 `.env` 文件
- [ ] 新增环境变量已写入 `.env.example`，真实值留空
- [ ] 涉及认证、CSRF、CORS、RBAC、上传、存储或日志的变更已说明安全影响
- [ ] 依赖变更已运行 `pnpm audit --prod`
- [ ] 没有在日志、错误信息或测试快照中暴露敏感数据

## 许可证

- [ ] 我同意本次贡献按 Apache-2.0 授权，并使用 `git commit -s` 签署 DCO
