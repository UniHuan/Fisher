# UniHuan 内容到商品拓展设计

日期：2026-11-21  
范围：V2 预研，V1.1 体验期不实现  
状态：待确认

## 1. 背景与目标

优丽环钓鱼助手先用「找钓点」建立深圳本地钓友的使用场景。下一阶段要把「在哪个钓点、钓什么鱼、用什么装备」的内容场景，接到 UniHuan 自有品牌的渔具、渔夫帽、防晒等产品上。

目标是让内容成为品牌入口，而不是在现有工具里再做一个孤立商城。第一阶段只做商品卡、场景展示和购买动作跳转，交易在微店完成。后续接京东时，只增加渠道实现，不改内容侧和商品卡结构。

成功标准：

- 钓点详情能按钓点和鱼种展示相关商品卡
- 商品卡点击后能稳定打开微店购买入口，失败时有可用的降级动作
- 后台能独立维护商品、渠道和展示位置，不需要改代码
- 关闭 `features.shop` 后，所有商品入口消失，钓点主流程不受影响
- 能统计商品曝光和点击，为后续选品和渠道决策提供依据

## 2. 非目标

- 不在 SZFisher 内做购物车、订单、支付、退款、物流和发票
- 不做商品评价、积分、优惠券、会员价
- 不做自动从 UGC 正文识别商品
- 不做个性化推荐算法，第一版只做人工配置的展示位置
- 不修改 `spot`、`report` 现有表结构
- 不因为商品功能增加手机号、收货地址等个人信息的采集

## 3. 约束

### 3.1 微店的购买动作

微店是第三方平台，不是微信官方小店。微信小程序内不能直接嵌入微店的下单流程。第一版可用的购买动作有三类：

- 跳转微店小程序
- 打开微店 H5 链接，第一版复制链接，`web-view` 作为后续增强
- 复制商品链接

商品二维码保留为线下物料能力，不在第一版实现。具体哪一种可用，取决于微店提供的商品链接形态和小程序 appid。因此购买动作必须由后台配置，前端只执行标准动作，不能把某个链接写死在页面里。

### 3.2 现有技术栈

- API：NestJS 11、Prisma 6、PostgreSQL 18
- 后台：Next.js 16 静态导出、React 19、Ant Design 6
- 小程序：原生 TypeScript，无组件库
- 契约：OpenAPI 生成 `packages/api-client`
- 功能开关：`config` 表的 `features.*`，通过 `/api/v1/config` 下发
- 权限：服务端 RBAC，权限名定义在 `apps/api/src/modules/auth/permissions.ts`
- 图片：私有工作桶 + 公开发布桶，`ImageProcessorService` 统一转 WebP 和去 EXIF

### 3.3 合规

- 商品展示和外链跳转不改变小程序的服务类目，交易不在 SZFisher 内完成
- 商品卡展示「参考价」时必须同时展示「以微店页面为准」
- 不采集收货地址、手机号、支付信息
- 如果后续改为小程序内下单，必须重新评估类目、微信支付、售后和隐私指引

## 4. 方案选择

### 4.1 采用 A：内容卡片 + 购买动作适配器

SZFisher 维护轻量商品卡、展示位置和渠道映射。用户点击后，由服务端返回标准购买动作，小程序执行跳转或复制链接。

- 商品目录、展示位置、渠道映射三层分离
- 微店先接，京东后面加一个渠道实现
- 不碰交易和售后
- 微店店还没开好时也能先做后台和页面

### 4.2 暂缓 B：微店商品同步

通过微店开放平台 API 拉商品、价格和库存，写入本地缓存，再由 SZFisher 展示。

- 价格库存准确，不用重复维护
- 需要微店开放平台权限、审核和限额
- 适合 SKU 多、价格变动频繁之后再上
- 作为 `CatalogSource` 实现接入，不改变商品卡和展示位置

### 4.3 暂缓 C：自建商城

在 SZFisher 内做商品、购物车、订单、支付和售后。

- 转化路径最短，数据最完整
- 需要电商类目、微信支付、客服、售后、发票和物流
- 与「先开微店」的策略冲突
- 只有 A/B 验证出稳定转化后再单独设计

## 5. 总体架构

