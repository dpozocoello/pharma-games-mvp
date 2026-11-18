import { describe, expect, it } from 'vitest';
import {
  sanitizeUsagePayload,
  submitKnowledgeTestRequestSchema,
  usageEventInputSchema,
} from './measurement';

describe('Medición y sanitización de eventos (sin PII)', () => {
  it('elimina cualquier campo de datos personales en payload de UsageEvent', () => {
    const clean = sanitizeUsagePayload({
      screen: 'games-catalog',
      phoneE164: '+51900010001',
      document: '10001001',
      displayName: 'Juan Pérez',
      nested: {
        ip: '190.12.34.56',
        brandSlug: 'alivex',
      },
    });
    expect(clean).toEqual({
      screen: 'games-catalog',
      nested: {
        brandSlug: 'alivex',
      },
    });
  });

  it('valida esquemas de envío de test inicial y eventos de uso', () => {
    const parsedEvent = usageEventInputSchema.parse({
      type: 'pwa.screen_view',
      payload: { tab: 'play' },
    });
    expect(parsedEvent.type).toBe('pwa.screen_view');

    const parsedTest = submitKnowledgeTestRequestSchema.parse({
      answers: [
        {
          questionId: '01950000-0000-7000-8000-000000000001',
          answer: 'a',
        },
      ],
    });
    expect(parsedTest.answers).toHaveLength(1);
  });
});
