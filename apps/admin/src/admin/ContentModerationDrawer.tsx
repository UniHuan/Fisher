'use client';

import {
  Alert,
  App,
  Badge,
  Button,
  Checkbox,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Image,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  resolveMediaUrl,
  type AdminAbuseHandleAction,
  type AdminAbuseItem,
  type AdminReportAuditItem,
  type AdminReportAuthor,
  type AdminReportHistory,
  type AdminReportHistoryAbuse,
  type AdminReportItem,
  type AdminReportQueue,
  type AdminReportSummary,
  type Session,
} from './api';

interface ContentModerationDrawerProps {
  open: boolean;
  session: Session;
  onClose: () => void;
  onChanged: () => void;
  onExpired: () => void;
}

type ModerationTab = AdminReportQueue | 'abuse';

const PAGE_SIZE = 20;
const ULID_PATTERN = /^[A-Za-z0-9]{26}$/;
const PUBLIC_STATUSES = ['published', 'human_approved'];

const TAB_LABEL: Record<ModerationTab, string> = {
  spot_check: '待抽查',
  pending: '待人工',
  abuse: '被举报',
  rejected: '已驳回',
  removed: '已下架',
};

const CONTENT_TYPE_LABEL: Record<string, string> = {
  comment: '评论',
  catch: '鱼获',
  intel: '情报',
  condition: '现场',
};

const CONDITION_OPEN_LABEL: Record<string, string> = {
  open: '开放',
  paused: '暂停',
  banned: '禁钓',
};

const CONDITION_FEE_LABEL: Record<string, string> = {
  free: '免费',
  paid: '收费',
  member: '需会员',
};

const CONDITION_CROWD_LABEL: Record<string, string> = {
  low: '人少',
  medium: '一般',
  high: '人多',
};

const CONDITION_FACILITY_LABEL: Record<string, string> = {
  toilet: '厕所',
  parking: '停车',
  food: '餐饮',
  water: '补水',
  shade: '遮阴',
  rental: '租赁',
};

const STATUS_LABEL: Record<string, string> = {
  machine_pending: '待人工',
  machine_rejected: '机审驳回',
  published: '已发布',
  human_approved: '人工通过',
  human_rejected: '已驳回',
  removed: '已下架',
};

const STATUS_COLOR: Record<string, string> = {
  machine_pending: 'orange',
  machine_rejected: 'red',
  published: 'green',
  human_approved: 'green',
  human_rejected: 'red',
  removed: 'default',
};

const ABUSE_REASON_LABEL: Record<string, string> = {
  ad: '广告引流',
  abuse: '辱骂攻击',
  false_info: '虚假误导',
  privacy: '隐私侵权',
  other: '其他',
};

const MODERATION_REASONS = ['广告引流', '辱骂攻击', '虚假误导', '隐私侵权', '其他'];

const ACTION_LABEL: Record<string, string> = {
  'report.approve': '通过',
  'report.reject': '驳回',
  'report.remove': '下架',
  'report.adopt': '采纳',
};

const ABUSE_STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  removed: '已下架',
  dismissed: '已驳回',
};

const ABUSE_STATUS_COLOR: Record<string, string> = {
  pending: 'orange',
  removed: 'red',
  dismissed: 'default',
};

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