```
小程序页面
  ├─ 钓点详情：GET /api/v1/products?surface=spot_detail&target_id=...
  └─ 品牌页：  GET /api/v1/products?surface=brand_page
        │
        ▼
commerce 模块
  ├─ ProductPlacementService  选展示位置
  ├─ ProductService           商品卡组装
  ├─ PurchaseActionResolver   渠道购买动作
  └─ ProductImageService      商品图上传和发布
        │
        ▼
product / product_channel / product_placement
        │
        ▼
后台「商品」抽屉：商品、渠道、展示位置、图片
```

依赖方向：

- `commerce` 可以只读查询 `spot` 表做展示位置校验
- `public-spots`、`reports`、`feedback` 不依赖 `commerce`
- 小程序通过两次独立请求组合页面，钓点详情接口的响应结构不变
- 商品卡 DTO 只通过 OpenAPI 生成，不手写重复类型

模块边界：

```
apps/api/src/modules/commerce/
  commerce.module.ts
  product.controller.ts             公共商品接口
  admin-product.controller.ts       后台商品接口
  product.service.ts                商品卡组装
  product.repository.ts             商品和渠道读写
  placement.service.ts              展示位置匹配
  purchase-action.service.ts        购买动作校验和解析
  product-image.service.ts          商品图上传和发布
  dto/

apps/admin/src/admin/ProductDrawer.tsx
apps/miniprogram/src/commerce.ts
apps/miniprogram/src/components/product-card/
apps/miniprogram/src/pages/shop/
```

`product.service.ts` 不直接处理 HTTP，`placement.service.ts` 不组装商品卡，`purchase-action.service.ts` 不做数据库查询。职责单一，后续接微店同步或京东时只替换或新增对应实现。

## 6. 数据模型

### 6.1 product

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `product_id` | Char(26) | ULID |
| `brand` | VarChar(32) | 默认 `unihuan` |
| `title` | VarChar(80) | 商品名 |
| `subtitle` | VarChar(120) | 一句话卖点，可为空 |
| `description` | Text | 详情文案，可为空 |
| `category` | VarChar(32) | `rod`、`reel`、`line`、`bait`、`hat`、`sun_protection`、`accessory`、`other` |
| `image_keys` | String[] | 商品图，第一张为封面 |
| `cover_image_key` | VarChar(255) | 封面 key，可为空 |
| `status` | VarChar(32) | `draft`、`active`、`archived` |
| `sort_weight` | Int | 默认 0，越大越靠前 |
| `created_at` | Timestamptz | |
| `updated_at` | Timestamptz | |
| `deleted_at` | Timestamptz | 软删除 |

索引：`(status, sort_weight)`、`(category, status)`、`(updated_at)`。

### 6.2 product_channel

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `channel_id` | Char(26) | ULID |
| `product_id` | Char(26) | 外键到 product |
| `channel` | VarChar(32) | `weidian`、`jd`，后续可扩展 |
| `external_product_id` | VarChar(64) | 渠道商品 ID，可为空 |
| `purchase_action` | VarChar(16) | `mini_program`、`h5`、`copy_link`；`qr` 预留 |
| `action_payload` | JsonB | 动作参数，按类型校验 |
| `price_display` | VarChar(32) | 参考价文本，可为空 |
| `status` | VarChar(16) | `active`、`disabled` |
| `created_at` | Timestamptz | |
| `updated_at` | Timestamptz | |

唯一约束：`(product_id, channel)`。  
索引：`(channel, status)`。

### 6.3 product_placement

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `placement_id` | Char(26) | ULID |
| `product_id` | Char(26) | 外键到 product |
| `surface` | VarChar(32) | `spot_detail`、`home`、`report_detail` |
| `scope` | VarChar(16) | `spot`、`fish` |
| `target_id` | Char(26) | `scope=spot` 时必填，填 `spot_id`；不建外键 |
| `fish_keys` | String[] | `scope=fish` 时至少 1 个鱼种字典 key |
| `district` | VarChar(32) | 行政区，可为空，预留给后续区域规则 |
| `sort_order` | Int | 默认 0，越小越靠前 |
| `starts_at` | Timestamptz | 可为空 |
| `ends_at` | Timestamptz | 可为空 |
| `status` | VarChar(16) | `active`、`disabled` |
| `created_at` | Timestamptz | |
| `updated_at` | Timestamptz | |

校验规则：

- `scope=spot`：`target_id` 必填，`fish_keys` 必须为空
- `scope=fish`：`target_id` 必须为空，`fish_keys` 至少 1 个
- 第一版 `surface` 只允许 `spot_detail`；`home` 和 `report_detail` 是预留值，后台不开放

