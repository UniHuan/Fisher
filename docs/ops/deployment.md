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
- ECS 安全组只允许 SLB/WAF 访问 8080，API 的 3000 端口只绑定 `127.0.0.1`。ECS 不能直接从公网访问，
  否则客户端可以伪造 `X-Forwarded-For` 绕过按 IP 限流。
- API 的 `trust proxy` 信任 loopback 与云入口使用的私有网段 `10.0.0.0/8`、`172.16.0.0/12`、
  `192.168.0.0/16`，因此 `req.ip` 取 `X-Forwarded-For` 中最右侧的非私有客户端地址。这些网段必须与
  实际云拓扑一致；SLB/WAF 或 VPC 网段变化时同步修改 `apps/api/src/app.factory.ts`。生产上线前必须
  用两个不同客户端 IP 验证限流桶是分开的，staging 的直连 Nginx 拓扑不能证明 SLB 这一跳。
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

V1.1 UGC 新增变量，staging 与 production 各用独立值：

- `APP_JWT_ACCESS_SECRET`：C 端 access token 密钥，至少 32 字符，必须与后台 `JWT_ACCESS_SECRET` 不同。
- `WECHAT_MINI_APPID`：小程序 AppID，公开值。
- `WECHAT_MINI_SECRET`：小程序 AppSecret，只放服务端 0600 环境文件，不写日志。
- `WECHAT_MSG_TOKEN`：微信消息推送 Token，与微信控制台一致。
- `WECHAT_MSG_AES_KEY`：微信消息推送 EncodingAESKey，43 字符，安全模式解密。
- `UGC_TERMS_VERSION`：社区规范版本，必须与已上线法务页面版本一致。
- `LEGAL_BASE_URL`：法务页面根地址，默认 `https://fish.unihuan.com/legal`。

缺少 `APP_JWT_ACCESS_SECRET`、`WECHAT_MINI_APPID` 或 `WECHAT_MINI_SECRET` 时，C 端登录返回 503；
缺少 `UGC_TERMS_VERSION` 时，发布返回 503。其余内容安全调用失败不会返回 503：文本进入人工审核、
图片检查记录为 `error` 并留在 `machine_pending`。`LEGAL_BASE_URL` 未配置时回退默认地址。
`features.ugc` 在验收通过前保持关闭。变量只写入 `/etc/szfisher/staging.env`、生产 KMS 或参数仓库，
不进入镜像、Compose 文件、日志或仓库。

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
- 定时任务告警：`media-check:timeout`、`ugc:purge`、`feedback:purge`、`rate-limits:purge`、`session:purge`
  连续失败或长时间未执行；会话清理输出 `event=user_sessions_purge` 与 `deleted`，不输出令牌或 openid。
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

## 13. V1.1 UGC 上线、定时任务与回滚

### 13.1 微信与法务前置

- 微信公众平台消息推送：URL 使用 `https://fish-api-staging.unihuan.com/api/v1/wechat/media-check/callback`（生产替换为 `https://fish-api.unihuan.com/api/v1/wechat/media-check/callback`），消息加密方式选择安全模式，数据格式选择 JSON，Token 与 EncodingAESKey 必须和服务器环境变量一致。
- 小程序开发设置：`request`、`uploadFile`、`downloadFile` 合法域名加入 `https://fish-api-staging.unihuan.com`；业务域名加入 `https://fish.unihuan.com`。
- 法务页面：`https://fish.unihuan.com/legal/terms`、`/legal/privacy`、`/legal/community` 上线后，把页面版本写入 `UGC_TERMS_VERSION`，两边必须一致。
- 上线前向微信确认小程序类目覆盖公开 UGC。未确认前保持 `features.ugc=false`，不绕过类目限制。
- 完整验收项见 [V1.1 UGC 验收记录](../qa/v1.1-ugc-acceptance.md)。

### 13.2 功能开关

`features.ugc` 存在 `config` 表，种子值为 `false`，V1.0 部署不受影响。staging 验收时再打开，生产最后打开：

```sql
INSERT INTO config (config_key, config_value, description, updated_at)
VALUES ('features.ugc', 'true', 'V1.1 钓友情报开关', now())
ON CONFLICT (config_key) DO UPDATE SET config_value = 'true', updated_at = now();
```

回滚立即关闭：

```sql
UPDATE config SET config_value = 'false' WHERE config_key = 'features.ugc';
```

关闭后公开列表返回空，写接口和上传返回 `FEATURE_DISABLED`，公开 UGC 图片路由返回 404；已发布内容保留在数据库和发布桶，不删除用户内容。

### 13.3 定时任务

以下任务通过 Postgres advisory lock 协调，多个 API 实例同时运行也只有一个实例执行。由 systemd timer 或 cron 在 API 主机触发：

