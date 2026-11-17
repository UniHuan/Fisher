'use client';

import {
  App,
  Alert,
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
  Switch,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  resolveMediaUrl,
  type AdminSpotDetail,
  type CreateSpotBody,
  type DuplicateWarning,
  type PublicDictionaries,
  type Session,
  type UpdateSpotBody,
} from './api';
import { MapPickerModal } from './MapPickerModal';

interface SpotEditorProps {
  open: boolean;
  spotId: string | null;
  session: Session;
  dictionaries: PublicDictionaries | null;
  onClose: () => void;
  onSaved: () => void;
  onExpired: () => void;
}

interface EditorImage {
  key: string;
  url: string | undefined;
}

const OPEN_OPTIONS = [
  { value: 'open', label: '开放' },
  { value: 'paused', label: '暂停' },
  { value: 'banned', label: '禁钓' },
];

const FEE_UNIT_OPTIONS = [
  { value: 'day', label: '按天' },
  { value: 'hour', label: '按小时' },
  { value: 'rod', label: '按竿' },
  { value: 'year', label: '按年' },
  { value: 'other', label: '其他' },
];

const SOURCE_OPTIONS = [
  { value: 'official', label: '官方' },
  { value: 'operation', label: '运营' },
  { value: 'user_report', label: '用户上报' },
  { value: 'third_party', label: '第三方' },
];

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'default',
  published: 'green',
  offline: 'orange',
};

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

