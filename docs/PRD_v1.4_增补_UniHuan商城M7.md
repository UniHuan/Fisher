# 深圳钓鱼助手 PRD 增补 —— UniHuan 自有品牌商城（M7）

> 本文档是《深圳钓鱼助手产品需求文档（PRD）v1.4》的**增补章节**，编号与术语完全沿用主文档约定。
> 建议合并方式：将本文各节插入主文档对应章节，或作为独立附录引用。字段命名、ULID 主键、枚举字典、API 约定、模块边界均与主文档一致，不得另起炉灶。
>
> - 关联主文档：`PRD_v1.4.md`
> - 增补模块编号：**M7（UniHuan 品牌商城）**
> - 目标版本：**V1.1**（与 M5 用户内容、M6 个人中心同期接入）
> - 交易模式：**完整电商闭环**（微信支付原生下单）
> - 核心差异化：**钓点 / 鱼种 → 装备智能联动**
> - 文档状态：评审稿 v1.0

---

## 一、增补说明与战略对齐

### 1.1 为什么增补 M7

主文档 1.5「产品边界与反目标」将「电商闭环」列为反目标，本次增补**有意识地对齐并收敛该边界**：产品定位由「纯工具」升级为「工具 + 自有品牌电商」，但**不以第三方电商平台为竞争对象**，只做自有品牌 UniHuan 的成交，避免沦为通用商城。

产品一句话定位同步更新为：

> **深圳钓鱼助手 = 「找钓点 + 查鱼情 + 配齐装备 + 一键导航」的一站式钓鱼决策与采购平台。**

### 1.2 核心差异化（为什么联动是护城河）

普通渔具商城的竞争对象是「不知道买什么」的决策焦虑。UniHuan 商城不做 SKU 堆砌，而是把商品**锚定在钓点与鱼种上**：

- 用户在看「深圳湾公园北湾钓点」时，看到的是「该钓点适钓鲈鱼/鲫鱼 → 对应的 UniHuan 台钓/路亚套装」；
- 商品不是孤立货架，而是「跟着钓点买装备」的答案。

这复用主文档 M2 钓点详情的 `fish_types`、`fishing_method`、`water_type`、`venue_type` 字段，实现零额外采集成本的场景化推荐。

### 1.3 边界（避免喧宾夺主）

| 允许 | 不允许 |
| --- | --- |
| 自有品牌 UniHuan 商品上架、下单、售后 | 第三方品牌/商家入驻（不做平台化） |
| 钓点→商品推荐、鱼种→装备映射 | 独立搜索电商大而全的类目 |
| 套装 + 高复购耗材 | 高价专业装备（V1.1 不碰禧玛诺/达亿瓦价格带） |

---

## 二、功能模块增补

### 2.1 模块总表追加

| 模块编号 | 模块名称 | 核心职责 | 优先级 | 版本 |
| --- | --- | --- | --- | --- |
| **M7** | **UniHuan 品牌商城** | 商品展示、场景推荐、下单支付、订单、库存、售后 | **P1** | **V1.1** |

### 2.2 V1.1 交付清单追加

| 功能 | 模块 | 优先级 | 验收标准 |
| --- | --- | --- | --- |
| 商城首页 | M7 | P1 | 品牌区、套装推荐、分类入口、商品卡片正常 |
| 商品详情 | M7 | P1 | 字段完整，含「适配钓点/鱼种」联动区 |
| 钓点→装备推荐 | M7 | P1 | 钓点详情页按 fish_types 推荐对应套装，命中率可统计 |
| 加购与下单 | M7 | P1 | 微信支付下单，幂等，重复提交不重复扣款 |
| 订单中心 | M7 | P1 | 待支付/待发货/待收货/已完成/售后状态完整 |
| 库存扣减 | M7 | P1 | 并发下单不超卖，下单失败自动回补 |
| 商城后台管理 | M0 | P1 | 商品、订单、库存、售后的增删改查与审核 |
| 售后（退款） | M7 | P1 | 退款流程可走通，微信支付原路退回 |

