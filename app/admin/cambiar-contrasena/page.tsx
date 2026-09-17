"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function CambiarContrasenaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Las contraseñas no coinciden."); return; }
    setLoading(true);
    const res = await fetch("/api/admin/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password, confirmPassword }) });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(body.error || "No se pudo cambiar la contraseña."); return; }
    router.push(body.redirect || "/admin");
    router.refresh();
  }

  return <main className="mark-shell"><div className="mark-card stack">
    <div><div className="brand-kicker">Dirección de Gestión Escolar</div><h1 className="heading">Cambiar contraseña</h1><p className="subheading">La contraseña utilizada para ingresar es temporal. Definí una nueva contraseña personal para continuar.</p></div>
    <form className="stack" onSubmit={submit}>
      <div><label className="label" htmlFor="password">Nueva contraseña</label><input className="input" id="password" type="password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" /></div>
      <div><label className="label" htmlFor="confirmPassword">Repetir nueva contraseña</label><input className="input" id="confirmPassword" type="password" minLength={8} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" /></div>
      <div className="notice info">La contraseña debe tener al menos 8 caracteres. Una vez modificada, la contraseña temporal deja de ser válida.</div>
      {error&&<div className="notice bad">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading?"Guardando…":"Guardar nueva contraseña"}</button>
    </form>
  </div></main>;
}
