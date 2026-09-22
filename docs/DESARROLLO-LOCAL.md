# Levantar el sistema en local

Para probar el refactor sin depender del despliegue de producción. Todo queda en tu máquina y en
una base de datos propia.

## 1. Base de datos

El proyecto usa `@neondatabase/serverless`, que habla el protocolo HTTP de Neon. Un PostgreSQL
local común **no sirve** sin un proxy intermedio, así que lo práctico es crear una base gratuita
en [neon.com](https://neon.com): cuenta, proyecto nuevo, y copiar la cadena de conexión que
ofrece (la que empieza con `postgresql://` e incluye `?sslmode=require`).

## 2. Variables de entorno

Creá un archivo `.env.local` en la raíz del repositorio:

```
DATABASE_URL=postgresql://...
AUTH_SECRET=<cadena larga y aleatoria, mínimo 24 caracteres>
ADMIN_EMAIL=admin@local
ADMIN_PASSWORD=<la que quieras para entrar>
SETUP_TOKEN=<cadena larga y aleatoria, mínimo 24 caracteres>
DEFAULT_ORGANIZATION_SLUG=dge
```

`.env.local` está en `.gitignore` y no debe versionarse nunca.

## 3. Arrancar

```
npm install
npm run dev
```

En Windows con PowerShell, si la política de ejecución bloquea los scripts, usá `npm.cmd` y
`npx.cmd` en lugar de `npm` y `npx`.

## 4. Inicializar el esquema anterior

Entrá a `http://localhost:3000/admin/login` con el `ADMIN_EMAIL` y el `ADMIN_PASSWORD` que
pusiste. Ya autenticado, abrí la consola del navegador (F12) y ejecutá:

```js
await fetch("/api/setup", { method: "POST" }).then((r) => r.json());
```

Eso crea las tablas del sistema actual.

> **Atención:** `/api/setup` carga el padrón semilla que está en `lib/seed-employees.ts`, que son
> agentes reales con nombre y DNI. Es una de las cosas que el refactor tiene que sacar del
> repositorio. Mientras tanto, esos datos quedan en tu base de prueba: no la compartas y
> eliminala cuando termines.

## 5. Instalar el organismo

Desde PowerShell, con el mismo `SETUP_TOKEN` del `.env.local`:

```powershell
$token = "<el SETUP_TOKEN>"
$body  = @{ slug = "dge"; name = "Dirección de Gestión Escolar" } | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/platform/install" `
  -Headers @{ "x-setup-token" = $token } `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

El `GetBytes` evita que los acentos lleguen mal codificados.

La respuesta indica qué migraciones se aplicaron, el organismo creado y cuántos tipos de
ausencia, tramos de cuota, escalas y roles quedaron instalados.

## 6. Verificar

1. En **Administración → Personal**, cargá un agente de prueba (o usá uno del padrón semilla) y
   asignale una fecha de antigüedad.
2. En **Novedades**, elegí ese agente y un tipo de licencia con tramos: Art. 8 inc. a (30 días con
   goce y el resto sin goce), Art. 12 (20 + 20) o Art. 30 inc. b (6 al año, 2 por mes).
3. Registrá algunos días y mirá el recuadro de saldo.

Para confirmar qué motor respondió, mirá el campo `source` de la respuesta:

```js
await fetch("/api/admin/leave-balance?employeeId=XXX&leaveTypeId=1&date=2026-09-22")
  .then((r) => r.json());
```

- `source: "RULES"` → está calculando el motor declarativo.
- `source: "LEGACY"` → el organismo no está instalado o falta `DEFAULT_ORGANIZATION_SLUG`.

## 7. Comprobación de equivalencia

Independiente de la base, verifica que el modelo declarativo da los mismos números que la lógica
anterior:

```
npm run verify:rules
```

Tiene que terminar en `✓ 875 comprobaciones, todas equivalentes.`
