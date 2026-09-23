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

Creá el operador de plataforma. Es el único paso que queda por consola, y se hace una sola vez:

```bash
npm run operador:crear -- --email tu@correo --clave "una contraseña larga"
```

Con eso ya podés entrar a `http://localhost:3000/plataforma` y crear los niveles desde ahí. Si
preferís hacerlo por consola —en un script de instalación, por ejemplo— el comando equivalente es:

```bash
npm run nivel:crear -- --slug primaria --nombre "Nivel Primario" \
  --sede "Sede central" --lat -27.4692 --lng -58.8306 \
  --admin ana@ejemplo.gob.ar --clave "una contraseña larga"
```

Los dos caminos llaman a la misma función, así que dan exactamente el mismo resultado.

Cargá una persona para poder probar la marcación:

```bash
npm run persona:crear -- --nivel primaria --apellido Gómez --nombre Ana \
  --dni 20111222 --pin 4821 --horario 08:00-14:00 --dias 1-5
```

`--dias` acepta un rango (`1-5`) o una lista (`1,3,5`); lunes es 1 y domingo es 7. Volver a
correrlo con el mismo documento actualiza la persona en lugar de duplicarla.

Creá un usuario para entrar al panel:

```bash
npm run usuario:crear -- --nivel primaria --email ana@ejemplo.gob.ar \
  --clave "una contraseña larga" --rol ADMIN
```

Los roles que instala el paquete son `ADMIN`, `LICENSE_OPERATOR` y `ATTENDANCE_OPERATOR`. El
mismo comando sirve para restablecer una contraseña: si el correo ya existe, la reemplaza.

Y levantá el servidor:

```bash
npm run dev
```

- `http://localhost:3000` — lista de niveles
- `http://localhost:3000/plataforma` — alta y baja de niveles
- `http://localhost:3000/primaria` — pantalla pública del QR
- `http://localhost:3000/primaria/ingresar` — acceso al panel
- `http://localhost:3000/primaria/admin` — panel del día, padrón, licencias, usuarios, sedes y configuración

Crear un nivel es idempotente por los dos caminos: repetirlo actualiza el catálogo de reglas sin
duplicar nada ni pisar la configuración que se haya cambiado desde la aplicación.

## Cómo está organizado

```
core/        lógica de dominio, sin dependencias de la interfaz
  absence/     cuotas por tramos, escalas de derecho
  attendance/  política declarativa y servicio de marcación
  config/      definiciones de configuración y su almacenamiento
  migrations/  esquema de la base de un nivel
  platform/    SQLite, tiempo con zona, geodistancia, hashes
  tenancy/     registro de niveles, alta completa y operadores de plataforma
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
npm run demo:identidad    # autenticación, permisos y aislamiento entre niveles
npm run demo:licencias    # cómputo de días y cuotas
npm run demo:configuracion # validación de parámetros y resguardo del último administrador
npm run demo:gestion      # marcación manual, clasificación de salidas y vacaciones
npm run demo:correcciones # corrección y anulación de movimientos, y migración de bases viejas
npm run demo:plataforma   # alta de niveles, operadores y sedes
npm run demo:cierre       # cierre automático: lo que cierra, lo que no, y la reparación
npm run verify:acciones   # ningún archivo "use server" exporta algo que no sea una función async
```

Las diez primeras corren contra bases temporales y no tocan `data/`. `verify:acciones` no toca la
base: lee los archivos de `app/` y adelanta un error que, si no, aparecería recién al abrir la
pantalla en el navegador.

## El panel

La sesión es por nivel: la cookie se llama `sesion_<nivel>` y su ruta es `/<nivel>`, así que
alguien puede estar autenticado en Primaria y en Secundaria a la vez sin que una sesión pise a la
otra. Va firmada con HMAC y **no guarda los permisos**: se resuelven contra la base en cada
petición, de modo que quitarle un permiso a alguien tiene efecto inmediato.

La verificación de sesión está en el layout de `/[nivel]/admin`, así que una pantalla nueva queda
protegida por colgar de ahí. Los permisos finos se verifican en cada pantalla y en cada acción,
porque son distintos en cada una.

## Dos áreas separadas

