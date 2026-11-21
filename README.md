# SZFisher 优丽环钓鱼助手

SZFisher 是面向深圳及周边海域的钓点查询与运营平台，包含公开 API、运营后台和微信小程序。V1.0 覆盖钓点检索、地图浏览、钓点详情、POI 展示、后台钓点编辑与发布、图片上传、Excel 导入、字典维护和审计日志。

## 仓库结构

| 路径                  | 说明                            |
| --------------------- | ------------------------------- |
| `apps/api`            | NestJS API，Prisma + PostgreSQL |
| `apps/admin`          | Next.js 静态运营后台            |
| `apps/miniprogram`    | 微信小程序                      |
| `packages/shared`     | 共享类型与常量                  |
| `packages/api-client` | OpenAPI 生成的 API 客户端       |
| `infra`               | Docker、Nginx 与部署配置        |
| `docs`                | 产品、QA、运维与实现计划        |

## 本地开发

环境要求：Node.js 24、pnpm 10、Docker。

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:admin
```

`pnpm db:seed` 的本地管理员由 `.env.example` 中的 `SEED_ADMIN_USERNAME` 和 `SEED_ADMIN_PASSWORD` 控制，密码至少 12 位。后台环境变量见 `apps/admin/.env.example`。小程序使用微信开发者工具打开 `apps/miniprogram`。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:admin
pnpm audit --prod
```

`pnpm test:admin` 需要本地 PostgreSQL 测试库和 Playwright Chromium。首次运行前执行 `pnpm test:admin:install`。

## 安全

不要在仓库中提交任何真实密钥、生产数据或 `.env` 文件。环境变量模板必须保持空值。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要创建公开 Issue。仓库管理员请按 [GitHub 安全设置](docs/ops/github-security.md) 配置分支保护和扫描功能。

## 下一步

当前 V1.0 的 staging、数据、真机和上线分工见 [下一步行动与授权清单](docs/ops/v1.0-next-actions.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，并遵守行为准则。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可。版权归深圳市环与瑞创新科技有限公司 (UniHuan / 优丽环) 所有，详见 [NOTICE](NOTICE)。

提交贡献即表示同意按 Apache-2.0 授权，并使用 Developer Certificate of Origin 1.1 签署提交。参见 [CONTRIBUTING.md](CONTRIBUTING.md)。
