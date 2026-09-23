# Levantar el sistema en local

En este repositorio conviven dos aplicaciones. Esta guía cubre las dos, porque se prueban de
maneras muy distintas.

- **`sistema/`** — la aplicación nueva, sobre SQLite. No necesita base de datos externa ni cuenta
  en ningún servicio: se levanta con `npm install` y anda.
- **la raíz** — la aplicación que está en producción, sobre Postgres (Neon). Esta rama no la
  modifica; se documenta acá sólo para quien necesite probarla.

---

## La aplicación nueva

Lo único que hace falta es Node 24 o superior. Con Node 22 funciona, pero `node:sqlite` todavía
está marcado como experimental y emite una advertencia en cada arranque.

```bash
cd sistema
npm install
```

En Windows con PowerShell, si la política de ejecución bloquea los scripts, usá `npm.cmd` y
`npx.cmd` en lugar de `npm` y `npx`.

### Las pruebas no necesitan nada más

Antes de levantar el servidor conviene correr esto, que verifica el dominio completo contra bases
temporales y no toca `data/`:

```bash
npm run verify:rules      # 875 comprobaciones de equivalencia con la lógica actual
npm run demo:sqlite
npm run demo:asistencia
npm run demo:identidad
npm run demo:licencias
npm run demo:configuracion
npm run demo:gestion
npm run demo:correcciones
npm run demo:plataforma
npm run demo:cierre
npm run verify:acciones
```

`verify:rules` tiene que terminar en `✓ 875 comprobaciones, todas equivalentes.`

### Configuración

Creá un `sistema/.env.local`:

```
AUTH_SECRET=<cadena aleatoria de al menos 24 caracteres>
DATA_DIR=./data
```

`AUTH_SECRET` deriva los índices de búsqueda de PIN y los hashes de dispositivo. **Si cambia, los
PIN dejan de encontrarse.** Generalo una vez y guardalo. `.env.local` no se versiona.

### Primer arranque

```bash
npm run operador:crear -- --email tu@correo --clave "una contraseña larga"
npm run dev
```

Con eso, en `http://localhost:3000/plataforma` podés crear los niveles desde la pantalla: nombre,
identificador, sede con coordenadas y el primer administrador de cada uno.

Si preferís hacerlo por consola —en un script de instalación, por ejemplo— el equivalente es:

```bash
npm run nivel:crear -- --slug primaria --nombre "Nivel Primario" \
  --sede "Sede central" --lat -27.4692 --lng -58.8306 \
  --admin ana@ejemplo.gob.ar --clave "una contraseña larga"
```

Los dos caminos llaman a la misma función y dan el mismo resultado.

Para probar la marcación hace falta al menos una persona con horario y PIN:

```bash
npm run persona:crear -- --nivel primaria --apellido Gómez --nombre Ana \
  --dni 20111222 --pin 4821 --horario 08:00-14:00 --dias 1-5
```

### Qué mirar

- `http://localhost:3000/plataforma` — alta y baja de niveles
- `http://localhost:3000/primaria` — pantalla pública del QR
- `http://localhost:3000/primaria/ingresar` — acceso al panel
- `http://localhost:3000/primaria/admin` — el panel

**Para probar la marcación desde el celular hace falta HTTPS.** Los navegadores bloquean la
geolocalización fuera de un contexto seguro, así que con `http://192.168.x.x:3000` no vas a poder
marcar. La pantalla lo detecta y lo avisa. Para probar en la computadora alcanza con `localhost`,
que sí cuenta como contexto seguro.

### Un recorrido de prueba

1. En **Personal**, cargá un agente con horario y generale un PIN.
2. En la pantalla pública, escaneá el QR y marcá una entrada.
3. En **Registros**, corregile la hora y fijate que la tardanza se recalcule sola en **Hoy**.
4. En **Licencias**, registrá una de un tipo con tramos —Art. 8 inc. a (30 días con goce y el
   resto sin goce), Art. 12 (20 + 20) o Art. 30 inc. b (6 al año, 2 por mes)— y mirá cómo se
   comporta el tope.
5. En **Sedes**, agregá una segunda y comprobá que la pantalla pública deja elegir entre las dos.

Los archivos de los niveles quedan en `sistema/data/`. Borrar esa carpeta borra todo y se empieza
de cero.

---

## La aplicación en producción

Sólo si hace falta probar el sistema actual. **Esta rama no lo modifica.**

Usa `@neondatabase/serverless`, que habla el protocolo HTTP de Neon: un PostgreSQL local común
**no sirve** sin un proxy intermedio. Lo práctico es crear una base gratuita en
[neon.com](https://neon.com) y copiar la cadena de conexión.

`.env.local` en la raíz del repositorio:

```
DATABASE_URL=postgresql://...
AUTH_SECRET=<cadena larga y aleatoria, mínimo 24 caracteres>
ADMIN_EMAIL=admin@local
ADMIN_PASSWORD=<la que quieras para entrar>
```

```
npm install
npm run dev
```

Entrá a `http://localhost:3000/admin/login` y, ya autenticado, desde la consola del navegador:

```js
await fetch("/api/setup", { method: "POST" }).then((r) => r.json());
```

> **Atención:** `/api/setup` carga el padrón semilla de `lib/seed-employees.ts`, que son agentes
> reales con nombre y DNI. Es uno de los problemas señalados en
> [`ESTADO-DEL-REFACTOR.md`](./ESTADO-DEL-REFACTOR.md). Esos datos quedan en tu base de prueba: no
> la compartas y eliminala cuando termines.