**`/plataforma`** crea, suspende y reactiva niveles, y administra los operadores. Sus cuentas
viven en `platform.db`, aparte de las de cada nivel, y no dan acceso a ningún panel. La separación
es deliberada: el administrador de Primaria administra Primaria y no tiene por qué poder crear
Secundaria ni entrar en ella. Si ambas cuentas vivieran en la misma tabla, un permiso mal asignado
alcanzaría para cruzar esa línea.

Crear un nivel deja el archivo con el esquema, el paquete de reglas, la sede y el primer
administrador —al que se le exige cambiar la contraseña en su primer ingreso—. Suspender no borra
nada: el archivo queda donde está y el nivel deja de responder, de forma reversible.

**`/{nivel}/admin`** es el panel de cada nivel, con sus propios usuarios y permisos.

## Sedes

Un nivel puede tener varias. Cada una define su geocerca y emite su propio QR, y los parámetros
de ámbito de sede —radio, exigencia de ubicación, vigencia del código— se configuran por separado
en cada una, no una vez para todo el nivel.

El código QR lleva consigo de qué sede salió, y la validación de ubicación usa **esa** sede. Antes
todo el flujo tomaba «la primera sede activa», lo que con un solo edificio funcionaba por
casualidad y con dos habría rechazado a todos los del segundo.

Con más de una sede activa, la pantalla pública deja elegir cuál mostrar; cada monitor se queda
fijo en su dirección (`/{nivel}?sede=CODIGO`). Una sede sin coordenadas es válida: funciona sin
geocerca. No se puede desactivar la última activa, porque sin ninguna no habría a quién emitirle
el código.

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

### Cuando algo queda mal cargado

Desde **Registros** se puede corregir la hora de un movimiento o anularlo. Con dos reglas:

**Nada se borra.** Un movimiento anulado sigue en la base, marcado, con quién lo anuló y por qué;
deja de contar pero no desaparece del historial. Una corrección guarda además la hora original, y
una segunda corrección no la pisa.

**La jornada tiene que seguir siendo posible.** Antes de escribir, el sistema arma la secuencia
que quedaría y la valida: tiene que empezar por una entrada, alternar salidas y reingresos, y no
tener dos movimientos en el mismo instante. Esto obliga a deshacer de atrás para adelante —para
anular la entrada hay que anular antes lo que vino después—, que es incómodo a propósito: la
alternativa es dejar días que el cálculo interpretaría de cualquier manera.

Lo demás se acomoda solo. La tardanza, la compensación y el cierre salen de `recomputeDay()`, que
lee los movimientos vigentes, así que no hay ningún número que haya que ajustar a mano. Los
intervalos siguen a sus movimientos: corregir una salida mueve el inicio del intervalo, anular un
reingreso lo vuelve a abrir y borra su clasificación, anular una salida anula el intervalo entero.

## El cierre automático

Las jornadas que quedan abiertas se cierran imputando la salida al horario previsto. **No corre
solo:** hay que programar el guion en el servidor, una vez por día después del último horario de
salida.

```bash
npm run jornadas:cerrar
```

**La salida imputada nunca cae antes del último movimiento.** Si alguien reingresó después de su
horario, o entró después del fin de su horario, la jornada no se cierra: queda marcada con el
motivo y aparece en el panel de Hoy para que alguien la resuelva desde Registros. Es deliberado —
el sistema no sabe a qué hora se fue esa persona, y cualquier hora que invente es un dato falso en
el legajo de alguien.

Si una versión anterior ya dejó jornadas con salidas automáticas apiladas o fuera de orden:

```bash
npm run jornadas:cerrar -- --reparar
```

Anula las salidas automáticas que sobran —no borra nada, quedan con su motivo— y deja esas
jornadas abiertas otra vez, que es como estaban antes de que el cierre las tocara.

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

El módulo de administración está completo: panel del día, registros con marcación manual,
corrección y anulación de movimientos, clasificación de salidas intermedias, padrón, licencias,
vacaciones, usuarios, sedes y configuración. Los niveles se crean desde `/plataforma`.

Falta lo de afuera del sistema: reportes y exportación, respaldos automáticos y el arranque como
servicio en el servidor.

La pantalla de configuración se genera desde el registro de definiciones de `core/config`: cada
parámetro declara su tipo, su ámbito, su valor por defecto y su validación en un solo lugar.
Agregar uno nuevo es agregar un `defineSetting`; la pantalla no cambia.

Los niveles y las sedes se siguen creando por línea de comandos.
