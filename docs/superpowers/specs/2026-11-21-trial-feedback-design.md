# 体验反馈与钓点实拍征集设计

日期：2026-11-21  
范围：V1.1 邀请体验期  
状态：已确认，进入实现

## 1. 目标

在体验版内提供一个低摩擦的反馈入口，收集问题、建议、内容问题和钓点实拍照片。反馈带页面、钓点、客户端版本、机型和截图，进入后台私有队列，帮助体验期快速定位问题和补齐核心钓点图片。

## 2. 非目标

- 不做公开反馈墙、用户回复、点赞或积分
- 不做自动把用户照片设为钓点封面，必须经过运营授权审核
- 不抓取或去水印使用网络图片
- 不向反馈用户承诺处理时限，只在页面说明会尽快查看

## 3. 数据模型

### TrialFeedback

- `feedback_id` ULID
- `user_id` 提交用户
- `category`：`bug`、`suggestion`、`content`、`photo`、`other`
- `content` 10 到 500 个 Unicode 字符
- `contact` 可选，最多 80 字符
- `page` 可选，当前页面路径
- `spot_id` 可选
- `app_version` 可选
- `device_info` JsonB，只存机型、系统、微信版本、SDK 版本
- `image_keys` 0 到 3 个
- `status`：`open`、`reviewing`、`resolved`、`closed`
- `handler_id`、`handled_at`、`note`
- 时间戳

索引：`(status, created_at)`、`(user_id, created_at)`、`(category, created_at)`。

### FeedbackImage

- `image_id` ULID
- `user_id`
- `object_key` 唯一，格式 `feedback/{userId}/{ulid}.webp`
- `size_bytes`
- `status`：`pending`、`used`、`deleted`
- `created_at`、`deleted_at`

索引：`(user_id, created_at)`、`(status, created_at)`。

对象存私有工作桶，不允许公开读取。

## 4. API

### C 端

- `POST /api/v1/feedback/images`：登录，multipart `file`，5 MB，JPEG/PNG/WebP，重编码 WebP，最长边 1600 px，每人每天最多 10 张，返回 `{ key, width, height, size_bytes }`
- `POST /api/v1/feedback`：登录，`{ category, content, contact?, page?, spot_id?, app_version?, device_info?, image_keys? }`，每人每天最多 5 条，返回 `{ feedback_id, status: 'open' }`
- 校验图片 key 必须属于当前用户且为 `pending`，在同一事务中标记 `used` 并写反馈
- 反馈图片用 `PreviewSignerService` 生成 15 分钟签名 URL，仅后台可读

### 后台

- `GET /api/v1/admin/feedback?status=&category=&cursor=&limit=`：默认 20，最大 50，按 `created_at DESC, feedback_id DESC`
- `GET /api/v1/admin/feedback/:id`：完整内容、签名图片、用户昵称、钓点名称、设备信息
- `PATCH /api/v1/admin/feedback/:id`：`{ status?, note? }`，写处理人和时间
- 权限：`feedback:read` 和 `feedback:handle`，三种后台角色都可用

### 定时任务

- `feedback:purge`：删除 24 小时仍为 `pending` 的图片和对象；删除 90 天前的反馈及其图片；使用 advisory lock

## 5. 小程序

- 入口：我的页面「意见反馈」；详情页 `···` 菜单「意见反馈」；发布失败提示下方「反馈这个问题」
- 表单：类型 chips、描述 10 到 500 字、最多 3 张截图、可选联系方式、隐私说明、提交
- 自动上下文：页面路径、钓点、版本、机型、系统、微信版本
- 选择 `photo` 类型时提示「提交即授权优丽环钓鱼助手在对应钓点页展示这张照片，我们会先审核」
- 成功提示「已收到，我们会尽快查看」，返回上一页
- 未登录时先登录；`features.feedback=false` 时入口隐藏

## 6. 钓点占位图与实拍

- 列表和详情在 `cover_image_url` 为空时显示品牌占位块，文案「实景图待补充」，不使用假图
- 体验成员通过 `photo` 类型反馈提交实拍，后台审核授权和内容后，由运营在后台上传到钓点
- 图片来源登记表记录：spot_id、来源、作者、授权方式、许可证、审核人、上线日期
- 禁止：带水印图片、地图截图、他人隐私、与钓点不一致的图片、未授权网络图片

## 7. 隐私与保留

- 反馈不公开，不出现在任何公开列表
- 不把 openid 写入反馈正文或日志
- 截图只在私有桶，后台签名预览
- 90 天后自动删除反馈和图片
- 联系方式仅用于回访，不进入公开数据

## 8. 配置与权限

- 新开关 `features.feedback`，默认 `false`，staging 开启
- 客户端配置暴露 `features.feedback`
- 后台权限新增 `feedback:read`、`feedback:handle`，三种角色都可用
- 生产环境默认关闭，体验期只在 staging 打开
