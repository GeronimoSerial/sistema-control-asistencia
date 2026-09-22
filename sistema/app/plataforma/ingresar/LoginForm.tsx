"use client";

import { useActionState } from "react";
import { ingresarPlataforma } from "./actions";

const inicial = { error: null as string | null };
const campo = { textAlign: "left" as const, letterSpacing: "normal", fontSize: 16 };

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(ingresarPlataforma, inicial);

  return (
    <form action={formAction}>
      <div className="card">
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus style={campo} />
        </div>
        <div>
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            style={campo}
          />
        </div>
      </div>
      {state.error && <div className="notice bad" style={{ marginTop: 14 }}>{state.error}</div>}
      <button type="submit" disabled={pending} style={{ marginTop: 14 }}>
        {pending ? "Verificando…" : "Ingresar"}
      </button>
    </form>
  );
}
