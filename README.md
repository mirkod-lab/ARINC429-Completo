# ARINC 429 Lab

Panel educativo con Node.js/Express, MySQL y una capa serial configurable. El modo de simulación funciona sin Arduino, pero requiere que MySQL esté configurado para guardar envíos.

## Datos físicos pendientes

Antes de completar firmware y cableado hacen falta: modelo exacto de Arduino; velocidad/encuadre/confirmación serial compatibles; pines y plataforma de temporización; esquema de los controladores que generan A/B; definición eléctrica de estados, polaridad, complementariedad o alta impedancia; velocidad ARINC pretendida; y hoja de datos/configuración real de cada instrumento (etiqueta, SDI, formato, bits, resolución, rango, SSM y orden de transmisión). **No conectar ±10 V a los pines del Arduino.** USB/serial no es una interfaz eléctrica ARINC 429.

## Instalación en Windows / Visual Studio Code

1. Instala Node.js 20 o superior, MySQL Server 8 y Visual Studio Code. Abre esta carpeta en VS Code.
2. En la terminal PowerShell integrada ejecuta `npm install`.
3. En MySQL Workbench, conecta con una cuenta administradora y abre/ejecuta `database/schema.sql`. El script crea `arinc429_lab` y nueve perfiles de práctica: temperatura de aceite, presión de combustible, altímetro, velocidad aerodinámica, velocidad vertical, rumbo, actitud, temperatura exterior y tacómetro de motor. Todos usan parámetros ficticios. Si ya ejecutaste una versión anterior, vuelve a ejecutar el mismo script para agregar los perfiles faltantes sin duplicarlos; después actualiza el panel para que aparezcan en el CRUD. Para limitar las credenciales de la aplicación, crea luego un usuario local propio:

   ```sql
   CREATE USER 'arinc_app'@'localhost' IDENTIFIED BY 'REEMPLAZAR_POR_UNA_CLAVE_SEGURA';
   GRANT SELECT, INSERT, UPDATE, DELETE ON arinc429_lab.* TO 'arinc_app'@'localhost';
   ```

   Cambia el nombre/host si tu instancia lo requiere. No guardes esa clave en el repositorio ni la envíes al frontend.

Para abrir y consultar la base, puedes usar **MySQL Workbench**: conéctate al servidor MySQL local, abre **Schemas → arinc429_lab → Tables**, y luego **clic derecho en `instrumentos` → Select Rows - Limit 1000**. También puedes abrir `database/schema.sql` en Workbench y ejecutar las consultas del archivo. La aplicación se conecta usando las variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` del `.env`; no compartas ni publiques ese archivo.
4. Copia `.env.example` como `.env` (en VS Code: **Guardar como**) y completa `DB_HOST`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`. No cambies `SERIAL_MODE=simulation` todavía.
5. En la terminal de VS Code ejecuta `npm start` y abre `http://localhost:3000`. Detén el servidor con Ctrl+C.
6. Ejecuta `npm test` para probar longitud, resolución, límites, BNR, BCD, paridad impar, trama serial, CRC y ACK.

## Uso

Selecciona el instrumento de demostración en la lista, introduce un valor dentro del rango y pulsa **Crear envío**. La acción solo guarda el envío pendiente en MySQL. La vista previa muestra la palabra/hexadecimal y un mapeo lógico didáctico por bit (`1 → +12 V`, `0 → −12 V`). Pulsa **Ejecutar** para simular: quedará como `procesado` y mostrará la palabra y esos niveles simulados. No se envía por serial ni se genera tensión física.

La sección **Administrar instrumentos** permite crear, consultar, modificar y eliminar perfiles. La descripción, etiqueta, formato, unidad, rango, resolución y objetos JSON de configuración se validan antes de guardar. El ID es autogenerado. No se permite eliminar un instrumento con envíos asociados; el control se aplica en la API y en la clave foránea MySQL.

El mapeo ±12 V es solo una representación conceptual para la práctica; no modela la temporización, el retorno a cero ni la señal diferencial física ARINC 429. No conectes una salida de ±12 V al Arduino ni uses esta vista como diseño o validación eléctrica.

La etiqueta BNR/BCD debe ser un múltiplo de la resolución; la interfaz previsualiza los 32 bits y el hexadecimal, y el backend vuelve a validar el valor. La paridad es impar si el conteo total de bits en `1`, incluido el bit 32, es impar. Los tests comprueban esta condición automáticamente.

## Codificación

Cada perfil define `parametros_arinc` en JSON. El generador asigna etiqueta (bits 1-8, reversión configurable), SDI (9-10), datos (11-29), SSM (30-31) y paridad impar (32). BNR admite `twos-complement` o `unsigned`; el primero es una convención del ejercicio configurable, no una declaración universal sobre una instalación certificada. BCD utiliza posiciones de nibble configurables. Se entrega `palabra_binaria` en orden de posición 32 a 1, hexadecimal numérico y cuatro bytes little-endian para la trama del PC; la capa posterior debe validar el orden de transmisión esperado por el hardware.

