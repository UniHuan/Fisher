import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export interface IdempotencyExecuteInput<T> {
  adminId: string;
  key: string | undefined;
  scope: string;
  body?: unknown;
  ttlMs?: number;
  operation: () => Promise<T>;
}

export interface IdempotencyExecuteResult<T> {
  data: T;
  replayed: boolean;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(input: IdempotencyExecuteInput<T>): Promise<IdempotencyExecuteResult<T>> {
    if (input.key === undefined) {
      return { data: await input.operation(), replayed: false };
    }
    if (input.key.length === 0 || input.key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Invalid Idempotency-Key',
      );
    }

    const requestHash = createHash('sha256')
      .update(`${input.scope}\n${JSON.stringify(input.body ?? null)}`)
      .digest('hex');
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? IDEMPOTENCY_TTL_MS));
    const filter = { actor_type: 'admin', actor_id: input.adminId, key: input.key };
    const where = { actor_type_actor_id_key: filter };

    let existing = await this.prisma.idempotencyKey.findUnique({ where });
    if (existing !== null && existing.expires_at.getTime() <= Date.now()) {
      await this.prisma.idempotencyKey.deleteMany({ where: filter });
      existing = null;
    }
    if (existing !== null) {
      return this.replay<T>(existing, requestHash);
    }

    let reserved = false;
    for (let attempt = 0; attempt < 2 && !reserved; attempt += 1) {
      try {
        await this.prisma.idempotencyKey.create({
          data: {
            actor_type: 'admin',
            actor_id: input.adminId,
            key: input.key,
            request_hash: requestHash,
            expires_at: expiresAt,
          },
        });
        reserved = true;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        const raced = await this.prisma.idempotencyKey.findUnique({ where });
        if (raced !== null && raced.expires_at.getTime() > Date.now()) {
          return this.replay<T>(raced, requestHash);
        }
        if (raced !== null) {
          await this.prisma.idempotencyKey.deleteMany({ where: filter });
        }
      }
    }
    if (!reserved) {
      throw new AppError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        HttpStatus.CONFLICT,
        'Idempotency key conflict',
      );
    }

    try {
      const data = await input.operation();
      await this.prisma.idempotencyKey.update({
        where,
        data: { response_json: data as Prisma.InputJsonValue },
      });
      return { data, replayed: false };
    } catch (error) {
      await this.prisma.idempotencyKey.deleteMany({ where: filter }).catch(() => undefined);
      throw error;
    }
  }

  private replay<T>(
    row: { request_hash: string; response_json: Prisma.JsonValue | null },
    requestHash: string,
  ): IdempotencyExecuteResult<T> {
    if (row.request_hash !== requestHash) {
      throw new AppError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        HttpStatus.CONFLICT,
        'Idempotency key conflict',
      );
    }
    if (row.response_json === null) {
      throw new AppError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        HttpStatus.CONFLICT,
        'Idempotency request in progress',
      );
    }
    return { data: row.response_json as T, replayed: true };
  }
}
