# QA 基线

本目录记录无需云账号和真机即可执行的本地验证。它不等同于 staging 验收。

| 项目 | 结果 | 文档 |
|---|---|---|
| 后台 Playwright 主链路 | 通过 | [admin-playwright.md](admin-playwright.md) |
| 本地性能基线 100/500/1000 点 | 通过，1000 点列表 P95 约 288 ms | [performance-baseline.md](performance-baseline.md) |
| 数据质量门槛 | 未通过，演示数据仅 1 个已发布钓点 | [data-quality.md](data-quality.md) |
| 本地逻辑备份恢复 | 通过 | [backup-rehearsal.md](backup-rehearsal.md) |
| 安全静态审查 | 通过，依赖审计无已知漏洞 | [security-review.md](security-review.md) |

## 一键命令

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @szfisher/api test:e2e
pnpm test:admin
DATABASE_URL='postgresql://.../szfisher?schema=public' \
  pnpm --filter @szfisher/api quality:report -- --strict
DATABASE_URL='postgresql://.../szfisher?schema=public' \
  scripts/rehearse-backup.sh
pnpm audit --prod
```

这些检查不能替代：staging 同镜像部署、真实 TLS/WAF/SLB、真机矩阵、k6 压测、RDS WAL 恢复和小程序审核。
