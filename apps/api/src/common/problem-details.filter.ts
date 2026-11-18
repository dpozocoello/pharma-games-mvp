import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Errores con formato RFC 7807 (application/problem+json). No filtra detalles internos. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let detail: string | undefined;
    let extra: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') detail = body;
      else if (body && typeof body === 'object') {
        const {
          message,
          error: _error,
          statusCode: _statusCode,
          status: _status,
          type: _type,
          title: _title,
          instance: _instance,
          ...rest
        } = body as Record<string, unknown>;
        detail = Array.isArray(message) ? message.join('; ') : (message as string | undefined);
        extra = rest;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: HttpStatus[status] ?? 'Error',
        status,
        ...(detail ? { detail } : {}),
        instance: req.originalUrl.split('?')[0],
        ...extra,
      });
  }
}