---

## 三、数据模型增补

> 沿用主文档 3.1 数据模型原则：ULID 主键、snake_case、软删除、`created_at/updated_at/deleted_at`、金额用 decimal 字符串、状态机对外只展示已发布。

### 3.1 实体关系追加

```text
product 1 --- N product_sku          （商品与规格）
product 1 --- N product_recommendation N --- 1 spot   （商品↔钓点推荐关系）
product 1 --- N product_fish_map N --- 1 fish_dict     （商品↔鱼种适配）
app_user 1 --- N order                （V1.1）
order 1 --- N order_item              （订单与明细）
app_user 1 --- N cart_item N --- 1 product_sku         （购物车）
order 1 --- N refund                  （售后）
```

### 3.2 商品 product

| 字段 | 说明 | 类型 | 必填 | 展示 | 备注 |
| --- | --- | --- | --- | --- | --- |
| product_id | 商品唯一标识 | string(26) | 是 | 否 | ULID，主键 |
| product_name | 商品名称 | string(80) | 是 | 是 | 例如「UniHuan 台钓入门套装 5.4m」 |
| brand_code | 品牌标识 | enum | 是 | 是 | 默认 `unihuan`，预留多品牌 |
| category | 商品类目 | enum | 是 | 是 | 见 3.8 类目字典 |
| subtitle | 副标题/卖点 | string(120) | 否 | 是 | 例如「新手首选，配好直接开钓」 |
| price | 售价（分） | decimal(10,2) | 是 | 是 | 元，decimal 字符串 |
| market_price | 划线价（分） | decimal(10,2) | 否 | 是 | 用于促销展示 |
| cost_price | 成本价（分） | decimal(10,2) | 否 | 否 | 仅后台可见，毛利核算 |
| images | 商品图 | array | 是 | 是 | 最多 9 张，存对象存储 key，规则同 3.2 钓点图 |
| cover_image_key | 封面图 key | string(255) | 是 | 是 | 规则同钓点 cover_image_key |
| detail_html | 商品详情富文本 | text | 否 | 是 | 内容安全审核后展示 |
| stock_total | 总库存 | int | 是 | 是 | 展示库存状态，不展示精确库存 |
| sales_count | 累计销量 | int | 否 | 是 | 后台可校准 |
| tags | 标签 | array | 否 | 是 | 例如「爆款」「新手」「鲈鱼专用」 |
| is_recommend | 是否首页推荐 | boolean | 是 | 否 | 默认 false |
| sort_weight | 排序权重 | int | 否 | 否 | 越大越靠前 |
| status | 商品状态 | enum | 是 | 否 | 草稿、已上架、已下架 |
| created_at | 创建时间 | datetime | 是 | 否 | |
| updated_at | 更新时间 | datetime | 是 | 否 | |
| deleted_at | 删除时间 | datetime | 否 | 否 | 软删除 |

### 3.3 规格 product_sku

> 同一商品可有多个 SKU（如不同竿长）。V1.1 简化：大部分套装为单 SKU，耗材按规格拆分。

| 字段 | 说明 | 类型 | 必填 | 备注 |
| --- | --- | --- | --- | --- |
| sku_id | SKU 唯一标识 | string(26) | 是 | ULID，主键 |
| product_id | 关联商品 | string(26) | 是 | 外键，索引 |
| sku_name | 规格名 | string(60) | 是 | 例如「5.4m」「3.9m」 |
| sku_code | 规格编码 | string(40) | 是 | 与 product_id 联合唯一 |
| price | 售价（分） | decimal(10,2) | 是 | 可覆盖商品价 |
| stock | 规格库存 | int | 是 | 下单扣减的原子单位 |
| status | 状态 | enum | 是 | 有效、停用 |

