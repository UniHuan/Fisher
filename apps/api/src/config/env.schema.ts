import { splitCsv } from '@szfisher/shared';
import { z } from 'zod';

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}

function isLocalHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      url.origin === value &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

const adminOriginsSchema = z.string().min(1).transform(splitCsv);

const OSS_REQUIRED_FIELDS = [
  'OSS_REGION',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_WORK_BUCKET',
  'OSS_PUBLIC_BUCKET',
  'OSS_PUBLIC_BASE_URL',
] as const;

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['local', 'test', 'staging', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.string().min(1),
  ADMIN_ORIGINS: adminOriginsSchema,
  JWT_ACCESS_SECRET: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z.string().min(32),
  STORAGE_DRIVER: z.enum(['local', 'oss']),
  STORAGE_LOCAL_ROOT: z.string().min(1),
  OSS_REGION: z.string().min(1).optional(),
  OSS_ACCESS_KEY_ID: z.string().min(1).optional(),
  OSS_ACCESS_KEY_SECRET: z.string().min(1).optional(),
  OSS_WORK_BUCKET: z.string().min(1).optional(),
  OSS_PUBLIC_BUCKET: z.string().min(1).optional(),
  OSS_PUBLIC_BASE_URL: z.string().url().optional(),
  // Optional at boot so local/manual POI management works without a Tencent key.
  // Empty is treated as missing by the provider; compose passes it through as "".
  TENCENT_MAP_SERVER_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

export const envSchema = baseEnvSchema.superRefine((value, context) => {
  if (value.ADMIN_ORIGINS.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['ADMIN_ORIGINS'],
      message: 'At least one admin origin is required',
    });
  }
  for (const origin of value.ADMIN_ORIGINS) {
    const allowed =
      isHttpsOrigin(origin) ||
      (value.NODE_ENV === 'local' && isLocalHttpOrigin(origin));
    if (!allowed) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_ORIGINS'],
        message: `Invalid admin origin: ${origin}`,
      });
    }
  }

  if (value.STORAGE_DRIVER !== 'oss') {
    return;
  }
  for (const field of OSS_REQUIRED_FIELDS) {
    if (value[field] === undefined || value[field].length === 0) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required when STORAGE_DRIVER=oss`,
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = Array.from(
      new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)')),
    ).sort();
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
