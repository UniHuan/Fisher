# ADR-011：数据库版本标准升级为 PostgreSQL 18

状态：已接受（2026-11-19）

背景：
v1.4 PRD 与 ADR-003 将数据库标准定为 PostgreSQL 15。项目计划 2026 年底上线，而 PostgreSQL 15 的社区支持周期到 2027 年 11 月结束，上线后约一年就需要规划大版本升级。当前代码只使用标准 SQL、Prisma、JSONB、数组和行锁，不依赖任何扩展或版本专有特性，具备直接采用新版本的条件。

选项：

1. 继续使用 PostgreSQL 15：零改动，但支持周期只剩约一年，上线后很快面临升级。
2. 升级到 PostgreSQL 16 或 17：支持周期分别到 2028、2029 年，但仍需同步修改 CI、compose 与文档，收益低于 18。
3. 升级到 PostgreSQL 18：支持周期到 2030 年 11 月，阿里云 RDS 已提供正式版本（18.5），改动量与 16、17 相同。

决定：
采用 PostgreSQL 18，作为 staging、CI、本地开发和后续生产的统一标准。继续使用标准 PostgreSQL，不使用云厂商专有内核。

影响：

- `.github/workflows/ci.yml`、`infra/docker/docker-compose.yml`、`infra/docker/docker-compose.test.yml` 的镜像由 `postgres:15` 改为 `postgres:18`。
- PostgreSQL 18 镜像的 PGDATA 为 `/var/lib/postgresql/18/docker`，compose 的卷挂载点改为 `/var/lib/postgresql`。已有本地开发卷需要重建，执行 `docker compose down -v` 后重新启动。
- staging RDS 使用 PostgreSQL 18，数据库名 `szfisher_staging`。
- 代码无需修改；Prisma 6.19.3 使用标准协议，但仍需在 18 上跑迁移与集成测试。
- PRD v1.4 中当前版本的表述同步更新；v1.2、v1.3 与历史计划文档保留原样。
- 部署机执行备份脚本时需要 PostgreSQL 18 的 `pg_dump` 和 `pg_restore`，旧版客户端无法连接或备份 18 实例。
- 生产使用 RDS 高可用版 18 前，需确认目标地域和系列可售；若不可售，单独评估生产版本。

后续：

- 合并后观察 CI 集成与 Playwright 在 PostgreSQL 18 上是否全绿。
- RDS 创建后先执行 Prisma 迁移与 smoke，再部署 API。
- 在 staging 验收清单中记录数据库版本。
