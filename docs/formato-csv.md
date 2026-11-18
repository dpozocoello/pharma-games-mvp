# Formato de Archivos CSV (Iteración 2)

Todos los archivos CSV deben estar codificados en **UTF-8** (con o sin BOM), separados por coma (`,`) según **RFC 4180**, y tener la fila de cabecera en la línea 1.

Los archivos de ejemplo listos para pruebas se encuentran en `tests/fixtures/`:

- `tests/fixtures/users-valid.csv` y `tests/fixtures/users-invalid.csv`
- `tests/fixtures/questions-valid.csv` y `tests/fixtures/questions-invalid.csv`

---

## 1. Importación Masiva de Usuarios y Farmacias (`POST /api/v1/admin/imports/users`)

Permite cargar hasta **5.000 usuarios por archivo** en menos de 60 segundos. Si una farmacia indicada en `pharmacyCode` no existe aún en el país, se crea automáticamente; si el usuario ya existe, actualiza su nombre/estado y si cambió de farmacia ejecuta el traslado conservando sus puntos e historial en `PharmacyAssignment`.

### Cabeceras obligatorias

```csv
countryCode,pharmacyCode,pharmacyName,city,phone,document,displayName,role
```

| Columna        | Obligatorio | Reglas de validación                                                                                      | Ejemplo                |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| `countryCode`  | Sí          | Código ISO-2 en mayúsculas (`PE`, `CO`, `EC`). Debe coincidir con el país del lote y el alcance del admin | `PE`                   |
| `pharmacyCode` | Sí          | Código externo de la farmacia (2 a 40 caracteres)                                                         | `PE-FAR-001`           |
| `pharmacyName` | Sí          | Nombre comercial de la farmacia (2 a 120 caracteres, sin caracteres de fórmula `=`, `+`, `-`, `@`)        | `Farmacia Demo 1 Lima` |
| `city`         | Sí          | Ciudad de la farmacia (2 a 80 caracteres)                                                                 | `Lima`                 |
| `phone`        | Sí          | Teléfono celular (local o E.164, normalizado con el prefijo del país). Único en la plataforma             | `+51900100001`         |
| `document`     | Sí          | Documento de identidad (3 a 32 caracteres alfanuméricos). Se guarda únicamente como `HMAC-SHA256`         | `PETEST100001`         |
| `displayName`  | Sí          | Nombre visible (2 a 120 caracteres, sin fórmulas)                                                         | `Lucía Quispe`         |
| `role`         | Sí          | `CLERK` (dependiente) o `PHARMACY_MANAGER` (gerente de farmacia)                                          | `CLERK`                |

---

## 2. Importación Masiva de Preguntas (`POST /api/v1/admin/imports/questions`)

Las preguntas importadas nacen en estado **`DRAFT`** para seguir el flujo de aprobación (`DRAFT → IN_REVIEW → PUBLISHED`). Solo las preguntas `PUBLISHED` entran al sorteo de partidas.

### Cabeceras obligatorias

```csv
brandSlug,countryCode,type,prompt,options,correctAnswer,locale
```

| Columna         | Obligatorio | Reglas de validación                                                                                              | Ejemplo                                               |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `brandSlug`     | Sí          | Slug de una marca existente (`marca-a` .. `marca-i`)                                                              | `marca-a`                                             |
| `countryCode`   | Opcional    | Vacío para pregunta compartida (solo `SUPER_ADMIN`), o código de país donde la marca está disponible (`PE`, etc.) | `PE`                                                  |
| `type`          | Sí          | `MULTIPLE_CHOICE` (3 a 6 opciones) o `TRUE_FALSE` (`TRUE` y `FALSE`)                                              | `MULTIPLE_CHOICE`                                     |
| `prompt`        | Sí          | Enunciado de la pregunta (5 a 500 caracteres, ficticio y sin afirmaciones médicas reales)                         | `¿Cuál es el color principal del empaque de Marca A?` |
| `options`       | Sí          | Lista separada por `\|` con formato `id:texto`                                                                    | `a:Azul\|b:Verde\|c:Naranja\|d:Morado`                |
| `correctAnswer` | Sí          | Debe coincidir con uno de los `id` declarados en `options`                                                        | `a`                                                   |
| `locale`        | Sí          | Idioma de la pregunta (`es`, `es-PE`, `es-CO`, `es-EC`)                                                           | `es`                                                  |

---

## 3. Reporte de Errores por Fila

Tanto `POST /api/v1/admin/imports/users` como `POST /api/v1/admin/imports/questions` crean un registro `ImportJob` consultable en `GET /api/v1/admin/imports/:id` que devuelve:

- `totalRows`: total de filas de datos leídas.
- `validRows`: filas procesadas y guardadas exitosamente.
- `errors`: arreglo detallado `{ row, field, message }` indicando el número exacto de línea en el CSV (>= 2), la columna afectada y el motivo del rechazo. Las filas válidas del archivo se importan aunque otras filas tengan error.
