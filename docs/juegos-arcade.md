# Juegos arcade y piloto A/B en Perú

Estado: **listo para encender el piloto** (F0 a F2 hechos en el repositorio; quedan las tareas que requieren personas, marcadas 👤). Decisiones: ADR-033 y ADR-034.

## 1. Qué son

Dos estilos originales que cambian **cómo se elige la respuesta**, no qué se mide:

| Estilo                            | Paquete                          | Cómo se responde                                                             |
| --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Clásico                           | `game-trivia`, `game-true-false` | Se toca la opción                                                            |
| Plataformas, «Ruta del Mostrador» | `game-platform`                  | Una dependiente recorre el pasillo y salta debajo de la caja de su respuesta |
| Lanzamiento, «Tiro de Muestras»   | `game-launch`                    | Se estira una honda y se lanza una cápsula al blanco de la respuesta         |

Golpear una caja o un blanco **solo selecciona**; hay que confirmar. Las preguntas llegan sin respuesta correcta y el servidor puntúa, igual que en el clásico.

## 2. Dirección de arte (F0)

- **Mundo propio de farmacia:** mostrador, estanterías, cajas de producto genéricas, cápsulas y la cruz verde. Nada de tuberías, hongos, monedas, aves, cerdos, catapultas de madera ni otros elementos asociados a juegos comerciales.
- **Personaje:** una dependiente con gorra y delantal en el color de la marca. Sin bigote, overol ni rasgos que recuerden a personajes conocidos.
- **Color:** solo el tema de la marca (`primary`, `secondary`) más neutros. La opción elegida se marca en amarillo con contorno oscuro. El texto de las opciones siempre se repite en HTML encima del lienzo (lectores de pantalla y fuente grande).
- **Forma:** formas planas con esquinas redondeadas, sin degradados pesados, legibles a 360 px de ancho.
- **Movimiento:** corto y desactivable. Con `prefers-reduced-motion` el juego abre en modo simple.
- **Entrega del diseñador (👤):** hojas de sprites o SVG por escena, como máximo 150 KB por estilo, con licencia de cesión total al cliente (CLAUDE.md §4.2).

## 3. Guía de sonido (F0)

- Sonidos sintetizados con Web Audio (sin archivos): golpe, selección, acierto y error de envío, de menos de 150 ms y a volumen bajo.
- Desactivables desde el botón «Sonido» en cada partida. El juego nunca reproduce sonido antes de la primera interacción.
- Nada de melodías ni efectos que imiten sonidos característicos de juegos comerciales.

## 4. Checklist de propiedad intelectual para revisión legal (👤 F0)

Marcar cada punto con el arte final antes de encender el piloto:

- [ ] Los nombres «Ruta del Mostrador» y «Tiro de Muestras» no coinciden con marcas registradas de juegos en PE, EC ni CO.
- [ ] El personaje no reproduce la silueta, la vestimenta ni la paleta de un personaje comercial.
- [ ] Ningún escenario reproduce niveles, objetos o composiciones reconocibles de un juego comercial.
- [ ] Los sonidos no imitan efectos reconocibles.
- [ ] Los materiales de comunicación al dependiente no mencionan títulos comerciales («como Mario», «tipo Angry Birds»).
- [ ] El arte final tiene cesión de derechos al cliente por escrito.
- [ ] Marcas y preguntas del piloto son las aprobadas por el cliente (las de este repositorio son ficticias).

## 5. Protocolo del piloto A/B (F3)

| Punto                | Definición                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| País                 | Perú                                                                                                                                            |
| Duración             | 4 semanas desde que se enciende                                                                                                                 |
| Unidad de asignación | La farmacia: todo el equipo juega el mismo grupo, para que los compañeros no se mezclen                                                         |
| Asignación           | Determinista: FNV-1a de `semilla:pharmacyId`, módulo 100, menor que `arcadeSharePct` → arcade. 50 % por defecto                                 |
| Grupo control        | Solo estilo clásico                                                                                                                             |
| Grupo arcade         | Plataformas o Lanzamiento, con modo simple disponible                                                                                           |
| Equidad del ranking  | Ambos grupos compiten juntos. El bono de velocidad usa la ventana del estilo (30 s arcade, 20 s clásico) y las preguntas por partida no cambian |
| Datos                | `GameSession.style` y `GameSession.experimentGroup`; evento `game.session_finished` con estilo y grupo                                          |

Indicadores (reporte `GET /admin/reports/arcade-pilot[.csv]`):

