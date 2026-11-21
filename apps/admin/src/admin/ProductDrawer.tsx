'use client';

import {
  Alert,
  App,
  Button,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  resolveMediaUrl,
  type AdminPlacementItem,
  type AdminProductDetail,
  type AdminProductListItem,
  type AdminProductPage,
  type CreatePlacementBody,
  type CreateProductBody,
  type Session,
  type UpdateProductBody,
} from './api';

interface ProductDrawerProps {
  open: boolean;
  reloadKey: number;
  session: Session;
  onClose: () => void;
  onChanged: () => void;
  onExpired: () => void;
}

interface EditorImage {
  key: string;
  url: string | undefined;
}

interface KeywordOption {
  value: string;
  label: string;
}

const SEARCH_DEBOUNCE_MS = 300;
const PRODUCT_OPTIONS_INITIAL_SIZE = 50;
const SPOT_OPTIONS_INITIAL_SIZE = 100;
const SEARCH_OPTIONS_SIZE = 20;
const MAX_PLACEMENT_FISH_KEYS = 5;

function mergeSelectedOption(
  options: KeywordOption[],
  selected: KeywordOption | null,
): KeywordOption[] {
  if (selected === null || options.some((option) => option.value === selected.value)) {
    return options;
  }
  return [selected, ...options];
}

interface ProductFormValues {
  title: string;
  subtitle?: string;
  description?: string;
  category: string;
  sort_weight?: number;
  channel?: string;
  purchase_action?: string;
  external_product_id?: string;
  price_display?: string;
  channel_status?: string;
  app_id?: string;
  path?: string;
  fallback_url?: string;
  url?: string;
  toast?: string;
}

const PAGE_SIZE = 20;
const MAX_IMAGE_COUNT = 9;
const V1_CHANNEL = 'weidian';

const CATEGORY_LABEL: Record<string, string> = {
  rod: '鱼竿',
  reel: '渔轮',
  line: '鱼线',
  bait: '鱼饵',
  hat: '帽子',
  sun_protection: '防晒',
  accessory: '配件',
  other: '其他',
};

const CATEGORY_COLOR: Record<string, string> = {
  rod: 'green',
  reel: 'cyan',
  line: 'blue',
  bait: 'orange',
  hat: 'gold',
  sun_protection: 'volcano',
  accessory: 'purple',
  other: 'default',
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  active: '已发布',
  archived: '已归档',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'default',
  active: 'green',
  archived: 'orange',
};

const PURCHASE_ACTION_LABEL: Record<string, string> = {
  mini_program: '小程序',
  h5: 'H5 链接',
  copy_link: '复制链接',
};

const CHANNEL_LABEL: Record<string, string> = {
  weidian: '微店',
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const PURCHASE_ACTION_OPTIONS = Object.entries(PURCHASE_ACTION_LABEL).map(
  ([value, label]) => ({ value, label }),
);

const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const CHANNEL_STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '停用' },
];

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const PLACEMENT_SURFACE_LABEL: Record<string, string> = {
  spot_detail: '钓点详情',
};

const PLACEMENT_SCOPE_LABEL: Record<string, string> = {
  spot: '单个钓点',
  fish: '按鱼种',
};

const PLACEMENT_SCOPE_COLOR: Record<string, string> = {
  spot: 'blue',
  fish: 'purple',
};

const PLACEMENT_STATUS_LABEL: Record<string, string> = {
  active: '启用',
  disabled: '停用',
};

const PLACEMENT_STATUS_COLOR: Record<string, string> = {
  active: 'green',
  disabled: 'default',
};