约束：库存扣减发生在 SKU 层；`stock_total` 为各 SKU `stock` 之和的冗余汇总，后台维护时保持一致性。

### 3.4 商品↔钓点推荐 product_recommendation

| 字段 | 说明 | 类型 | 必填 | 备注 |
| --- | --- | --- | --- | --- |
| rec_id | 推荐关系 ID | string(26) | 是 | ULID，主键 |
| product_id | 商品 ID | string(26) | 是 | 外键 |
| spot_id | 钓点 ID | string(26) | 是 | 外键，可空表示「全站通用」 |
| rec_type | 推荐类型 | enum | 是 | 鱼种适配、钓法适配、水域适配、手动运营 |
| priority | 优先级 | int | 否 | 越大越靠前 |
| created_at | 创建时间 | datetime | 是 | |

约束：`(product_id, spot_id, rec_type)` 联合唯一。

> 设计说明：推荐关系优先由**规则引擎**从 `product_fish_map` 自动推导（钓点 fish_types ∩ 商品适配鱼种），`product_recommendation` 存**运营手动覆盖**的强推荐结果。规则命中与手动覆盖合并后返回，避免逐钓点人工配置。

### 3.5 商品↔鱼种适配 product_fish_map

| 字段 | 说明 | 类型 | 必填 | 备注 |
| --- | --- | --- | --- | --- |
| map_id | 映射 ID | string(26) | 是 | ULID，主键 |
| product_id | 商品 ID | string(26) | 是 | 外键 |
| fish_code | 鱼种代码 | string(40) | 是 | 来自鱼种字典（如 `luyu`） |
| fishing_method | 适配钓法 | enum | 否 | 台钓/路亚/海竿/手竿 |
| water_type | 适配水域 | enum | 否 | 复用主文档 water_type |

约束：`(product_id, fish_code)` 联合唯一。这是「鱼种→装备」智能联动的数据底座。

### 3.6 订单 order / order_item

订单表 order：

| 字段 | 说明 | 类型 | 必填 | 备注 |
| --- | --- | --- | --- | --- |
| order_id | 订单 ID | string(26) | 是 | ULID，主键 |
| order_no | 订单号 | string(32) | 是 | 展示用，唯一，可读 |
| user_id | 下单用户 | string(26) | 是 | 外键，索引 |
| status | 订单状态 | enum | 是 | 待支付、待发货、待收货、已完成、已取消、售后中 |
| total_amount | 商品总额（分） | decimal(10,2) | 是 | |
| discount_amount | 优惠金额（分） | decimal(10,2) | 是 | 默认 0 |
| freight_amount | 运费（分） | decimal(10,2) | 是 | 默认 0，深圳同城包邮 |
| pay_amount | 实付金额（分） | decimal(10,2) | 是 | = total - discount + freight |
| pay_channel | 支付渠道 | enum | 是 | 默认 wechat_mini |
| prepay_id | 微信预支付单号 | string(64) | 否 | 下单后回填 |
| transaction_id | 微信支付流水号 | string(64) | 否 | 支付成功后回填 |
| receiver_name | 收货人 | string(40) | 是 | |
| receiver_phone | 收货电话 | string(20) | 是 | 脱敏存储 |
| receiver_address | 收货地址 | string(200) | 是 | |
| remark | 买家备注 | string(200) | 否 | |
| paid_at | 支付时间 | datetime | 否 | |
| shipped_at | 发货时间 | datetime | 否 | |
| completed_at | 完成时间 | datetime | 否 | |
| canceled_at | 取消时间 | datetime | 否 | |
| created_at | 创建时间 | datetime | 是 | |
| updated_at | 更新时间 | datetime | 是 | |
| deleted_at | 删除时间 | datetime | 否 | 软删除，用户侧订单不可物理删除 |

订单明细 order_item：

