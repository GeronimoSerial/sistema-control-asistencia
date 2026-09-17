# Actualización V1.25.2

## Corrección crítica
Se corrige una excepción del lado del cliente al abrir `/admin` introducida por el buscador del Resumen diario.

### Causa
El hook `useMemo` se ejecutaba únicamente después de que terminaba la carga inicial. En React los hooks deben ejecutarse siempre en el mismo orden en todos los renderizados. La primera renderización no ejecutaba `useMemo` y la siguiente sí, provocando una excepción de cliente.

### Corrección
El filtro del buscador ahora se calcula mediante `useMemo` antes de cualquier retorno condicional y trabaja de forma segura con `data?.rows`.

No cambia la base de datos ni los registros existentes.
