/**
 * Datos de semilla 100 % ficticios (CLAUDE.md §4.7). Funciones puras y deterministas para poder
 * probarlas sin base de datos. Ninguna pregunta contiene afirmaciones médicas: todas tratan
 * atributos inventados de marcas inventadas (empaque, mascota, eslogan, campañas…).
 */
import type { CountryCode, QuestionInput } from '@pharma/shared';

/** PRNG determinista (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedBrand {
  slug: string;
  name: string;
  countries: CountryCode[];
  theme: { primary: string; secondary: string; logoUrl: string };
}

/**
 * Distribución real del cliente con nombres ficticios:
 * 2 en los tres países (A, B), 1 en EC y PE (C), 3 solo en CO (D, E, F),
 * 2 solo en EC (G, H), 1 solo en PE (I). → CO 5, EC 5, PE 4 = 14 combinaciones.
 */
const BRAND_COUNTRIES: Record<string, CountryCode[]> = {
  A: ['CO', 'EC', 'PE'],
  B: ['CO', 'EC', 'PE'],
  C: ['EC', 'PE'],
  D: ['CO'],
  E: ['CO'],
  F: ['CO'],
  G: ['EC'],
  H: ['EC'],
  I: ['PE'],
};

const PALETTE: [string, string][] = [
  ['#1D4ED8', '#DBEAFE'],
  ['#047857', '#D1FAE5'],
  ['#B91C1C', '#FEE2E2'],
  ['#7C3AED', '#EDE9FE'],
  ['#C2410C', '#FFEDD5'],
  ['#0E7490', '#CFFAFE'],
  ['#A21CAF', '#FAE8FF'],
  ['#4D7C0F', '#ECFCCB'],
  ['#334155', '#E2E8F0'],
];

export const SEED_BRANDS: SeedBrand[] = Object.entries(BRAND_COUNTRIES).map(
  ([letter, countries], i) => ({
    slug: `marca-${letter.toLowerCase()}`,
    name: `Marca ${letter}`,
    countries,
    theme: {
      primary: PALETTE[i]![0],
      secondary: PALETTE[i]![1],
      logoUrl: `/brands/marca-${letter.toLowerCase()}.svg`,
    },
  }),
);

/** Atributos inventados por marca, con un banco de distractores por atributo. */
const ATTRIBUTES: { key: string; label: string; pool: string[] }[] = [
  {
    key: 'color',
    label: 'el color principal del empaque',
    pool: ['azul', 'verde', 'naranja', 'morado', 'rojo', 'turquesa', 'gris', 'amarillo', 'fucsia'],
  },
  {
    key: 'mascot',
    label: 'la mascota de la campaña',
    pool: [
      'un búho',
      'un delfín',
      'un zorro',
      'una tortuga',
      'un colibrí',
      'un oso',
      'una abeja',
      'un gato',
      'un pingüino',
    ],
  },
  {
    key: 'slogan',
    label: 'el eslogan',
    pool: [
      '"Siempre contigo"',
      '"Tu aliado diario"',
      '"Bienestar en casa"',
      '"Paso a paso"',
      '"Listo para el día"',
      '"Confianza que se nota"',
      '"Más cerca de ti"',
      '"Hecho para tu ritmo"',
      '"Cuidado sencillo"',
    ],
  },
  {
    key: 'year',
    label: 'el año de lanzamiento ficticio',
    pool: ['1998', '2003', '2007', '2010', '2012', '2015', '2018', '2020', '2022'],
  },
  {
    key: 'presentations',
    label: 'el número de presentaciones en el catálogo',
    pool: ['2', '3', '4', '5', '6', '7', '8', '9', '10'],
  },
  {
    key: 'shape',
    label: 'la forma del logotipo',
    pool: [
      'un círculo',
      'un hexágono',
      'una hoja',
      'una estrella',
      'un rombo',
      'una gota',
      'un escudo',
      'una nube',
      'un triángulo',
    ],
  },
  {
    key: 'campaign',
    label: 'la campaña de temporada',
    pool: [
      '"Verano Activo"',
      '"Invierno Tranquilo"',
      '"Vuelta al Cole"',
      '"Familia Feliz"',
      '"Mes del Cuidado"',
      '"Ruta Saludable"',
      '"Semana Clave"',
      '"Plan Diario"',
      '"Equipo Total"',
    ],
  },
  {
    key: 'display',
    label: 'la ubicación sugerida en el mostrador',
    pool: [
      'junto a la caja',
      'en la vitrina central',
      'en la góndola de entrada',
      'en el exhibidor lateral',
      'a la altura de los ojos',
      'en la isla promocional',
      'en el estante superior',
      'en el punto de pago',
      'en la zona de temporada',
    ],
  },
  {
    key: 'line',
    label: 'el nombre de la línea extendida',
    pool: ['Plus', 'Max', 'Kids', 'Noche', 'Express', 'Duo', 'Fresh', 'Pro', 'Zen'],
  },
  {
    key: 'pack',
    label: 'el material del empaque',
    pool: [
      'cartón reciclado',
      'blíster transparente',
      'frasco ámbar',
      'sobre metalizado',
      'caja mate',
      'tubo plástico',
      'lata compacta',
      'bolsa resellable',
      'estuche rígido',
    ],
  },
];