索引：`(surface, scope, target_id, status, sort_order)`、`(product_id)`，`fish_keys` 建 GIN 索引。

`target_id` 不建外键，避免内容表和商品表互相锁死。后台保存展示位置时由 commerce 模块只读校验钓点是否存在；钓点下线后，展示位置自动失效，不需要级联删除。一个商品要同时覆盖某个钓点和某个鱼种，创建两条展示位置，不做 OR 混排。

## 7. 接口契约

### 7.1 公共商品列表

`GET /api/v1/products`

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `surface` | 是 | 第一版只允许 `spot_detail`、`brand_page`；`home`、`report_detail` 预留 |
| `category` | 否 | 只用于 `brand_page`，按分类筛选 |
| `target_id` | 条件必填 | `spot_detail` 必填；`brand_page` 忽略 |
| `fish_keys` | 否 | 逗号分隔的鱼种字典 key，最多 5 个，只用于 `spot_detail` |
| `district` | 否 | 预留，第一版不参与匹配 |
| `limit` | 否 | 只用于 `spot_detail`，默认 6，最大 12 |

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "product_id": "01HX...",
        "title": "UniHuan 轻量路亚竿",
        "subtitle": "深圳湾岸钓适用",
        "category": "rod",
        "image_url": "https://...",
        "channels": [
          {
            "channel": "weidian",
            "label": "微店",
            "price_display": "¥299 起",
            "purchase_action": {
              "type": "mini_program",
              "app_id": "wx...",
              "path": "/pages/product/detail?id=...",
              "fallback_url": "https://weidian.com/item.html?itemID=..."
            }
          }
        ]
      }
    ]
  },
  "request_id": "req_..."
}
```

匹配规则：

1. `surface=brand_page` 返回所有 `active` 商品，按 `sort_weight` 倒序，最多 100 个，支持服务端按 `category` 筛选。品牌页不读取 `product_placement`。超过 100 个商品时再加分页，不在第一版做。
2. `surface=spot_detail` 返回满足以下任一条件的商品：
   - 存在 `scope=spot` 且 `target_id` 等于当前 `spot_id` 的启用展示位置
   - 存在 `scope=fish` 且 `fish_keys` 与请求的 `fish_keys` 有交集的启用展示位置
3. 只返回 `status=active` 的商品和 `status=active` 的渠道
4. 展示位置的 `starts_at`、`ends_at` 必须覆盖当前时间
5. 同一商品只出现一次；钓点定向优先于鱼种匹配，然后按 `sort_order`、`sort_weight` 排序
6. `surface=home` 和 `surface=report_detail` 第一版返回空数组
7. `district` 第一版只作为预留参数，不参与匹配
8. `features.shop=false` 时返回空数组，HTTP 仍为 200

第一版每个商品只启用一个渠道，商品卡取 `channels[0]`。服务端按 `weidian`、`jd` 的优先级排序返回。`channels` 数组保留多渠能力，后续接京东时前端可以改成渠道选择。

缓存：`Cache-Control: public, max-age=60`。

### 7.2 后台接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/products` | `product:read` | 分页、状态和分类筛选 |
| POST | `/api/v1/admin/products` | `product:write` | 创建草稿 |
| PUT | `/api/v1/admin/products/:id` | `product:write` | 更新商品和渠道 |
| POST | `/api/v1/admin/products/:id/archive` | `product:write` | 归档 |
| POST | `/api/v1/admin/products/:id/images` | `product:write` | 上传商品图 |
| GET | `/api/v1/admin/product-placements` | `product:read` | 按 surface 和 target 查询 |
| POST | `/api/v1/admin/product-placements` | `product:write` | 新增展示位置 |
| PUT | `/api/v1/admin/product-placements/:id` | `product:write` | 更新展示位置 |
| DELETE | `/api/v1/admin/product-placements/:id` | `product:write` | 删除展示位置 |

权限分配：

- `super_admin`：`product:read`、`product:write`
- `operator`：`product:read`、`product:write`
- `reviewer`：无商品权限

审计动作：`product.create`、`product.update`、`product.archive`、`product.image_upload`、`product.placement_create`、`product.placement_update`、`product.placement_delete`。审计只记录商品 ID、状态、渠道、展示位置和目标 ID，不记录完整文案。

### 7.3 购买动作契约

```ts
type PurchaseAction =
  | {
      type: 'mini_program';
      app_id: string;
      path: string;
      fallback_url?: string;
    }
  | { type: 'h5'; url: string }
  | { type: 'copy_link'; url: string; toast?: string };
```

