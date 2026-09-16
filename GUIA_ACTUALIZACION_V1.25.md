# Actualización V1.25

## Restablecimiento de contraseñas

- El Administrador puede restablecer la contraseña de cualquier usuario creado desde **Usuarios y permisos**.
- Al restablecerla puede indicar si la nueva clave es temporal y debe cambiarse en el próximo ingreso.
- Los usuarios nuevos pueden quedar configurados para cambiar obligatoriamente la contraseña inicial.
- Cuando el cambio es obligatorio, el usuario no puede acceder a los módulos del sistema hasta definir su nueva contraseña.
- La contraseña anterior queda invalidada inmediatamente.
- Se registra en auditoría el restablecimiento y el cambio, pero nunca el texto de la contraseña.
- En la pantalla de acceso se agregó **Olvidé mi contraseña**, con instrucciones para solicitar el restablecimiento al Administrador.
- La cuenta administradora principal configurada mediante `ADMIN_EMAIL` / `ADMIN_PASSWORD` continúa recuperándose desde Vercel y no desde este mecanismo.

## Compatibilidad

La migración agrega automáticamente `must_change_password` a `app_users`; los usuarios existentes quedan con el valor `FALSE`, por lo que no cambia su acceso actual.
