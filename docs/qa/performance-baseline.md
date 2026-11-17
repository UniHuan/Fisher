# 本地性能基线

日期：2026-11-17  
基线提交：`ba2d0ed`  
环境：macOS、Node 24、本地 PostgreSQL、API 单实例、无 TLS/WAF/CDN

## 方法

- 合成数据脚本：`apps/api/scripts/seed-performance-data.ts`
- 压测脚本：`scripts/perf/load-test.mjs`
- 每个场景 8 秒、并发 20、先预热 1 次
- 数据全部为 `PERF-` 前缀的已发布钓点，测试完成后清理
- 详情场景取列表第一条钓点

```bash
createdb szfisher_perf
psql -d szfisher_perf -c 'ALTER SCHEMA public OWNER TO szfisher;'
DATABASE_URL='postgresql://szfisher:szfisher@localhost:5432/szfisher_perf?schema=public' \
  pnpm --filter @szfisher/api exec prisma migrate deploy
DATABASE_URL='postgresql://szfisher:szfisher@localhost:5432/szfisher_perf?schema=public' \
  pnpm --filter @szfisher/api perf:seed -- --count=1000 --prefix=PERF-
DATABASE_URL='postgresql://szfisher:szfisher@localhost:5432/szfisher_perf?schema=public' \
  PORT=3012 node apps/api/dist/main.js
BASE_URL=http://127.0.0.1:3012 node scripts/perf/load-test.mjs --scenario=list --duration=8 --concurrency=20
```

## 结果

| 钓点数 | 场景 | RPS | 错误率 | P50 | P95 | P99 | 最大 |
|---:|---|---:|---:|---:|---:|---:|---:|
| 100 | 列表 | 1039.4 | 0% | 18.21 ms | 27.99 ms | 35.71 ms | 77.68 ms |
| 100 | 详情 | 3919.5 | 0% | 4.96 ms | 7.48 ms | 9.17 ms | 26.10 ms |
| 100 | 搜索 | 1014.8 | 0% | 18.83 ms | 26.94 ms | 36.67 ms | 65.17 ms |
| 500 | 列表 | 250.4 | 0% | 76.77 ms | 123.69 ms | 146.80 ms | 180.33 ms |
| 500 | 详情 | 3638.5 | 0% | 5.16 ms | 8.05 ms | 12.41 ms | 187.81 ms |
| 500 | 搜索 | 238.3 | 0% | 80.82 ms | 136.89 ms | 152.40 ms | 164.95 ms |
| 1000 | 列表 | 121.3 | 0% | 157.03 ms | 287.67 ms | 303.68 ms | 316.86 ms |
| 1000 | 详情 | 3668.6 | 0% | 5.32 ms | 7.97 ms | 10.07 ms | 25.38 ms |
| 1000 | 搜索 | 115.6 | 0% | 163.73 ms | 292.32 ms | 319.80 ms | 375.55 ms |

原始输出：

```
list   100  rps=1039.4 p95=27.99  err=0
detail 100  rps=3919.5 p95=7.48   err=0
search 100  rps=1014.8 p95=26.94  err=0
list   500  rps=250.4  p95=123.69 err=0
detail 500  rps=3638.5 p95=8.05   err=0
search 500  rps=238.3  p95=136.89 err=0
list   1000 rps=121.3  p95=287.67 err=0
detail 1000 rps=3668.6 p95=7.97   err=0
search 1000 rps=115.6  p95=292.32 err=0
```

## 结论

- 本地 1000 个钓点的列表和搜索 P95 约 288 至 292 ms，低于 500 ms 目标，但余量已明显收窄。
- 详情接口不随列表规模增长，稳定在 10 ms 以内。
- 列表和搜索目前会把候选钓点加载到内存后排序分页，规模增长时 CPU 和内存压力会继续上升。
- 上线前必须在 staging 用真实网络、TLS、WAF、SLB、连接池和 2 台实例重跑，并补充 50 QPS 与 200 QPS 场景。
- 如果数据量向 5000 条接近，优先改为数据库侧筛选、排序和分页，或增加热点缓存，而不是继续依赖进程内排序。

本结果不代表生产容量，也不能替代 PRD 12.4 的 k6 压测。
