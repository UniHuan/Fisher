import { createApp } from './app.factory';
import { parseEnv } from './config/env.schema';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const app = await createApp();
  app.get(PrismaService).enableShutdownHooks(app);
  await app.listen(env.PORT);
}

void bootstrap();
