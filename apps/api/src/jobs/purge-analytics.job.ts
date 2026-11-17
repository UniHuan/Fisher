import { NestFactory } from '@nestjs/core';
import { JsonLogger } from '../common/logging/json-logger';
import { AppModule } from '../app.module';
import { AnalyticsService } from '../modules/analytics/analytics.service';

/**
 * Deletes analytics detail older than the PRD retention window (180 days).
 * Run from a daily cron/systemd timer; aggregate reports must be stored elsewhere.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    logger: new JsonLogger(),
  });
  try {
    const retentionDays = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 180);
    const deleted = await app
      .get(AnalyticsService)
      .purgeExpired(Number.isInteger(retentionDays) ? retentionDays : 180);
    process.stdout.write(
      `${JSON.stringify({ event: 'analytics_purge', deleted, retention_days: retentionDays })}\n`,
    );
  } finally {
    await app.close();
  }
}

void main();
