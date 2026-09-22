# `core/` — núcleo agnóstico

Regla única: **nada en `core/` puede saber de un organismo concreto.** Ni "Corrientes", ni
"docente", ni "Art. 8", ni una zona horaria, ni un número de días. Si aparece una de esas cosas
aquí, va en un rule pack (`packs/`) o en una tabla de configuración.

| Módulo | Reemplaza a | Qué resuelve |
|---|---|---|
| `platform/time.ts` | `lib/time.ts` | Zona horaria por organización. Corrige además el offset `-03:00` concatenado, que fallaba en zonas con horario de verano. |
| `platform/db.ts` | `lib/db.ts` | Único punto de contacto con el driver. |
| `config/definitions.ts` | columnas de `office_settings` | Registro tipado de parámetros. El formulario de configuración se genera desde acá. |
| `config/settings.ts` | — | Resolución sede → organización → valor por defecto. |
| `tenancy/` | `CHECK (id = 1)` | Organizaciones y contexto por request. |
| `absence/quota.ts` | los `if (code === "ART8A")` de `leave-balance` | Cuotas por tramos, como datos. |
| `absence/entitlement.ts` | `baseDays()` / `entitlement()` de `vacation-status` | Escalas por antigüedad con prorrateo. |
| `attendance/policy.ts` | la regla de tardanza duplicada en `lib/attendance.ts` y `records/route.ts` | Política declarativa, en un solo lugar. |
| `migrations/` | `ensureV13Schema()` | Migraciones versionadas que corren una vez y no pisan configuración. |

## Verificación

```
npm run verify:rules
```

Reimplementa la lógica vieja tal cual y comprueba que el modelo declarativo, alimentado por
`packs/ar-corrientes-dge/pack.json`, da los mismos números. Cualquier cambio en los evaluadores
tiene que seguir pasando esas comprobaciones.

## Qué ya está conectado

| Endpoint | Estado |
|---|---|
| `POST /api/platform/install` | Corre las migraciones, da de alta el organismo y aplica el pack. Protegido con `SETUP_TOKEN`. |
| `GET /api/admin/leave-balance` | Usa `absence/quota.ts`. Cae en el catálogo viejo si el organismo no fue instalado (`source: "LEGACY"`). |
| `GET/POST /api/admin/vacation-status` | Usa `absence/entitlement.ts`, con el mismo respaldo. |
| `lib/attendance.ts` y `records/route.ts` | Usan `attendance/policy.ts`. Las tres copias de la regla de tardanza quedaron en una. |

Cada camino nuevo tiene respaldo al comportamiento anterior, así que desplegar sin correr la
instalación no cambia nada. El campo `source` de las respuestas dice qué motor contestó.

## Lo que todavía no está conectado

La marca sigue escrita en las pantallas y las tablas de dominio todavía no tienen
`organization_id`. El orden de las fases está en
[`docs/REFACTOR-AGNOSTICO.md`](../docs/REFACTOR-AGNOSTICO.md); lo hecho aquí cubre las fases 0 y 1
y adelanta el modelo de datos de las fases 2, 4 y 5. Falta la migración `0002`, que agrega
`organization_id` a las tablas de dominio y hace el backfill — es la única con riesgo de pérdida
de datos y requiere respaldo verificado y ensayo sobre una copia.