export function SpotEditor({
  open,
  spotId,
  session,
  dictionaries,
  onClose,
  onSaved,
  onExpired,
}: SpotEditorProps) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<Record<string, unknown>>();
  const [detail, setDetail] = useState<AdminSpotDetail | null>(null);
  const [images, setImages] = useState<EditorImage[]>([]);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapInitial, setMapInitial] = useState<{
    latitude: string | null;
    longitude: string | null;
  }>({ latitude: null, longitude: null });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadPurposeRef = useRef<'cover' | 'detail'>('detail');
  const writable = session.admin.role !== 'reviewer';
  const canDelete = session.admin.role === 'super_admin';

  const openMapPicker = (): void => {
    const latitude = form.getFieldValue('latitude');
    const longitude = form.getFieldValue('longitude');
    setMapInitial({
      latitude:
        typeof latitude === 'string' && latitude.trim() !== '' ? latitude : null,
      longitude:
        typeof longitude === 'string' && longitude.trim() !== '' ? longitude : null,
    });
    setMapPickerOpen(true);
  };

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
    message.error(error instanceof ApiError ? error.message : '操作失败，请稍后重试');
  };

  const applyDetail = (spot: AdminSpotDetail): void => {
    setDetail(spot);
    form.setFieldsValue({
      spot_name: spot.spot_name,
      district: spot.district ?? undefined,
      latitude: spot.latitude ?? undefined,
      longitude: spot.longitude ?? undefined,
      nav_latitude: spot.nav_latitude ?? undefined,
      nav_longitude: spot.nav_longitude ?? undefined,
      parking_latitude: spot.parking_latitude ?? undefined,
      parking_longitude: spot.parking_longitude ?? undefined,
      address: spot.address ?? undefined,
      fish_types: spot.fish_types,
      fee_status: spot.fee_status ?? undefined,
      fee_unit: spot.fee_unit ?? undefined,
      fee_detail: spot.fee_detail ?? undefined,
      water_type: spot.water_type ?? undefined,
      venue_type: spot.venue_type ?? undefined,
      fishing_method: spot.fishing_method,
      open_status: spot.open_status ?? 'open',
      ban_note: spot.ban_note ?? undefined,
      open_hours: spot.open_hours ?? undefined,
      description: spot.description ?? undefined,
      tips: spot.tips ?? undefined,
      sort_weight: spot.sort_weight,
      is_core: spot.is_core,
      source: spot.source ?? 'operation',
    });
    setImages(
      spot.images.map((key, index) => ({
        key,
        url: resolveMediaUrl(spot.image_urls[index]),
      })),
    );
    setCoverKey(spot.cover_image_key ?? spot.images[0] ?? null);
  };

  useEffect(() => {
    if (!open) {
      setMapPickerOpen(false);
      return undefined;
    }
    let active = true;
    setDetail(null);
    setImages([]);
    setCoverKey(null);
    form.resetFields();
    if (spotId === null) {
      form.setFieldsValue({
        open_status: 'open',
        source: 'operation',
        is_core: false,
        sort_weight: 0,
        fish_types: [],
        fishing_method: [],
      });
      return () => {
        active = false;
      };
    }

    setLoading(true);
    api
      .getSpot(spotId)
      .then((spot) => {
        if (active) {
          applyDetail(spot);
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
    // Reload only when the drawer opens or switches to another spot.
  }, [open, spotId, form]);

  const buildBody = (values: Record<string, unknown>): CreateSpotBody => ({
    spot_name: typeof values.spot_name === 'string' ? values.spot_name.trim() : '',
    district: (values.district as string | undefined) ?? null,
    latitude: textOrNull(values.latitude),
    longitude: textOrNull(values.longitude),
    nav_latitude: textOrNull(values.nav_latitude),
    nav_longitude: textOrNull(values.nav_longitude),
    parking_latitude: textOrNull(values.parking_latitude),
    parking_longitude: textOrNull(values.parking_longitude),
    address: textOrNull(values.address),
    fish_types: (values.fish_types as string[] | undefined) ?? [],
    fee_status: (values.fee_status as string | undefined) ?? null,
    fee_unit: (values.fee_unit as string | undefined) ?? null,
    fee_detail: textOrNull(values.fee_detail),
    water_type: (values.water_type as string | undefined) ?? null,
    venue_type: (values.venue_type as string | undefined) ?? null,
    fishing_method: (values.fishing_method as string[] | undefined) ?? [],
    open_status:
      (values.open_status as CreateSpotBody['open_status']) ?? null,
    ban_note: textOrNull(values.ban_note),
    open_hours: textOrNull(values.open_hours),
    description: textOrNull(values.description),
    tips: textOrNull(values.tips),
    images: images.map((image) => image.key),
    cover_image_key: coverKey,
    sort_weight: (values.sort_weight as number | undefined) ?? 0,
    is_core: (values.is_core as boolean | undefined) ?? false,
    source: (values.source as CreateSpotBody['source']) ?? 'operation',
  });

  const showWarnings = (warnings: DuplicateWarning[]): void => {
    if (warnings.length === 0) {
      return;
    }
    modal.info({
      title: '发现相似钓点',
      content: (
        <div>
          <p>保存已成功。以下钓点与当前钓点区域相同、名称相似且在 200 米内，请确认是否重复。</p>
          {warnings.map((warning) => (
            <div key={warning.spot_id} className="warning-row">
              {warning.spot_name}，约 {warning.distance_m} 米
            </div>
          ))}
        </div>
      ),
      okText: '知道了',
    });
  };

  const persist = async (): Promise<AdminSpotDetail | null> => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const body = buildBody(values);
      const result =
        detail === null
          ? await api.createSpot(body, session.csrf)
          : await api.updateSpot(
              detail.spot_id,
              body as UpdateSpotBody,
              session.csrf,
            );
      applyDetail(result.spot);
      showWarnings(result.warnings);
      onSaved();
      return result.spot;
    } catch (error) {
      showError(error);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    const saved = await persist();
    if (saved !== null) {
      message.success('已保存');
    }
  };

  const handlePublish = async (): Promise<void> => {
    const saved = await persist();
    if (saved === null) {
      return;
    }
    try {
      const published = await api.publishSpot(saved.spot_id, session.csrf);
      applyDetail(published);
      message.success('钓点已发布');
      onSaved();
    } catch (error) {
      showError(error);
    }
  };

  const handleOffline = (): void => {
    if (detail === null) {
      return;
    }
    modal.confirm({
      title: '下线钓点',
      content: '下线后小程序不可见，历史数据与图片保留。',
      okText: '下线',
      cancelText: '取消',
      onOk: async () => {
        try {
          const offline = await api.offlineSpot(detail.spot_id, session.csrf);
          applyDetail(offline);
          message.success('钓点已下线');
          onSaved();
        } catch (error) {
          showError(error);
        }
      },
    });
  };

  const handleVerify = (): void => {
    if (detail === null) {
      return;
    }
    modal.confirm({
      title: '标记已核实',
      content: '确认最近核实过该钓点的开放状态、收费与图片信息？',
      okText: '确认核实',
      cancelText: '取消',
      onOk: async () => {
        try {
          const verified = await api.verifySpot(detail.spot_id, session.csrf);
          applyDetail(verified);
          message.success('已标记核实');
          onSaved();
        } catch (error) {
          showError(error);
        }
      },
    });
  };

  const handleDelete = (): void => {
    if (detail === null) {
      return;
    }
    modal.confirm({
      title: '删除钓点',
      content: '仅草稿或已下线钓点可删除。删除后默认不可见。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.deleteSpot(detail.spot_id, session.csrf);
          message.success('钓点已删除');
          onSaved();
          onClose();
        } catch (error) {
          showError(error);
        }
      },
    });
  };

  const triggerUpload = (purpose: 'cover' | 'detail'): void => {
    if (detail === null) {
      message.info('请先保存草稿，再上传图片');
      return;
    }
    uploadPurposeRef.current = purpose;
    fileInputRef.current?.click();
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined || detail === null) {
      return;
    }
    setUploading(true);
    try {
      const result = await api.uploadImage(
        detail.spot_id,
        uploadPurposeRef.current,
        file,
        session.csrf,
      );
      const nextImage: EditorImage = {
        key: result.key,
        url: resolveMediaUrl(result.preview_url),
      };
      setImages((current) => [...current, nextImage]);
      if (uploadPurposeRef.current === 'cover' || coverKey === null) {
        setCoverKey(result.key);
      }
      message.success('图片已上传，保存后生效');
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
      setCoverKey(next[0]?.key ?? null);
    }
  };

  const districtOptions = (dictionaries?.districts ?? []).map((item) => ({
    value: item.key,
    label: item.label,
  }));
  const fishOptions = (dictionaries?.fish_types ?? []).map((item) => ({
    value: item.key,
    label: item.label,
  }));
  const feeOptions = (dictionaries?.fee_status ?? []).map((item) => ({
    value: item.key,
    label: item.label,
  }));
  const waterOptions = (dictionaries?.water_types ?? []).map((item) => ({
    value: item.key,
    label: item.label,
  }));
  const venueOptions = (dictionaries?.venue_types ?? []).map((item) => ({
    value: item.key,
    label: item.label,
  }));
  const methodOptions = (dictionaries?.fishing_methods ?? []).map((item) => ({
    value: item.key,
    label: item.label,
  }));

  return (
    <Drawer
      open={open}
      width={880}
      title={
        <Space>
          <span>{detail === null ? '新增钓点' : detail.spot_name}</span>
          {detail !== null && (
            <Tag color={STATUS_COLOR[detail.status] ?? 'default'}>
              {STATUS_LABEL[detail.status] ?? detail.status}
            </Tag>
          )}
        </Space>
      }
      onClose={onClose}
      footer={
        <div className="editor-footer">
          <Button onClick={onClose}>关闭</Button>
          <Space>
            {canDelete && detail !== null && detail.status === 'draft' && (
              <Button danger onClick={handleDelete}>
                删除
              </Button>
            )}
            {canDelete && detail !== null && detail.status === 'offline' && (
              <Button danger onClick={handleDelete}>
                删除
              </Button>
            )}
            {writable && (
              <Button onClick={handleSave} loading={saving}>
                保存
              </Button>
            )}
            {writable && (detail === null || detail.status !== 'published') && (
              <Button type="primary" onClick={handlePublish} loading={saving}>
                {detail === null ? '保存并发布' : '发布'}
              </Button>
            )}
            {writable && detail !== null && detail.status === 'published' && (
              <Button onClick={handleOffline}>下线</Button>
            )}
            {writable && detail !== null && (
              <Button onClick={handleVerify}>标记核实</Button>
            )}
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical" disabled={!writable || loading} requiredMark={false}>
        {!writable && (
          <Alert
            type="info"
            showIcon
            message="当前角色为审核员，只能查看钓点信息。"
            style={{ marginBottom: 16 }}
          />
        )}
        {loading && <Typography.Text type="secondary">正在加载钓点…</Typography.Text>}

        <Typography.Title level={5}>基础信息</Typography.Title>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item
              label="钓点名称"
              name="spot_name"
              rules={[{ required: true, max: 60, message: '请输入 1-60 字钓点名称' }]}
            >
              <Input placeholder="例如：深圳湾公园东门钓点" maxLength={60} showCount />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="所属区域" name="district">
              <Select allowClear showSearch options={districtOptions} placeholder="选择区域" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="地址" name="address">
              <Input placeholder="用于导航与复制地址" maxLength={120} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="钓点纬度" name="latitude">
              <Input placeholder="GCJ-02，例如 22.517600" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="钓点经度" name="longitude">
              <Input placeholder="GCJ-02，例如 113.952300" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="导航纬度" name="nav_latitude">
              <Input placeholder="留空默认等于钓点坐标" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="导航经度" name="nav_longitude">
              <Input placeholder="留空默认等于钓点坐标" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Space size={12} align="center">
              <Button size="small" disabled={!writable} onClick={openMapPicker}>
                地图选点
              </Button>
              <Typography.Text type="secondary">
                点击地图或搜索地址，自动填入钓点 GCJ-02 坐标。
              </Typography.Text>
            </Space>
          </Col>
        </Row>

        <Divider />
        <Typography.Title level={5}>鱼情与场地</Typography.Title>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="可钓鱼种" name="fish_types">
              <Select mode="multiple" options={fishOptions} placeholder="可多选" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="适配钓法" name="fishing_method">
              <Select mode="multiple" options={methodOptions} placeholder="可多选" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="收费状态" name="fee_status">
              <Select allowClear options={feeOptions} placeholder="选择收费状态" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="收费单位" name="fee_unit">
              <Select allowClear options={FEE_UNIT_OPTIONS} placeholder="可选" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="收费说明" name="fee_detail">
              <Input maxLength={200} placeholder="例如 80 元一天" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="水域类型" name="water_type">
              <Select allowClear options={waterOptions} placeholder="选择水域类型" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="场所类型" name="venue_type">
              <Select allowClear options={venueOptions} placeholder="选择场所类型" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="开放状态" name="open_status">
              <Select options={OPEN_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={16}>
            <Form.Item label="禁钓 / 限钓说明" name="ban_note">
              <Input maxLength={200} placeholder="禁钓点必填" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="开放时间" name="open_hours">
              <Input maxLength={100} placeholder="例如 06:00 至 22:00" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="数据来源" name="source">
              <Select options={SOURCE_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        <Divider />
        <Typography.Title level={5}>运营信息</Typography.Title>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="核心钓点" name="is_core" valuePropName="checked">
              <Switch checkedChildren="核心" unCheckedChildren="普通" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="排序权重" name="sort_weight">
              <InputNumber min={0} max={1000000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="钓点简介" name="description">
          <Input.TextArea rows={3} maxLength={2000} showCount placeholder="钓位、环境、适合人群等" />
        </Form.Item>
        <Form.Item label="注意事项" name="tips">
          <Input.TextArea rows={2} maxLength={2000} showCount placeholder="安全、规则、饵料建议" />
        </Form.Item>

        <Divider />
        <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              图片
            </Typography.Title>
            <Typography.Text type="secondary">
              自动压缩为 WebP。封面不超过 200 KB，详情图不超过 300 KB。
            </Typography.Text>
          </div>
          {writable && (
            <Space>
              <Button
                onClick={() => {
                  triggerUpload('detail');
                }}
                loading={uploading}
              >
                上传详情图
              </Button>
              <Button
                type="primary"
                ghost
                onClick={() => {
                  triggerUpload('cover');
                }}
                loading={uploading}
              >
                上传封面
              </Button>
            </Space>
          )}
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
            <div key={image.key} className={`image-tile ${coverKey === image.key ? 'is-cover' : ''}`}>
              {image.url === undefined ? (
                <div className="image-missing">预览不可用</div>
              ) : (
                <Image src={image.url} width={150} height={106} className="editor-image" />
              )}
              <div className="image-actions">
                {coverKey === image.key ? (
                  <Tag color="green">封面</Tag>
                ) : (
                  writable && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        setCoverKey(image.key);
                      }}
                    >
                      设为封面
                    </Button>
                  )
                )}
                {writable && (
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
                )}
              </div>
            </div>
          ))}
        </div>
      </Form>
      <MapPickerModal
        open={mapPickerOpen}
        initialLatitude={mapInitial.latitude}
        initialLongitude={mapInitial.longitude}
        onPick={(picked) => {
          form.setFieldsValue({
            latitude: picked.latitude,
            longitude: picked.longitude,
            ...(picked.address === null ? {} : { address: picked.address }),
          });
          message.success('坐标已填入');
        }}
        onClose={() => setMapPickerOpen(false)}
      />
    </Drawer>
  );
}
