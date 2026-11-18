import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { ENV, type Env } from './config/env';
import { CountriesController } from './countries/countries.controller';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        {
          module: EnvModule,
          providers: [{ provide: ENV, useValue: env }],
          exports: [ENV],
          global: true,
        },
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            // Sin datos personales en logs: se redactan cabeceras sensibles y cuerpos.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.body',
              ],
              remove: true,
            },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url.split('?')[0],
              }),
            },
            autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
            ...(env.NODE_ENV === 'development'
              ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
              : {}),
          },
        }),
        InfraModule,
      ],
      controllers: [HealthController, CountriesController],
      providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
    };
  }
}

@Module({})
class EnvModule {}
