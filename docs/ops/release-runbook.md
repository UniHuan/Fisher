# 发布与回滚 Runbook

适用范围：SZFisher API、admin 静态站、数据库迁移和小程序版本的发布。  
相关文档：[部署与运维基线](deployment.md)、[staging 清单](staging-checklist.md)、[GitHub 安全设置](github-security.md)

## 1. 角色

| 角色       | 职责                               |
| ---------- | ---------------------------------- |
| 发布负责人 | 执行发布、观察指标、决定继续或回滚 |
| 复核人     | 检查变更、迁移、备份和回滚方案     |
| 业务负责人 | 确认数据、内容和上线范围           |
| 安全负责人 | 确认密钥、权限、扫描和漏洞处置     |
| 值班人     | 处理告警、日志和用户反馈           |

单人维护时，发布负责人和复核人不能由同一个人绕过全部检查。必须保留 GitHub PR 审批、CI 和备份记录。

## 2. 发布前检查

- [ ] 需求范围冻结，PR 已合并
- [ ] main CI 和 CodeQL 全绿
- [ ] 镜像已构建并推送，记录 digest
- [ ] staging 已用同一镜像验收
- [ ] 数据库迁移已评审
- [ ] 本次发布没有未评估的破坏性 DDL
- [ ] 生产备份已完成并校验
- [ ] 回滚镜像 tag 和 admin 静态包已准备
- [ ] 监控、告警和值班人已确认
- [ ] 变更窗口和对外沟通已确认
- [ ] 安全扫描无高危未处置项

## 3. 发布步骤

### 3.1 构建与记录

```bash
TAG="$(git rev-parse --short HEAD)"
REGISTRY="registry.cn-shenzhen.aliyuncs.com/<production-namespace>"

docker build -f infra/docker/Dockerfile.api \
  -t "$REGISTRY/szfisher-api:$TAG" .
docker build -f infra/docker/Dockerfile.admin \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://fish-api.unihuan.com/api/v1 \
  --build-arg NEXT_PUBLIC_TENCENT_MAP_JS_KEY="<production-js-key>" \
  -t "$REGISTRY/szfisher-admin:$TAG" .

docker push "$REGISTRY/szfisher-api:$TAG"
docker push "$REGISTRY/szfisher-admin:$TAG"
```

记录镜像 digest、commit、构建时间、操作人。

### 3.2 数据库迁移

1. 确认备份完成，记录备份文件和时间。
2. 在 staging 演练同一迁移。
3. 生产只向前执行，禁止在发布窗口临时改 schema。
4. 迁移失败时 API 不启动，按回滚流程处理。

```bash
export API_IMAGE="$REGISTRY/szfisher-api:$TAG"
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml run --rm migrate
```

### 3.3 API 发布

```bash
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml up -d migrate api
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml ps
```

逐台检查：

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

### 3.4 Admin 发布

- 上传新的 `apps/admin/out/` 到发布桶。
- 刷新 `index.html` 和根路径 CDN。
- 保留带哈希静态资源的长缓存。
- 检查登录、TOTP、列表、编辑、图片、发布和下线。

```bash
ossutil cp -r apps/admin/out/ oss://fish-admin-prod/ --update
```

### 3.5 Smoke 与灰度

```bash
scripts/smoke-api.sh https://fish-api.unihuan.com
SMOKE_ADMIN_ORIGIN=https://fish-admin.unihuan.com \
  scripts/smoke-api.sh https://fish-api.unihuan.com
```

灰度建议：

1. 先放 5% 流量，观察 15 分钟。
2. 5xx、P95、登录失败率、图片错误率和 POI 同步没有异常后放 50%。
3. 再观察 30 分钟，最后全量。
4. 任何一项超过阈值，停止放量并回滚。

## 4. 观察指标

- API 5xx 比例，5 分钟窗口超过 1% 告警
- 核心接口 P95 超过 1 秒告警
- `/ready` 连续失败
- 登录失败率和 429 比例
- 数据库连接数和慢查询
- 图片上传失败率和公开图片 4xx/5xx
- POI 同步失败和配额
- 证书剩余天数
- 备份任务结果

## 5. 回滚

### 5.1 API 镜像回滚

1. 把 `API_IMAGE` 切回上一个已验证 tag 或 digest。
2. 重新启动 api。
3. 检查 `/health`、`/ready`、5xx、P95、CORS 和登录。
4. 记录回滚原因和时间。

```bash
export API_IMAGE="$REGISTRY/szfisher-api:<previous-tag>"
docker compose --env-file /etc/szfisher/production.env \
  -f infra/docker/docker-compose.prod.yml up -d api
```

### 5.2 Admin 回滚

1. 重新上传上一个 tag 的 `apps/admin/out/`。
2. 刷新 `index.html` 和根路径 CDN。
3. 验证登录和静态资源哈希。

### 5.3 数据库回滚

- 向前兼容迁移优先用镜像回滚。
- 不可逆 DDL 需要恢复备份或执行预评审的 down 脚本。
- 生产恢复必须由业务负责人和安全负责人双人确认。
- 禁止直接用开发库覆盖生产库。

## 6. 证书与密钥

### 证书续期

- 证书到期前 30 天告警。
- 使用 DNS-01 自动续期或提前手动续期。
- 续期后在 staging 验证，再替换生产证书。
- 检查 HSTS、CSP 和移动端证书链。

### 密钥轮换

- JWT、CSRF、TOTP 密钥轮换需要评估会话失效影响。
- OSS 和腾讯地图 Key 轮换后，旧 Key 先保留一个观察窗口再禁用。
- 轮换记录写入变更单，不在聊天或 Issue 中记录密钥值。

## 7. 备份与恢复

- 每日逻辑备份，保留 30 天。
- 备份文件权限 `0600`，落盘前校验。
- 定期同步到独立 OSS，使用服务端加密。
- 每季度做一次恢复演练，记录 RPO/RTO。
- 生产恢复只在新实例或隔离环境演练，不直接覆盖生产库。

```bash
DATABASE_URL=... BACKUP_DIR=/var/backups/szfisher \
  scripts/backup-postgres.sh
```

## 8. 事故处理

1. 确认影响范围和开始时间。
2. 停止继续放量，保留日志和现场。
3. 优先恢复服务，再定位根因。
4. 回滚或切换流量。
5. 记录时间线、影响、处置和后续动作。
6. 涉及个人信息、密钥或数据泄露时，按公司安全与合规流程上报。

## 9. 发布后复盘

- [ ] 发布是否按计划完成
- [ ] 是否发生回滚或紧急修复
- [ ] 指标是否在阈值内
- [ ] 是否有告警未覆盖
- [ ] 文档、runbook 和监控是否需要更新
- [ ] 后续动作有负责人和截止时间

## 10. Go/No-Go 清单

- [ ] staging 验收签字
- [ ] 100 个钓点质量门槛通过
- [ ] 小程序审核和真机矩阵通过
- [ ] 安全扫描、WAF 和渗透测试完成
- [ ] 备份恢复和回滚演练完成
- [ ] 监控、告警、值班和对外沟通就绪
- [ ] 生产密钥和账号权限确认
- [ ] 业务负责人明确同意上线
