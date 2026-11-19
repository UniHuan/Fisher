# Staging 部署与验收清单

适用范围：SZFisher V1.0 首次 staging 部署和每次重大发布前复验。  
相关文档：[部署与运维基线](deployment.md)、[数据质量报告](../qa/data-quality.md)、[下一步行动](v1.0-next-actions.md)

## 1. 目标

staging 必须与 production 使用同一套镜像、同一套迁移和同一套 Nginx 配置，只替换域名、密钥、数据库和对象存储。staging 通过后再进入 production。

## 2. 前置条件

- [ ] 阿里云账号、地域、预算和资源命名规则已确认
- [ ] `unihuan.com` 备案主体和接入商已核验
- [ ] staging 子域已规划：`fish-api-staging`、`fish-admin-staging`、`fish-static-staging`
- [ ] 通配符证书或三个单域证书已签发，DNS 解析权限可用
- [ ] ACR 命名空间和镜像仓库已创建
- [ ] RDS PostgreSQL 18 已创建，未开放公网
- [ ] OSS 工作桶、发布桶、admin 桶已创建，默认私有
- [ ] CDN、WAF、SLB、ECS 安全组已准备
- [ ] 腾讯地图 staging JS Key 和 Server Key 已申请，域名与 IP 白名单已配置
- [ ] staging 管理员账号和 TOTP 已准备
- [ ] 微信小程序合法域名和体验成员已准备，至少可做开发版联调

## 3. 资源与隔离

| 资源   | staging 要求                    | 禁止                                  |
| ------ | ------------------------------- | ------------------------------------- |
| RDS    | 独立实例或独立数据库，独立账号  | 复用 production 数据库                |
| OSS    | 独立 staging 工作桶和发布桶     | 写入 production 桶                    |
| 密钥   | 独立 staging 值，KMS 或参数仓库 | 复用 production 密钥                  |
| 域名   | 只使用 staging 子域             | 让 staging 流量进入正式小程序合法域名 |
| 管理员 | staging 专用账号                | 复用生产管理员                        |
| 数据   | 脱敏或公开测试数据              | 导入真实用户个人信息                  |

## 4. 构建镜像

使用当前 commit 生成不可变 tag，禁止 `latest`。

```bash
TAG="$(git rev-parse --short HEAD)"
REGISTRY="registry.cn-shenzhen.aliyuncs.com/<staging-namespace>"

docker build -f infra/docker/Dockerfile.api \
  -t "$REGISTRY/szfisher-api:staging-$TAG" .

docker build -f infra/docker/Dockerfile.admin \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://fish-api-staging.unihuan.com/api/v1 \
  --build-arg NEXT_PUBLIC_TENCENT_MAP_JS_KEY="<staging-js-key>" \
  -t "$REGISTRY/szfisher-admin:staging-$TAG" .

docker push "$REGISTRY/szfisher-api:staging-$TAG"
docker push "$REGISTRY/szfisher-admin:staging-$TAG"
```

记录两个镜像的 digest，后续验收和回滚都引用 digest，不只引用 tag。

## 5. 环境变量

从 KMS 或 staging 参数仓库注入，不写入镜像或 Git。

必填：

- `DATABASE_URL`
- `ADMIN_ORIGINS=https://fish-admin-staging.unihuan.com`
- `JWT_ACCESS_SECRET`
- `CSRF_SECRET`
- `TOTP_ENCRYPTION_KEY`
- `OSS_REGION`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_WORK_BUCKET`
- `OSS_PUBLIC_BUCKET`
- `OSS_PUBLIC_BASE_URL`

建议：

- `STORAGE_DRIVER=oss`
- `TENCENT_MAP_SERVER_KEY`
- `LOG_LEVEL=info`
- `ANALYTICS_RETENTION_DAYS=180`

检查：

- [ ] staging 密钥全部独立生成，没有复制 production
- [ ] `ADMIN_ORIGINS` 只包含 staging admin 域名
- [ ] OSS 桶名和域名是 staging 资源
- [ ] 环境变量没有打印到 CI 日志

## 6. 数据库与迁移

- [ ] 创建 staging 数据库和最小权限账号
- [ ] 运行 `prisma migrate deploy`，记录迁移版本
- [ ] staging 种子只创建字典和 staging 管理员
- [ ] 管理员密码至少 12 位，首次登录绑定 TOTP
- [ ] 生产管理员不在种子文件中创建
- [ ] 迁移前后记录核心表行数

命令：

```bash
export API_IMAGE="$REGISTRY/szfisher-api:staging-$TAG"
docker compose --env-file /etc/szfisher/staging.env \
  -f infra/docker/docker-compose.prod.yml run --rm migrate
