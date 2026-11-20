'use client';

import {
  Alert,
  App,
  Button,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Image,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  resolveMediaUrl,
  type AdminFeedbackDetail,
  type AdminFeedbackItem,
  type FeedbackCategory,
  type FeedbackStatus,
  type Session,
} from './api';

interface FeedbackDrawerProps {
  open: boolean;
  session: Session;
  onClose: () => void;
  onChanged: () => void;
  onExpired: () => void;
}

const PAGE_SIZE = 20;
const NOTE_MAX = 500;

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: '问题',
  suggestion: '建议',
  content: '内容',
  photo: '钓点实拍',
  other: '其他',
};

const CATEGORY_COLOR: Record<FeedbackCategory, string> = {
  bug: 'red',
  suggestion: 'blue',
  content: 'orange',
  photo: 'green',
  other: 'default',
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '待处理',
  reviewing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  open: 'orange',
  reviewing: 'blue',
  resolved: 'green',
  closed: 'default',
};

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as FeedbackCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABEL[value],
}));

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

const ACTION_STATUSES: FeedbackStatus[] = ['reviewing', 'resolved', 'closed'];

const DEVICE_FIELDS: Array<[string, string]> = [
  ['model', '机型'],
  ['system', '系统'],
  ['wechat_version', '微信版本'],
  ['sdk_version', 'SDK 版本'],
];

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

function categoryTag(category: FeedbackCategory) {
  return (
    <Tag color={CATEGORY_COLOR[category] ?? 'default'}>
      {CATEGORY_LABEL[category] ?? category}
    </Tag>
  );
}

function statusTag(status: FeedbackStatus) {
  return (
    <Tag color={STATUS_COLOR[status] ?? 'default'}>{STATUS_LABEL[status] ?? status}</Tag>
  );
}

interface FeedbackDetailDrawerProps {
  feedbackId: string | null;
  session: Session;
  onClose: () => void;
  onUpdated: () => void;
  onExpired: () => void;
}