Los perfiles precargados usan rangos, etiquetas y escalas inventados para ensayar software. Los nombres se muestran sin la etiqueta «DEMO FICTICIA», pero eso no convierte sus parámetros en datos reales: la interfaz y esta documentación avisan que son perfiles de práctica. No son etiquetas ARINC oficiales ni datos aprobados para instrumentos reales. Ajusta escalas, SDI, SSM, ubicación de bits y codificación con documentación técnica auténtica antes de cualquier integración.

## Protocolo PC–Arduino

Parámetros de ejemplo: 115200 baudios, 8 bits, sin paridad, 1 stop. Trama de 11 bytes: `02 | versión(01) | comando(01) | secuencia | palabra(4 bytes LE) | CRC16-Modbus(2 bytes LE) | 03`. ACK: `02 | versión(01) | comando(81) | secuencia | CRC16-Modbus(2 bytes LE) | 03` (7 bytes). El código base del Arduino valida el marco y responde ACK. El ACK solo prueba que el firmware recibió y validó la trama; no confirma generación de pulsos ni tensión A/B. Los campos CRC y encuadre evitan aceptar silenciosamente la mayoría de tramas alteradas; añade timeout, reintentos y recuperación según el firmware definitivo.

Para el modo real, cambia `SERIAL_MODE=hardware`, reinicia y selecciona COM. Cierra el monitor serial de Arduino IDE antes de ejecutar; el servidor abre el puerto en cada envío. Si el modelo no usa el firmware de ejemplo, adapta baudrate, trama, CRC y ACK en ambos extremos.

### Verificación de COM y firmware de ejemplo

1. Conecta la placa por USB y abre **Administrador de dispositivos → Puertos (COM y LPT)** para identificar el COM. También se puede revisar en Arduino IDE → **Herramientas → Puerto**. La lista del panel usa los puertos visibles para Node.
2. No ejecutes el ejemplo como transmisor ARINC: es solo receptor de trama/validador con ACK, no conoce modelo de placa, no configura pines A/B y no genera señal física.
3. Si solo se prueba el enlace de datos de la placa: abre `arduino/firmware.ino` en Arduino IDE, selecciona el modelo/puerto correctos, verifica y carga. Luego activa `SERIAL_MODE=hardware` en `.env`, reinicia el servidor y envía una palabra de prueba; un ACK cambia el estado a `enviado`, que solo acredita recepción serial.
4. Para integrar salida A/B se debe completar el firmware después de recibir las especificaciones eléctricas y lógicas faltantes. Valida primero con osciloscopio apropiado, carga de prueba y circuito aislado. No uses solo un multímetro para certificar forma de onda/temporización, no conectes el instrumento mientras no se hayan validado amplitud, polaridad, secuencia y protecciones, y nunca conectes ±10 V a un pin Arduino.

## Arduino y seguridad eléctrica

`arduino/firmware.ino` es una interfaz no destructiva: recibe la trama, valida CRC y responde ACK; **no cambia pines ni produce A/B**. No es firmware de transmisor final. Antes de implementarlo hay que acordar modelo, pines, periféricos/temporizador, secuencia y tasa de bits, codificación bipolar/estados A/B, comportamiento en reposo y protecciones de la etapa posterior. No asumir A=+10 V ni B=-10 V. Verifica primero con osciloscopio y multímetro adecuados, carga resistiva/aislamiento y el esquema eléctrico, sin conectar el instrumento físico hasta confirmar niveles, formas de onda y límites.

## API

- `GET /api/instrumentos`, `GET /api/instrumentos/:id`
- `POST /api/instrumentos`, `PUT /api/instrumentos/:id`, `DELETE /api/instrumentos/:id`
  - El cuerpo de creación/edición requiere `nombre` (descripción), `etiqueta_arinc`, `formato_datos` (`BNR` o `BCD`), `unidad`, `valor_minimo`, `valor_maximo`, `resolucion`, `parametros_arinc` y `parametros_tension`.
  - `parametros_arinc` y `parametros_tension` son objetos JSON (también se aceptan como cadenas JSON). Los parámetros ARINC deben permitir codificar los extremos del rango con la resolución seleccionada.
  - `DELETE` responde HTTP 409 cuando hay envíos asociados.
- `POST /api/envios/preview` valida y codifica una vista previa sin guardar el envío
- `GET /api/envios?estado=&id_instrumento=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
- `GET /api/envios/:id`, `POST /api/envios`, `PUT /api/envios/:id`, `DELETE /api/envios/:id`
- `POST /api/envios/:id/ejecutar` con `{ "port": "COM3" }` en hardware
- `GET /api/serial/puertos`, `GET /api/estado`

La tabla `envios` ya referencia `instrumentos` por `id_instrumento` mediante una clave foránea con `ON DELETE RESTRICT`; un instrumento puede tener varios envíos y cada envío pertenece a un instrumento. No hace falta una migración adicional en instalaciones que ya aplicaron `database/schema.sql`. Todas las consultas MySQL usan parámetros. `enviado` significa únicamente ACK serial del firmware; la aplicación no registra simulación como transmisión ni afirma confirmación eléctrica física.