```bash
# 图片审核回调超时，建议每 1 至 5 分钟一次
docker compose --env-file /etc/szfisher/staging.env \
  -f infra/docker/docker-compose.prod.yml exec -T api \
  node apps/api/dist/jobs/media-check-timeout.job.js

# 清理 24 小时未使用的上传和超过 30 天的驳回图片，建议每小时或每日一次
docker compose --env-file /etc/szfisher/staging.env \
  -f infra/docker/docker-compose.prod.yml exec -T api \
  node apps/api/dist/jobs/purge-ugc-orphans.job.js

# 清理过期限流计数，建议每日一次
docker compose --env-file /etc/szfisher/staging.env \
  -f infra/docker/docker-compose.prod.yml exec -T api \
  node apps/api/dist/jobs/purge-rate-limits.job.js

# 清理 30 天前过期或已吊销的会话，建议每日一次
docker compose --env-file /etc/szfisher/staging.env \
  -f infra/docker/docker-compose.prod.yml exec -T api \
  node apps/api/dist/jobs/purge-user-sessions.job.js
```

生产环境把 `--env-file` 换成 `/etc/szfisher/production.env`。任务输出为单行 JSON，不包含正文、
图片 URL、Token 或 openid：

- 媒体检查超时：`event=media_check_timeout`，字段 `expired` 与 `locked`。
- UGC 清理：`event=ugc_orphans_purge`，字段 `uploads_marked_deleted`、`uploads_marked_used`、
  `objects_deleted`；未拿到 advisory lock 时输出 `skipped=true`。
- 限流计数清理：`event=rate_limits_purge`，字段 `deleted`。
- 会话清理：`event=user_sessions_purge`，字段 `deleted` 与 `locked`。

会话清理任务失败或 `deleted` 异常增大时告警；该任务只删除 30 天前过期或吊销的行，
吊销记录保留用于刷新令牌重放分析。

### 13.4 公开图片读取

V1.1 先由 API 提供公开图片：

```text
GET /api/v1/uploads/public/ugc/:reportId/:file
```

只有 `features.ugc=true`、内容处于 `published` 或 `human_approved`、钓点已发布且非禁钓时返回 200，其余情况返回 404。CDN 就绪后再切换，不改数据库中的图片 key。

管理端 `infra/nginx/admin.conf` 的 `img-src` 已包含 `https://fish-api.unihuan.com` 和 `https://fish-api-staging.unihuan.com`，审核抽屉预览 UGC 图片不需要额外 CSP 改动。

## 14. V1.1 体验反馈上线、定时任务与保留

### 14.1 功能开关

`features.feedback` 存在 `config` 表，种子值为 `false`，V1.0 与生产默认关闭。staging 部署并完成本地检查后打开：

```sql
INSERT INTO config (config_key, config_value, description, updated_at)
VALUES ('features.feedback', 'true', 'V1.1 体验反馈开关', now())
ON CONFLICT (config_key) DO UPDATE SET config_value = 'true', updated_at = now();
```

回滚立即关闭：

```sql
UPDATE config SET config_value = 'false' WHERE config_key = 'features.feedback';
```

关闭后小程序隐藏「我的」页的「意见反馈」「钓点实拍」、详情页 `···` 菜单的「意见反馈」和发布失败提示下方的「反馈这个问题」；反馈页显示暂未开放。`POST /api/v1/feedback` 与 `POST /api/v1/feedback/images` 返回 `FEATURE_DISABLED`（40302）。后台 `GET/PATCH /api/v1/admin/feedback` 不受开关影响，便于处理关闭前已提交的反馈。生产环境在体验期保持关闭，只在 staging 打开。

### 14.2 权限

后台新增 `feedback:read` 和 `feedback:handle`，`super_admin`、`operator`、`reviewer` 三种角色都具备：

- `feedback:read`：后台「体验反馈」入口、列表和详情读取。
- `feedback:handle`：`PATCH /api/v1/admin/feedback/:id` 更新状态和备注。

服务端 `RolesGuard` 是唯一权威；客户端按钮和入口只读取 `GET /api/v1/admin/me` 返回的权限名，不复制角色映射。

### 14.3 定时任务

`feedback:purge` 使用 `feedback:purge` advisory lock，多个 API 实例同时运行也只有一个实例执行：

```bash
# 清理 24 小时未使用的反馈截图和 90 天前的反馈，建议每小时或每日一次
docker compose --env-file /etc/szfisher/staging.env \
  -f infra/docker/docker-compose.prod.yml exec -T api \
  node apps/api/dist/jobs/purge-feedback.job.js
```

生产环境把 `--env-file` 换成 `/etc/szfisher/production.env`。本地开发可用 `pnpm --filter @szfisher/api feedback:purge`，API 镜像构建后对应脚本为 `feedback:purge:prod`。

任务规则：

- `feedback_image.status=pending` 且创建超过 24 小时：删除对象和行；若已有反馈引用该对象，则标记为 `used` 并保留。
- `trial_feedback` 创建超过 90 天：在同一事务中删除反馈并把图片标记为 `deleted`，随后删除对象。
- 对象删除失败时保留行作为重试指针，下一轮继续。
- 单次每类最多处理 100 行，事务超时 120 秒，避免长时间持有 advisory lock。

