CREATE DATABASE IF NOT EXISTS arinc429_lab
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE arinc429_lab;

CREATE TABLE IF NOT EXISTS instrumentos (
  id_instrumento INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(120) NOT NULL,
  etiqueta_arinc TINYINT UNSIGNED NOT NULL COMMENT 'Valor de etiqueta de demostración o configurado, 0-255',
  formato_datos ENUM('BNR', 'BCD') NOT NULL,
  unidad VARCHAR(24) NOT NULL,
  valor_minimo DECIMAL(14, 5) NOT NULL,
  valor_maximo DECIMAL(14, 5) NOT NULL,
  resolucion DECIMAL(14, 8) NOT NULL,
  parametros_arinc JSON NOT NULL COMMENT 'Incluye sdi, ssm y posiciones/codificación configurables',
  parametros_tension JSON NOT NULL COMMENT 'Solo notas de configuración; no controla salidas eléctricas',
  PRIMARY KEY (id_instrumento),
  CONSTRAINT chk_instrumento_rango CHECK (valor_minimo < valor_maximo),
  CONSTRAINT chk_instrumento_resolucion CHECK (resolucion > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS envios (
  id_envio BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_instrumento INT UNSIGNED NOT NULL,
  valor DECIMAL(14, 5) NOT NULL,
  fecha_hora DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  palabra_binaria CHAR(32) NOT NULL,
  palabra_hexadecimal CHAR(8) NOT NULL,
  estado ENUM('pendiente', 'procesado', 'enviado', 'error') NOT NULL DEFAULT 'pendiente',
  detalle_error TEXT NULL,
  PRIMARY KEY (id_envio),
  KEY idx_envios_instrumento_fecha (id_instrumento, fecha_hora),
  KEY idx_envios_estado_fecha (estado, fecha_hora),
  CONSTRAINT fk_envios_instrumento FOREIGN KEY (id_instrumento)
    REFERENCES instrumentos (id_instrumento) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_envios_palabra CHECK (palabra_binaria REGEXP '^[01]{32}$'),
  CONSTRAINT chk_envios_hex CHECK (palabra_hexadecimal REGEXP '^[0-9A-F]{8}$')
) ENGINE=InnoDB;

-- Perfiles para laboratorio, no son especificaciones aeronáuticas.
-- Etiquetas 0x00/0x01/0x02, escalas y posiciones son datos ficticios editables.
-- Normaliza nombres de instalaciones que ejecutaron la versión anterior del script.
UPDATE instrumentos
SET nombre = REPLACE(nombre, ' (DEMO FICTICIA)', '')
WHERE nombre IN (
  'Indicador de temperatura de aceite (DEMO FICTICIA)',
  'Indicador de presión de combustible (DEMO FICTICIA)'
);

UPDATE instrumentos
SET parametros_arinc = JSON_SET(parametros_arinc, '$.perfil',
    'FICTICIO: reemplazar con documentación real del instrumento')
WHERE nombre IN (
  'Indicador de temperatura de aceite',
  'Indicador de presión de combustible',
  'Altímetro'
);

INSERT INTO instrumentos
  (nombre, etiqueta_arinc, formato_datos, unidad, valor_minimo, valor_maximo, resolucion,
   parametros_arinc, parametros_tension)
SELECT 'Indicador de temperatura de aceite', 0, 'BNR', '°C',
       -50, 150, 1,
       JSON_OBJECT('sdi', 0, 'ssm', 0, 'dataStartBit', 11, 'dataBitLength', 19,
                   'encoding', 'twos-complement', 'labelBitOrder', 'reverse',
                   'perfil', 'FICTICIO: reemplazar con documentación real del instrumento'),
       JSON_OBJECT('status', 'FICTICIO: completar según esquema eléctrico del circuito A/B')
WHERE NOT EXISTS (SELECT 1 FROM instrumentos WHERE nombre = 'Indicador de temperatura de aceite');

INSERT INTO instrumentos
  (nombre, etiqueta_arinc, formato_datos, unidad, valor_minimo, valor_maximo, resolucion,
   parametros_arinc, parametros_tension)
SELECT 'Indicador de presión de combustible', 1, 'BCD', 'psi',
       0, 999, 1,
       JSON_OBJECT('sdi', 0, 'ssm', 0, 'bcdStartBit', 11, 'digitCount', 3,
                   'digitBitPositions', JSON_ARRAY(11, 15, 19), 'labelBitOrder', 'reverse',
                   'perfil', 'FICTICIO: reemplazar con documentación real del instrumento'),
       JSON_OBJECT('status', 'FICTICIO: completar según esquema eléctrico del circuito A/B')
WHERE NOT EXISTS (SELECT 1 FROM instrumentos WHERE nombre = 'Indicador de presión de combustible');

INSERT INTO instrumentos
  (nombre, etiqueta_arinc, formato_datos, unidad, valor_minimo, valor_maximo, resolucion,
   parametros_arinc, parametros_tension)
SELECT 'Altímetro', 2, 'BNR', 'ft',
       -1000, 50000, 100,
       JSON_OBJECT('sdi', 0, 'ssm', 0, 'dataStartBit', 11, 'dataBitLength', 19,
                   'encoding', 'twos-complement', 'labelBitOrder', 'reverse',
                   'perfil', 'FICTICIO: reemplazar con documentación real del instrumento'),
       JSON_OBJECT('status', 'FICTICIO: completar según esquema eléctrico del circuito A/B')
WHERE NOT EXISTS (SELECT 1 FROM instrumentos WHERE nombre = 'Altímetro');
