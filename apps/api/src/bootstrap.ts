import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import helmet from 'helmet';
import type { Env } from './config/env';

/** Configuración HTTP común a main.ts y a las pruebas de integración. */
export function configureApp(app: INestApplication, env: Env): void {
  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
}