const PLACEMENT_SURFACE_OPTIONS = Object.entries(PLACEMENT_SURFACE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

const PLACEMENT_SCOPE_OPTIONS = Object.entries(PLACEMENT_SCOPE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

const PLACEMENT_STATUS_OPTIONS = Object.entries(PLACEMENT_STATUS_LABEL).map(
  ([value, label]) => ({ value, label }),
);

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function payloadString(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' ? value : undefined;
}

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

function categoryTag(category: string) {
  return (
    <Tag color={CATEGORY_COLOR[category] ?? 'default'}>
      {CATEGORY_LABEL[category] ?? category}
    </Tag>
  );
}

function statusTag(status: string) {
  return <Tag color={STATUS_COLOR[status] ?? 'default'}>{STATUS_LABEL[status] ?? status}</Tag>;
}

function toLocalDateTimeInput(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTime(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function placementWindowText(startsAt: string | null, endsAt: string | null): string {
  if (startsAt === null && endsAt === null) {
    return '长期';
  }
  const start = startsAt === null ? '立即' : formatDateTime(startsAt);
  const end = endsAt === null ? '不限' : formatDateTime(endsAt);
  return `${start} 至 ${end}`;
}

interface ProductEditorDrawerProps {
  open: boolean;
  productId: string | null;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
  onExpired: () => void;
}

function ProductEditorDrawer({
  open,
  productId,
  session,
  onClose,
  onSaved,
  onExpired,
}: ProductEditorDrawerProps) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<ProductFormValues>();
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const [images, setImages] = useState<EditorImage[]>([]);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const purchaseAction = Form.useWatch('purchase_action', form);

  const showError = (error: unknown): void => {
    if (isAuthError(error)) {
      onExpired();
      return;
    }
    if (error instanceof ApiError && (error.details?.length ?? 0) > 0) {
      modal.error({
        title: error.message,
        content: (
          <ul className="error-list">
            {error.details?.map((issue) => (
              <li key={`${issue.field}-${issue.message}`}>
                <strong>{issue.field}</strong>：{issue.message}
              </li>
            ))}
          </ul>
        ),
      });
      return;
    }
    message.error(errorText(error));
  };

  const applyDetail = (product: AdminProductDetail): void => {
    const channel = product.channels[0];
    const payload = channel?.action_payload;
    setDetail(product);
    form.setFieldsValue({
      title: product.title,
      subtitle: product.subtitle ?? undefined,
      description: product.description ?? undefined,
      category: product.category,
      sort_weight: product.sort_weight,
      channel: channel?.channel ?? V1_CHANNEL,
      purchase_action: channel?.purchase_action ?? 'mini_program',
      external_product_id: channel?.external_product_id ?? undefined,
      price_display: channel?.price_display ?? undefined,
      channel_status: channel?.status ?? 'active',
      app_id: payloadString(payload, 'app_id'),
      path: payloadString(payload, 'path'),
      fallback_url: payloadString(payload, 'fallback_url'),
      url: payloadString(payload, 'url'),
      toast: payloadString(payload, 'toast'),
    });
    setImages(
      product.image_keys.map((key, index) => ({
        key,
        url: resolveMediaUrl(product.image_urls[index]),
      })),
    );
    setCoverKey(product.cover_image_key ?? null);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let active = true;
    setDetail(null);
    setImages([]);
    setCoverKey(null);
    setLoading(false);
    form.resetFields();
    form.setFieldsValue({
      channel: V1_CHANNEL,
      purchase_action: 'mini_program',
      channel_status: 'active',
      sort_weight: 0,
    });
    if (productId === null) {
      return () => {
        active = false;
      };
    }

    setLoading(true);
    api
      .getProduct(productId)
      .then((product) => {
        if (active) {
          applyDetail(product);
        }
      })
      .catch(showError)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // Reload only when the drawer opens or switches to another product.
  }, [open, productId, form]);

  const buildBody = (values: ProductFormValues): CreateProductBody => {
    const action = values.purchase_action ?? 'mini_program';
    const actionPayload: Record<string, unknown> =
      action === 'mini_program'
        ? {
            app_id: (values.app_id ?? '').trim(),
            path: (values.path ?? '').trim(),
            ...(textOrNull(values.fallback_url) === null
              ? {}
              : { fallback_url: textOrNull(values.fallback_url) }),
          }
        : {
            url: (values.url ?? '').trim(),
            ...(action === 'copy_link' && textOrNull(values.toast) !== null
              ? { toast: textOrNull(values.toast) }
              : {}),
          };

    return {
      title: values.title.trim(),
      subtitle: textOrNull(values.subtitle),
      description: textOrNull(values.description),
      category: values.category as CreateProductBody['category'],
      sort_weight: values.sort_weight ?? 0,
      image_keys: images.map((image) => image.key),
      cover_image_key: coverKey,
      channels: [
        {
          channel: (values.channel ?? V1_CHANNEL) as CreateProductBody['channels'][number]['channel'],
          external_product_id: textOrNull(values.external_product_id),
          purchase_action:
            action as CreateProductBody['channels'][number]['purchase_action'],
          action_payload: actionPayload,
          price_display: textOrNull(values.price_display),
          status:
            (values.channel_status ??
              'active') as CreateProductBody['channels'][number]['status'],
        },
      ],
    };
  };

  const persist = async (
    nextStatus?: 'active',
  ): Promise<{ product: AdminProductDetail; created: boolean } | null> => {
    setSaving(true);
    let createdDraft = false;
    try {
      const body = buildBody(await form.validateFields());
      const existingId = detail?.product_id ?? null;
      if (existingId === null) {
        // Create always lands as a draft; publishing is a second update.
        const draft = await api.createProduct(body, session.csrf);
        applyDetail(draft);
        createdDraft = true;
        if (nextStatus === undefined) {
          onSaved();
          return { product: draft, created: true };
        }
        const product = await api.updateProduct(
          draft.product_id,
          { ...body, status: nextStatus } satisfies UpdateProductBody,
          session.csrf,
        );
        applyDetail(product);
        onSaved();
        return { product, created: true };
      }

      const product = await api.updateProduct(
        existingId,
        nextStatus === undefined ? body : { ...body, status: nextStatus },
        session.csrf,
      );
      applyDetail(product);
      onSaved();
      return { product, created: false };
    } catch (error) {
      // The draft write above may have succeeded before publishing failed.
      if (createdDraft) {
        onSaved();
      }
      showError(error);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    const saved = await persist();
    if (saved !== null) {
      message.success(saved.created ? '草稿已保存' : '已保存');
    }
  };

  const handlePublish = async (): Promise<void> => {
    const saved = await persist('active');
    if (saved !== null && saved.product.status === 'active') {
      message.success('商品已发布');
    }
  };

  const handleArchive = (): void => {
    if (detail === null) {
      return;
    }
    modal.confirm({
      title: '归档商品',
      content: `归档后「${detail.title}」不再出现在小程序，历史数据保留。`,
      okText: '归档',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setSaving(true);
        try {
          const archived = await api.archiveProduct(detail.product_id, session.csrf);
          applyDetail(archived);
          message.success('商品已归档');
          onSaved();
        } catch (error) {
          showError(error);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const triggerUpload = (): void => {
    if (detail === null) {
      message.info('请先保存草稿，再上传图片');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined || detail === null) {
      return;
    }
    if (images.length >= MAX_IMAGE_COUNT) {
      message.warning(`最多上传 ${MAX_IMAGE_COUNT} 张图片`);
      return;
    }
    setUploading(true);
    try {
      const result = await api.uploadProductImage(detail.product_id, file, session.csrf);
      setImages((current) => [
        ...current,
        { key: result.key, url: resolveMediaUrl(result.preview_url) },
      ]);
      message.success('图片已上传，请保存');
    } catch (error) {
      showError(error);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (key: string): void => {
    const next = images.filter((image) => image.key !== key);
    setImages(next);
    if (coverKey === key) {
      setCoverKey(null);
    }
  };

  const archived = detail?.status === 'archived';
  const published = detail?.status === 'active';

  return (
    <Drawer
      open={open}
      width={880}
      title={
        <Space>
          <span>{detail === null ? '新增商品' : detail.title}</span>
          {detail !== null && statusTag(detail.status)}
        </Space>
      }
      onClose={onClose}
      destroyOnHidden
      footer={
        <div className="editor-footer">
          <Button onClick={onClose}>关闭</Button>
          <Space>
            {detail !== null && !archived && (
              <Button danger onClick={handleArchive} loading={saving}>
                归档
              </Button>
            )}
            <Button onClick={handleSave} loading={saving}>
              {detail === null || detail.status === 'draft' ? '保存草稿' : '保存'}
            </Button>
            {!archived && !published && (
              <Button type="primary" onClick={handlePublish} loading={saving}>
                发布
              </Button>
            )}
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
        {loading && <Typography.Text type="secondary">正在加载商品…</Typography.Text>}

        <Typography.Title level={5}>基础信息</Typography.Title>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item
              label="商品名称"
              name="title"
              rules={[{ required: true, max: 80, message: '请输入 1-80 字商品名称' }]}
            >
              <Input placeholder="例如：UniHuan 轻量路亚竿" maxLength={80} showCount />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="分类"
              name="category"
              rules={[{ required: true, message: '请选择商品分类' }]}
            >
              <Select options={CATEGORY_OPTIONS} placeholder="选择分类" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="副标题" name="subtitle">
              <Input placeholder="一句话卖点" maxLength={120} showCount />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="商品描述" name="description">
              <Input.TextArea
                rows={3}
                maxLength={2000}
                showCount
                placeholder="后台文案，仅运营可见"
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="排序权重" name="sort_weight">
              <InputNumber min={0} max={1000000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Divider />
        <Typography.Title level={5}>渠道与购买方式</Typography.Title>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="渠道" name="channel">
              <Select options={CHANNEL_OPTIONS} disabled />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="购买方式"
              name="purchase_action"
              rules={[{ required: true, message: '请选择购买方式' }]}
            >
              <Select options={PURCHASE_ACTION_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="渠道状态" name="channel_status">
              <Select options={CHANNEL_STATUS_OPTIONS} />
            </Form.Item>
          </Col>
          {purchaseAction === 'mini_program' && (
            <>
              <Col span={10}>
                <Form.Item
                  label="小程序 AppID"
                  name="app_id"
                  rules={[
                    { required: true, message: '请输入小程序 AppID' },
                    {
                      pattern: /^wx[0-9a-f]{16}$/,
                      message: '格式为 wx 加 16 位小写十六进制',
                    },
                  ]}
                >
                  <Input placeholder="wx0123456789abcdef" maxLength={18} />
                </Form.Item>
              </Col>
              <Col span={14}>
                <Form.Item
                  label="小程序路径"
                  name="path"
                  rules={[
                    { required: true, message: '请输入小程序路径' },
                    { pattern: /^\//, message: '路径必须以 / 开头' },
                  ]}
                >
                  <Input placeholder="/pages/product/detail?id=1" maxLength={200} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  label="兜底链接"
                  name="fallback_url"
                  rules={[
                    { pattern: /^https:\/\//, message: '链接必须以 https:// 开头' },
                  ]}
                >
                  <Input placeholder="选填，小程序不可用时的 HTTPS 链接" maxLength={500} />
                </Form.Item>
              </Col>
            </>
          )}
          {purchaseAction !== 'mini_program' && (
            <Col span={24}>
              <Form.Item
                label="商品链接"
                name="url"
                rules={[
                  { required: true, message: '请输入商品链接' },
                  { pattern: /^https:\/\//, message: '链接必须以 https:// 开头' },
                ]}
              >
                <Input placeholder="https://weidian.com/item.html?itemID=1" maxLength={500} />
              </Form.Item>
            </Col>
          )}
          {purchaseAction === 'copy_link' && (
            <Col span={24}>
              <Form.Item label="复制提示" name="toast">
                <Input placeholder="选填，例如：链接已复制" maxLength={40} />
              </Form.Item>
            </Col>
          )}
          <Col span={12}>
            <Form.Item label="微店商品 ID" name="external_product_id">
              <Input placeholder="选填" maxLength={64} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="价格文案" name="price_display">
              <Input placeholder="选填，例如：¥299 起" maxLength={32} />
            </Form.Item>
          </Col>
        </Row>

        <Divider />
        <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              图片
            </Typography.Title>
            <Typography.Text type="secondary">
              至多 9 张，自动压缩为 WebP。发布前至少需要一张图片。
            </Typography.Text>
          </div>
          <Button
            onClick={triggerUpload}
            loading={uploading}
            disabled={images.length >= MAX_IMAGE_COUNT}
          >
            上传图片
          </Button>
        </Space>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            void handleFile(event);
          }}
        />
        <div className="image-grid">
          {images.length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有图片" />
          )}
          {images.map((image) => (
            <div
              key={image.key}
              className={`image-tile ${coverKey === image.key ? 'is-cover' : ''}`}
            >
              {image.url === undefined ? (
                <div className="image-missing">预览不可用</div>
              ) : (
                <Image src={image.url} width={150} height={106} className="editor-image" />
              )}
              <div className="image-actions">
                {coverKey === image.key ? (
                  <Tag color="green">封面</Tag>
                ) : (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setCoverKey(image.key);
                    }}
                  >
                    设为封面
                  </Button>
                )}
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => {
                    removeImage(image.key);
                  }}
                >
                  移除
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Form>
    </Drawer>
  );
}

interface PlacementFormValues {
  product_id: string;
  surface: 'spot_detail';
  scope: 'spot' | 'fish';
  target_id?: string | null;
  fish_keys?: string[];
  sort_order?: number;
  starts_at?: string;
  ends_at?: string;
  status: 'active' | 'disabled';
}

interface PlacementEditorDrawerProps {
  open: boolean;
  placement: AdminPlacementItem | null;
  products: KeywordOption[];
  spots: KeywordOption[];
  fishOptions: KeywordOption[];
  productsLoading: boolean;
  spotsLoading: boolean;
  onProductSearch: (keyword: string) => void;
  onSpotSearch: (keyword: string) => void;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
  onExpired: () => void;
}

function PlacementEditorDrawer({
  open,
  placement,
  products,
  spots,
  fishOptions,
  productsLoading,
  spotsLoading,
  onProductSearch,
  onSpotSearch,
  session,
  onClose,
  onSaved,
  onExpired,
}: PlacementEditorDrawerProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<PlacementFormValues>();
  const [saving, setSaving] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<KeywordOption | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<KeywordOption | null>(null);
  const scope = Form.useWatch('scope', form) ?? 'spot';

  useEffect(() => {
    if (!open) {
      return;
    }
    form.resetFields();
    if (placement === null) {
      form.setFieldsValue({
        surface: 'spot_detail',
        scope: 'spot',
        fish_keys: [],
        sort_order: 0,
        status: 'active',
      });
      return;
    }
    form.setFieldsValue({
      product_id: placement.product_id,
      surface: 'spot_detail',
      scope: placement.scope,
      target_id: placement.target_id,
      fish_keys: placement.fish_keys,
      sort_order: placement.sort_order,
      starts_at: toLocalDateTimeInput(placement.starts_at),
      ends_at: toLocalDateTimeInput(placement.ends_at),
      status: placement.status,
    });
  }, [open, placement, form]);

  // Resolve the stored ids even when the current keyword page does not include them.
  useEffect(() => {
    if (!open || placement === null) {
      setSelectedProduct(null);
      setSelectedSpot(null);
      return undefined;
    }
    let active = true;
    setSelectedProduct({ value: placement.product_id, label: placement.product_id });
    api
      .getProduct(placement.product_id)
      .then((product) => {
        if (active) {
          setSelectedProduct({ value: product.product_id, label: product.title });
        }
      })
      .catch((cause: unknown) => {
        if (active && isAuthError(cause)) {
          onExpired();
        }
      });
    if (placement.target_id === null) {
      setSelectedSpot(null);
    } else {
      const targetId = placement.target_id;
      setSelectedSpot({ value: targetId, label: targetId });
      api
        .getSpot(targetId)
        .then((spot) => {
          if (active) {
            setSelectedSpot({ value: spot.spot_id, label: spot.spot_name });
          }
        })
        .catch((cause: unknown) => {
          if (active && isAuthError(cause)) {
            onExpired();
          }
        });
    }
    return () => {
      active = false;
    };
  }, [open, placement, onExpired]);

  const productSelectOptions = mergeSelectedOption(products, selectedProduct);
  const spotSelectOptions = mergeSelectedOption(spots, selectedSpot);

  const handleSave = async (): Promise<void> => {
    let values: PlacementFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const body: CreatePlacementBody = {
      product_id: values.product_id,
      surface: values.surface,
      scope: values.scope,
      sort_order: values.sort_order ?? 0,
      starts_at: parseLocalDateTime(values.starts_at),
      ends_at: parseLocalDateTime(values.ends_at),
      status: values.status,
      ...(values.scope === 'spot'
        ? { target_id: values.target_id ?? null, fish_keys: [] }
        : { target_id: null, fish_keys: values.fish_keys ?? [] }),
    };

    setSaving(true);
    try {
      if (placement === null) {
        await api.createPlacement(body, session.csrf);
        message.success('展示位置已创建');
      } else {
        await api.updatePlacement(placement.placement_id, body, session.csrf);
        message.success('展示位置已保存');
      }
      onSaved();
      onClose();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      width={640}
      title={placement === null ? '新增展示位置' : '编辑展示位置'}
      onClose={onClose}
      destroyOnHidden
      footer={
        <div className="editor-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item
              label="关联商品"
              name="product_id"
              rules={[{ required: true, message: '请选择商品' }]}
            >
              <Select
                showSearch
                filterOption={false}
                onSearch={onProductSearch}
                loading={productsLoading}
                placeholder="输入商品名称搜索"
                options={productSelectOptions}
                onChange={(value: string) => {
                  setSelectedProduct(
                    products.find((option) => option.value === value) ?? {
                      value,
                      label: value,
                    },
                  );
                }}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="状态"
              name="status"
              rules={[{ required: true, message: '请选择状态' }]}
            >
              <Select options={PLACEMENT_STATUS_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="展示页面" name="surface">
              <Select options={PLACEMENT_SURFACE_OPTIONS} disabled />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="范围"
              name="scope"
              rules={[{ required: true, message: '请选择范围' }]}
            >
              <Select
                options={PLACEMENT_SCOPE_OPTIONS}
                onChange={(value: 'spot' | 'fish') => {
                  // Switch scope clears the other targeting field explicitly.
                  form.setFieldsValue(
                    value === 'spot'
                      ? { target_id: undefined, fish_keys: [] }
                      : { target_id: null, fish_keys: [] },
                  );
                }}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="排序" name="sort_order">
              <InputNumber min={0} max={1000000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          {scope === 'spot' && (
            <Col span={24}>
              <Form.Item
                label="钓点"
                name="target_id"
                rules={[{ required: true, message: '请选择钓点' }]}
              >
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={onSpotSearch}
                  loading={spotsLoading}
                  placeholder="输入钓点名称搜索"
                  options={spotSelectOptions}
                  onChange={(value: string) => {
                    setSelectedSpot(
                      spots.find((option) => option.value === value) ?? {
                        value,
                        label: value,
                      },
                    );
                  }}
                />
              </Form.Item>
            </Col>
          )}
          {scope === 'fish' && (
            <Col span={24}>
              <Form.Item
                label="鱼种"
                name="fish_keys"
                rules={[{ required: true, message: '请选择至少一个鱼种' }]}
              >
                <Select
                  mode="multiple"
                  showSearch
                  optionFilterProp="label"
                  maxCount={MAX_PLACEMENT_FISH_KEYS}
                  placeholder="最多选择 5 个鱼种"
                  options={fishOptions}
                />
              </Form.Item>
            </Col>
          )}
          <Col span={12}>
            <Form.Item label="生效开始" name="starts_at">
              <Input type="datetime-local" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="生效结束" name="ends_at">
              <Input type="datetime-local" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Drawer>
  );
}

interface PlacementPanelProps {
  session: Session;
  active: boolean;
  onExpired: () => void;
}

function PlacementPanel({ session, active, onExpired }: PlacementPanelProps) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<AdminPlacementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [products, setProducts] = useState<KeywordOption[]>([]);
  const [spots, setSpots] = useState<KeywordOption[]>([]);
  const [fishOptions, setFishOptions] = useState<KeywordOption[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [spotSearch, setSpotSearch] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [spotsLoading, setSpotsLoading] = useState(false);
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPlacementItem | null>(null);

  // The tab stays mounted, so re-run this search whenever the tab becomes active.
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    setProductsLoading(true);
    const keyword = productSearch.trim();
    const timer = setTimeout(() => {
      api
        .listProducts({
          keyword: keyword === '' ? undefined : keyword,
          page: 1,
          page_size:
            keyword === '' ? PRODUCT_OPTIONS_INITIAL_SIZE : SEARCH_OPTIONS_SIZE,
        })
        .then((result) => {
          if (cancelled) {
            return;
          }
          setProducts(
            result.items.map((item) => ({
              value: item.product_id,
              label: item.title,
            })),
          );
        })
        .catch((cause: unknown) => {
          if (cancelled) {
            return;
          }
          if (isAuthError(cause)) {
            onExpired();
            return;
          }
          message.error(errorText(cause));
        })
        .finally(() => {
          if (!cancelled) {
            setProductsLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, productSearch, optionsReloadKey, message, onExpired]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    setSpotsLoading(true);
    const keyword = spotSearch.trim();
    const timer = setTimeout(() => {
      api
        .listSpots({
          keyword: keyword === '' ? undefined : keyword,
          page: 1,
          page_size: keyword === '' ? SPOT_OPTIONS_INITIAL_SIZE : SEARCH_OPTIONS_SIZE,
        })
        .then((result) => {
          if (cancelled) {
            return;
          }
          setSpots(
            result.items.map((item) => ({
              value: item.spot_id,
              label: item.spot_name,
            })),
          );
        })
        .catch((cause: unknown) => {
          if (cancelled) {
            return;
          }
          if (isAuthError(cause)) {
            onExpired();
            return;
          }
          message.error(errorText(cause));
        })
        .finally(() => {
          if (!cancelled) {
            setSpotsLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, spotSearch, optionsReloadKey, message, onExpired]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    api
      .dictionaries()
      .then((dictionaries) => {
        if (cancelled) {
          return;
        }
        setFishOptions(
          dictionaries.fish_types.map((item) => ({
            value: item.key,
            label: item.label,
          })),
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        if (isAuthError(cause)) {
          onExpired();
          return;
        }
        message.error(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [active, optionsReloadKey, message, onExpired]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .listPlacements({
        status: statusFilter,
        page,
        page_size: pageSize,
      })
      .then((result) => {
        if (!active) {
          return;
        }
        setRows(result.items);
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        if (isAuthError(cause)) {
          onExpired();
          return;
        }
        setError(errorText(cause));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [statusFilter, page, pageSize, reloadKey, onExpired]);

  const refresh = (): void => {
    setReloadKey((value) => value + 1);
    setOptionsReloadKey((value) => value + 1);
  };

  const productTitle = (productId: string): string =>
    products.find((product) => product.value === productId)?.label ?? productId;

  const spotName = (spotId: string | null): string => {
    if (spotId === null) {
      return '';
    }
    return spots.find((spot) => spot.value === spotId)?.label ?? spotId;
  };

  const fishLabel = (key: string): string =>
    fishOptions.find((option) => option.value === key)?.label ?? key;

  const openEditor = (placement: AdminPlacementItem | null): void => {
    setEditing(placement);
    setEditorOpen(true);
  };

  const handleDelete = (row: AdminPlacementItem): void => {
    modal.confirm({
      title: '删除展示位置',
      content: '删除后该商品不再出现在对应位置，确定删除？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.deletePlacement(row.placement_id, session.csrf);
          message.success('展示位置已删除');
          refresh();
        } catch (cause) {
          if (isAuthError(cause)) {
            onExpired();
            return;
          }
          message.error(errorText(cause));
        }
      },
    });
  };

  const columns: TableProps<AdminPlacementItem>['columns'] = [
    {
      title: '商品',
      dataIndex: 'product_id',
      render: (value: string) => <Typography.Text strong>{productTitle(value)}</Typography.Text>,
    },
    {
      title: '范围',
      dataIndex: 'scope',
      width: 210,
      render: (_value, row) => (
        <Space size={4} wrap>
          <Tag color={PLACEMENT_SCOPE_COLOR[row.scope] ?? 'default'}>
            {PLACEMENT_SCOPE_LABEL[row.scope] ?? row.scope}
          </Tag>
          <span>
            {row.scope === 'spot'
              ? spotName(row.target_id)
              : row.fish_keys.map(fishLabel).join('、')}
          </span>
        </Space>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 72,
    },
    {
      title: '生效时间',
      key: 'window',
      width: 220,
      render: (_value, row) => placementWindowText(row.starts_at, row.ends_at),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 82,
      render: (value: string) => (
        <Tag color={PLACEMENT_STATUS_COLOR[value] ?? 'default'}>
          {PLACEMENT_STATUS_LABEL[value] ?? value}
        </Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 168,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_value, row) => (
        <Space size={4} wrap>
          <Button
            size="small"
            type="link"
            onClick={() => {
              openEditor(row);
            }}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={() => {
              handleDelete(row);
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Row gutter={[12, 12]} align="middle" className="feedback-filter-row">
        <Col xs={24} md={6}>
          <Select
            allowClear
            placeholder="全部状态"
            value={statusFilter}
            onChange={(value: string | undefined) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={PLACEMENT_STATUS_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} md={18}>
          <Space>
            <Button onClick={refresh}>刷新</Button>
            <Button type="primary" onClick={() => openEditor(null)}>
              新增展示位置
            </Button>
          </Space>
        </Col>
      </Row>
      {error !== null && (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={error}
          action={
            <Button size="small" onClick={refresh}>
              重试
            </Button>
          }
          className="feedback-error"
        />
      )}
      <Table<AdminPlacementItem>
        rowKey="placement_id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 960 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50],
          showTotal: (count) => `共 ${count} 个展示位置`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
        locale={{ emptyText: <Empty description="还没有展示位置" /> }}
      />
      <PlacementEditorDrawer
        open={editorOpen}
        placement={editing}
        products={products}
        spots={spots}
        fishOptions={fishOptions}
        productsLoading={productsLoading}
        spotsLoading={spotsLoading}
        onProductSearch={setProductSearch}
        onSpotSearch={setSpotSearch}
        session={session}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSaved={refresh}
        onExpired={onExpired}
      />
    </>
  );
}

export function ProductDrawer({
  open,
  reloadKey,
  session,
  onClose,
  onChanged,
  onExpired,
}: ProductDrawerProps) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<AdminProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listReloadKey, setListReloadKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorProductId, setEditorProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('products');

  useEffect(() => {
    if (!open) {
      setEditorOpen(false);
      setEditorProductId(null);
      setActiveTab('products');
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .listProducts({
        status: statusFilter,
        category: categoryFilter,
        keyword: keyword.trim() === '' ? undefined : keyword.trim(),
        page,
        page_size: pageSize,
      })
      .then((result: AdminProductPage) => {
        if (!active) {
          return;
        }
        setRows(result.items);
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        if (isAuthError(cause)) {
          onExpired();
          return;
        }
        setError(errorText(cause));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    open,
    statusFilter,
    categoryFilter,
    keyword,
    page,
    pageSize,
    reloadKey,
    listReloadKey,
    onExpired,
  ]);

  const refresh = (): void => {
    setListReloadKey((value) => value + 1);
    onChanged();
  };

  const openEditor = (productId: string | null): void => {
    setEditorProductId(productId);
    setEditorOpen(true);
  };

  const handleArchive = (row: AdminProductListItem): void => {
    modal.confirm({
      title: '归档商品',
      content: `归档后「${row.title}」不再出现在小程序，历史数据保留。`,
      okText: '归档',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.archiveProduct(row.product_id, session.csrf);
          message.success('商品已归档');
          refresh();
        } catch (cause) {
          if (isAuthError(cause)) {
            onExpired();
            return;
          }
          message.error(errorText(cause));
        }
      },
    });
  };

  const columns: TableProps<AdminProductListItem>['columns'] = [
    {
      title: '封面',
      dataIndex: 'cover_image_url',
      width: 82,
      render: (value: string | null) => {
        const src = resolveMediaUrl(value);
        return src === undefined ? (
          <div className="cover-placeholder">无图</div>
        ) : (
          <Image src={src} width={58} height={42} preview={false} className="cover-thumb" />
        );
      },
    },
    {
      title: '商品',
      dataIndex: 'title',
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.subtitle ?? '未填副标题'}</div>
        </div>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 92,
      render: (value: string) => categoryTag(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 92,
      render: (value: string) => statusTag(value),
    },
    {
      title: '渠道',
      dataIndex: 'channel_count',
      width: 82,
      render: (value: number) =>
        value === 0 ? <span className="muted-text">未配置</span> : `${value} 个`,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 168,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_value, row) => (
        <Space size={4} wrap>
          <Button
            size="small"
            type="link"
            onClick={() => {
              openEditor(row.product_id);
            }}
          >
            编辑
          </Button>
          {row.status !== 'archived' && (
            <Button
              size="small"
              type="link"
              danger
              onClick={() => {
                handleArchive(row);
              }}
            >
              归档
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Drawer title="商品管理" width={1120} open={open} onClose={onClose} destroyOnHidden>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
        }}
        items={[
          {
            key: 'products',
            label: '商品',
            children: (
              <>
                <Row gutter={[12, 12]} align="middle" className="feedback-filter-row">
                  <Col xs={24} md={5}>
                    <Select
                      allowClear
                      placeholder="全部状态"
                      value={statusFilter}
                      onChange={(value: string | undefined) => {
                        setStatusFilter(value);
                        setPage(1);
                      }}
                      options={STATUS_OPTIONS}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={24} md={5}>
                    <Select
                      allowClear
                      placeholder="全部分类"
                      value={categoryFilter}
                      onChange={(value: string | undefined) => {
                        setCategoryFilter(value);
                        setPage(1);
                      }}
                      options={CATEGORY_OPTIONS}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Input.Search
                      allowClear
                      placeholder="按商品名称搜索"
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                      onSearch={() => {
                        setPage(1);
                        refresh();
                      }}
                    />
                  </Col>
                  <Col xs={24} md={6}>
                    <Space>
                      <Button onClick={refresh}>刷新</Button>
                      <Button type="primary" onClick={() => openEditor(null)}>
                        新增商品
                      </Button>
                    </Space>
                  </Col>
                </Row>
                {error !== null && (
                  <Alert
                    type="error"
                    showIcon
                    message="加载失败"
                    description={error}
                    action={
                      <Button size="small" onClick={refresh}>
                        重试
                      </Button>
                    }
                    className="feedback-error"
                  />
                )}
                <Table<AdminProductListItem>
                  rowKey="product_id"
                  size="small"
                  loading={loading}
                  columns={columns}
                  dataSource={rows}
                  scroll={{ x: 960 }}
                  pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    pageSizeOptions: [20, 50],
                    showTotal: (count) => `共 ${count} 个商品`,
                    onChange: (nextPage, nextPageSize) => {
                      setPage(nextPage);
                      setPageSize(nextPageSize);
                    },
                  }}
                  locale={{
                    emptyText: <Empty description="还没有商品，先新增一个草稿" />,
                  }}
                />
              </>
            ),
          },
          {
            key: 'placements',
            label: '展示位置',
            children: (
              <PlacementPanel
                session={session}
                active={activeTab === 'placements'}
                onExpired={onExpired}
              />
            ),
          },
        ]}
      />
      <ProductEditorDrawer
        open={editorOpen}
        productId={editorProductId}
        session={session}
        onClose={() => {
          setEditorOpen(false);
          setEditorProductId(null);
        }}
        onSaved={refresh}
        onExpired={onExpired}
      />
    </Drawer>
  );
}
