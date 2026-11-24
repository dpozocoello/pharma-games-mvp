import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { AdminAnomaliesService } from './admin/admin-anomalies.service';
import { AdminContentService } from './admin/admin-content.service';
import { AdminCountriesController } from './admin/admin-countries.controller';
import { AdminCountriesService } from './admin/admin-countries.service';
import { AdminManagementController } from './admin/admin-management.controller';
import { AdminUsersPharmaciesService } from './admin/admin-users-pharmacies.service';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard, ConsentGuard, RolesGuard } from './auth/guards';
import { OtpQueue } from './auth/messaging/otp-queue';
import {
  ConsoleProvider,
  FALLBACK_PROVIDER,
  HttpSmsProvider,
  OtpDeliveryService,
  PRIMARY_PROVIDER,
  WhatsAppCloudProvider,
} from './auth/messaging/providers';
import { OtpService } from './auth/otp.service';
import { TokenService } from './auth/token.service';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { RateLimitGuard, RateLimitService } from './common/rate-limit';
import { devToolsEnabled, ENV, type Env } from './config/env';
import { CountriesController } from './countries/countries.controller';
import { CountryConfigService } from './countries/country-config.service';
import { DevOutboxController } from './dev/dev-outbox.controller';
import { GamesController } from './games/games.controller';
import { GamesService } from './games/games.service';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';
import { ConsentService } from './me/consent.service';
import { MeController } from './me/me.controller';
import { MeService } from './me/me.service';
import { MeasurementController } from './measurement/measurement.controller';
import { ArcadePilotService } from './measurement/arcade-pilot.service';
import { MeasurementService } from './measurement/measurement.service';
import { RankingsController } from './rankings/rankings.controller';
import { DailySnapshotScheduler } from './rankings/daily-snapshot.scheduler';
import { RankingJobsWorker } from './rankings/daily-snapshot.worker';
import { LiveRankingStore } from './rankings/live-ranking.store';
import { RankingsService } from './rankings/rankings.service';

function messagingProviders(env: Env): Provider[] {
  const whatsapp = env.MESSAGING_PROVIDER === 'whatsapp';
  return [
    ConsoleProvider,
    WhatsAppCloudProvider,
    HttpSmsProvider,
    {
      provide: PRIMARY_PROVIDER,
      useExisting: whatsapp ? WhatsAppCloudProvider : ConsoleProvider,
    },
    whatsapp
      ? { provide: FALLBACK_PROVIDER, useExisting: HttpSmsProvider }
      : { provide: FALLBACK_PROVIDER, useValue: null },
    OtpDeliveryService,
    OtpQueue,
  ];
}

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    const devOutbox = devToolsEnabled(env) && env.MESSAGING_PROVIDER === 'console';
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
        JwtModule.register({}),
        InfraModule,
      ],
      controllers: [
        HealthController,
        CountriesController,
        AuthController,
        MeController,
        GamesController,
        RankingsController,
        MeasurementController,
        AdminCountriesController,
        AdminManagementController,
        ...(devOutbox ? [DevOutboxController] : []),
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        // Orden: autenticación → límite de solicitudes → rol/audiencia → consentimiento.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
        RateLimitService,
        AuditService,
        CountryConfigService,
        TokenService,
        OtpService,
        AuthService,
        ConsentService,
        MeService,
        GamesService,
        LiveRankingStore,
        RankingsService,
        DailySnapshotScheduler,
        RankingJobsWorker,
        MeasurementService,
        ArcadePilotService,
        AdminCountriesService,
        AdminUsersPharmaciesService,
        AdminContentService,
        AdminAnomaliesService,
        ...messagingProviders(env),
      ],
    };
  }
}

@Module({})
class EnvModule {}
