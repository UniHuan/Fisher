'use client';

import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type ImportJob, type Session } from './api';

interface ImportDrawerProps {
  open: boolean;
  session: Session;
  onClose: () => void;
  onImported: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  processing: '处理中',
  completed: '已完成',
  failed: '处理失败',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  processing: 'blue',
  completed: 'green',
  failed: 'red',
};

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportDrawer({
  open,
  session,
  onClose,
  onImported,
}: ImportDrawerProps) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (
      job === null ||
      (job.status !== 'pending' && job.status !== 'processing')
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      api
        .getImportJob(job.job_id)
        .then((next) => {
          setJob(next);
          if (next.status === 'completed') {
            onImported();
          }
        })
        .catch((pollError: unknown) => {
          setError(
            pollError instanceof ApiError ? pollError.message : '导入任务查询失败',
          );
        });
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [job, onImported]);

  const downloadTemplate = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await api.downloadImportTemplate();
      saveBlob(blob, 'spot-import-template.xlsx');
    } catch (downloadError) {
      message.error(
        downloadError instanceof ApiError ? downloadError.message : '模板下载失败',
      );
    } finally {
      setDownloading(false);
    }
  };

  const downloadErrors = async (): Promise<void> => {
    if (job === null) {
      return;
    }
    setDownloading(true);
    try {
      const blob = await api.downloadImportErrors(job.job_id);
      saveBlob(blob, `import-${job.job_id}-issues.csv`);
    } catch (downloadError) {
      message.error(
        downloadError instanceof ApiError ? downloadError.message : '报告下载失败',
      );
    } finally {
      setDownloading(false);
    }
  };

  const upload = async (): Promise<void> => {
    if (file === null) {
      message.info('请先选择 Excel 文件');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const created = await api.importSpots(file, session.csrf);
      setJob(created);
      if (created.status === 'completed') {
        onImported();
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof ApiError ? uploadError.message : '导入上传失败',
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Drawer
      open={open}
      width={600}
      title="Excel 批量导入"
      onClose={onClose}
      footer={
        <div className="editor-footer">
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            onClick={() => {
              void upload();
            }}
            loading={uploading}
            disabled={file === null}
          >
            开始导入
          </Button>
        </div>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="导入只创建草稿，不会直接发布"
          description="先下载模板按列填写。单次最多 200 行，文件不超过 20 MB。有效行创建为草稿，非法行进入错误报告；重复钓点只告警，不阻断导入。"
        />

        <Space wrap>
          <Button onClick={() => void downloadTemplate()} loading={downloading}>
            下载 Excel 模板
          </Button>
          <Button
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            选择文件
          </Button>
          <Typography.Text type="secondary">
            {file === null ? '尚未选择文件' : file.name}
          </Typography.Text>
        </Space>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setJob(null);
            setError('');
            event.target.value = '';
          }}
        />

        {error !== '' && <Alert type="error" showIcon message={error} />}

        {job !== null && (
          <Card size="small" title="导入任务">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color={STATUS_COLOR[job.status] ?? 'default'}>
                  {STATUS_LABEL[job.status] ?? job.status}
                </Tag>
                <Typography.Text copyable className="job-id">
                  {job.job_id}
                </Typography.Text>
              </Space>
              {(job.status === 'pending' || job.status === 'processing') && (
                <Space>
                  <Spin size="small" />
                  <Typography.Text type="secondary">
                    正在逐行校验并创建草稿，请稍候…
                  </Typography.Text>
                </Space>
              )}
              <div className="import-stats">
                <div>
                  <span className="import-stat-value">{job.total_rows}</span>
                  <span className="muted-text">总行数</span>
                </div>
                <div>
                  <span className="import-stat-value">{job.success_rows}</span>
                  <span className="muted-text">成功</span>
                </div>
                <div>
                  <span className="import-stat-value">{job.failed_rows}</span>
                  <span className="muted-text">失败</span>
                </div>
              </div>
              {job.status === 'completed' && job.failed_rows === 0 && (
                <Alert
                  type="success"
                  showIcon
                  message="全部行已处理，成功行已创建为草稿"
                />
              )}
              {job.status === 'completed' && job.failed_rows > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message={`有 ${job.failed_rows} 行未导入，请下载错误报告修正后重新上传`}
                />
              )}
              {job.status === 'failed' && (
                <Alert
                  type="error"
                  showIcon
                  message="导入任务失败，请下载报告检查文件格式"
                />
              )}
              {job.has_error_report && (
                <Space direction="vertical" size={6}>
                  <Button
                    onClick={() => void downloadErrors()}
                    loading={downloading}
                  >
                    下载错误与重复告警报告
                  </Button>
                  <Typography.Text type="secondary">
                    报告同时包含非法行和重复钓点告警。
                  </Typography.Text>
                </Space>
              )}
            </Space>
          </Card>
        )}
      </Space>
    </Drawer>
  );
}
