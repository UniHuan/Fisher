import { NestFactory } from '@nestjs/core';
import { JsonLogger } from '../common/logging/json-logger';
import { AppModule } from '../app.module';
import { PoisService } from '../modules/pois/pois.service';

/**
 * Daily POI sync. Run from cron/systemd after the API image is built:
 *   node dist/jobs/sync-pois.job.js
 * The service caches successful runs for 24 hours and writes PoiSyncRun rows.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    logger: new JsonLogger(),
  });
  try {
    const result = await app.get(PoisService).syncDueSpots();
    process.stdout.write(`${JSON.stringify({ event: 'poi_sync_daily', ...result })}\n`);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
