'use client';

import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type AdminDictionaryItem,
  type CreateDictionaryBody,
  type Session,
} from './api';

interface DictionaryDrawerProps {
  open: boolean;
  session: Session;
  onClose: () => void;
  onChanged: () => void;
  onExpired: () => void;
}

const DICTIONARY_TYPES = [
  'district',
  'fish_type',
  'fee_status',
  'fee_unit',
  'water_type',
  'venue_type',
  'fishing_method',
  'poi_type',
] as const;

const TYPE_LABEL: Record<string, string> = {
  district: '区域',
  fish_type: '鱼种',
  fee_status: '收费状态',
  fee_unit: '收费单位',
  water_type: '水域类型',
  venue_type: '场所类型',
  fishing_method: '钓法',
  poi_type: '周边场所类型',
};

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

export function DictionaryDrawer({
  open,
  session,
  onClose,
  onChanged,
  onExpired,
}: DictionaryDrawerProps) {
  const { message } = App.useApp();
  const [createForm] = Form.useForm<CreateDictionaryBody>();
  const [editForm] = Form.useForm();
  const [rows, setRows] = useState<AdminDictionaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminDictionaryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.listDictionaries();
      setRows(result.items);
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [message, onExpired]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const openCreate = (): void => {
    createForm.resetFields();
    createForm.setFieldsValue({ sort_order: 0, enabled: true });
    setCreateOpen(true);
  };

  const openEdit = (row: AdminDictionaryItem): void => {
    setEditing(row);
    editForm.resetFields();
    editForm.setFieldsValue({
      dict_label: row.dict_label,
      sort_order: row.sort_order,
      enabled: row.enabled,
    });
  };

  const notifyChanged = (): void => {
    onChanged();
  };

  const submitCreate = async (): Promise<void> => {
    const values = await createForm.validateFields();
    setSaving(true);
    try {
      await api.createDictionary(
        {
          dict_type: values.dict_type,
          dict_key: values.dict_key.trim(),
          dict_label: values.dict_label.trim(),
          sort_order: values.sort_order ?? 0,
          enabled: values.enabled ?? true,
        },
        session.csrf,
      );
      message.success('字典项已新增');
      setCreateOpen(false);
      await load();
      notifyChanged();
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

  const submitEdit = async (): Promise<void> => {
    if (editing === null) {
      return;
    }
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      await api.updateDictionary(
        editing.dict_type,
        editing.dict_key,
        {
          dict_label: values.dict_label.trim(),
          sort_order: values.sort_order,
          enabled: values.enabled,
        },
        session.csrf,
      );
      message.success('字典项已更新');
      setEditing(null);
      await load();
      notifyChanged();
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

  const toggleEnabled = async (row: AdminDictionaryItem, enabled: boolean): Promise<void> => {
    const key = `${row.dict_type}:${row.dict_key}`;
    setTogglingKey(key);
    try {
      await api.updateDictionary(
        row.dict_type,
        row.dict_key,
        { enabled },
        session.csrf,
      );
      message.success(enabled ? '已启用' : '已停用');
      await load();
      notifyChanged();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setTogglingKey(null);
    }
  };

  const columns: TableProps<AdminDictionaryItem>['columns'] = [
    {
      title: '类型',
      dataIndex: 'dict_type',
      width: 150,
      render: (value: string) => TYPE_LABEL[value] ?? value,
    },
    {
      title: '键',
      dataIndex: 'dict_key',
      width: 160,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: '显示名称',
      dataIndex: 'dict_label',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 120,
      render: (value: boolean, row) => (
        <Space size={6}>
          <Switch
            size="small"
            checked={value}
            loading={togglingKey === `${row.dict_type}:${row.dict_key}`}
            onChange={(checked) => {
              void toggleEnabled(row, checked);
            }}
          />
          <Tag color={value ? 'green' : 'default'}>{value ? '启用' : '停用'}</Tag>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_value, row) => (
        <Button
          size="small"
          type="link"
          onClick={() => {
            openEdit(row);
          }}
        >
          编辑
        </Button>
      ),
    },
  ];

  const filteredRows =
    typeFilter === undefined ? rows : rows.filter((row) => row.dict_type === typeFilter);

  return (
    <Drawer
      title="字典维护"
      width={900}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Button type="primary" onClick={openCreate}>
          新增字典项
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        message="字典变更会影响后台表单和小程序展示"
        description="停用后不会出现在公开字典中，历史数据仍保留原键值。公开接口最多缓存 10 分钟。"
        style={{ marginBottom: 16 }}
      />
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="全部类型"
          value={typeFilter}
          onChange={setTypeFilter}
          style={{ width: 220 }}
          options={DICTIONARY_TYPES.map((type) => ({
            value: type,
            label: TYPE_LABEL[type],
          }))}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table<AdminDictionaryItem>
        rowKey={(row) => `${row.dict_type}:${row.dict_key}`}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={filteredRows}
        pagination={false}
        scroll={{ y: 520 }}
      />

      <Modal
        title="新增字典项"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void submitCreate().catch(() => undefined);
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        forceRender
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item
            name="dict_type"
            label="类型"
            rules={[{ required: true, message: '请选择字典类型' }]}
          >
            <Select
              options={DICTIONARY_TYPES.map((type) => ({
                value: type,
                label: TYPE_LABEL[type],
              }))}
            />
          </Form.Item>
          <Form.Item
            name="dict_key"
            label="键"
            rules={[{ required: true, message: '请填写键' }]}
          >
            <Input maxLength={64} placeholder="例如：new_fish" />
          </Form.Item>
          <Form.Item
            name="dict_label"
            label="显示名称"
            rules={[{ required: true, message: '请填写显示名称' }]}
          >
            <Input maxLength={128} placeholder="例如：新鱼种" />
          </Form.Item>
          <Space size={16} align="start">
            <Form.Item name="sort_order" label="排序">
              <InputNumber min={0} max={1000000} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={editing === null ? '编辑字典项' : `编辑 ${editing.dict_type}:${editing.dict_key}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => {
          void submitEdit().catch(() => undefined);
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        forceRender
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item
            name="dict_label"
            label="显示名称"
            rules={[{ required: true, message: '请填写显示名称' }]}
          >
            <Input maxLength={128} />
          </Form.Item>
          <Space size={16} align="start">
            <Form.Item name="sort_order" label="排序">
              <InputNumber min={0} max={1000000} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Drawer>
  );
}
