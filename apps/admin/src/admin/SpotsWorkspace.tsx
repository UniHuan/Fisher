'use client';

import {
  App,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Image,
  Input,
  Layout,
  Row,
  Select,
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
  resolveMediaUrl,
  type AdminReportSummary,
  type AdminSpotListItem,
  type AdminSpotPage,
  type PublicDictionaries,
  type Session,
} from './api';
import { AuditLogDrawer } from './AuditLogDrawer';
import { ContentModerationDrawer } from './ContentModerationDrawer';
import { DictionaryDrawer } from './DictionaryDrawer';
import { FeedbackDrawer } from './FeedbackDrawer';
import { ImportDrawer } from './ImportDrawer';
import { PoiDrawer } from './PoiDrawer';
import { SpotEditor } from './SpotEditor';

interface SpotsWorkspaceProps {
  session: Session;
  onLogout: () => void;
  onExpired: () => void;
}

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

const OPEN_LABEL: Record<string, string> = {
  open: '开放',
  paused: '暂停',
  banned: '禁钓',
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员',
  operator: '运营',
  reviewer: '审核员',
};

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40101 || error.code === 40102);
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

export function SpotsWorkspace({ session, onLogout, onExpired }: SpotsWorkspaceProps) {
  const { message, modal } = App.useApp();
  const [dictionaries, setDictionaries] = useState<PublicDictionaries | null>(null);
  const [rows, setRows] = useState<AdminSpotListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [districtFilter, setDistrictFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSpotId, setEditorSpotId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [poiSpot, setPoiSpot] = useState<{ spot_id: string; spot_name: string } | null>(null);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [dictionaryReloadKey, setDictionaryReloadKey] = useState(0);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [moderationSummary, setModerationSummary] = useState<AdminReportSummary | null>(null);
  const [moderationReloadKey, setModerationReloadKey] = useState(0);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackOpenCount, setFeedbackOpenCount] = useState(0);
  const [feedbackReloadKey, setFeedbackReloadKey] = useState(0);

  const writable = session.admin.role !== 'reviewer';

  useEffect(() => {
    let active = true;
    api
      .reportSummary()
      .then((result) => {
        if (active) {
          setModerationSummary(result);
        }
      })
      .catch((error: unknown) => {
        if (active && isAuthError(error)) {
          onExpired();
        }
      });
    return () => {
      active = false;
    };
  }, [moderationReloadKey, onExpired]);

  useEffect(() => {
    let active = true;
    api
      .me()
      .then((result) => {
        if (active) {
          setPermissions(result.permissions);
        }
      })
      .catch((error: unknown) => {
        if (active && isAuthError(error)) {
          onExpired();
        }
      });
    return () => {
      active = false;
    };
  }, [onExpired]);

  useEffect(() => {
    if (permissions === null || !permissions.includes('feedback:read')) {
      return;
    }
    let active = true;
    api
      .listFeedback({ status: 'open', limit: 1 })
      .then((page) => {
        if (active) {
          setFeedbackOpenCount(page.total);
        }
      })
      .catch((error: unknown) => {
        if (active && isAuthError(error)) {
          onExpired();
        }
      });
    return () => {
      active = false;
    };
  }, [permissions, feedbackReloadKey, onExpired]);

  useEffect(() => {
    api
      .dictionaries()
      .then(setDictionaries)
      .catch((error: unknown) => message.error(errorText(error)));
  }, [message, dictionaryReloadKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .listSpots({
        status: statusFilter,
        district: districtFilter,
        keyword: keyword.trim() === '' ? undefined : keyword.trim(),
        page,
        page_size: pageSize,
      })
      .then((result: AdminSpotPage) => {
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
  }, [statusFilter, districtFilter, keyword, page, pageSize, reloadKey, message, onExpired]);

  const refresh = (): void => {
    setReloadKey((value) => value + 1);
  };

  const openEditor = (spotId: string | null): void => {
    setEditorSpotId(spotId);
    setEditorOpen(true);
  };

  const runAction = async (
    action: () => Promise<unknown>,
    successText: string,
  ): Promise<void> => {
    try {
      await action();
      message.success(successText);
      refresh();
    } catch (error) {
      if (isAuthError(error)) {
        onExpired();
        return;
      }
      message.error(errorText(error));
    }
  };

  const handlePublish = (row: AdminSpotListItem): void => {
    modal.confirm({
      title: '发布钓点',
      content: `发布后「${row.spot_name}」将对小程序可见。确认发布？`,
      okText: '发布',
      cancelText: '取消',
      onOk: () => runAction(() => api.publishSpot(row.spot_id, session.csrf), '钓点已发布'),
    });
  };

  const handleOffline = (row: AdminSpotListItem): void => {
    modal.confirm({
      title: '下线钓点',
      content: `下线后「${row.spot_name}」将从小程序隐藏，历史数据保留。`,
      okText: '下线',
      cancelText: '取消',
      onOk: () => runAction(() => api.offlineSpot(row.spot_id, session.csrf), '钓点已下线'),
    });
  };

  const handleVerify = (row: AdminSpotListItem): void => {
    modal.confirm({
      title: '标记已核实',
      content: `确认最近核实过「${row.spot_name}」？`,
      okText: '确认核实',
      cancelText: '取消',
      onOk: () => runAction(() => api.verifySpot(row.spot_id, session.csrf), '已标记核实'),
    });
  };

  const columns: TableProps<AdminSpotListItem>['columns'] = [
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
      title: '钓点',
      dataIndex: 'spot_name',
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.district ?? '区域未填'}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 92,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>{STATUS_LABEL[value] ?? value}</Tag>
      ),
    },
    {
      title: '开放',
      dataIndex: 'open_status',
      width: 82,
      render: (value: string | null) => OPEN_LABEL[value ?? ''] ?? '未填',
    },
    {
      title: '核实',
      dataIndex: 'verified_at',
      width: 120,
      render: (value: string | null) =>
        value === null ? <span className="muted-text">未核实</span> : new Date(value).toLocaleDateString('zh-CN'),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 150,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: writable ? 306 : 130,
      render: (_value, row) => (
        <Space size={4} wrap>
          <Button
            size="small"
            onClick={() => {
              openEditor(row.spot_id);
            }}
          >
            查看
          </Button>
          <Button
            size="small"
            onClick={() => {
              setPoiSpot({ spot_id: row.spot_id, spot_name: row.spot_name });
            }}
          >
            周边
          </Button>
          {writable && (
            <>
              <Button
                size="small"
                type="link"
                onClick={() => {
                  openEditor(row.spot_id);
                }}
              >
                编辑
              </Button>
              {row.status !== 'published' && (
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    handlePublish(row);
                  }}
                >
                  发布
                </Button>
              )}
              {row.status === 'published' && (
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    handleOffline(row);
                  }}
                >
                  下线
                </Button>
              )}
              <Button
                size="small"
                type="link"
                onClick={() => {
                  handleVerify(row);
                }}
              >
                核实
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const moderationPending =
    moderationSummary === null
      ? 0
      : moderationSummary.spot_check +
        moderationSummary.pending +
        moderationSummary.abuse_pending;

  return (
    <Layout className="app-shell">
      <Layout.Header className="app-header">
        <Space size={14}>
          <div className="brand-mark small">SZ</div>
          <div>
            <Typography.Text strong className="header-title">
              钓点运营台
            </Typography.Text>
            <div className="header-subtitle">深圳钓鱼助手</div>
          </div>
        </Space>
        <Space size={12}>
          <Badge count={moderationPending} size="small" className="moderation-badge">
            <Button size="small" onClick={() => setModerationOpen(true)}>
              内容审核
            </Button>
          </Badge>
          {permissions?.includes('feedback:read') === true && (
            <Badge count={feedbackOpenCount} size="small" className="feedback-badge">
              <Button size="small" onClick={() => setFeedbackOpen(true)}>
                体验反馈
              </Button>
            </Badge>
          )}
          {session.admin.role === 'super_admin' && (
            <Button size="small" onClick={() => setDictionaryOpen(true)}>
              字典
            </Button>
          )}
          {session.admin.role !== 'reviewer' && (
            <Button size="small" onClick={() => setAuditOpen(true)}>
              审计
            </Button>
          )}
          <Tag>{ROLE_LABEL[session.admin.role] ?? session.admin.role}</Tag>
          <Typography.Text className="header-user">{session.admin.username}</Typography.Text>
          <Button size="small" onClick={onLogout}>
            退出
          </Button>
        </Space>
      </Layout.Header>

      <Layout.Content className="app-content">
        <div className="page-heading">
          <div>
            <Typography.Title level={2}>钓点库</Typography.Title>
            <Typography.Paragraph className="muted-text">
              先保存草稿，再补图片与核实信息。发布前会统一校验必填字段。
            </Typography.Paragraph>
          </div>
          {writable && (
            <Space>
              <Button size="large" onClick={() => setImportOpen(true)}>
                Excel 导入
              </Button>
              <Button type="primary" size="large" onClick={() => openEditor(null)}>
                新增钓点
              </Button>
            </Space>
          )}
        </div>

        <Card className="filter-card">
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} md={5}>
              <Select
                allowClear
                placeholder="全部状态"
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value);
                  setPage(1);
                }}
                options={[
                  { value: 'draft', label: '草稿' },
                  { value: 'published', label: '已发布' },
                  { value: 'offline', label: '已下线' },
                ]}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} md={5}>
              <Select
                allowClear
                showSearch
                placeholder="全部区域"
                value={districtFilter}
                onChange={(value) => {
                  setDistrictFilter(value);
                  setPage(1);
                }}
                options={(dictionaries?.districts ?? []).map((item) => ({
                  value: item.key,
                  label: item.label,
                }))}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} md={10}>
              <Input.Search
                allowClear
                placeholder="按钓点名称搜索"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onSearch={() => {
                  setPage(1);
                  refresh();
                }}
              />
            </Col>
            <Col xs={24} md={4}>
              <Button block onClick={refresh}>
                刷新
              </Button>
            </Col>
          </Row>
        </Card>

        <Card className="table-card">
          <Table<AdminSpotListItem>
            rowKey="spot_id"
            columns={columns}
            dataSource={rows}
            loading={loading}
            locale={{
              emptyText: <Empty description="还没有钓点，先新增一个草稿" />,
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (count) => `共 ${count} 个钓点`,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize);
              },
            }}
          />
        </Card>
      </Layout.Content>

      <SpotEditor
        open={editorOpen}
        spotId={editorSpotId}
        session={session}
        dictionaries={dictionaries}
        onClose={() => {
          setEditorOpen(false);
        }}
        onSaved={() => {
          refresh();
        }}
        onExpired={onExpired}
      />
      <ImportDrawer
        open={importOpen}
        session={session}
        onClose={() => {
          setImportOpen(false);
        }}
        onImported={refresh}
      />
      <PoiDrawer
        open={poiSpot !== null}
        spotId={poiSpot?.spot_id ?? null}
        spotName={poiSpot?.spot_name ?? ''}
        session={session}
        dictionaries={dictionaries}
        onClose={() => {
          setPoiSpot(null);
        }}
        onExpired={onExpired}
      />
      {session.admin.role === 'super_admin' && (
        <DictionaryDrawer
          open={dictionaryOpen}
          session={session}
          onClose={() => {
            setDictionaryOpen(false);
          }}
          onChanged={() => setDictionaryReloadKey((value) => value + 1)}
          onExpired={onExpired}
        />
      )}
      {session.admin.role !== 'reviewer' && (
        <AuditLogDrawer
          open={auditOpen}
          onClose={() => {
            setAuditOpen(false);
          }}
          onExpired={onExpired}
        />
      )}
      <ContentModerationDrawer
        open={moderationOpen}
        session={session}
        onClose={() => {
          setModerationOpen(false);
          setModerationReloadKey((value) => value + 1);
        }}
        onChanged={() => setModerationReloadKey((value) => value + 1)}
        onExpired={onExpired}
      />
      <FeedbackDrawer
        open={feedbackOpen}
        session={session}
        onClose={() => {
          setFeedbackOpen(false);
        }}
        onChanged={() => setFeedbackReloadKey((value) => value + 1)}
        onExpired={onExpired}
      />
    </Layout>
  );
}
