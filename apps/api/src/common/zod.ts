import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z, type ZodType } from 'zod';

/** Valida el cuerpo con un esquema Zod compartido; responde 400 RFC 7807 con errores por campo. */
export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      message: 'Datos inválidos',
      code: 'VALIDATION_ERROR',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}

/** Esquema OpenAPI a partir de un esquema Zod (documentación en /api/docs). */
export function openApiSchema(schema: ZodType): SchemaObject {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, {
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return json as SchemaObject;
}
