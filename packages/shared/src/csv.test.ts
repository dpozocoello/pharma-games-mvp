import { describe, expect, it } from 'vitest';
import { hasCsvFormulaInjection, parseCsv, questionCsvRowSchema, userCsvRowSchema } from './csv';

describe('parseCsv & CSV validation schemas (Iteration 2)', () => {
  it('parses UTF-8 CSV with quotes, escaped quotes and CRLF', () => {
    const raw =
      '\uFEFFcountryCode,pharmacyCode,pharmacyName,city,phone,document,displayName,role\r\n' +
      'PE,PE-FAR-001,"Botica ""Central"", Lima",Lima,+51900111222,PETEST000101,María Quispe,CLERK\r\n';
    const parsed = parseCsv(raw);
    expect(parsed.headers).toEqual([
      'countryCode',
      'pharmacyCode',
      'pharmacyName',
      'city',
      'phone',
      'document',
      'displayName',
      'role',
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rowNumber).toBe(2);
    expect(parsed.rows[0]?.values.pharmacyName).toBe('Botica "Central", Lima');

    const valid = userCsvRowSchema.parse(parsed.rows[0]?.values);
    expect(valid.role).toBe('CLERK');
  });

  it('rejects formula injection characters in CSV fields', () => {
    expect(hasCsvFormulaInjection('=cmd|"/c calc"!A0')).toBe(true);
    expect(hasCsvFormulaInjection('+SUM(A1:A2)')).toBe(true);
    expect(hasCsvFormulaInjection('Botica Norte')).toBe(false);

    const res = userCsvRowSchema.safeParse({
      countryCode: 'PE',
      pharmacyCode: 'PE-FAR-001',
      pharmacyName: 'Botica Norte',
      city: 'Lima',
      phone: '+51900111222',
      document: 'DOC12345',
      displayName: '=1+1',
      role: 'CLERK',
    });
    expect(res.success).toBe(false);
  });

  it('validates question CSV rows with optional countryCode', () => {
    const sharedQuestion = questionCsvRowSchema.parse({
      brandSlug: 'marca-a',
      countryCode: '',
      type: 'MULTIPLE_CHOICE',
      prompt: '¿Cuál es el color principal del empaque de Marca A?',
      options: 'a:Azul|b:Verde|c:Rojo|d:Amarillo',
      correctAnswer: 'a',
      locale: 'es',
    });
    expect(sharedQuestion.countryCode).toBeUndefined();
  });
});