function authorName(author: AdminReportAuthor): string {
  return author.nickname ?? `用户 ${author.user_id.slice(-6)}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

function ageText(hours: number): string {
  if (hours < 1) {
    return '刚刚';
  }
  if (hours < 24) {
    return `${Math.round(hours)} 小时前`;
  }
  return `${Math.floor(hours / 24)} 天前`;
}

function machineText(result: Record<string, unknown> | null): string {
  if (result === null) {
    return '无';
  }
  const suggest = result.suggest;
  return typeof suggest === 'string' ? suggest : '已记录';
}

function machineColor(result: Record<string, unknown> | null): string {
  const text = machineText(result);
  if (text === 'pass') {
    return 'green';
  }
  if (text === 'risky' || text === 'fail') {
    return 'red';
  }
  if (text === 'review') {
    return 'orange';
  }
  return 'default';
}

function isPublicStatus(status: string): boolean {
  return PUBLIC_STATUSES.includes(status);
}

interface DecisionModalProps {
  mode: 'reject' | 'remove';
  item: AdminReportItem | null;
  session: Session;
  onClose: () => void;
  onDone: () => void;
  onExpired: () => void;
}

function DecisionModal({
  mode,
  item,
  session,
  onClose,
  onDone,
  onExpired,
}: DecisionModalProps) {
  const { message } = App.useApp();
  const [reasonLabel, setReasonLabel] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setReasonLabel(undefined);
    setNote('');
    setReasonError(null);
    setSubmitting(false);
  }, [item?.report_id, mode]);

  const isReject = mode === 'reject';
  const errorCopy = isReject ? '驳回原因必填' : '下架原因必填';

  const submit = async (): Promise<void> => {
    if (item === null) {
      return;
    }
    if (reasonLabel === undefined) {
      setReasonError(errorCopy);
      return;
    }
    const trimmedNote = note.trim();
    const reason = (trimmedNote === '' ? reasonLabel : `${reasonLabel}：${trimmedNote}`).slice(
      0,
      200,
    );
    setSubmitting(true);
    try {
      if (isReject) {
        await api.rejectReport(item.report_id, reason, session.csrf);
      } else {
        await api.removeReport(item.report_id, reason, session.csrf);
      }
      message.success(isReject ? '已驳回' : '已下架');
      onDone();
      onClose();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isReject ? '驳回内容' : '下架内容'}
      open={item !== null}
      onCancel={onClose}
      onOk={() => {
        void submit();
      }}
      okText={isReject ? '驳回' : '下架'}
      cancelText="取消"
      okButtonProps={{ danger: true, loading: submitting }}
      destroyOnHidden
    >
      <div className="moderation-field">
        <label className="moderation-field-label" htmlFor="moderation-decision-reason">
          {isReject ? '驳回原因' : '下架原因'}
        </label>
        <Select
          id="moderation-decision-reason"
          placeholder="请选择原因"
          value={reasonLabel}
          onChange={(value: string) => {
            setReasonLabel(value);
            setReasonError(null);
          }}
          options={MODERATION_REASONS.map((label) => ({ value: label, label }))}
          style={{ width: '100%' }}
        />
        {reasonError !== null && <div className="moderation-field-error">{reasonError}</div>}
      </div>
      <div className="moderation-field">
        <label className="moderation-field-label" htmlFor="moderation-decision-note">
          补充说明
        </label>
        <Input.TextArea
          id="moderation-decision-note"
          rows={3}
          maxLength={200}
          showCount
          placeholder="选填，会记录在审核原因里"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Modal>
  );
}

interface UserActionModalProps {
  mode: 'restrict' | 'ban';
  item: AdminReportItem | null;
  session: Session;
  onClose: () => void;
  onDone: () => void;
  onExpired: () => void;
}

function UserActionModal({
  mode,
  item,
  session,
  onClose,
  onDone,
  onExpired,
}: UserActionModalProps) {
  const { message } = App.useApp();
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDays(3);
    setReason('');
    setReasonError(null);
    setSubmitting(false);
  }, [item?.report_id, mode]);

  const isRestrict = mode === 'restrict';

  const submit = async (): Promise<void> => {
    if (item === null) {
      return;
    }
    const trimmed = reason.trim();
    if (trimmed === '') {
      setReasonError('原因必填');
      return;
    }
    setSubmitting(true);
    try {
      if (isRestrict) {
        await api.restrictUser(item.author.user_id, days, trimmed, session.csrf);
        message.success(`已限制发布 ${days} 天`);
      } else {
        await api.banUser(item.author.user_id, trimmed, session.csrf);
        message.success('已封禁用户');
      }
      onDone();
      onClose();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isRestrict ? '限制发布' : '封禁用户'}
      open={item !== null}
      onCancel={onClose}
      onOk={() => {
        void submit();
      }}
      okText={isRestrict ? '限制发布' : '封禁用户'}
      cancelText="取消"
      okButtonProps={{ danger: !isRestrict, loading: submitting }}
      destroyOnHidden
    >
      {item !== null && (
        <Typography.Paragraph>
          作者：{authorName(item.author)}（{item.author.user_id}）
        </Typography.Paragraph>
      )}
      {!isRestrict && (
        <Alert
          type="warning"
          showIcon
          message="封禁后将下架该用户全部公开内容，并注销其登录状态。"
          className="moderation-modal-alert"
        />
      )}
      {isRestrict && (
        <div className="moderation-field">
          <label className="moderation-field-label" htmlFor="moderation-restrict-days">
            限制天数
          </label>
          <Select
            id="moderation-restrict-days"
            value={days}
            onChange={(value: number) => setDays(value)}
            options={Array.from({ length: 30 }, (_value, index) => ({
              value: index + 1,
              label: `${index + 1} 天`,
            }))}
            style={{ width: '100%' }}
          />
        </div>
      )}
      <div className="moderation-field">
        <label className="moderation-field-label" htmlFor="moderation-user-reason">
          原因
        </label>
        <Input.TextArea
          id="moderation-user-reason"
          rows={3}
          maxLength={200}
          showCount
          placeholder="必填，记录在审计日志"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setReasonError(null);
          }}
        />
        {reasonError !== null && <div className="moderation-field-error">{reasonError}</div>}
      </div>
    </Modal>
  );
}

interface AbuseHandleModalProps {
  abuse: AdminAbuseItem | null;
  session: Session;
  onClose: () => void;
  onDone: () => void;
  onExpired: () => void;
}

function AbuseHandleModal({
  abuse,
  session,
  onClose,
  onDone,
  onExpired,
}: AbuseHandleModalProps) {
  const { message } = App.useApp();
  const [action, setAction] = useState<AdminAbuseHandleAction>('remove');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAction('remove');
    setNote('');
    setSubmitting(false);
  }, [abuse?.abuse_id]);

  const submit = async (): Promise<void> => {
    if (abuse === null) {
      return;
    }
    const trimmed = note.trim();
    setSubmitting(true);
    try {
      await api.handleAbuse(
        abuse.abuse_id,
        action,
        trimmed === '' ? undefined : trimmed,
        session.csrf,
      );
      message.success(action === 'remove' ? '内容已下架' : '举报已驳回');
      onDone();
      onClose();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="举报处理"
      className="moderation-modal"
      open={abuse !== null}
      onCancel={onClose}
      onOk={() => {
        void submit();
      }}
      okText="确认处理"
      cancelText="取消"
      okButtonProps={{ danger: action === 'remove', loading: submitting }}
      destroyOnHidden
    >
      {abuse !== null && (
        <Typography.Paragraph className="moderation-excerpt">
          {abuse.report.spot_name} · {abuse.report.content}
        </Typography.Paragraph>
      )}
      <div className="moderation-field">
        <label className="moderation-field-label" htmlFor="moderation-abuse-action">
          处理方式
        </label>
        <Select
          id="moderation-abuse-action"
          value={action}
          onChange={(value: AdminAbuseHandleAction) => setAction(value)}
          options={[
            { value: 'remove', label: '下架内容' },
            { value: 'dismiss', label: '驳回举报' },
          ]}
          style={{ width: '100%' }}
        />
      </div>
      <div className="moderation-field">
        <label className="moderation-field-label" htmlFor="moderation-abuse-note">
          处理说明
        </label>
        <Input.TextArea
          id="moderation-abuse-note"
          rows={3}
          maxLength={200}
          placeholder="选填，记录在审计日志"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="moderation-count">{note.length} / 200</div>
      </div>
    </Modal>
  );
}

interface ReportDetailDrawerProps {
  item: AdminReportItem | null;
  history: AdminReportHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  onRetryHistory: () => void;
  onClose: () => void;
}

function ReportDetailDrawer({
  item,
  history,
  historyLoading,
  historyError,
  onRetryHistory,
  onClose,
}: ReportDetailDrawerProps) {
  const auditColumns: TableProps<AdminReportAuditItem>['columns'] = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 150,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 88,
      render: (value: string) => <Tag>{ACTION_LABEL[value] ?? value}</Tag>,
    },
    {
      title: '状态变化',
      key: 'status',
      width: 172,
      render: (_value, row) => {
        if (row.status_before === null && row.status_after === null) {
          return <span className="muted-text">无状态变化</span>;
        }
        const before =
          row.status_before === null
            ? '无'
            : STATUS_LABEL[row.status_before] ?? row.status_before;
        const after =
          row.status_after === null
            ? '无'
            : STATUS_LABEL[row.status_after] ?? row.status_after;
        return `${before} → ${after}`;
      },
    },
    {
      title: '原因',
      dataIndex: 'reason',
      render: (value: string | null) => value ?? '无',
    },
    {
      title: '操作人',
      dataIndex: 'admin_id',
      width: 112,
      render: (value: string) => (
        <Typography.Text code ellipsis={{ tooltip: value }}>
          {value.slice(-8)}
        </Typography.Text>
      ),
    },
  ];

  const abuseHistoryColumns: TableProps<AdminReportHistoryAbuse>['columns'] = [
    {
      title: '原因',
      dataIndex: 'reason',
      width: 110,
      render: (value: string) => (
        <Tag color="orange">{ABUSE_REASON_LABEL[value] ?? value}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (
        <Tag color={ABUSE_STATUS_COLOR[value] ?? 'default'}>
          {ABUSE_STATUS_LABEL[value] ?? value}
        </Tag>
      ),
    },
    {
      title: '举报时间',
      dataIndex: 'created_at',
      width: 160,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '处理时间',
      dataIndex: 'handled_at',
      render: (value: string | null) => (value === null ? '未处理' : formatDateTime(value)),
    },
  ];

  return (
    <Drawer
      title="内容详情"
      width={640}
      open={item !== null}
      onClose={onClose}
      destroyOnHidden
    >
      {item !== null && (
        <>
          <Image.PreviewGroup>
            <div className="moderation-images">
              {item.images.map((image) => {
                const src = resolveMediaUrl(image);
                return src === undefined ? null : (
                  <Image key={image} src={src} className="moderation-image" />
                );
              })}
            </div>
          </Image.PreviewGroup>
          <Typography.Title level={5}>正文</Typography.Title>
          <Typography.Paragraph className="moderation-content-text">
            {item.content}
          </Typography.Paragraph>
          {(item.fish_key !== null || item.catch_weight_kg !== null) && (
            <Descriptions column={2} size="small" bordered title="鱼获信息">
              <Descriptions.Item label="鱼种">{item.fish_key ?? '未填'}</Descriptions.Item>
              <Descriptions.Item label="重量">
                {item.catch_weight_kg === null ? '未填' : `${item.catch_weight_kg} kg`}
              </Descriptions.Item>
            </Descriptions>
          )}
          {item.content_type === 'condition' && (
            <Descriptions column={2} size="small" bordered title="现场情况">
              <Descriptions.Item label="开放状态">
                {CONDITION_OPEN_LABEL[item.condition_open_status ?? ''] ?? '未填'}
              </Descriptions.Item>
              <Descriptions.Item label="收费">
                {CONDITION_FEE_LABEL[item.condition_fee_status ?? ''] ?? '未填'}
              </Descriptions.Item>
              <Descriptions.Item label="人流">
                {CONDITION_CROWD_LABEL[item.condition_crowd_level ?? ''] ?? '未填'}
              </Descriptions.Item>
              <Descriptions.Item label="观察时间">
                {item.observed_at === null ? '未填' : formatDateTime(item.observed_at)}
              </Descriptions.Item>
              <Descriptions.Item label="设施">
                {item.condition_facilities
                  .map((key) => CONDITION_FACILITY_LABEL[key] ?? key)
                  .join('、') || '未填'}
              </Descriptions.Item>
              <Descriptions.Item label="正文">
                {item.content === '' ? '仅结构化上报' : item.content}
              </Descriptions.Item>
            </Descriptions>
          )}
          <Descriptions column={1} size="small" bordered title="基础信息">
            <Descriptions.Item label="状态">
              <Tag color={STATUS_COLOR[item.moderation_status] ?? 'default'}>
                {STATUS_LABEL[item.moderation_status] ?? item.moderation_status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="类型">
              {CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}
            </Descriptions.Item>
            <Descriptions.Item label="钓点">{item.spot_name}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {formatDateTime(item.created_at)}
            </Descriptions.Item>
            <Descriptions.Item label="点赞 / 举报">
              {item.like_count} / {item.abuse_count}
            </Descriptions.Item>
            <Descriptions.Item label="采纳">
              {item.adopted_at === null
                ? '未采纳'
                : `${formatDateTime(item.adopted_at)} · ${item.adopted_by ?? '未知'}`}
            </Descriptions.Item>
          </Descriptions>
          <Descriptions column={1} size="small" bordered title="作者">
            <Descriptions.Item label="昵称">{authorName(item.author)}</Descriptions.Item>
            <Descriptions.Item label="用户 ID">{item.author.user_id}</Descriptions.Item>
            <Descriptions.Item label="账号状态">{item.author.status}</Descriptions.Item>
            <Descriptions.Item label="注册时间">
              {formatDateTime(item.author.created_at)}
            </Descriptions.Item>
            <Descriptions.Item label="历史驳回">
              {item.author.rejected_count} 条
            </Descriptions.Item>
            <Descriptions.Item label="限制截止">
              {item.author.restricted_until === null
                ? '无'
                : formatDateTime(item.author.restricted_until)}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5}>机器审核</Typography.Title>
          <pre className="audit-json">
            {item.machine_result === null
              ? '无'
              : JSON.stringify(item.machine_result, null, 2)}
          </pre>
          <Typography.Title level={5}>审核记录</Typography.Title>
          {historyError !== null && (
            <Alert
              type="error"
              showIcon
              message="审核记录加载失败"
              description={historyError}
              action={
                <Button size="small" onClick={onRetryHistory}>
                  重试
                </Button>
              }
              className="moderation-error"
            />
          )}
          <Table<AdminReportAuditItem>
            rowKey="log_id"
            size="small"
            loading={historyLoading}
            columns={auditColumns}
            dataSource={history?.audit ?? []}
            pagination={false}
            scroll={{ x: 620 }}
            locale={{ emptyText: <Empty description="暂无审核记录" /> }}
          />
          <Typography.Title level={5}>举报记录</Typography.Title>
          <Table<AdminReportHistoryAbuse>
            rowKey="abuse_id"
            size="small"
            loading={historyLoading}
            columns={abuseHistoryColumns}
            dataSource={history?.abuses ?? []}
            pagination={false}
            scroll={{ x: 560 }}
            locale={{ emptyText: <Empty description="暂无举报" /> }}
          />
        </>
      )}
    </Drawer>
  );
}

export function ContentModerationDrawer({
  open,
  session,
  onClose,
  onChanged,
  onExpired,
}: ContentModerationDrawerProps) {
  const { message, modal } = App.useApp();
  const [activeTab, setActiveTab] = useState<ModerationTab>('spot_check');
  const [summary, setSummary] = useState<AdminReportSummary | null>(null);
  const [reports, setReports] = useState<AdminReportItem[]>([]);
  const [reportTotal, setReportTotal] = useState(0);
  const [reportCursor, setReportCursor] = useState<string | null>(null);
  const [abuses, setAbuses] = useState<AdminAbuseItem[]>([]);
  const [abuseTotal, setAbuseTotal] = useState(0);
  const [abuseCursor, setAbuseCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string | undefined>();
  const [spotInput, setSpotInput] = useState('');
  const [spotFilter, setSpotFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [detail, setDetail] = useState<AdminReportItem | null>(null);
  const [history, setHistory] = useState<AdminReportHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [decision, setDecision] = useState<{
    mode: 'reject' | 'remove';
    item: AdminReportItem;
  } | null>(null);
  const [userAction, setUserAction] = useState<{
    mode: 'restrict' | 'ban';
    item: AdminReportItem;
  } | null>(null);
  const [abuseAction, setAbuseAction] = useState<AdminAbuseItem | null>(null);

  const writable = session.admin.role !== 'reviewer';
  const keyword = spotFilter.trim();
  const detailReportId = detail?.report_id ?? null;

  useEffect(() => {
    if (!open) {
      setDetail(null);
      setDecision(null);
      setUserAction(null);
      setAbuseAction(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    api
      .reportSummary()
      .then((result) => {
        if (active) {
          setSummary(result);
        }
      })
      .catch((cause: unknown) => {
        if (active && isAuthError(cause)) {
          onExpired();
        }
      });
    return () => {
      active = false;
    };
  }, [open, reloadKey, onExpired]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const spotId = ULID_PATTERN.test(keyword) ? keyword : undefined;
    const spotName =
      keyword !== '' && spotId === undefined ? keyword : undefined;
    const overdue = overdueOnly ? true : undefined;
    const task: Promise<void> =
      activeTab === 'abuse'
        ? api
            .listAbuseReports({
              status: 'pending',
              spot_name: spotName,
              sla_overdue: overdue,
              limit: PAGE_SIZE,
            })
            .then((page) => {
              if (!active) {
                return;
              }
              setAbuses(page.items);
              setAbuseTotal(page.total);
              setAbuseCursor(page.next_cursor);
            })
        : api
            .listAdminReports({
              queue: activeTab,
              content_type: contentType,
              spot_id: spotId,
              spot_name: spotName,
              sla_overdue: overdue,
              limit: PAGE_SIZE,
            })
            .then((page) => {
              if (!active) {
                return;
              }
              setReports(page.items);
              setReportTotal(page.total);
              setReportCursor(page.next_cursor);
            });
    task
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
  }, [open, activeTab, contentType, keyword, overdueOnly, reloadKey, onExpired]);

  useEffect(() => {
    if (detailReportId === null) {
      setHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let active = true;
    // Never show report A's audit/abuse tables under report B while the new
    // history request is still in flight.
    setHistory(null);
    setHistoryLoading(true);
    setHistoryError(null);
    api
      .reportHistory(detailReportId)
      .then((result) => {
        if (active) {
          setHistory(result);
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        if (isAuthError(cause)) {
          onExpired();
          return;
        }
        setHistoryError(errorText(cause));
      })
      .finally(() => {
        if (active) {
          setHistoryLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [detailReportId, historyReloadKey, onExpired]);

  const refresh = (): void => {
    setReloadKey((value) => value + 1);
    onChanged();
  };

  const loadMore = async (): Promise<void> => {
    setLoadingMore(true);
    setError(null);
    const spotId = ULID_PATTERN.test(keyword) ? keyword : undefined;
    const spotName = keyword !== '' && spotId === undefined ? keyword : undefined;
    const overdue = overdueOnly ? true : undefined;
    try {
      if (activeTab === 'abuse') {
        if (abuseCursor !== null) {
          const page = await api.listAbuseReports({
            status: 'pending',
            spot_name: spotName,
            sla_overdue: overdue,
            cursor: abuseCursor,
            limit: PAGE_SIZE,
          });
          setAbuses((previous) => [...previous, ...page.items]);
          setAbuseTotal(page.total);
          setAbuseCursor(page.next_cursor);
        }
      } else if (reportCursor !== null) {
        const page = await api.listAdminReports({
          queue: activeTab,
          content_type: contentType,
          spot_id: spotId,
          spot_name: spotName,
          sla_overdue: overdue,
          cursor: reportCursor,
          limit: PAGE_SIZE,
        });
        setReports((previous) => [...previous, ...page.items]);
        setReportTotal(page.total);
        setReportCursor(page.next_cursor);
      }
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

  const runConfirm = (
    action: () => Promise<unknown>,
    successText: string,
  ): (() => Promise<void>) => {
    return async () => {
      try {
        await action();
        message.success(successText);
        refresh();
      } catch (cause) {
        if (isAuthError(cause)) {
          onExpired();
          return;
        }
        message.error(errorText(cause));
        throw cause;
      }
    };
  };

  const handleApprove = (item: AdminReportItem): void => {
    modal.confirm({
      title: '通过内容',
      content:
        item.moderation_status === 'machine_pending'
          ? '通过后内容标记为人工通过，待审图片会复制到发布存储。确认通过？'
          : '通过后内容标记为人工通过。确认通过？',
      okText: '通过',
      cancelText: '取消',
      onOk: runConfirm(
        () => api.approveReport(item.report_id, session.csrf),
        '已通过',
      ),
    });
  };

  /** Abuse rows carry only a summary; fetch the queue-shaped item for the drawer. */
  const openAbuseDetail = async (item: AdminAbuseItem): Promise<void> => {
    try {
      const report = await api.getReport(item.report_id);
      setDetail(report);
    } catch (cause) {
      if (isAuthError(cause)) {
        onExpired();
        return;
      }
      message.error(errorText(cause));
    }
  };

  const handleAdopt = (item: AdminReportItem): void => {
    modal.confirm({
      title: '采纳情报',
      content: '采纳后公开卡片显示「运营已采纳」，不会自动修改钓点数据。确认采纳？',
      okText: '采纳',
      cancelText: '取消',
      onOk: runConfirm(() => api.adoptReport(item.report_id, session.csrf), '已采纳'),
    });
  };

  const reportColumns: TableProps<AdminReportItem>['columns'] = [
    {
      title: '图片',
      dataIndex: 'images',
      width: 82,
      render: (images: string[]) => {
        const src = resolveMediaUrl(images[0]);
        return src === undefined ? (
          <div className="cover-placeholder">无图</div>
        ) : (
          <Image src={src} width={60} height={44} className="moderation-thumb" />
        );
      },
    },
    {
      title: '内容',
      key: 'content',
      render: (_value, item) => (
        <div className="moderation-row-content">
          <Space size={6} wrap>
            <Typography.Text strong>{authorName(item.author)}</Typography.Text>
            <Tag>{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}</Tag>
            {item.is_adopted && <Tag color="blue">已采纳</Tag>}
          </Space>
          <div className="muted-text">{item.spot_name}</div>
          <Typography.Paragraph className="moderation-excerpt" ellipsis={{ rows: 2 }}>
            {item.content}
          </Typography.Paragraph>
        </div>
      ),
    },
    {
      title: '机器 / 举报',
      key: 'machine',
      width: 128,
      render: (_value, item) => (
        <Space direction="vertical" size={2}>
          <Tag color={machineColor(item.machine_result)}>
            机器 {machineText(item.machine_result)}
          </Tag>
          <span className="muted-text">举报 {item.abuse_count}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'moderation_status',
      width: 96,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>{STATUS_LABEL[value] ?? value}</Tag>
      ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 124,
      render: (_value, item) => (
        <div>
          <div>{ageText(item.age_hours)}</div>
          {item.sla_overdue && <Tag color="red">超时</Tag>}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      render: (_value, item) => {
        const moderatable =
          item.moderation_status === 'published' ||
          item.moderation_status === 'machine_pending';
        const removable = isPublicStatus(item.moderation_status);
        const adoptable =
          item.content_type === 'intel' && removable && !item.is_adopted;
        return (
          <Space size={0} wrap className="moderation-actions">
            <Button
              size="small"
              type="link"
              onClick={() => {
                setDetail(item);
              }}
            >
              详情
            </Button>
            {moderatable && (
              <>
                <Button size="small" type="link" onClick={() => handleApprove(item)}>
                  通过
                </Button>
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setDecision({ mode: 'reject', item });
                  }}
                >
                  驳回
                </Button>
              </>
            )}
            {removable && (
              <Button
                size="small"
                type="link"
                danger
                onClick={() => {
                  setDecision({ mode: 'remove', item });
                }}
              >
                下架
              </Button>
            )}
            {adoptable && (
              <Button size="small" type="link" onClick={() => handleAdopt(item)}>
                采纳
              </Button>
            )}
            {writable && (
              <>
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setUserAction({ mode: 'restrict', item });
                  }}
                >
                  限制发布
                </Button>
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => {
                    setUserAction({ mode: 'ban', item });
                  }}
                >
                  封禁用户
                </Button>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  const abuseColumns: TableProps<AdminAbuseItem>['columns'] = [
    {
      title: '图片',
      key: 'images',
      width: 82,
      render: (_value, item) => {
        const src = resolveMediaUrl(item.report.images[0]);
        return src === undefined ? (
          <div className="cover-placeholder">无图</div>
        ) : (
          <Image src={src} width={60} height={44} className="moderation-thumb" />
        );
      },
    },
    {
      title: '内容',
      key: 'content',
      render: (_value, item) => (
        <div className="moderation-row-content">
          <Space size={6} wrap>
            <Tag>{CONTENT_TYPE_LABEL[item.report.content_type] ?? item.report.content_type}</Tag>
            <Typography.Text type="secondary">{item.report.spot_name}</Typography.Text>
            <Tag color={STATUS_COLOR[item.report.moderation_status] ?? 'default'}>
              {STATUS_LABEL[item.report.moderation_status] ?? item.report.moderation_status}
            </Tag>
          </Space>
          <Typography.Paragraph className="moderation-excerpt" ellipsis={{ rows: 2 }}>
            {item.report.content}
          </Typography.Paragraph>
        </div>
      ),
    },
    {
      title: '举报原因',
      dataIndex: 'reason',
      width: 116,
      render: (value: string) => (
        <Tag color="orange">{ABUSE_REASON_LABEL[value] ?? value}</Tag>
      ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 124,
      render: (_value, item) => (
        <div>
          <div>{ageText(item.age_hours)}</div>
          {item.sla_overdue && <Tag color="red">超时</Tag>}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_value, item) => (
        <Space size={0} wrap className="moderation-actions">
          <Button
            size="small"
            type="link"
            onClick={() => {
              void openAbuseDetail(item);
            }}
          >
            详情
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              setAbuseAction(item);
            }}
          >
            举报处理
          </Button>
        </Space>
      ),
    },
  ];

  const tabItems = (Object.keys(TAB_LABEL) as ModerationTab[]).map((key) => {
    const count =
      summary === null
        ? 0
        : key === 'abuse'
          ? summary.abuse_pending
          : summary[key];
    return {
      key,
      label: (
        <span className="moderation-tab-label">
          {TAB_LABEL[key]}
          {count > 0 && <Badge count={count} size="small" />}
        </span>
      ),
    };
  });

  const currentTotal = activeTab === 'abuse' ? abuseTotal : reportTotal;
  const nextCursor = activeTab === 'abuse' ? abuseCursor : reportCursor;

  return (
    <Drawer
      title="内容审核"
      width={960}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Tabs
        activeKey={activeTab}
        items={tabItems}
        onChange={(key) => {
          setActiveTab(key as ModerationTab);
        }}
      />
      {summary !== null && summary.sla_overdue > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${summary.sla_overdue} 条内容超过 24 小时未处理`}
          className="moderation-sla-alert"
        />
      )}
      <Row gutter={[12, 12]} align="middle" className="moderation-filter-row">
        {activeTab !== 'abuse' && (
          <Col xs={24} md={5}>
            <Select
              allowClear
              placeholder="全部类型"
              value={contentType}
              onChange={(value: string | undefined) => {
                setContentType(value);
              }}
              options={[
                { value: 'comment', label: '评论' },
                { value: 'catch', label: '鱼获' },
                { value: 'intel', label: '情报' },
                { value: 'condition', label: '现场' },
              ]}
              style={{ width: '100%' }}
            />
          </Col>
        )}
        <Col xs={24} md={10}>
          <Input.Search
            allowClear
            placeholder="钓点名称或 ID"
            value={spotInput}
            onChange={(event) => {
              setSpotInput(event.target.value);
              if (event.target.value === '') {
                setSpotFilter('');
              }
            }}
            onSearch={(value) => setSpotFilter(value)}
          />
        </Col>
        <Col xs={24} md={5}>
          <Checkbox
            checked={overdueOnly}
            onChange={(event) => setOverdueOnly(event.target.checked)}
          >
            仅看超时
          </Checkbox>
        </Col>
        <Col xs={24} md={4}>
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
          className="moderation-error"
        />
      )}
      {activeTab === 'abuse' ? (
        <Table<AdminAbuseItem>
          rowKey="abuse_id"
          size="small"
          loading={loading}
          columns={abuseColumns}
          dataSource={abuses}
          scroll={{ x: 760 }}
          pagination={false}
          locale={{
            emptyText: <Empty description="暂无待处理举报" />,
          }}
        />
      ) : (
        <Table<AdminReportItem>
          rowKey="report_id"
          size="small"
          loading={loading}
          columns={reportColumns}
          dataSource={reports}
          scroll={{ x: 940 }}
          pagination={false}
          locale={{
            emptyText: <Empty description="这个队列暂时没有内容" />,
          }}
        />
      )}
      <div className="moderation-list-footer">
        <span className="muted-text">共 {currentTotal} 条</span>
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

      <ReportDetailDrawer
        item={detail}
        history={history}
        historyLoading={historyLoading}
        historyError={historyError}
        onRetryHistory={() => setHistoryReloadKey((value) => value + 1)}
        onClose={() => {
          setDetail(null);
        }}
      />
      <DecisionModal
        mode={decision?.mode ?? 'reject'}
        item={decision?.item ?? null}
        session={session}
        onClose={() => {
          setDecision(null);
        }}
        onDone={refresh}
        onExpired={onExpired}
      />
      <UserActionModal
        mode={userAction?.mode ?? 'restrict'}
        item={userAction?.item ?? null}
        session={session}
        onClose={() => {
          setUserAction(null);
        }}
        onDone={refresh}
        onExpired={onExpired}
      />
      <AbuseHandleModal
        abuse={abuseAction}
        session={session}
        onClose={() => {
          setAbuseAction(null);
        }}
        onDone={refresh}
        onExpired={onExpired}
      />
    </Drawer>
  );
}