服务端校验：

- `mini_program.app_id` 匹配 `^wx[0-9a-f]{16}$`
- `mini_program.path` 以 `/` 开头，最长 200 字符
- `h5.url`、`copy_link.url`、`fallback_url` 必须是 `https://`
- 第一版 `channel` 只允许 `weidian`，`jd` 在 Phase 3 开放
- 未知 `channel` 或 `purchase_action` 在后台保存时拒绝
- `qr` 作为线下物料动作保留，不进入第一版契约

前端执行：

- `mini_program`：`wx.navigateToMiniProgram`；失败且有 `fallback_url` 时复制链接并提示
- `h5`：第一版复制链接并提示「链接已复制，请在浏览器打开」
- `copy_link`：复制链接并提示

## 8. 小程序设计

### 8.1 钓点详情

在钓点信息之后、钓友情报之前增加「此钓点常用装备」区块。

- 只在 `features.shop=true` 时请求商品
- 横向滚动，最多 6 张卡
- 没有商品时整个区块不渲染，不显示空状态
- 商品接口失败时静默隐藏，不影响钓点详情和情报加载
- 「查看全部」进入品牌页

商品卡结构：

```
┌──────────────┐
│   商品图      │
│ 标题          │
│ 一句话卖点    │
│ ¥299 起  微店 │
└──────────────┘
```

### 8.2 品牌页

新增页面 `pages/shop/index`，不新增 tab。

入口：

- 钓点详情「查看全部」
- 我的页面「UniHuan 装备」

页面内容：

- 顶部品牌标题和一句介绍
- 分类筛选：全部、竿、轮、线、饵、帽子、防晒、配件
- 商品卡列表
- 底部说明「商品由 UniHuan 微店提供，价格和售后以微店页面为准」

`features.shop=false` 时直接打开品牌页显示「暂未开放」。

### 8.3 组件与模块

- `components/product-card/`：商品卡展示组件
- `src/commerce.ts`：`loadProductCards`、`openPurchaseAction`、商品事件
- `src/api.ts`：只增加类型导出和 `fetchProductCards`，购买动作不放这里

### 8.4 埋点

微信自定义分析事件：

- `product_impression`：`product_id`、`surface`、`target_id`、`channel`
- `product_click`：`product_id`、`surface`、`target_id`、`channel`
- `purchase_action_open`：`action_type`、`channel`、`product_id`
- `purchase_action_fail`：`action_type`、`channel`、`product_id`、`reason`

不记录 openid、手机号、地址或完整链接。事件名需要先在微信后台自定义分析中创建，否则可能被丢弃。

服务端分析：

- 新增 `api_product_list` 事件，记录 `surface`、`result_count`、`spot_id`
- `analytics.service.ts` 的白名单增加 `api_product_list`、`surface`、`product_id`

## 9. 后台设计

新增「商品」入口，只有 `product:read` 权限可见。商品管理放在独立抽屉，不进入钓点编辑器。

### 9.1 商品列表

- 筛选：状态、分类、关键词
- 列：封面、标题、分类、状态、渠道数、展示位置数、更新时间
- 操作：编辑、归档

### 9.2 商品编辑

- 基本信息：标题、副标题、描述、分类、排序
- 商品图：上传、预览、设为封面、删除
- 渠道：第一版只开放微店；每个渠道配置购买动作类型、参数、参考价、启用状态。京东字段在 Phase 3 开放
- 保存草稿、发布、归档
- 发布前校验：至少 1 张图、至少 1 个启用渠道、购买动作参数合法

### 9.3 展示位置

- 页面类型：钓点详情、首页、情报详情
- 钓点详情：选择钓点，可再加鱼种和行政区
- 品牌页是完整商品目录，不需要展示位置
- 排序、起止时间、启用状态
- 保存时校验钓点存在；钓点下线后展示位置自动不生效

### 9.4 商品图片

- 复用 `ImageProcessorService`，新增 `product` 用途，目标 250 KB
- 存储路径：`products/{product_id}/{ulid}.webp`
- 草稿用工作桶签名预览，发布时复制到公开桶
- 归档商品不删除公开图，避免历史外链失效；需要清理时走单独任务

## 10. 扩展点

### 10.1 微店商品同步

新增接口：

```ts
interface CatalogSource {
  code: string;
  sync(): Promise<ExternalProduct[]>;
}
```

