# 安全静态审查

日期：2026-11-17  
分支：`feat/v1.0-qa-baseline`  
范围：仓库代码、依赖、配置、密钥和已有自动化测试

## 结论

未发现硬编码真实密钥；核心认证、CSRF、CORS、RBAC、上传和审计控制已在代码与 API e2e 中覆盖。

依赖审计仍有 1 个高危和 1 个中危，均来自第三方包。它们不是当前代码引入的自定义漏洞，但不能宣称“无高危依赖”。

## 自动化检查

| 检查 | 结果 |
|---|---|
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| API e2e | 136 个通过 |
| 后台 Playwright 主链路 | 通过 |
| `pnpm audit --prod` | 1 high、1 moderate |
| 跟踪文件密钥 grep | 未发现真实密钥，仅有占位值 |
| `.env` 忽略检查 | `.env` 与 `apps/api/.env` 已被 `.gitignore` 忽略 |

## 依赖发现

### High：deepmerge-ts < 8.0.0

- 路径：`@prisma/client@6.19.3 > prisma@6.19.3 > @prisma/config > deepmerge-ts@7.1.5`
- 公告：GHSA-ggr8-5vv4-36mx，恶意递归配置可导致栈耗尽
- 影响面：Prisma CLI/config 加载，主要在构建、迁移和种子阶段，不在公开请求处理链
- 当前处置：记录为待升级项。直接覆盖 deepmerge-ts 8 可能与 Prisma 6 的内部配置格式不兼容，未在发布分支盲改
- 建议：升级 Prisma 到包含修复的版本，或先在独立分支验证 override 后跑完整迁移与测试

### Moderate：uuid < 11.1.1

- 路径：`apps/api > exceljs@4.4.0 > uuid@8.3.2`
- 公告：GHSA-w5hq-g745-h8pq，仅在调用方传入自定义 buf 的 v3/v5/v6 路径触发
- 影响面：Excel 导入解析。导入仅限已认证运营，文件大小和行数有上限，目前未见传入自定义 buf 的代码路径
- 建议：关注 ExcelJS 上游升级；若强制 override uuid 11，需要单独验证 Excel 导入二进制兼容性

## 已核验控制

- 管理端访问令牌只放 `__Host-` Cookie，HttpOnly、Secure、SameSite=Lax，不带 Domain
- 所有非 GET 管理端请求强制 CSRF，刷新令牌轮换和复用检测已有测试
- CORS 使用准确 admin origin，不使用通配符
- 管理端接口按 super_admin、operator、reviewer 做服务端 RBAC
- 公开接口只返回已发布钓点，禁钓规则和隐藏 POI 有测试
- Prisma 参数化查询，没有拼接 SQL
- 上传有大小限制、magic bytes、Sharp 重编码和存储 key 白名单
- 审计日志脱敏，分析事件仅写白名单字段
- 日志不记录查询字符串，签名预览 URL 不进入 access log

## 仍需外部验证

- WAF 规则与绕过测试
- TLS 证书、HSTS、DNS 和备案
- 镜像扫描与 SBOM
- 生产数据库网络隔离与备份恢复
- 第三方渗透测试
- 多实例下的全局限流和配额告警

## 复现命令

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @szfisher/api test:e2e
pnpm test:admin
pnpm audit --prod
git grep -nE "(JWT_ACCESS_SECRET|CSRF_SECRET|TOTP_ENCRYPTION_KEY|DATABASE_URL|TENCENT_MAP_SERVER_KEY|SEED_ADMIN_PASSWORD)=[^[:space:]]+" -- ':!*.example' ':!docs/*' ':!apps/api/prisma/migrations/*'
```
