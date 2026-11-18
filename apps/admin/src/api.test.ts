import { describe, expect, it } from 'vitest';
import { AdminApiError } from './api';

describe('@pharma/admin API client', () => {
  it('wraps RFC 7807 problem details with status and field errors', () => {
    const err = new AdminApiError({
      status: 400,
      detail: 'Datos inválidos',
      code: 'VALIDATION_ERROR',
      errors: [{ path: 'rankingPeriodMonths', message: 'Debe ser 1, 2 o 3' }],
    });
    expect(err.message).toBe('Datos inválidos');
    expect(err.problem.status).toBe(400);
    expect(err.problem.errors).toHaveLength(1);
  });
});