| 字段 | 说明 | 类型 | 必填 | 备注 |
| --- | --- | --- | --- | --- |
| order_item_id | 明细 ID | string(26) | 是 | ULID，主键 |
| order_id | 订单 ID | string(26) | 是 | 外键，索引 |
| product_id | 商品 ID | string(26) | 是 | 外键 |
| sku_id | SKU ID | string(26) | 是 | 外键 |
| product_name | 商品名称快照 | string(80) | 是 | 下单时快照，防商品改名 |
| sku_name | 规格名快照 | string(60) | 是 | |
| cover_image_key | 图片快照 | string(255) | 否 | |
| unit_price | 成交单价（分） | decimal(10,2) | 是 | |
| quantity | 数量 | int | 是 | 默认 1 |
| amount | 小计（分） | decimal(10,2) | 是 | unit_price × quantity |

> 关键约束：`product_name/sku_name/unit_price` 均为**下单时快照**，商品后续改名/改价不影响历史订单。

### 3.7 购物车 cart_item

| 字段 | 说明 | 类型 | 必填 | 备注 |
| --- | --- | --- | --- | --- |
| cart_id | 购物车项 ID | string(26) | 是 | ULID，主键 |
| user_id | 用户 ID | string(26) | 是 | 外键 |
| sku_id | SKU ID | string(26) | 是 | 外键 |
| quantity | 数量 | int | 是 | 上限 99 |
| selected | 是否勾选结算 | boolean | 是 | 默认 true |
| created_at | 加入时间 | datetime | 是 | |

约束：`(user_id, sku_id)` 联合唯一，重复加购累加数量。

### 3.8 售后 refund

| 字段 | 说明 | 类型 | 必填 | 备注 |
| --- | --- | --- | --- | --- |
| refund_id | 售后单 ID | string(26) | 是 | ULID，主键 |
| order_id | 订单 ID | string(26) | 是 | 外键 |
| user_id | 用户 ID | string(26) | 是 | 外键 |
| refund_type | 售后类型 | enum | 是 | 仅退款、退货退款 |
| refund_amount | 退款金额（分） | decimal(10,2) | 是 | |
| reason | 退款原因 | enum | 是 | 见 3.10 |
| description | 补充说明 | string(500) | 否 | |
| images | 凭证图 | array | 否 | 最多 6 张 |
| status | 售后状态 | enum | 是 | 待审核、同意、拒绝、已退款、已关闭 |
| handled_by | 处理人 | string(26) | 否 | 后台 admin_id |
| handled_at | 处理时间 | datetime | 否 | |
| refund_no | 退款流水号 | string(64) | 否 | 微信退款单号 |
| created_at | 创建时间 | datetime | 是 | |

### 3.9 枚举与字典追加

| 枚举 | 取值 | 说明 |
| --- | --- | --- |
| product_category | 套装、鱼竿、渔轮、渔线、浮漂、鱼钩、饵料、配件、其他 | 类目字典，后台可扩展 |
| product_status | 草稿、已上架、已下架 | 对外只展示已上架 |
| brand_code | unihuan、其他 | 预留多品牌 |
| order_status | pending_pay、pending_ship、pending_receive、completed、canceled、refunding | 待支付、待发货、待收货、已完成、已取消、售后中 |
| refund_type | refund_only、return_refund | 仅退款、退货退款 |
| refund_status | pending、approved、rejected、refunded、closed | 待审核、同意、拒绝、已退款、已关闭 |
| refund_reason | 质量问题、与描述不符、拍错、不想要了、其他 | 退款原因 |

API 代码与标签映射（沿用主文档约定：小写英文代码 + 客户端字典映射）：

