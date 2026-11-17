import type { LoggerService } from '@nestjs/common';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return raw === 'debug' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

function messageText(message: unknown): string {
  if (message instanceof Error) {
    return message.message;
  }
  if (typeof message === 'string') {
    return message;
  }
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}

function contextFrom(params: unknown[]): string | undefined {
  for (let index = params.length - 1; index >= 0; index -= 1) {
    const value = params[index];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * One JSON object per line. Cloud log collectors can index request_id, level and
 * context without a regex parser; stdout stays the only log sink in containers.
 */
export class JsonLogger implements LoggerService {
  // Read lazily: ConfigModule populates .env after NestFactory constructs the logger.
  private get threshold(): number {
    return LEVEL_ORDER[configuredLevel()];
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    if (LEVEL_ORDER[level] < this.threshold) {
      return;
    }
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message: messageText(message),
    };
    const context = contextFrom(params);
    if (context !== undefined) {
      entry.context = context;
    }
    const error =
      message instanceof Error ? message : params.find((param) => param instanceof Error);
    if (error instanceof Error && error.stack !== undefined) {
      entry.stack = error.stack;
    }
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}
