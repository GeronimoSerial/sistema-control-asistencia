# Sistema de asistencia por nivel

Aplicación nueva, sobre SQLite y servidor propio. Vive en esta carpeta, con su propio
`package.json` y su propia configuración: **no comparte nada con la aplicación que está en la raíz
del repositorio**, que sigue funcionando en producción sin cambios.

La arquitectura está explicada en [`../docs/ARQUITECTURA-NIVELES-SQLITE.md`](../docs/ARQUITECTURA-NIVELES-SQLITE.md).

## Requisitos

Node 24 o superior. Funciona con Node 22, pero `node:sqlite` todavía está marcado como
experimental ahí y emite una advertencia en cada arranque.

## Puesta en marcha

```bash
cd sistema
npm install
```

Creá un `.env.local` con el secreto del servidor:

```
AUTH_SECRET=<cadena aleatoria de al menos 24 caracteres>
DATA_DIR=./data
```

`AUTH_SECRET` deriva los índices de búsqueda de PIN y los hashes de dispositivo. **Si cambia,
los PIN dejan de encontrarse.** Generalo una vez y guardalo.

Creá el primer nivel:

```bash
npm run nivel:crear -- --slug primaria --nombre "Nivel Primario" \
  --sede "Sede central" --lat -27.4692 --lng -58.8306 \
  --admin ana@ejemplo.gob.ar --clave "una contraseña larga"
```

Y levantá el servidor:

```bash
npm run dev
```

- `http://localhost:3000` — lista de niveles
- `http://localhost:3000/primaria` — pantalla pública del QR

Cada nivel se agrega repitiendo `nivel:crear` con otro `--slug`. El comando es idempotente:
volver a correrlo actualiza el catálogo de reglas sin duplicar nada ni pisar la configuración que
se haya cambiado desde la aplicación.

## Cómo está organizado

```
core/        lógica de dominio, sin dependencias de la interfaz
  absence/     cuotas por tramos, escalas de derecho
  attendance/  política declarativa y servicio de marcación
  config/      definiciones de configuración y su almacenamiento
  migrations/  esquema de la base de un nivel
  platform/    SQLite, tiempo con zona, geodistancia, hashes
  tenancy/     registro de niveles
packs/       paquetes de reglas por organismo, como datos
lib/         resolución del nivel y validación de marcación para la aplicación web
app/         pantallas y API
scripts/     alta de niveles y pruebas
```

El dominio no importa nada de `app/` ni de `next`. Por eso se puede probar con Node directo, sin
levantar el servidor.

## Pruebas

```bash
npm run verify:rules      # los evaluadores dan los mismos números que la lógica anterior
npm run demo:sqlite       # dos niveles reales, aislamiento y saldos
npm run demo:asistencia   # flujo completo de marcación
```

Las tres corren contra bases temporales y no tocan `data/`.

## Marcación: cómo funciona

1. La pantalla pública muestra un QR que se renueva cada pocos minutos. Una foto del código deja
   de servir cuando vence.
2. El código lleva al celular a `/{nivel}/marcar?t=<token>`.
3. La página pide la ubicación, después el PIN.
4. El servidor valida en este orden: token vigente → PIN → dispositivo autorizado → dentro de la
   geocerca. El orden es deliberado: sin un código vigente no se puede averiguar si un PIN
   existe.
5. El servidor decide qué movimiento corresponde —entrada, salida o reingreso— y la pantalla
   muestra un solo botón. La interfaz no decide nada.

El teléfono queda vinculado recién al registrar el primer movimiento, no al identificarse.

## Antes de ponerlo en producción

**Hace falta HTTPS.** Los navegadores bloquean la geolocalización fuera de un contexto seguro. Si
el servidor queda accesible como `http://192.168.1.50:3000`, los celulares no van a poder marcar.
La pantalla lo detecta y lo avisa con un mensaje claro en lugar de fallar sin explicación, pero
la solución es un dominio con certificado o un túnel.

**Respaldos con `VACUUM INTO`.** Copiar un `.db` mientras se escribe puede producir un archivo
inconsistente:

```bash
sqlite3 data/primaria.db "VACUUM INTO 'respaldo/primaria-$(date +%F).db'"
```

**`npm run build` genera una carpeta autocontenida** en `.next/standalone`, que se copia al
servidor y se ejecuta con `node server.js`. `data/` tiene que quedar afuera de esa carpeta y
sobrevivir a los despliegues.

## Lo que todavía no está

La sesión de usuario y el módulo de administración. Hoy los niveles, las sedes y los
administradores se crean por línea de comandos; las personas y sus horarios todavía no tienen
pantalla de carga.
