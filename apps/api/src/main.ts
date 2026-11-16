import { createApp } from './app.factory';
import { parseEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const app = await createApp();
  await app.listen(env.PORT);
}

void bootstrap();