function FeedbackDetailDrawer({
  feedbackId,
  session,
  onClose,
  onUpdated,
  onExpired,
}: FeedbackDetailDrawerProps) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<AdminFeedbackDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus>('open');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState<FeedbackStatus | null>(null);

  useEffect(() => {
    if (feedbackId === null) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getFeedback(feedbackId)
      .then((result) => {
        if (!active) {
          return;
        }
        setDetail(result);
        setDraftStatus(result.status);
        setDraftNote(result.note ?? '');
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
  }, [feedbackId, reloadKey, onExpired]);

  const reload = (): void => {
    setReloadKey((value) => value + 1);
  };

  /** Mirror a successful PATCH locally so the handler and time stay visible. */
  const markUpdated = (next: { status: FeedbackStatus; note?: string }): void => {
    setDetail((previous) =>
      previous === null
        ? previous
        : {
            ...previous,
            status: next.status,
            ...(next.note === undefined ? {} : { note: next.note }),
            handler_id: session.admin.admin_id,
            handled_at: new Date().toISOString(),
          },
    );
  };

  const applyStatus = async (status: FeedbackStatus): Promise<void> => {
    if (detail === null) {
      return;
    }
    setStatusSaving(status);
    try {
      const result = await api.updateFeedback(detail.feedback_id, { status }, session.csrf);
      markUpdated({ status: result.status });
      setDraftStatus(result.status);
      message.success(`已标记为${STATUS_LABEL[status]}`);
      onUpdated();
    } catch (cause) {
      if (isAuthError(cause)) {
        onExpired();
        return;
      }
      message.error(errorText(cause));
    } finally {
      setStatusSaving(null);
    }
  };

  const save = async (): Promise<void> => {
    if (detail === null) {
      return;
    }
    const note = draftNote.trim();
    setSaving(true);
    try {
      const result = await api.updateFeedback(
        detail.feedback_id,
        { status: draftStatus, note },
        session.csrf,
      );
      markUpdated({ status: result.status, note });
      setDraftStatus(result.status);
      message.success('已保存');
      onUpdated();
    } catch (cause) {
      if (isAuthError(cause)) {
        onExpired();
        return;
      }
      message.error(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const deviceInfo = detail?.device_info ?? null;
  const deviceEntries = DEVICE_FIELDS.flatMap(([key, label]) => {
    const value = deviceInfo?.[key];
    return typeof value === 'string' && value !== '' ? [{ key, label, value }] : [];
  });

  return (
    <Drawer
      title="反馈详情"
      width={640}
      open={feedbackId !== null}
      onClose={onClose}
      destroyOnHidden
    >
      {error !== null && (
        <Alert
          type="error"
          showIcon
          message="详情加载失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重试
            </Button>
          }
          className="feedback-error"
        />
      )}
      {detail === null && loading && (
        <div className="feedback-detail-loading">
          <Spin />
        </div>
      )}
      {detail !== null && (
        <>
          {detail.images.length > 0 && (
            <Image.PreviewGroup>
              <div className="feedback-images">
                {detail.images.map((url) => {
                  const src = resolveMediaUrl(url);
                  return src === undefined ? null : (
                    <Image key={url} src={src} className="feedback-image" />
                  );
                })}
              </div>
            </Image.PreviewGroup>
          )}
          <Typography.Title level={5}>反馈内容</Typography.Title>
          <Typography.Paragraph className="feedback-content-text">
            {detail.content}
          </Typography.Paragraph>
          <Descriptions column={1} size="small" bordered title="反馈信息">
            <Descriptions.Item label="分类">
              {categoryTag(detail.category)}
            </Descriptions.Item>
            <Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item>
            <Descriptions.Item label="提交人">
              {detail.user_nickname ?? '未设置昵称'}
            </Descriptions.Item>
            <Descriptions.Item label="钓点">{detail.spot_name ?? '未关联'}</Descriptions.Item>
            <Descriptions.Item label="提交时间">
              {formatDateTime(detail.created_at)}
            </Descriptions.Item>
            {detail.contact !== null && (
              <Descriptions.Item label="联系方式">{detail.contact}</Descriptions.Item>
            )}
            <Descriptions.Item label="页面">{detail.page ?? '未记录'}</Descriptions.Item>
            <Descriptions.Item label="客户端版本">
              {detail.app_version ?? '未记录'}
            </Descriptions.Item>
            {deviceEntries.length === 0 ? (
              <Descriptions.Item label="设备信息">未记录</Descriptions.Item>
            ) : (
              deviceEntries.map((entry) => (
                <Descriptions.Item key={entry.key} label={entry.label}>
                  {entry.value}
                </Descriptions.Item>
              ))
            )}
            <Descriptions.Item label="处理人">
              {detail.handler_id === null ? (
                '未处理'
              ) : (
                <Typography.Text code>{detail.handler_id}</Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="处理时间">
              {detail.handled_at === null ? '未处理' : formatDateTime(detail.handled_at)}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5}>处理</Typography.Title>
          <Space wrap className="feedback-actions">
            {ACTION_STATUSES.map((status) => (
              <Button
                key={status}
                loading={statusSaving === status}
                disabled={detail.status === status}
                onClick={() => {
                  void applyStatus(status);
                }}
              >
                {STATUS_LABEL[status]}
              </Button>
            ))}
          </Space>
          <div className="feedback-field">
            <label className="feedback-field-label" htmlFor="feedback-status">
              状态
            </label>
            <Select
              id="feedback-status"
              value={draftStatus}
              onChange={(value: FeedbackStatus) => setDraftStatus(value)}
              options={STATUS_OPTIONS}
              style={{ width: '100%' }}
            />
          </div>
          <div className="feedback-field">
            <label className="feedback-field-label" htmlFor="feedback-note">
              处理备注
            </label>
            <Input.TextArea
              id="feedback-note"
              rows={4}
              maxLength={NOTE_MAX}
              showCount
              placeholder="选填，仅后台可见"
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
            />
          </div>
          <div className="feedback-detail-footer">
            <Button
              type="primary"
              loading={saving}
              onClick={() => {
                void save();
              }}
            >
              保存
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}

export function FeedbackDrawer({
  open,
  session,
  onClose,
  onChanged,
  onExpired,
}: FeedbackDrawerProps) {
  const { message } = App.useApp();
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory | undefined>();
  const [rows, setRows] = useState<AdminFeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDetailId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .listFeedback({
        status: statusFilter,
        category: categoryFilter,
        limit: PAGE_SIZE,
      })
      .then((page) => {
        if (!active) {
          return;
        }
        setRows(page.items);
        setTotal(page.total);
        setNextCursor(page.next_cursor);
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
  }, [open, statusFilter, categoryFilter, reloadKey, onExpired]);

  const refresh = (): void => {
    setReloadKey((value) => value + 1);
    onChanged();
  };

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.listFeedback({
        status: statusFilter,
        category: categoryFilter,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setRows((previous) => [...previous, ...page.items]);
      setTotal(page.total);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      if (isAuthError(cause)) {
        onExpired();
        return;
      }
      message.error(errorText(cause));
    } finally {
      setLoadingMore(false);
    }
  };

  const columns: TableProps<AdminFeedbackItem>['columns'] = [
    {
      title: '分类',
      dataIndex: 'category',
      width: 96,
      render: (value: FeedbackCategory) => categoryTag(value),
    },
    {
      title: '反馈内容',
      key: 'content',
      render: (_value, item) => (
        <div className="feedback-row-content">
          <Space size={6} wrap>
            <Typography.Text strong>{item.user_nickname ?? '未设置昵称'}</Typography.Text>
            <Typography.Text type="secondary">
              {item.spot_name ?? '未关联钓点'}
            </Typography.Text>
          </Space>
          <Typography.Paragraph className="feedback-excerpt" ellipsis={{ rows: 2 }}>
            {item.content}
          </Typography.Paragraph>
        </div>
      ),
    },
    {
      title: '图片',
      dataIndex: 'image_count',
      width: 82,
      render: (value: number) =>
        value === 0 ? <span className="muted-text">无图</span> : `${value} 张`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 92,
      render: (value: FeedbackStatus) => statusTag(value),
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      width: 168,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 72,
      render: (_value, item) => (
        <Button
          size="small"
          type="link"
          onClick={() => {
            setDetailId(item.feedback_id);
          }}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <Drawer title="反馈队列" width={960} open={open} onClose={onClose} destroyOnHidden>
      <Row gutter={[12, 12]} align="middle" className="feedback-filter-row">
        <Col xs={24} md={7}>
          <Select
            allowClear
            placeholder="全部状态"
            value={statusFilter}
            onChange={(value: FeedbackStatus | undefined) => setStatusFilter(value)}
            options={STATUS_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} md={7}>
          <Select
            allowClear
            placeholder="全部类型"
            value={categoryFilter}
            onChange={(value: FeedbackCategory | undefined) => setCategoryFilter(value)}
            options={CATEGORY_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} md={6}>
          <Button block onClick={refresh}>
            刷新
          </Button>
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
      <Table<AdminFeedbackItem>
        rowKey="feedback_id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 840 }}
        pagination={false}
        locale={{ emptyText: <Empty description="暂无反馈" /> }}
      />
      <div className="feedback-list-footer">
        <span className="muted-text">共 {total} 条</span>
        {nextCursor !== null && (
          <Button
            loading={loadingMore}
            onClick={() => {
              void loadMore();
            }}
          >
            加载更多
          </Button>
        )}
      </div>
      <FeedbackDetailDrawer
        feedbackId={detailId}
        session={session}
        onClose={() => {
          setDetailId(null);
        }}
        onUpdated={refresh}
        onExpired={onExpired}
      />
    </Drawer>
  );
}
