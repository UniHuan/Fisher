# 数据质量报告

日期：2026-11-17  
数据源：本地演示库 `szfisher`  
工具：`apps/api/scripts/spot-quality-report.ts`

## 当前结果

```json
{
  "published": 1,
  "drafts": 1,
  "offline": 0,
  "incomplete_required": 0,
  "core": 0,
  "core_with_images": 0,
  "core_with_three_pois": 0,
  "published_with_images": 0,
  "published_with_pois": 0,
  "banned": 0,
  "open_or_paused": 1,
  "expired_verification": 0,
  "passed": false
}
```

当前本地演示数据只能验证功能，不能达到上线数据门槛。失败项：

- 已发布钓点 1 个，目标至少 100 个
- 开放或暂停 1 个，目标至少 90 个
- 核心钓点 0 个，目标至少 50 个
- 核心钓点图片和周边覆盖均为 0

## 命令

```bash
DATABASE_URL='postgresql://.../szfisher?schema=public' \
  pnpm --filter @szfisher/api quality:report

# CI 或上线门槛检查：不达标时退出码为 1
DATABASE_URL='postgresql://.../szfisher?schema=public' \
  pnpm --filter @szfisher/api quality:report -- --strict
```

## 门槛定义

脚本按 PRD 7.2 与 12.3 检查：

- 已发布钓点不少于 100
- 禁钓点不超过 10
- 开放或暂停不少于 90
- 核心钓点不少于 50
- 必填字段完整率 100%
- 每个核心钓点至少 1 张图
- 每个核心钓点至少 3 个周边场所
- 核心钓点核实不超过 30 天，普通钓点不超过 90 天

## 数据运营建议

1. 先用 Excel 导入 100 个基础钓点，统一区域、坐标、收费、水域、场所和来源。
2. 优先补齐 50 个核心钓点的实拍图和 3 个周边场所。
3. 每周运行一次 `quality:report --strict`，把完整率、过期率和 POI 覆盖率纳入运营例会。
4. 上线前把报告归档到发布记录，不以压缩核实时间换取上线日期。
