'use client';

import {
  App,
  Button,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type AuditLogItem,
  type AuditLogPage,
} from './api';

interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
  onExpired: () => void;
}

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

function jsonText(value: Record<string, unknown> | null): string {
  return value === null ? '无' : JSON.stringify(value, null, 2);
}

export function AuditLogDrawer({
  open,
  onClose,
  onExpired,
}: AuditLogDrawerProps) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [actionInput, setActionInput] = useState('');
  const [entityInput, setEntityInput] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<AuditLogItem | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listAuditLogs({
        action: actionFilter.trim() === '' ? undefined : actionFilter.trim(),
        entity_type: entityFilter.trim() === '' ? undefined : entityFilter.trim(),
        page,
        page_size: pageSize,
      })
      .then((result: AuditLogPage) => {
        if (!active) {
          return;
        }
        setRows(result.items);
        setTotal(result.total);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (isAuthError(error)) {
          onExpired();
          return;
        }
        message.error(errorText(error));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [open, page, pageSize, actionFilter, entityFilter, reloadKey, message, onExpired]);

  const applyFilters = (): void => {
    setPage(1);
    setActionFilter(actionInput);
    setEntityFilter(entityInput);
    setReloadKey((value) => value + 1);
  };

  const resetFilters = (): void => {
    setActionInput('');
    setEntityInput('');
    setActionFilter('');
    setEntityFilter('');
    setPage(1);
    setReloadKey((value) => value + 1);
  };

  const columns: TableProps<AuditLogItem>['columns'] = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '管理员',
      dataIndex: 'admin_id',
      width: 110,
      render: (value: string) => (
        <Typography.Text code ellipsis={{ tooltip: value }}>
          {value.slice(-8)}
        </Typography.Text>
      ),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 150,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '实体',
      key: 'entity',
      width: 190,
      render: (_value, row) => (
        <div>
          <div>{row.entity_type}</div>
          {row.entity_id !== null && (
            <Typography.Text type="secondary" ellipsis={{ tooltip: row.entity_id }}>
              {row.entity_id}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '请求 ID',
      dataIndex: 'request_id',
      width: 190,
      render: (value: string | null) =>
        value === null ? (
          <span className="muted-text">无</span>
        ) : (
          <Typography.Text code copyable={{ text: value }}>
            {value.slice(0, 14)}…
          </Typography.Text>
        ),
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 120,
      render: (value: string | null) => value ?? '无',
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
            setSelected(row);
          }}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <Drawer
      title="审计日志"
      width={1040}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="动作，例如 spot.publish"
          value={actionInput}
          onChange={(event) => setActionInput(event.target.value)}
          onSearch={applyFilters}
          style={{ width: 260 }}
        />
        <Input.Search
          allowClear
          placeholder="实体类型，例如 spot"
          value={entityInput}
          onChange={(event) => setEntityInput(event.target.value)}
          onSearch={applyFilters}
          style={{ width: 220 }}
        />
        <Button type="primary" onClick={applyFilters}>
          查询
        </Button>
        <Button onClick={resetFilters}>重置</Button>
        <Button onClick={() => setReloadKey((value) => value + 1)}>刷新</Button>
      </Space>

      <Table<AuditLogItem>
        rowKey="log_id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ y: 560 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (count) => `共 ${count} 条`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />

      <Modal
        title="审计详情"
        open={selected !== null}
        onCancel={() => setSelected(null)}
        footer={null}
        width={760}
      >
        {selected !== null && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="日志 ID">{selected.log_id}</Descriptions.Item>
              <Descriptions.Item label="管理员">{selected.admin_id}</Descriptions.Item>
              <Descriptions.Item label="动作">{selected.action}</Descriptions.Item>
              <Descriptions.Item label="实体">
                {selected.entity_type}
                {selected.entity_id === null ? '' : ` · ${selected.entity_id}`}
              </Descriptions.Item>
              <Descriptions.Item label="请求 ID">
                {selected.request_id ?? '无'}
              </Descriptions.Item>
              <Descriptions.Item label="IP">{selected.ip ?? '无'}</Descriptions.Item>
              <Descriptions.Item label="User-Agent">
                {selected.user_agent ?? '无'}
              </Descriptions.Item>
              <Descriptions.Item label="时间">
                {new Date(selected.created_at).toLocaleString('zh-CN')}
              </Descriptions.Item>
            </Descriptions>
            <div className="audit-json-block">
              <Typography.Text strong>变更前</Typography.Text>
              <pre className="audit-json">{jsonText(selected.before_json)}</pre>
            </div>
            <div className="audit-json-block">
              <Typography.Text strong>变更后</Typography.Text>
              <pre className="audit-json">{jsonText(selected.after_json)}</pre>
            </div>
          </>
        )}
      </Modal>
    </Drawer>
  );
}
