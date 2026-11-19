# SZFisher 部署与运维基线

本文覆盖 E8 的代码侧交付：镜像、迁移 Job、Nginx、结构化日志、备份与回滚步骤。云账号、备案、证书、WAF、SLB、RDS、OSS 和 ACR 的创建属于外部运行项，必须在 staging 前完成并记录在变更单中。

## 1. 目标拓扑

```
小程序 / iOS
      |
      v
fish-api.unihuan.com
      |
 WAF -> SLB -> 2 台 ECS (Nginx -> API 127.0.0.1:3000)
                         |
                         v
                  托管 PostgreSQL (多可用区)

fish-admin.unihuan.com
      |
 WAF -> CDN -> 私有 OSS (admin 静态文件)
```

- API 与 admin 使用不同域名和不同源，管理端 CORS 只允许准确的 admin origin。
- ECS 安全组只允许 SLB/WAF 访问 8080，API 的 3000 端口只绑定 `127.0.0.1`。
- 数据库只允许 API 安全组访问，不开放公网。
- 生产镜像不可变，部署只引用 ACR 中的 tag，不使用 `latest`。

## 2. 构建与推送镜像

使用当前 commit 生成 tag，staging 与 production 必须使用同一镜像摘要：

```bash
TAG="$(git rev-parse --short HEAD)"
REGISTRY="registry.cn-shenzhen.aliyuncs.com/<namespace>"

docker build -f infra/docker/Dockerfile.api \
  -t "$REGISTRY/szfisher-api:$TAG" .

docker build -f infra/docker/Dockerfile.admin \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://fish-api-staging.unihuan.com/api/v1 \
  --build-arg NEXT_PUBLIC_TENCENT_MAP_JS_KEY="<staging-js-key>" \
  -t "$REGISTRY/szfisher-admin:staging-$TAG" .

docker push "$REGISTRY/szfisher-api:$TAG"
docker push "$REGISTRY/szfisher-admin:staging-$TAG"
```

生产 admin 必须用生产 API 地址重新构建，不能复用 staging 静态包：

```bash
docker build -f infra/docker/Dockerfile.admin \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://fish-api.unihuan.com/api/v1 \
  --build-arg NEXT_PUBLIC_TENCENT_MAP_JS_KEY="<production-js-key>" \
  -t "$REGISTRY/szfisher-admin:$TAG" .
docker push "$REGISTRY/szfisher-admin:$TAG"
```

腾讯地图 JS Key 只用于后台域名，必须在腾讯位置服务控制台限制到
`fish-admin.unihuan.com` 与 staging 域名。它不是服务端密钥，但仍需按域名白名单管理。

`Dockerfile.api` 使用非 root 用户、内置 `/health` 健康检查；`Dockerfile.admin` 使用 unprivileged Nginx，监听 8080。

## 3. 环境变量

生产变量从云 KMS 或参数仓库注入，不写入镜像、Compose 文件或 Git。

必填：

- `DATABASE_URL`
- `ADMIN_ORIGINS`
- `JWT_ACCESS_SECRET`
- `CSRF_SECRET`
- `TOTP_ENCRYPTION_KEY`
- `OSS_REGION`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`
- `OSS_WORK_BUCKET`、`OSS_PUBLIC_BUCKET`、`OSS_PUBLIC_BASE_URL`

可选：

- `STORAGE_DRIVER`，生产固定为 `oss`
- `TENCENT_MAP_SERVER_KEY`，不配置时手动 POI 管理仍可用，自动同步会失败并记录原因
- `LOG_LEVEL`，默认 `info`

`NEXT_PUBLIC_API_BASE_URL` 是构建参数，不是运行时变量。修改 API 域名必须重建 admin 镜像并刷新 CDN。

## 4. 迁移 Job

迁移作为独立 Job 执行，失败时 API 不启动。`docker-compose.prod.yml` 中的 `migrate` 服务已经声明了 `service_completed_successfully` 依赖：

```bash
export API_IMAGE="$REGISTRY/szfisher-api:$TAG"
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml run --rm migrate
```

生产迁移只允许向前执行，回滚以镜像 tag 与兼容性评估为主。破坏性 DDL 必须先做备份、双人评审并在 staging 演练。

## 5. 发布 API

```bash
export API_IMAGE="$REGISTRY/szfisher-api:$TAG"
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml up -d migrate api
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml ps
```

发布后逐台检查：

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

`/health` 只表示进程存活；`/ready` 会执行 `SELECT 1`，数据库不可用时返回 503。SLB 健康检查应使用 `/ready`，存活探针使用 `/health`。

完整 smoke 检查不依赖账号：

```bash
scripts/smoke-api.sh https://fish-api-staging.unihuan.com
SMOKE_ADMIN_ORIGIN=https://fish-admin-staging.unihuan.com \
  scripts/smoke-api.sh https://fish-api-staging.unihuan.com