输出单行 JSON `event=feedback_purge`，字段 `images_deleted`、`feedback_deleted`、`objects_deleted`；未抢到锁时输出 `skipped=true`。不输出反馈正文、联系方式、图片 key、Token 或 openid。任务连续失败或长时间未执行时告警。

### 14.4 私有图片与签名预览

- 反馈截图 key 固定为 `feedback/{userId}/{ulid}.webp`，只写入私有工作桶 `OSS_WORK_BUCKET`，不写发布桶。
- 不提供公开反馈图片读取路由。`GET /api/v1/uploads/public/spots/:spotId/:file` 和 `GET /api/v1/uploads/public/ugc/:reportId/:file` 只服务钓点和公开 UGC，无法读取 `feedback/` key。
- 后台详情通过 `PreviewSignerService` 生成 15 分钟签名 URL，经 `GET /api/v1/uploads/preview` 校验 HMAC 和过期时间后由 API 读取对象；浏览器不接触 OSS 凭证或桶名。
- 签名 URL 只出现在后台详情响应和页面中，不写入日志，不进入小程序。过期或签名被篡改返回 404。

### 14.5 后台处理与 90 天保留

- 后台「体验反馈」按状态（待处理、处理中、已解决、已关闭）和类型（问题、建议、内容、钓点实拍、其他）筛选；详情展示正文、联系方式、页面、钓点、版本、设备和签名截图。
- 处理流程见 `docs/qa/v1.1-trial-feedback-template.md`：每日分流一次，P0 当天处理，P1 三天内处理，P2 每周汇总。
- 状态按 `open -> reviewing -> resolved/closed` 流转，备注最多 500 字；`PATCH` 自动记录 `handler_id` 和 `handled_at`。
- 联系方式只用于回访，不进入公开数据；日志、审计和导出不得包含 openid、联系方式和反馈正文。
- 反馈和图片保留 90 天，由 `feedback:purge` 自动删除。需要留存的结论应在删除前汇总到体验反馈模板或验收记录，不导出原文和联系方式。
- `photo` 类型反馈转钓点图片前必须完成授权和内容审核，来源、作者、授权方式、许可证、审核人和上线日期写入来源登记；没有合格图片的钓点继续显示「实景图待补充」品牌占位。

## 15. UniHuan 商品扩展（Phase 1）上线与回滚

### 15.1 功能开关

`features.shop` 存在 `config` 表，种子值为 `false`，生产默认关闭。staging 部署并完成商品配置后打开：

```sql
INSERT INTO config (config_key, config_value, description, updated_at)
VALUES ('features.shop', 'true', 'UniHuan 商品扩展开关', now())
ON CONFLICT (config_key) DO UPDATE SET config_value = 'true', updated_at = now();
```

回滚立即关闭：

```sql
UPDATE config SET config_value = 'false' WHERE config_key = 'features.shop';
```

关闭后 `GET /api/v1/products` 仍返回 HTTP 200，`data.items` 为空数组；小程序钓点详情不显示商品区块，品牌页与「我的」页商品入口隐藏。钓点详情、搜索、情报和反馈不受影响。后台商品和展示位置接口不受开关控制，可以继续准备草稿。

### 15.2 商品图片桶与公开路由

- 商品图 key 固定为 `products/{product_id}/{ulid}.webp`。输入支持 JPG、PNG、WebP，单张不超过 10 MB；服务端自动旋转、清除 EXIF、最长边缩到 1600 px 并转为 WebP，目标约 250 KB。
- 上传和草稿阶段只写私有工作桶 `OSS_WORK_BUCKET`。后台通过 `GET /api/v1/uploads/preview` 的 15 分钟签名 URL 预览草稿图。
- 商品发布时把 `image_keys` 复制到公开发布桶 `OSS_PUBLIC_BUCKET`，复制失败时商品保持草稿，不进入公开列表。
- 公开读取支持两种方式，二者都只读取发布桶：商品卡使用 `OSS_PUBLIC_BASE_URL` 拼接 key；`GET /api/v1/uploads/public/products/:productId/:file` 会校验商品为 `status=active`、`deleted_at` 为空且 `image_keys` 包含完整 key，否则返回 404。
- `GET /api/v1/uploads/public/products/:productId/:file` 响应为 `image/webp`，缓存一年且 `immutable`；使用 `OSS_PUBLIC_BASE_URL` 时在 OSS 或 CDN 上配置相同的缓存策略。
- 归档商品保留已发布的公开图，不删除对象，避免历史外链失效；需要清理时单独评估。
- OSS 账号需要对工作桶读写，并对发布桶具备复制写入和删除权限。小程序「开发设置」的 downloadFile 合法域名需要包含 `OSS_PUBLIC_BASE_URL` 使用的域名；使用 API 公开路由时沿用 API 域名。
