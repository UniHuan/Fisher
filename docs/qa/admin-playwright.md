# 后台 Playwright 主链路

日期：2026-11-17  
测试文件：`apps/api/test/playwright/admin.spec.ts`  
结果：1 个场景通过，耗时约 14 秒

## 覆盖内容

- 超级管理员密码登录
- 首次登录 TOTP 绑定：读取手动密钥、生成动态码、保存恢复码并进入后台
- 新增钓点：名称、区域、地址、坐标、鱼种、收费、水域、场所
- 保存草稿、标记核实、发布
- 打开周边场所抽屉，新增 POI 并绑定
- 打开字典维护抽屉
- 打开审计日志，确认存在 `spot.publish`
- 页面刷新后下线钓点

## 运行方式

```bash
pnpm test:admin:install   # 首次安装 Chromium
pnpm test:admin
```

测试使用：

- 测试库：`szfisher_test`
- API：`http://localhost:3011`
- 静态后台：`http://localhost:3010`
- 独立端口，不占用本地 3000/3001
- 全局 setup 会幂等执行字典种子
- 测试账号、钓点和 POI 使用时间戳前缀，结束后通过 Prisma 清理

Playwright 会自动构建 admin 静态导出，用 Python 静态服务器托管，避免 Next dev 单目录限制。

## 已知边界

- 仅覆盖 Chromium，1280 像素桌面视口
- 未覆盖图片上传、Excel 导入和地图选点，这三项需要单独测试数据或腾讯 JS Key
- 未接入 GitHub Actions；CI 接入需要 PostgreSQL service、Playwright 浏览器缓存和 3010/3011 端口
- 首次运行需要测试库已迁移；全局 setup 只负责种子，不执行 `migrate reset`
