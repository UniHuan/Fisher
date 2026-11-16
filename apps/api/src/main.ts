import { ConfigService } from '@nestjs/config';
import { createApp } from './app.factory';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  app.get(PrismaService).enableShutdownHooks(app);
  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
}

void bootstrap();