| 字典 | 代码 | 标签 |
| --- | --- | --- |
| product_category | bundle / rod / reel / line / float / hook / bait / accessory / other | 套装/鱼竿/渔轮/渔线/浮漂/鱼钩/饵料/配件/其他 |
| product_status | draft / on_sale / off_shelf | 草稿/已上架/已下架 |
| order_status | pending_pay / pending_ship / pending_receive / completed / canceled / refunding | 待支付/待发货/待收货/已完成/已取消/售后中 |
| refund_type | refund_only / return_refund | 仅退款/退货退款 |
| refund_status | pending / approved / rejected / refunded / closed | 待审核/同意/拒绝/已退款/已关闭 |

### 3.10 校验规则与唯一约束追加

- 商品发布（上架）时 `product_name`、`category`、`price`、`cover_image_key`、至少 1 个有效 SKU 必填。
- 售价 `price > 0`；划线价 `market_price >= price`；成本价仅后台填写。
- 下单时校验：商品已上架、SKU 库存充足、订单金额与商品当前价一致（防止改价漏洞，以服务端实时价为准）。
- 库存扣减使用**行级锁 + 事务**：`UPDATE ... SET stock = stock - N WHERE sku_id = ? AND stock >= N`，影响行数为 0 则库存不足，回滚订单。
- 支付回调与主动查询**双重确认**，幂等：同一 `transaction_id` 只入账一次；超时未支付订单（默认 30 分钟）自动关闭并回补库存。
- 订单金额字段一律 decimal 字符串，杜绝浮点误差。

---

## 四、页面与交互增补

### 4.1 信息架构追加

| 页面或组件 | 路由 | V1.1 | 说明 |
| --- | --- | --- | --- |
| 商城首页 | /pages/shop/index | 是 | Tab「商城」，品牌区 + 套装推荐 + 分类 |
| 商品详情 | /pages/shop/product?product_id= | 是 | 含「适配钓点/鱼种」联动区 |
| 购物车 | /pages/shop/cart | 是 | 勾选结算 |
| 订单确认 | /pages/shop/checkout | 是 | 地址 + 金额 + 提交 |
| 订单列表 | /pages/order/list | 是 | 分状态 Tab |
| 订单详情 | /pages/order/detail?order_id= | 是 | 含物流、售后入口 |
| 售后申请 | /pages/order/refund?order_id= | 是 | 退款表单 |

### 4.2 核心流程追加

**流程四：钓点→装备推荐→下单（V1.1 核心联动流程）**

```text
钓点详情页
-> 下滑至「推荐装备」区
-> 系统按该钓点 fish_types / fishing_method 匹配 UniHuan 商品
-> 点击推荐商品进入商品详情
-> 查看适配说明 + 规格选择
-> 加入购物车或立即购买
-> 订单确认页（收货地址 + 金额）
-> 微信支付
-> 支付成功 -> 订单中心查看
```

**流程五：商城直达（V1.1）**

```text
商城 Tab
-> 品牌区 / 套装推荐 / 分类
-> 商品详情
-> 加购 / 立即购买
-> 下单支付 -> 订单中心
```

### 4.3 关键页面交互要点

| 页面 | 关键交互 | 说明 |
| --- | --- | --- |
| 商城首页 | 品牌 banner + 推荐流 | UniHuan 品牌露出，套装优先于单品 |
| 商品详情 | 适配钓点/鱼种卡片 | 展示该商品适配的鱼种标签与典型钓点，强化「跟着钓点买」心智 |
| 钓点详情 | 推荐装备区 | 插入在「周边推荐」与「用户情报」之间，不超过 3 个商品 |
| 订单确认 | 地址选择 | 复用微信地址组件，深圳同城包邮（默认） |
| 支付 | 微信支付 | 调 `wx.requestPayment`，失败可重试，不重复扣款 |

### 4.4 全局状态追加

- 商品已下架/售罄：详情页显示「已下架/已售罄」，禁用加购；购物车内对应项标记失效。
- 支付超时：订单 30 分钟未支付自动关闭，提示用户重新下单。
- 库存不足：加购/下单时实时校验，给出「库存不足」提示，不进入支付。

---

## 五、API 增补