| Indicador                      | Definición                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Dependientes activos           | Con al menos una partida terminada en la ventana                                        |
| Partidas por activo por semana | Terminadas ÷ activos ÷ semanas de la ventana                                            |
| Aciertos                       | Correctas ÷ preguntas de partidas terminadas                                            |
| Abandono                       | Partidas vencidas sin terminar ÷ partidas resueltas (no cuenta las que siguen en curso) |
| Retorno a 7 días               | % de activos que juegan otro día local dentro de los 7 días de su primera partida       |
| Duración media                 | Segundos entre inicio y cierre de partidas terminadas                                   |

**Criterios para extender a EC y CO** (todos): partidas por activo **+20 %** frente al control, aciertos sin caer **más de 3 puntos**, abandono arcade **< 15 %**, carga del juego **< 2 s** en Android de 2 GB, revisión legal aprobada y sin hallazgos críticos de accesibilidad. El panel muestra el veredicto calculado con las tres primeras condiciones.

## 6. Operación

**Encender el piloto (día 1):** Panel → País PE → Configuración → «Juegos arcade y piloto A/B»: marcar «Estilos arcade activos» y «Piloto A/B por farmacia», dejar 50 % y guardar. Se aplica sin desplegar (caché invalidada). No cambiar la semilla durante el piloto: reasigna farmacias.

**Seguimiento semanal:** Panel → «Piloto arcade: indicadores» → «Ver indicadores» o «Exportar CSV» (queda en auditoría). Solo `SUPER_ADMIN` y el `COUNTRY_ADMIN` de PE.

**Apagar (fin o incidente):** desmarcar «Estilos arcade activos». Las partidas en curso terminan con su estilo; las nuevas vuelven al clásico. Los datos del piloto se conservan.

**Extender a otro país:** el mismo bloque en la configuración de EC o CO. Sin desarrollo.

## 7. Evidencia de pruebas (F2)

| Prueba                                                                      | Resultado                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Unidad `shared` (asignación A/B, reglas por estilo, indicadores, veredicto) | 74 pruebas en verde                                                                                                              |
| Unidad de juegos (alcanzabilidad de todas las opciones, física)             | 14 pruebas en verde                                                                                                              |
| Integración API con PostgreSQL y Redis reales (`arcade.int.test.ts`)        | 6 pruebas en verde (63 en total)                                                                                                 |
| E2E Pixel 5 (Chromium)                                                      | 7 de 7 en verde, incluida la partida arcade completa                                                                             |
| E2E perfil iPhone 12 sobre Chromium                                         | 7 de 7 en verde. **Pendiente 👤:** WebKit no está disponible en el entorno de CI de este repositorio; validar en Safari iOS real |
| Respuesta correcta en la red                                                | Ninguna respuesta de la API la incluye durante la partida arcade (E2E)                                                           |
| Objetivos táctiles                                                          | Controles y «Confirmar» ≥ 44 px (E2E)                                                                                            |
| Rendimiento con CPU x4 y x6 (Pixel 5 emulado)                               | 60 fps, cuadro p95 ≤ 16,8 ms, escena lista en ≤ 350 ms, 9,5 MB de memoria                                                        |
| Peso                                                                        | 10,7 KB y 12,7 KB por juego + 9,6 KB del kit; JS inicial de la PWA sin cambios (94,7 KB gzip)                                    |
| **Pendiente 👤**                                                            | 3 Android reales de 2 GB, auditoría AA con TalkBack y VoiceOver, contraste de cada tema de marca real                            |

## 8. Ensayo del piloto con datos sintéticos (F3)

2026-11-24, contra la API local con la configuración real del panel: piloto encendido con la semilla `ensayo-2` (2 farmacias demo en control y 1 en arcade), los 20 dependientes demo de PE jugando por la API con aciertos simulados y fechas repartidas en 2 semanas; al final se restauró la configuración.

- El catálogo asignó a cada dependiente el grupo de su farmacia y el servidor aceptó solo los estilos de su grupo.
- El reporte JSON y el CSV salieron por grupo y estilo, con veredicto. En el ensayo: partidas por activo +32,6 %, aciertos −7,3 puntos y abandono arcade 6,7 %, así que **no cumple** (la simulación usó menos aciertos en arcade a propósito). Los números son sintéticos y solo validan el circuito.
- **Hallazgo corregido:** la participación del grupo arcade salió en 133 % porque contaba a dependientes que jugaron en el grupo y después quedaron en una farmacia del otro grupo (pasa con traslados o si se cambia la semilla). Ahora es «asignados hoy que jugaron ÷ asignados» y la prueba de integración verifica que nunca pase de 100 %.
