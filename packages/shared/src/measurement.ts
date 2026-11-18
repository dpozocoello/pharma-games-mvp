import { z } from 'zod';
import { publicQuestionSchema } from './schemas';

export const TEST_KINDS = ['INITIAL', 'FINAL'] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const pendingKnowledgeTestSchema = z.object({
  id: z.string().uuid(),
  brandId: z.string().uuid(),
  brandName: z.string(),
  brandSlug: z.string(),
  countryId: z.string().uuid(),
  kind: z.enum(TEST_KINDS),
  questions: z.array(publicQuestionSchema).min(1),
});
export type PendingKnowledgeTest = z.infer<typeof pendingKnowledgeTestSchema>;

export const submitKnowledgeTestRequestSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        answer: z.string().trim().min(1).max(64),
      }),
    )
    .min(1)
    .max(30),
});
export type SubmitKnowledgeTestRequest = z.infer<typeof submitKnowledgeTestRequestSchema>;

export const submitKnowledgeTestResponseSchema = z.object({
  resultId: z.string().uuid(),
  testId: z.string().uuid(),
  brandId: z.string().uuid(),
  score: z.number().int().min(0),
  total: z.number().int().min(1),
  completedAt: z.string(),
});
export type SubmitKnowledgeTestResponse = z.infer<typeof submitKnowledgeTestResponseSchema>;

export const FORBIDDEN_PII_KEYS = new Set([
  'phone',
  'phonee164',
  'document',
  'documenthash',
  'dni',
  'cedula',
  'email',
  'ip',
  'displayname',
  'fullname',
  'name',
]);

/**
 * Elimina recursivamente cualquier clave que pudiera contener datos personales
 * antes de persistir `UsageEvent.payload` (cumplimiento Ley 1581, LOPDP, Ley 29733).
 */
export function sanitizeUsagePayload(
  payload: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (FORBIDDEN_PII_KEYS.has(key.toLowerCase())) continue;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      clean[key] = sanitizeUsagePayload(val as Record<string, unknown>);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export const usageEventInputSchema = z.object({
  type: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_.-]+$/i, 'Tipo de evento inválido'),
  brandId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type UsageEventInput = z.infer<typeof usageEventInputSchema>;
