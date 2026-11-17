# 安全静态审查

日期：2026-11-17  
分支：`feat/v1.0-qa-baseline`  
范围：仓库代码、依赖、配置、密钥和已有自动化测试

## 结论

未发现硬编码真实密钥；核心认证、CSRF、CORS、RBAC、上传和审计控制已在代码与 API e2e 中覆盖。

依赖审计当前无已知漏洞。此前 Prisma CLI 的 deepmerge-ts 与 ExcelJS 的 uuid 告警已通过 pnpm overrides 升级并完成迁移、种子、构建、e2e、Excel 导入和 Playwright 验证。

## 自动化检查

| 检查 | 结果 |
|---|---|
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| API e2e | 136 个通过 |
| 后台 Playwright 主链路 | 通过 |
| `pnpm audit --prod` | 无已知漏洞 |
| 跟踪文件密钥 grep | 未发现真实密钥，仅有占位值 |
| `.env` 忽略检查 | `.env` 与 `apps/api/.env` 已被 `.gitignore` 忽略 |

## 依赖处置

已在根 `package.json` 增加：

```json
"pnpm": {
  "overrides": {
    "deepmerge-ts": "8.0.2",
    "uuid": "11.1.1"
  }
}
```

处置依据：

- `deepmerge-ts 8.0.2` 修复 GHSA-ggr8-5vv4-36mx。验证了 `prisma generate`、`prisma migrate status`、`prisma db seed` 和 API 构建。
- `uuid 11.1.1` 修复 GHSA-w5hq-g745-h8pq。验证了 ExcelJS 生成 workbook、Excel 导入 e2e 和 API 构建。
- `pnpm audit --prod` 当前返回 `No known vulnerabilities found`。
- 仍需在 staging 重新执行依赖、镜像和 SBOM 扫描，overrides 不能替代生产镜像扫描。

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
# 当前应输出 No known vulnerabilities found
git grep -nE "(JWT_ACCESS_SECRET|CSRF_SECRET|TOTP_ENCRYPTION_KEY|DATABASE_URL|TENCENT_MAP_SERVER_KEY|SEED_ADMIN_PASSWORD)=[^[:space:]]+" -- ':!*.example' ':!docs/*' ':!apps/api/prisma/migrations/*'
```
