import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { devToolsEnabled, type Env } from './config/env';

/** Configuración HTTP común a main.ts y a las pruebas de integración. */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  // Detrás de un balanceador, la IP real llega en X-Forwarded-For (límites y consentimiento).
  express.set('trust proxy', env.TRUST_PROXY_HOPS);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
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

  // OpenAPI solo fuera de producción (CLAUDE.md §10).
  if (devToolsEnabled(env)) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('API — Plataforma de juegos de capacitación')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
}