```

## 7. 发布与健康检查

- [ ] API 容器启动，`/health` 返回 200
- [ ] `/ready` 返回 200，数据库可用
- [ ] admin 静态站可访问，API 地址指向 staging
- [ ] SLB 健康检查使用 `/ready`
- [ ] Nginx 配置和 CSP 已加载
- [ ] 日志为 JSON，`request_id` 可追踪

```bash
scripts/smoke-api.sh https://fish-api-staging.unihuan.com
SMOKE_ADMIN_ORIGIN=https://fish-admin-staging.unihuan.com \
  scripts/smoke-api.sh https://fish-api-staging.unihuan.com
```

## 8. 功能验收

- [ ] 管理员登录、错误密码、TOTP 绑定和恢复码
- [ ] 新增草稿、编辑草稿、保存图片
- [ ] 图片上传、封面选择、WebP 预览、公开图片 URL
- [ ] 地图选点和地址搜索
- [ ] 标记核实、发布校验、发布、下线
- [ ] 禁钓点列表默认隐藏，详情不可导航
- [ ] Excel 导入成功、部分失败、错误 CSV 下载
- [ ] POI 手工新增、绑定、周边展示
- [ ] POI 同步任务和失败原因展示
- [ ] 字典维护、审计日志筛选和导出
- [ ] 公开列表、搜索、筛选、详情和分页
- [ ] 小程序开发版联调，定位拒绝和导航

## 9. 安全验收

- [ ] 全站 HTTPS，HTTP 301 到 HTTPS
- [ ] admin 使用 WAF 和 IP 白名单
- [ ] API 只允许必要方法和请求体大小
- [ ] CORS 只允许 staging admin origin
- [ ] `__Host-` Cookie 属性正确
- [ ] OSS 工作桶私有，发布桶只读
- [ ] CDN 不缓存 admin `index.html`
- [ ] admin 和 API 返回 `X-Robots-Tag: noindex`
- [ ] WAF 绕过测试和直接访问 ECS 测试失败
- [ ] 依赖审计、镜像扫描和 SBOM 无高危
- [ ] 仓库和镜像中没有真实密钥

## 10. 监控与备份

- [ ] API 5xx 比例告警
- [ ] 核心接口 P95 告警
- [ ] `/ready` 失败告警
- [ ] RDS 连接数、CPU、存储告警
- [ ] 证书剩余天数告警
- [ ] POI 同步失败告警
- [ ] 每日逻辑备份完成并校验
- [ ] staging 恢复演练成功
- [ ] 日志保留和查询可用

## 11. 数据验收

- [ ] 导入 100 个基础钓点
- [ ] 运行 `quality:report --strict`
- [ ] 已发布不少于 100
- [ ] 开放或暂停不少于 90
- [ ] 禁钓点不超过 10
- [ ] 核心钓点不少于 50
- [ ] 核心钓点至少 1 张图、3 个周边场所
- [ ] 核实时间未过期
- [ ] 质量报告归档到发布记录

```bash
DATABASE_URL='postgresql://.../szfisher_staging?schema=public' \
  pnpm --filter @szfisher/api quality:report -- --strict
```

## 12. 验收签字

| 角色   | 确认内容                      | 签字 |
| ------ | ----------------------------- | ---- |
| 后端   | API、迁移、POI、日志          |      |
| 后台   | 登录、编辑、导入、发布        |      |
| 小程序 | 地图、筛选、详情、导航        |      |
| 测试   | 主链路、异常、真机矩阵        |      |
| 运维   | TLS、WAF、SLB、RDS、OSS、监控 |      |
| 安全   | 依赖、镜像、WAF、密钥、权限   |      |
| 业务   | 数据质量、内容审核、上线范围  |      |
