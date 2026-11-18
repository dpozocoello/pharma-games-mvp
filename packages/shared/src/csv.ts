import { z } from 'zod';
import { QUESTION_STATUSES, QUESTION_TYPES, USER_STATUSES } from './constants';
import { brandThemeSchema, countryCodeSchema } from './schemas';

// ───────────────────────────── Parser CSV (RFC 4180) ─────────────────────────────

export interface ParsedCsvRow {
  /** Número de fila en el archivo (1 = cabecera, >= 2 = datos). */
  rowNumber: number;
  values: Record<string, string>;
}

export interface ParsedCsv {
  headers: string[];
  rows: ParsedCsvRow[];
}

/**
 * Analiza un texto CSV en UTF-8 (soporta BOM, saltos CRLF/LF y campos entrecomillados con `""`).
 * Ligero y determinista, sin dependencias externas.
 */
export function parseCsv(input: string): ParsedCsv {
  const clean = input.replace(/^\uFEFF/, '');
  const rawRows: string[][] = [];
  let currentRow: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(field.trim());
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      currentRow.push(field.trim());
      field = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rawRows.push(currentRow);
      }
      currentRow = [];
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || currentRow.length > 0) {
    currentRow.push(field.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rawRows.push(currentRow);
    }
  }

  if (rawRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rawRows[0]!.map((h) => h.trim());
  const rows: ParsedCsvRow[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const cells = rawRows[r]!;
    const values: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]!;
      if (key) {
        values[key] = cells[c]?.trim() ?? '';
      }
    }
    rows.push({ rowNumber: r + 1, values });
  }

  return { headers, rows };
}

/** Previene inyección de fórmulas en hojas de cálculo (`=`, `+`, `-`, `@` al inicio de un texto). */
export function hasCsvFormulaInjection(value: string): boolean {
  return /^[=+\-@]/.test(value.trim());
}

/** Escapa una celda CSV para exportación segura (neutraliza fórmulas y escapa comas/comillas). */
export function sanitizeCsvCell(value: string): string {
  const safe = hasCsvFormulaInjection(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

// ───────────────────────────── Esquemas de Filas CSV ─────────────────────────────

export const USER_CSV_HEADERS = [
  'countryCode',
  'pharmacyCode',
  'pharmacyName',
  'city',
  'phone',
  'document',
  'displayName',
  'role',
] as const;

export const userCsvRowSchema = z
  .object({
    countryCode: countryCodeSchema,
    pharmacyCode: z.string().trim().min(2, 'pharmacyCode mínimo 2 caracteres').max(40),
    pharmacyName: z
      .string()
      .trim()
      .min(2, 'pharmacyName mínimo 2 caracteres')
      .max(120)
      .refine(
        (v) => !hasCsvFormulaInjection(v),
        'pharmacyName contiene caracteres de fórmula no permitidos',
      ),
    city: z
      .string()
      .trim()
      .min(2, 'city mínimo 2 caracteres')
      .max(80)
      .refine(
        (v) => !hasCsvFormulaInjection(v),
        'city contiene caracteres de fórmula no permitidos',
      ),
    phone: z.string().trim().min(6, 'phone inválido').max(24),
    document: z.string().trim().min(3, 'document mínimo 3 caracteres').max(32),
    displayName: z
      .string()
      .trim()
      .min(2, 'displayName mínimo 2 caracteres')
      .max(120)
      .refine(
        (v) => !hasCsvFormulaInjection(v),
        'displayName contiene caracteres de fórmula no permitidos',
      ),
    role: z.enum(['CLERK', 'PHARMACY_MANAGER']),
  })
  .strict();

export type UserCsvRow = z.infer<typeof userCsvRowSchema>;

export const QUESTION_CSV_HEADERS = [
  'brandSlug',
  'countryCode',
  'type',
  'prompt',
  'options',
  'correctAnswer',
  'locale',
] as const;

export const questionCsvRowSchema = z
  .object({
    brandSlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]+$/, 'brandSlug inválido (usa minúsculas y guiones, ej. marca-a)'),
    /** Vacío = pregunta compartida por los países de la marca; con valor = exclusiva de ese país. */
    countryCode: z
      .string()
      .trim()
      .transform((v) => (v === '' ? undefined : v))
      .pipe(countryCodeSchema.optional()),
    type: z.enum(QUESTION_TYPES),
    prompt: z
      .string()
      .trim()
      .min(5, 'prompt mínimo 5 caracteres')
      .max(500)
      .refine(
        (v) => !hasCsvFormulaInjection(v),
        'prompt contiene caracteres de fórmula no permitidos',
      ),
    /** Formato `id:texto|id:texto` (ej. `a:Opción 1|b:Opción 2|c:Opción 3` o `TRUE:Verdadero|FALSE:Falso`). */
    options: z.string().trim().min(3, 'options es obligatorio'),
    correctAnswer: z.string().trim().min(1, 'correctAnswer es obligatorio').max(8),
    locale: z.string().trim().min(2).max(10).default('es'),
  })
  .strict();

export type QuestionCsvRow = z.infer<typeof questionCsvRowSchema>;

export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportJobView {
  id: string;
  countryCode: string;
  kind: 'USERS' | 'QUESTIONS';
  fileName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalRows: number;
  validRows: number;
  errors: ImportRowError[];
  createdAt: string;
  finishedAt: string | null;
}

export const csvImportBodySchema = z
  .object({
    countryCode: countryCodeSchema,
    fileName: z.string().trim().min(1).max(120).default('import.csv'),
    csv: z.string().min(1, 'El archivo CSV está vacío').max(10_000_000),
  })
  .strict();
export type CsvImportBody = z.infer<typeof csvImportBodySchema>;

// ───────────────────────────── Farmacias y Usuarios (Admin API) ─────────────────────────────

export const pharmacyCreateSchema = z
  .object({
    countryCode: countryCodeSchema,
    externalCode: z.string().trim().min(2).max(40),
    name: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(80),
    chainName: z.string().trim().min(2).max(80).optional(),
  })
  .strict();
export type PharmacyCreate = z.infer<typeof pharmacyCreateSchema>;

export const pharmacyPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().min(2).max(80).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Sin cambios');
export type PharmacyPatch = z.infer<typeof pharmacyPatchSchema>;

export const userTransferSchema = z
  .object({
    pharmacyId: z.string().uuid('pharmacyId inválido'),
  })
  .strict();
export type UserTransfer = z.infer<typeof userTransferSchema>;

export const userStatusPatchSchema = z
  .object({
    status: z.enum(USER_STATUSES),
  })
  .strict();
export type UserStatusPatch = z.infer<typeof userStatusPatchSchema>;

// ───────────────────────────── Marcas y Preguntas (Admin API) ─────────────────────────────

export const brandCreateSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9-]+$/, 'Usa minúsculas, números y guiones'),
    name: z.string().trim().min(2).max(80),
    theme: brandThemeSchema,
    countryCodes: z.array(countryCodeSchema).min(1, 'Asigna al menos un país'),
  })
  .strict();
export type BrandCreate = z.infer<typeof brandCreateSchema>;

export const questionStatusPatchSchema = z
  .object({
    status: z.enum(QUESTION_STATUSES),
  })
  .strict();
export type QuestionStatusPatch = z.infer<typeof questionStatusPatchSchema>;