第一版不实现。后续微店开放平台权限下来后，新增 `WeidianCatalogSource`，由定时任务把商品和价格写入 `product`、`product_channel`。商品卡、展示位置和购买动作不变。

### 10.2 京东渠道

新增 `JdPurchaseActionResolver`，把京东 SKU 转成 H5 链接或京东小程序路径。前端不需要新增渠道判断。

### 10.3 情报关联商品

保留 `surface=report_detail` 和 `target_id=report_id`。后续可以在鱼获情报卡上显示「同款装备」，仍然走同一套展示位置和商品卡。

### 10.4 推荐规则

第一版只做人工配置。后续可以在 `product_placement` 上增加季节、天气、收费类型等条件，或者引入独立的推荐服务。商品卡契约不变。

### 10.5 小程序内交易

如果 A/B 验证后决定自建交易，需要单独设计订单、支付、退款、地址和售后，不复用本次的商品卡表结构。

## 11. 上线与回滚

- `features.shop` 默认 `false`，写入 `config` 种子
- staging 先建 3 到 5 个测试商品，打开开关验证跳转
- 生产保持关闭，直到微店链接、商品图和文案确认
- 回滚：把 `features.shop` 改为 `false`，所有商品入口消失；已发布商品图保留，不影响钓点
- 单个商品或展示位置可以单独停用，不需要整体回滚

## 12. 测试

### 12.1 API

- `features.shop=false` 返回空数组
- 只返回 active 商品、active 渠道、有效时间内的展示位置
- 钓点定向和鱼种匹配的排序正确
- 同一商品不重复
- 后台权限：reviewer 无商品权限
- 购买动作参数校验：非法 appid、非 https 链接、未知类型被拒绝
- 公共响应不包含后台字段、成本价、内部备注
- 审计记录正确且不含完整文案

### 12.2 后台 Playwright

- 创建商品、上传图片、配置微店渠道
- 创建钓点展示位置
- 发布后公共商品接口返回商品卡，后台列表显示 active
- reviewer 看不到商品入口

### 12.3 小程序

- 商品卡渲染、空状态隐藏、接口失败不影响详情
- 三种购买动作的执行和降级
- `features.shop=false` 时详情页不请求商品

### 12.4 契约

- `openapi:check` 无差异
- `pnpm -r lint`、`pnpm -r typecheck` 通过

## 13. 分阶段

### Phase 0：设计与契约

- 本文档确认
- 确认微店商品链接形态和跳转方式
- 不写业务代码

### Phase 1：商品卡最小闭环

- 数据表迁移
- commerce 模块、公共商品接口、后台商品和展示位置接口
- 后台商品抽屉和图片上传
- 小程序钓点详情商品区块、品牌页、购买动作
- `features.shop` 开关和埋点
- 测试和 staging 验收

### Phase 2：微店商品同步

- 微店开放平台权限
- `WeidianCatalogSource` 和同步任务
- 价格、库存和商品状态自动更新

### Phase 3：多渠与内容关联

- 京东渠道
- 情报详情「同款装备」
- 季节、天气、鱼种推荐规则

## 14. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 微店小程序跳转不可用 | 点击后无法购买 | 后台切换为复制链接或 H5，不改代码 |
| 参考价过期 | 用户投诉 | 标注「以微店页面为准」，优先推动 Phase 2 自动同步 |
| 微信审核认为在站内卖货 | 审核被拒 | 可关闭价格展示，只保留品牌内容和外链 |
| 商品图版权 | 侵权 | 只用 UniHuan 自有拍摄图，后台记录来源 |
| 展示位置指向已下线钓点 | 商品出现在无效页面 | 公共接口只返回已发布钓点；后台保存时校验，失效位置自动忽略 |
| 商品接口拖慢钓点详情 | 体验下降 | 独立请求、60 秒缓存、失败静默隐藏、最多 6 张卡 |

## 15. 待确认

- 微店商品链接的实际形态：小程序 appid/path、H5 链接，还是只有商品 ID
- 品牌页是否只放商品，还是需要品牌故事和内容板块
- 首发商品清单和图片是否已经准备好

## 16. 已定决策

- 采用 A，不在 SZFisher 内做交易
- 商品、渠道、展示位置三层分离
- 商品接口独立于钓点详情接口，不改现有响应结构
- `target_id` 不建外键，内容与商品单向依赖
- 购买动作由后台配置，前端只执行标准动作
- `features.shop` 默认关闭，按环境灰度
- 微店先接，京东通过新增渠道实现接入
