"use client";

import { useActionState } from "react";
import { ingresar, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginForm({ nivel }: { nivel: string }) {
  const [state, formAction, pending] = useActionState(ingresar, initialState);

  return (
    <form action={formAction}>
      <div className="card">
        <input type="hidden" name="nivel" value={nivel} />
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            style={{ textAlign: "left", letterSpacing: "normal", fontSize: 16 }}
          />
        </div>
        <div>
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            style={{ textAlign: "left", letterSpacing: "normal", fontSize: 16 }}
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
