# Actualización V1.23 — Permisos múltiples por usuario

## Objetivo
La V1.23 reemplaza el esquema operativo de un único rol por usuario por un sistema de permisos múltiples.

## Cambios
- Un mismo usuario puede tener simultáneamente **Operador de Licencias** y **Operador de Asistencia**.
- En **Usuarios y permisos** el Administrador puede editar los permisos de cualquier usuario activo o inactivo.
- Los cambios de permisos se aplican en la siguiente acción del usuario, incluso si ya tenía una sesión iniciada.
- Los usuarios existentes conservan automáticamente sus capacidades anteriores al migrar a V1.23.
- El modelo queda preparado para agregar nuevos permisos en versiones futuras.
- La cuenta Administradora mantiene acceso total y es la única que puede administrar usuarios y permisos.

## Permisos disponibles en esta versión
- `LICENSES`: Operador de Licencias.
- `ATTENDANCE`: Operador de Asistencia.

## Despliegue
Subir el contenido completo de la versión al repositorio y esperar la compilación de Vercel. La migración de base de datos se ejecuta automáticamente al iniciar el esquema.