> 沿用主文档 10.4 约定：`/api/v1`、统一响应结构、snake_case、幂等键 `Idempotency-Key`、业务码。金额字段 decimal 字符串。写接口（下单、支付、退款）必须带 `Idempotency-Key`。

### 5.1 公开接口（C 端）追加

| 方法 | 路径 | 用途 | 鉴权 |
| --- | --- | --- | --- |
| GET | /api/v1/products | 商品列表（分类、推荐、分页） | 否 |
| GET | /api/v1/products/{product_id} | 商品详情（含 SKU、适配信息） | 否 |
| GET | /api/v1/spots/{spot_id}/products | 钓点推荐装备（联动核心） | 否 |
| GET | /api/v1/cart | 购物车 | 是 |
| POST | /api/v1/cart | 加入购物车 | 是 |
| PUT | /api/v1/cart/{cart_id} | 修改数量/勾选 | 是 |
| DELETE | /api/v1/cart/{cart_id} | 删除购物车项 | 是 |
| POST | /api/v1/orders | 创建订单（下单） | 是 |
| GET | /api/v1/orders | 订单列表 | 是 |
| GET | /api/v1/orders/{order_id} | 订单详情 | 是 |
| POST | /api/v1/orders/{order_id}/pay | 发起支付（返回 prepay 参数） | 是 |
| POST | /api/v1/orders/{order_id}/cancel | 取消订单 | 是 |
| POST | /api/v1/orders/{order_id}/confirm | 确认收货 | 是 |
| POST | /api/v1/orders/{order_id}/refund | 申请售后 | 是 |
| GET | /api/v1/refunds | 售后列表 | 是 |
| GET | /api/v1/refunds/{refund_id} | 售后详情 | 是 |
| POST | /api/v1/callbacks/wechat/pay | 微信支付回调 | 验签 |

### 5.2 后台接口追加（`/api/v1/admin`）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST/PUT/DELETE | /api/v1/admin/products | 商品管理 |
| POST | /api/v1/admin/products/{id}/on-shelf | 上架 |
| POST | /api/v1/admin/products/{id}/off-shelf | 下架 |
| GET | /api/v1/admin/products/{id}/stock | 库存查询 |
| POST | /api/v1/admin/products/{id}/stock | 库存调整 |
| GET | /api/v1/admin/orders | 订单管理（筛选、分页） |
| POST | /api/v1/admin/orders/{id}/ship | 发货 |
| GET | /api/v1/admin/refunds | 售后审核队列 |
| POST | /api/v1/admin/refunds/{id}/approve | 同意退款 |
| POST | /api/v1/admin/refunds/{id}/reject | 拒绝退款 |

### 5.3 关键业务码追加

| 业务码 | HTTP | 含义 |
| --- | --- | --- |
| 42210 | 422 | 库存不足 |
| 42211 | 422 | 商品已下架/售罄 |
| 40910 | 409 | 订单状态冲突（如重复支付/重复取消） |
| 40911 | 409 | 支付幂等冲突（transaction_id 已入账） |

---

## 六、运营后台增补（M0 扩展）

在现有后台（Next.js + Ant Design）中新增「商城」一级菜单，复用现有 RBAC、审计、登录安全体系。

### 6.1 角色权限追加

| 功能 | 超级管理员 | 运营 | 审核员 |
| --- | --- | --- | --- |
| 商品管理（增删改查/上下架） | 是 | 是 | 否 |
| 库存管理 | 是 | 是 | 否 |
| 订单管理（发货） | 是 | 是 | 否 |
| 售后审核（同意/拒绝退款） | 是 | 是 | 是 |
| 商品推荐规则配置 | 是 | 是 | 否 |

### 6.2 后台功能清单

