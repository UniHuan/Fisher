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

const adminOriginsSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    const origins = splitCsv(value);
    if (origins.length === 0) {
      context.addIssue({ code: 'custom', message: 'At least one HTTPS origin is required' });
      return;
    }
    for (const origin of origins) {
      if (!isHttpsOrigin(origin)) {
        context.addIssue({ code: 'custom', message: `Invalid HTTPS origin: ${origin}` });
      }
    }
  })
  .transform(splitCsv);

export const envSchema = z.object({
  NODE_ENV: z.enum(['local', 'test', 'staging', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.string().min(1),
  ADMIN_ORIGINS: adminOriginsSchema,
  JWT_ACCESS_SECRET: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z.string().min(32),
  STORAGE_DRIVER: z.enum(['local', 'oss']),
  STORAGE_LOCAL_ROOT: z.string().min(1),
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
