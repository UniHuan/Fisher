import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ImportJob } from '@prisma/client';
import { ERROR_CODES } from '@szfisher/shared';
import ExcelJS from 'exceljs';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { StorageService } from '../storage/storage.service';
import {
  IMPORT_COLUMNS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
} from './import.constants';
import {
  dataRowNumbers,
  loadImportWorkbook,
  validateImportHeaders,
} from './import-excel';
import { ImportWorker } from './import-worker.service';
import type { ImportJobDto, ImportJobStatus } from './dto/import-job.dto';

export interface UploadedImportFile {
  buffer?: Buffer;
  size?: number;
  originalname?: string;
  mimetype?: string;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditLogs: AuditLogService,
    private readonly worker: ImportWorker,
  ) {}

  async getTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '优丽环钓鱼助手';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('钓点导入');
    sheet.columns = IMPORT_COLUMNS.map((column) => ({
      header: column.label,
      key: column.key,
      width: column.width,
    }));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F6B5C' },
    };
    header.alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const instructions = workbook.addWorksheet('填写说明');
    instructions.columns = [
      { header: '列名', key: 'label', width: 18 },
      { header: '是否必填', key: 'required', width: 10 },
      { header: '说明', key: 'note', width: 40 },
      { header: '示例', key: 'example', width: 30 },
    ];
    for (const column of IMPORT_COLUMNS) {
      instructions.addRow({
        label: column.label,
        required: column.required ? '是' : '否',
        note: column.note,
        example: column.example,
      });
    }
    instructions.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async upload(
    file: UploadedImportFile | undefined,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<ImportJobDto> {
    if (file === undefined || file.buffer === undefined) {
      throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, 'Import file is required');
    }
    if ((file.size ?? file.buffer.length) > MAX_IMPORT_FILE_BYTES) {
      throw new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'Import file exceeds 20 MB',
      );
    }

    let parsed: Awaited<ReturnType<typeof loadImportWorkbook>>;
    try {
      parsed = await loadImportWorkbook(file.buffer);
      validateImportHeaders(parsed.headerIndex);
    } catch (error) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Excel 校验失败',
        [{ field: 'file', message: error instanceof Error ? error.message : '无法解析 Excel' }],
      );
    }
    const rowNumbers = dataRowNumbers(parsed.worksheet, parsed.headerIndex);
    if (rowNumbers.length === 0) {
      throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, 'Excel 没有数据行');
    }
    if (rowNumbers.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        `单次最多导入 ${MAX_IMPORT_ROWS} 行`,
      );
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.importJob.findUnique({
      where: {
        admin_id_file_hash: { admin_id: admin.adminId, file_hash: fileHash },
      },
    });
    if (existing !== null) {
      return this.toDto(existing);
    }

    const fileKey = `imports/${admin.adminId}/${ulid()}.xlsx`;
    try {
      await this.storage.putObject(
        fileKey,
        file.buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Import storage unavailable',
      );
    }

    let job: ImportJob;
    try {
      job = await this.prisma.importJob.create({
        data: {
          job_id: ulid(),
          admin_id: admin.adminId,
          file_key: fileKey,
          file_hash: fileHash,
          status: 'pending',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.importJob.findUnique({
          where: {
            admin_id_file_hash: { admin_id: admin.adminId, file_hash: fileHash },
          },
        });
        if (raced !== null) {
          return this.toDto(raced);
        }
      }
      throw error;
    }

    await this.auditLogs.record({
      adminId: admin.adminId,
      action: 'spot.import',
      entityType: 'import_job',
      entityId: job.job_id,
      before: null,
      after: {
        job_id: job.job_id,
        status: job.status,
        total_rows: rowNumbers.length,
      },
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent:
        typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
    });

    void this.worker.process(job.job_id).catch(() => undefined);
    return this.toDto(job);
  }

  async getJob(jobId: string, admin: AdminContext): Promise<ImportJobDto> {
    const job = await this.findOwnedJob(jobId, admin);
    return this.toDto(job);
  }

  async getErrors(
    jobId: string,
    admin: AdminContext,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const job = await this.findOwnedJob(jobId, admin);
    if (job.error_file_key === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Error report not found');
    }
    try {
      const buffer = await this.storage.readObject(job.error_file_key, 'working');
      return {
        buffer,
        filename: `import-${job.job_id}-issues.csv`,
      };
    } catch {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Error report not found');
    }
  }

  private async findOwnedJob(jobId: string, admin: AdminContext): Promise<ImportJob> {
    const job = await this.prisma.importJob.findUnique({ where: { job_id: jobId } });
    if (
      job === null ||
      (admin.role !== 'super_admin' && job.admin_id !== admin.adminId)
    ) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Import job not found');
    }
    return job;
  }

  private toDto(job: ImportJob): ImportJobDto {
    return {
      job_id: job.job_id,
      status: job.status as ImportJobStatus,
      total_rows: job.total_rows,
      success_rows: job.success_rows,
      failed_rows: job.failed_rows,
      has_error_report: job.error_file_key !== null,
      error_report_url:
        job.error_file_key === null
          ? null
          : `/api/v1/admin/imports/${job.job_id}/errors`,
      created_at: job.created_at.toISOString(),
      finished_at: job.finished_at?.toISOString() ?? null,
    };
  }
}