const MC_PHRASES = [
  (brand: string, label: string) => `¿Cuál es ${label} de ${brand}?`,
  (brand: string, label: string) =>
    `En el material de capacitación, ¿qué corresponde a ${label} de ${brand}?`,
  (brand: string, label: string) =>
    `Un cliente pregunta por ${label} de ${brand}. ¿Qué le respondes?`,
];
const TF_PHRASES = [
  (brand: string, label: string, value: string) => `${cap(label)} de ${brand} es ${value}.`,
  (brand: string, label: string, value: string) =>
    `Según el material de capacitación, ${label} de ${brand} es ${value}.`,
  (brand: string, label: string, value: string) =>
    `Verdadero o falso: ${label} de ${brand} es ${value}.`,
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pick<T>(arr: readonly T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Genera `count` preguntas ficticias para una marca (mitad opción múltiple, mitad V/F). */
export function generateBrandQuestions(
  brandIndex: number,
  brandName: string,
  count = 60,
): QuestionInput[] {
  const rnd = prng(1000 + brandIndex);
  // Valor "verdadero" de cada atributo para esta marca.
  const truth = ATTRIBUTES.map((a) => a.pool[brandIndex % a.pool.length]!);
  const out: QuestionInput[] = [];

  for (let i = 0; i < count; i++) {
    const attrIdx = i % ATTRIBUTES.length;
    const variant = Math.floor(i / ATTRIBUTES.length) % 6;
    const attr = ATTRIBUTES[attrIdx]!;
    const correct = truth[attrIdx]!;

    if (variant < 3) {
      const distractors = shuffle(
        attr.pool.filter((v) => v !== correct),
        rnd,
      ).slice(0, 3);
      const values = shuffle([correct, ...distractors], rnd);
      const ids = ['a', 'b', 'c', 'd'];
      const options = values.map((text, k) => ({ id: ids[k]!, text: cap(text) }));
      out.push({
        type: 'MULTIPLE_CHOICE',
        prompt: MC_PHRASES[variant]!(brandName, attr.label),
        options,
        correctAnswer: ids[values.indexOf(correct)]!,
      });
    } else {
      const isTrue = rnd() < 0.5;
      const value = isTrue
        ? correct
        : pick(
            attr.pool.filter((v) => v !== correct),
            rnd,
          );
      out.push({
        type: 'TRUE_FALSE',
        prompt: TF_PHRASES[variant - 3]!(brandName, attr.label, value),
        options: [
          { id: 'TRUE', text: 'Verdadero' },
          { id: 'FALSE', text: 'Falso' },
        ],
        correctAnswer: isTrue ? 'TRUE' : 'FALSE',
      });
    }
  }
  return out;
}

export const PHARMACIES_PER_COUNTRY = 3;
export const CLERKS_PER_COUNTRY = 20;

const CITIES: Record<CountryCode, string[]> = {
  CO: ['Bogotá', 'Medellín', 'Cali'],
  EC: ['Quito', 'Guayaquil', 'Cuenca'],
  PE: ['Lima', 'Arequipa', 'Trujillo'],
};

export function seedPharmacies(country: CountryCode) {
  return CITIES[country].map((city, i) => ({
    externalCode: `${country}-FAR-${String(i + 1).padStart(3, '0')}`,
    name: `Farmacia Demo ${i + 1} ${city}`,
    city,
  }));
}

/**
 * Teléfonos ficticios de prueba en E.164 (bloque 9000000xx / 30000000xx), nunca reales.
 * `n` va de 1 a 99.
 */
export function fakePhone(country: CountryCode, n: number): string {
  const nn = String(n).padStart(2, '0');
  switch (country) {
    case 'CO':
      return `+57300000${nn.padStart(4, '0')}`;
    case 'EC':
      return `+5939000${nn.padStart(5, '0')}`;
    case 'PE':
      return `+519000${nn.padStart(5, '0')}`;
  }
}

/** Documento ficticio (solo se guarda su HMAC). */
export function fakeDocument(country: CountryCode, n: number): string {
  return `${country}TEST${String(n).padStart(6, '0')}`;
}

export const DEFAULT_TERMS: Record<CountryCode, Record<string, string>> = {
  CO: { 'term.pharmacy': 'droguería' },
  EC: {},
  PE: { 'term.pharmacy': 'botica' },
};

const LAW: Record<CountryCode, string> = {
  CO: 'la Ley 1581 de 2012 de Colombia',
  EC: 'la Ley Orgánica de Protección de Datos Personales del Ecuador',
  PE: 'la Ley 29733 del Perú',
};

/** Texto de consentimiento de ejemplo (debe ser revisado por el área legal del cliente). */
export function consentText(country: CountryCode): string {
  return [
    'TEXTO DE EJEMPLO — PENDIENTE DE REVISIÓN LEGAL.',
    `Conforme a ${LAW[country]}, autorizas el tratamiento de tu número de celular, tu documento (guardado de forma cifrada), tu nombre visible y tu actividad de juego`,
    'con la finalidad exclusiva de operar el programa de capacitación, calcular puntos y rankings y entregar premios.',
    'Puedes ejercer tus derechos de acceso, rectificación y eliminación escribiendo al canal de soporte del programa.',
  ].join(' ');
}
