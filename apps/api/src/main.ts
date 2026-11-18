import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule.register(env), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, env);
  await app.listen(env.API_PORT);
}

void main();
