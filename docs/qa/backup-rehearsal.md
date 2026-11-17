# 本地备份恢复演练

日期：2026-11-17  
源库：本地 `szfisher`  
工具：`scripts/rehearse-backup.sh`

## 执行

```bash
DATABASE_URL='postgresql://szfisher:szfisher@localhost:5432/szfisher?schema=public' \
  scripts/rehearse-backup.sh
```

脚本会：

1. 调用 `backup-postgres.sh` 生成 custom-format dump
2. 校验 dump 可被 `pg_restore --list` 读取
3. 创建带时间戳的临时恢复库
4. `pg_restore --single-transaction` 恢复到临时库
5. 对比 `spot`、`poi`、`spot_poi`、`dictionary`、`admin_user` 行数
6. 删除临时恢复库和 dump

## 本次结果

```text
table source_count restore_count
spot 2 2
poi 0 0
spot_poi 0 0
dictionary 61 61
admin_user 1 1
rehearsal passed: szfisher -> szfisher_restore_20261117042012
```

## 边界

- 本次是本地逻辑备份恢复，不是托管 RDS 的 WAL/PITR 演练
- 没有验证大库恢复耗时、跨可用区故障和网络隔离
- 生产仍需按 PRD 9.7 做全量加 WAL 恢复到新实例，并记录 RTO/RPO
- 备份目录应挂载独立云盘并同步到 OSS，cron 和告警在 E8 环境配置
