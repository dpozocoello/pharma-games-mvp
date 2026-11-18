import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error de negocio con código estable para el cliente (`code`) y texto para la persona (`detail`).
 * El filtro RFC 7807 copia `code` y los campos extra al cuerpo.
 */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super({ message, code, ...extra }, status);
  }
}