- **商品管理**：类目、名称、价格、成本、库存、图片、详情富文本、上下架、排序。
- **库存管理**：按 SKU 查库存、手动调库存、库存流水（调整记录进 audit_log）。
- **订单管理**：按状态/时间/用户筛选，发货、查看物流单号、订单明细。
- **售后审核**：退款申请队列、同意/拒绝、退款金额校验、微信原路退回。
- **推荐规则配置**：维护「鱼种→商品」映射（product_fish_map）与手动推荐覆盖（product_recommendation）。
- **数据看板追加**：GMV、订单量、客单价、转化率、爆款 TOP10、库存预警。

---

## 七、非功能需求增补

- **支付安全**：微信支付回调验签 + 金额核对 + 幂等入账；支付与订单金额以服务端为准。
- **并发安全**：库存扣减行级锁，下单并发不超卖；订单关闭/取消/退款等状态流转用状态机 + 乐观锁/条件更新。
- **性能**：商品列表首屏 ≤ 1.5s；推荐接口（钓点→商品）≤ 300ms，可缓存 60s。
- **合规**：电商经营需营业执照 + 微信支付商户号；商品详情富文本与图片走内容安全审核；用户地址/电话加密存储，日志脱敏。
- **可观测**：下单、支付、退款全链路埋点，关联 `request_id` 与 `order_no`。

---

## 八、埋点增补（对齐主文档第 11 章）

| 事件 | 触发点 | 关键参数 |
| --- | --- | --- |
| shop_view | 商城首页曝光 | source（tab/钓点详情推荐位） |
| product_view | 商品详情曝光 | product_id、category、entry_source |
| product_recommend_click | 点击推荐商品 | product_id、spot_id、rec_type |
| cart_add | 加入购物车 | product_id、sku_id、quantity |
| order_create | 创建订单 | order_no、amount、product_ids |
| pay_success | 支付成功 | order_no、pay_amount、channel |
| order_confirm | 确认收货 | order_no |
| refund_apply | 申请售后 | order_no、refund_type、reason |

新增核心指标（对齐主文档 11.4 成功指标）：

| 指标 | 目标（V1.1 上线后 3 个月） |
| --- | --- |
| 商城转化率（下单/商品曝光） | ≥ 3% |
| 钓点→推荐点击率 | ≥ 5% |
| 月 GMV | 待业务方定 |
| 售后率 | ≤ 3% |

---

## 九、供应链与品牌（非功能，供运营参考）

> 本节是运营落地参考，非开发需求，可移入独立运营文档。

- **OEM 贴牌策略**：首批「台钓入门套装」+ 3 类高复购耗材（线组、浮漂、饵料），SKU 控制在 20 内。
- **货源产业带**（对齐渔具供应链分布）：
  - 鱼竿 → 山东威海；渔线 → 浙江东阳；浮漂 → 湖南临湘/河北固安；渔轮 → 浙江宁波慈溪；鱼钩 → 江西鄱阳；饵料 → 湖北。
- **仓储**：深圳本地备货，实现「次日达」本地化优势。
- **品牌**：UniHuan（优环）商标需尽早注册（第 28 类），避免品牌纠纷。

---

## 十、范围调整顺序（V1.1 若超载）

若 V1.1 资源紧张，按以下顺序缩减（对齐主文档 7.8 思路）：

1. 先砍「购物车」，只保留「立即购买」直达下单；
2. 再砍「售后申请」用户自助入口，改为「联系客服 + 后台人工退款」；
3. 保留「钓点→推荐」与「下单支付」两个不可削减的核心。

---

## 附：术语追加（对齐主文档附录 A）

| 术语 | 定义 |
| --- | --- |
| UniHuan | 深圳钓鱼助手自有渔具品牌（中文名「优环」待商标注册） |
| GMV | 成交总额（Gross Merchandise Volume） |
| SKU | 库存量单位（Stock Keeping Unit），商品规格维度 |
| OEM | 贴牌代工（Original Equipment Manufacturer） |
| 场景联动 | 基于钓点/鱼种数据驱动的商品推荐能力 |
