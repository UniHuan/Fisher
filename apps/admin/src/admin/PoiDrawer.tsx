'use client';

import {
  Alert,
  App,
  Button,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type AdminPoiItem,
  type AdminSpotDetail,
  type AdminSpotPoiItem,
  type CreatePoiBody,
  type PoiSyncRun,
  type PublicDictionaries,
  type Session,
} from './api';

interface PoiDrawerProps {
  open: boolean;
  spotId: string | null;
  spotName: string;
  session: Session;
  dictionaries: PublicDictionaries | null;
  onClose: () => void;
  onExpired: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: '运营录入',
  tencent: '腾讯位置服务',
  amap: '高德地图',
};

const FALLBACK_TYPE_LABEL: Record<string, string> = {
  food: '餐饮',
  parking: '停车',
  toilet: '厕所',
  supply: '补给',
  entertainment: '娱乐',
  lodging: '住宿',
};

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

function syncText(run: PoiSyncRun): string {
  if (run.status === 'failed') {
    return '同步失败';
  }
  if (run.status === 'running') {
    return '同步进行中';
  }
  return `同步成功，写入 ${run.poi_count} 个场所`;
}

export function PoiDrawer({
  open,
  spotId,
  spotName,
  session,
  dictionaries,
  onClose,
  onExpired,
}: PoiDrawerProps) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<CreatePoiBody>();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminSpotPoiItem[]>([]);
  const [lastSync, setLastSync] = useState<PoiSyncRun | null>(null);
  const [spot, setSpot] = useState<AdminSpotDetail | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminSpotPoiItem | null>(null);
  const [binding, setBinding] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [poiLibrary, setPoiLibrary] = useState<AdminPoiItem[]>([]);
  const [bindingPoiId, setBindingPoiId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const canWrite = session.admin.role !== 'reviewer';
  const dictionaryTypeOptions = (dictionaries?.poi_types ?? []).map((item) => ({
    value: item.key,
    label: item.label,
  }));
  const typeOptions =
    dictionaryTypeOptions.length > 0
      ? dictionaryTypeOptions
      : Object.entries(FALLBACK_TYPE_LABEL).map(([value, label]) => ({ value, label }));
  const typeLabels = new Map(
    (dictionaries?.poi_types ?? []).map((item) => [item.key, item.label]),
  );

  const typeLabel = (key: string): string =>
    typeLabels.get(key) ?? FALLBACK_TYPE_LABEL[key] ?? key;

  const load = useCallback(async (): Promise<void> => {
    if (spotId === null) {
      return;
    }
    setLoading(true);
    try {
      const [detail, poiList] = await Promise.all([
        api.getSpot(spotId),
        api.listSpotPois(spotId),
      ]);
      setSpot(detail);
      setItems(poiList.items);
      setLastSync(poiList.last_sync);
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [spotId, message, onExpired]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const openAdd = (): void => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      poi_type: 'food',
      latitude: spot?.latitude ?? '',
      longitude: spot?.longitude ?? '',
    });
    setFormOpen(true);
  };

  const openEdit = (item: AdminSpotPoiItem): void => {
    setEditing(item);
    form.resetFields();
    form.setFieldsValue({
      poi_name: item.poi_name,
      poi_type: item.poi_type,
      latitude: item.latitude,
      longitude: item.longitude,
      address: item.address ?? undefined,
      open_time: item.open_time ?? undefined,
    });
    setFormOpen(true);
  };

  const submitForm = async (): Promise<void> => {
    const values = await form.validateFields();
    const body: CreatePoiBody = {
      poi_name: values.poi_name.trim(),
      poi_type: values.poi_type,
      latitude: values.latitude,
      longitude: values.longitude,
      address: values.address?.trim() === '' ? null : (values.address ?? null),
      open_time: values.open_time?.trim() === '' ? null : (values.open_time ?? null),
    };
    setBinding(true);
    try {
      if (editing !== null) {
        await api.updatePoi(editing.poi_id, body, session.csrf);
        message.success('POI 已更新');
        setFormOpen(false);
        await load();
        return;
      }
      const created = await api.createPoi(body, session.csrf);
      try {
        await api.bindPoi(spotId as string, { poi_id: created.poi_id }, session.csrf);
        message.success('POI 已新增并绑定');
        setFormOpen(false);
        await load();
      } catch (error) {
        if (isAuthError(error)) {
          onExpired();
          return;
        }
        message.warning(`POI 已创建，但绑定失败：${errorText(error)}`);
        setFormOpen(false);
        await load();
      }
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setBinding(false);
    }
  };

  const loadPoiLibrary = useCallback(
    async (keyword: string): Promise<void> => {
      setSearching(true);
      try {
        const result = await api.listPois({
          status: 'active',
          keyword: keyword.trim() === '' ? undefined : keyword.trim(),
          page: 1,
          page_size: 20,
        });
        setPoiLibrary(result.items);
      } catch (error) {
        if (isAuthError(error)) {
          onExpired();
          return;
        }
        message.error(errorText(error));
      } finally {
        setSearching(false);
      }
    },
    [message, onExpired],
  );

  const openBind = (): void => {
    setBindOpen(true);
    void loadPoiLibrary('');
  };

  const handleBind = async (poi: AdminPoiItem): Promise<void> => {
    if (spotId === null) {
      return;
    }
    setBindingPoiId(poi.poi_id);
    try {
      await api.bindPoi(spotId, { poi_id: poi.poi_id }, session.csrf);
      message.success(`已绑定「${poi.poi_name}」`);
      setBindOpen(false);
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setBindingPoiId(null);
    }
  };

  const handleUnbind = (item: AdminSpotPoiItem): void => {
    modal.confirm({
      title: '解绑 POI',
      content: `确定从「${spotName}」解绑「${item.poi_name}」？POI 库中的记录会保留。`,
      okText: '解绑',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.unbindPoi(spotId as string, item.poi_id, session.csrf);
          message.success('POI 已解绑');
          await load();
        } catch (error) {
          if (isAuthError(error)) {
            onExpired();
            return;
          }
          message.error(errorText(error));
        }
      },
    });
  };

  const handleHide = (item: AdminSpotPoiItem): void => {
    modal.confirm({
      title: '隐藏 POI',
      content: `隐藏后「${item.poi_name}」不会在任何钓点的公开页展示，记录仍保留在 POI 库。`,
      okText: '隐藏',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.updatePoi(item.poi_id, { status: 'hidden' }, session.csrf);
          message.success('POI 已隐藏');
          await load();
        } catch (error) {
          if (isAuthError(error)) {
            onExpired();
            return;
          }
          message.error(errorText(error));
        }
      },
    });
  };

  const handleRestore = async (item: AdminSpotPoiItem): Promise<void> => {
    try {
      await api.updatePoi(item.poi_id, { status: 'active' }, session.csrf);
      message.success('POI 已恢复展示');
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    }
  };

  const handleSync = (): void => {
    modal.confirm({
      title: '从腾讯位置服务同步周边',
      content:
        '将以钓点为中心拉取 3 公里内的餐饮、停车、厕所、补给、娱乐和住宿场所，写入 POI 库并绑定。同步会消耗接口配额。',
      okText: '开始同步',
      cancelText: '取消',
      onOk: async () => {
        setSyncing(true);
        try {
          const run = await api.syncSpotPois(spotId as string, session.csrf);
          message.success(syncText(run));
          await load();
        } catch (error) {
          if (isAuthError(error)) {
            onExpired();
            return;
          }
          message.error(
            error instanceof ApiError && error.code === 50301
              ? '同步失败，失败原因已写入最近同步状态'
              : errorText(error),
          );
          await load();
        } finally {
          setSyncing(false);
        }
      },
    });
  };

  const boundIds = new Set(items.map((item) => item.poi_id));
  const groups = new Map<string, AdminSpotPoiItem[]>();
  for (const item of items) {
    const existing = groups.get(item.effective_type) ?? [];
    existing.push(item);
    groups.set(item.effective_type, existing);
  }

  return (
    <Drawer
      title={spotName === '' ? '周边场所' : `周边场所 · ${spotName}`}
      width={780}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        canWrite ? (
          <Space wrap>
            <Button onClick={openAdd}>新增 POI</Button>
            <Button onClick={openBind}>绑定已有</Button>
            <Button type="primary" loading={syncing} onClick={handleSync}>
              从腾讯同步
            </Button>
          </Space>
        ) : (
          <Tag>只读</Tag>
        )
      }
    >
      <Spin spinning={loading}>
        {lastSync === null ? (
          <Alert
            type="info"
            showIcon
            message="还没有同步记录"
            description="可以手动新增或绑定 POI，也可以从腾讯位置服务拉取钓点周边。"
          />
        ) : (
          <Alert
            type={
              lastSync.status === 'success'
                ? 'success'
                : lastSync.status === 'failed'
                  ? 'error'
                  : 'info'
            }
            showIcon
            message={`${syncText(lastSync)} · ${new Date(lastSync.started_at).toLocaleString('zh-CN')}`}
            description={
              lastSync.status === 'failed'
                ? lastSync.error_message
                : `接口配额调用 ${lastSync.quota_used} 次`
            }
          />
        )}

        <div className="poi-summary">
          <span>{items.length} 个已绑定场所</span>
          <span className="muted-text">公开页只展示未隐藏的 POI</span>
        </div>

        {items.length === 0 ? (
          <Empty description="还没有绑定周边场所" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          Array.from(groups.entries()).map(([type, group]) => (
            <div className="poi-group" key={type}>
              <div className="poi-group-head">
                <Typography.Text strong>{typeLabel(type)}</Typography.Text>
                <Tag>{group.length}</Tag>
              </div>
              <List
                dataSource={group}
                renderItem={(item) => (
                  <List.Item className="poi-row">
                    <div className="poi-row-main">
                      <Space size={6} wrap>
                        <Typography.Text strong>{item.poi_name}</Typography.Text>
                        {item.status === 'hidden' && <Tag color="red">已隐藏</Tag>}
                        {item.poi_type_override !== null && (
                          <Tag color="blue">类型已覆盖</Tag>
                        )}
                      </Space>
                      <div className="muted-text">
                        {item.address ?? '地址未填'} · {item.open_time ?? '营业时间未填'}
                      </div>
                    </div>
                    <div className="poi-row-meta">
                      <span className="poi-distance">{item.distance_m} m</span>
                      <Tag>{SOURCE_LABEL[item.source] ?? item.source}</Tag>
                      {canWrite && (
                        <Space size={2} wrap>
                          <Button
                            size="small"
                            type="link"
                            onClick={() => {
                              openEdit(item);
                            }}
                          >
                            编辑
                          </Button>
                          {item.status === 'active' ? (
                            <Button
                              size="small"
                              type="link"
                              danger
                              onClick={() => {
                                handleHide(item);
                              }}
                            >
                              隐藏
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              type="link"
                              onClick={() => {
                                void handleRestore(item);
                              }}
                            >
                              恢复
                            </Button>
                          )}
                          <Button
                            size="small"
                            type="link"
                            onClick={() => {
                              handleUnbind(item);
                            }}
                          >
                            解绑
                          </Button>
                        </Space>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            </div>
          ))
        )}
      </Spin>

      <Modal
        title={editing === null ? '新增 POI' : '编辑 POI'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => {
          void submitForm().catch(() => undefined);
        }}
        okText={editing === null ? '保存并绑定' : '保存修改'}
        cancelText="取消"
        confirmLoading={binding}
        width={560}
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="poi_name"
            label="场所名称"
            rules={[{ required: true, message: '请填写场所名称' }]}
          >
            <Input maxLength={80} placeholder="例如：深圳湾公园停车场" />
          </Form.Item>
          <Form.Item
            name="poi_type"
            label="场所类型"
            rules={[{ required: true, message: '请选择场所类型' }]}
          >
            <Select options={typeOptions} />
          </Form.Item>
          <Space size={12} style={{ width: '100%' }} align="start">
            <Form.Item
              name="latitude"
              label="纬度（GCJ-02）"
              rules={[{ required: true, message: '请填写纬度' }]}
              style={{ width: 220 }}
            >
              <Input placeholder="22.517600" />
            </Form.Item>
            <Form.Item
              name="longitude"
              label="经度（GCJ-02）"
              rules={[{ required: true, message: '请填写经度' }]}
              style={{ width: 220 }}
            >
              <Input placeholder="113.952300" />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="地址">
            <Input maxLength={120} placeholder="选填" />
          </Form.Item>
          <Form.Item name="open_time" label="营业时间">
            <Input maxLength={100} placeholder="例如：06:00 至 22:00" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="绑定已有 POI"
        open={bindOpen}
        onCancel={() => setBindOpen(false)}
        footer={null}
        width={640}
        destroyOnHidden
      >
        <Input.Search
          allowClear
          placeholder="按场所名称搜索 POI 库"
          loading={searching}
          onSearch={(value) => {
            void loadPoiLibrary(value);
          }}
        />
        <Divider />
        <List
          loading={searching}
          dataSource={poiLibrary}
          locale={{ emptyText: <Empty description="没有匹配的 POI" /> }}
          renderItem={(poi) => {
            const alreadyBound = boundIds.has(poi.poi_id);
            return (
              <List.Item
                actions={[
                  alreadyBound ? (
                    <Tag key="bound">已绑定</Tag>
                  ) : (
                    <Button
                      key="bind"
                      size="small"
                      type="primary"
                      loading={bindingPoiId === poi.poi_id}
                      disabled={!canWrite}
                      onClick={() => {
                        void handleBind(poi);
                      }}
                    >
                      绑定
                    </Button>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={6}>
                      <span>{poi.poi_name}</span>
                      <Tag>{typeLabel(poi.poi_type)}</Tag>
                    </Space>
                  }
                  description={`${poi.address ?? '地址未填'} · ${SOURCE_LABEL[poi.source] ?? poi.source}`}
                />
              </List.Item>
            );
          }}
        />
      </Modal>
    </Drawer>
  );
}