```

## 6. Nginx

API 主机使用 `infra/nginx/api.conf`，同时把 `infra/nginx/snippets/szfisher-proxy.conf` 放到 `/etc/nginx/snippets/`。配置假设：

- Nginx 监听 8080，由 SLB/WAF 转发。
- upstream 为 `127.0.0.1:3000`。
- 请求 ID 透传给 API，并写入 JSON access log。
- `/api/v1/` 读取超时 120 秒，覆盖 POI 同步和导入。
- 请求体上限 21 MB，API 自身仍有更严格的 JSON、图片和 Excel 限制。

admin 使用 `infra/nginx/admin.conf`，由 `Dockerfile.admin` 内置；使用 OSS + CDN 时把同样的安全响应头和缓存策略配置到 CDN 回源规则：

- `index.html` 不缓存。
- `/_next/static/` 缓存一年。
- CSP 的 `connect-src` 必须包含实际 API 域名。
- 不允许 admin 被 iframe 嵌入。

## 7. 静态后台发布到 OSS

使用阿里云官方 `ossutil`（安装在发布机或 CI runner，不进入 API 镜像）：

```bash
ossutil cp -r apps/admin/out/ oss://fish-admin-prod/ --update
```

随后刷新 CDN 中 `index.html` 和根路径，保留 `/_next/static/` 的长缓存。发布前确认 `apps/admin/out/index.html` 中存在生产 API 地址。回滚时重新上传上一个 tag 的 `out/` 目录并刷新 CDN。

## 8. 日志与指标

API 日志是单行 JSON，写入 stdout：

```json
{"timestamp":"2026-11-17T03:00:00.000Z","level":"info","type":"http_access","request_id":"req_...","method":"GET","path":"/api/v1/spots","status":200,"duration_ms":12.4,"client_type":"miniprogram"}
```

Nest 的启动、错误和审计日志同样使用 JSON。查询字符串不会进入 access log，避免签名 URL 或未来 token 落盘。主机 Nginx 的 access/error 日志交给 logrotate 或 SLS，默认保留 30 天；容器日志由 Compose 的 `json-file` 限制为 20 MB × 5 个文件。

建议在 SLS/CloudMonitor 配置：

- 5xx 比例按 5 分钟窗口告警，超过 1% 告警。
- P95 延迟按路径聚合，核心接口超过 1 秒告警。
- `PoiSyncRun.status = failed` 告警，并展示 `error_message` 与 `quota_used`。
- `/ready` 连续失败、数据库连接数、ECS CPU/内存、证书剩余天数、备份任务结果。
- Nginx access log 中的 `request_id` 与 API 日志关联，用于单请求排查。

## 9. 备份与恢复

每日逻辑备份：

```bash
DATABASE_URL=... BACKUP_DIR=/var/backups/szfisher \
  scripts/backup-postgres.sh
```

脚本使用 custom format、权限 `0600`、落盘前 `pg_restore --list` 校验，并保留 30 天。建议 cron 在凌晨低峰执行，备份目录挂载独立云盘并同步到 OSS。备份机需安装 PostgreSQL 18 的客户端工具，`pg_dump` 版本不能低于数据库主版本。

恢复演练只在新建实例进行：

```bash
createdb szfisher_restore
pg_restore --dbname=postgresql://.../szfisher_restore \
  --no-owner --no-privileges /var/backups/szfisher/szfisher-<stamp>.dump
```

恢复后核对核心表行数、`spot` 状态分布与 `audit_log` 最新时间。生产恢复必须由业务负责人和安全负责人双人确认，禁止直接覆盖生产库。

WAL 归档、时间点恢复和多可用区由托管 PostgreSQL 配置，目标 RPO 5 分钟、RTO 5 分钟；每季度做一次恢复演练并留存记录。

## 10. 回滚

镜像回滚目标时间 10 分钟内：

1. 将 `API_IMAGE` 切回上一个已验证 tag。
2. `docker compose ... up -d api`。
3. 检查 `/health`、`/ready`、5xx、P95 和 CORS。
4. admin 若同时发布，重新上传上一 tag 的静态包并刷新 CDN。

数据库迁移默认向前兼容。若新版本包含不可逆 DDL，回滚前必须恢复备份或执行预先评审的 down 脚本。

## 11. 上线前安全检查

- admin Cookie 仍为 `__Host-`、HttpOnly、Secure、SameSite=Lax，不带 Domain。
- CORS 只包含准确的 admin origin，不使用 `*`，不开放额外 header。
- WAF 只允许 `fish-api` 与 `fish-admin` 的必要方法，阻断直接访问 ECS 的绕过路径。
- OSS 工作桶私有，发布桶只读公开；CDN 不缓存 admin `index.html`。
- 数据库不对公网开放，安全组只允许 API 实例。
- 镜像与依赖扫描无高危；仓库无 `.env`、密钥、数据库导出。
- 证书、DNS、备案、小程序合法域名与隐私指引已核验。
- 备份、恢复、回滚、证书续期各完成一次演练。

## 12. 仍需云上完成的事项

以下内容无法只靠仓库代码完成，必须在 staging/production 账号中配置并回填变更记录：

- ACR 命名空间与镜像仓库
- RDS PostgreSQL 多可用区、备份、WAL、白名单
- OSS 工作桶/发布桶、CDN、证书
- WAF 规则、SLB 监听与健康检查
- 云监控、SLS、告警联系人
- 域名解析、ICP 备案核验、小程序合法域名
- 定时任务：POI 每日同步、数据库备份

POI 每日同步命令：

```bash
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml exec -T api \
  node apps/api/dist/jobs/sync-pois.job.js
```

建议由 systemd timer 或云函数每天触发一次，任务会跳过 24 小时内已成功同步的钓点。

分析明细保留 180 天，用同一套定时任务清理：

```bash
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml exec -T api \
  node apps/api/dist/jobs/purge-analytics.job.js
```

API 会把公开列表、搜索和详情结果写入 `analytics_event`，字段经过白名单过滤，不写入坐标、Token 或联系方式；客户端事件仍由微信自定义分析承载。
