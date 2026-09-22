"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Coordinates = { lat: number; lng: number; accuracy?: number | null };

type StatusResponse = {
  person: { name: string; nationalId: string };
  action: "ENTRY" | "EXIT" | "REENTRY" | null;
  actionLabel: string | null;
  blocked: string | null;
  schedule: { start: string; end: string } | null;
  day: { entry: string; exit: string; lateMinutes: number } | null;
  distanceMeters: number | null;
};

type SubmitResponse = {
  title: string;
  person: string;
  entry: string;
  exit: string;
  lateMinutes: number;
  deviceBoundNow: boolean;
};

const DEVICE_STORAGE_KEY = "asistencia_dispositivo_v1";

/**
 * Identificador estable del teléfono.
 *
 * Se guarda en el navegador y sirve para que una persona marque siempre desde el mismo aparato.
 * Si el almacenamiento no está disponible —modo privado, por ejemplo— se genera uno por sesión:
 * la marcación funciona igual, pero el aparato queda sin vincular hasta que se pueda guardar.
 */
function deviceKey(): string {
  const generate = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  try {
    const stored = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (stored && stored.length >= 16) return stored;
    const created = generate();
    localStorage.setItem(DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    return generate();
  }
}

export default function MarkClient({ nivel, token }: { nivel: string; token: string }) {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(true);
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [done, setDone] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const device = useRef<string>("");

  useEffect(() => {
    device.current = deviceKey();
  }, []);

  const locate = useCallback(() => {
    setLocating(true);
    setError(null);

    // Los navegadores bloquean la geolocalización fuera de un contexto seguro. Conviene decirlo
    // con claridad: si no, la pantalla parece rota sin motivo aparente.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setLocating(false);
      setError(
        "Esta página tiene que abrirse por HTTPS para poder leer la ubicación. Avisá en Administración."
      );
      return;
    }
    if (!navigator.geolocation) {
      setLocating(false);
      setError("Este navegador no permite compartir la ubicación.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setLocating(false);
      },
      (positionError) => {
        setLocating(false);
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Necesitamos tu ubicación para registrar la marcación. Habilitala y volvé a intentar."
            : "No se pudo obtener tu ubicación. Probá de nuevo cerca de una ventana."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (token) locate();
    else setLocating(false);
  }, [token, locate]);

  async function post<T>(path: string, body: unknown): Promise<T | null> {
    const response = await fetch(`/api/${encodeURIComponent(nivel)}/mark/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "No se pudo completar la operación.");
      return null;
    }
    setError(null);
    return data as T;
  }

  async function identify(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await post<StatusResponse>("status", {
      token,
      pin,
      deviceKey: device.current,
      coordinates,
    });
    if (result) setStatus(result);
    setBusy(false);
  }

  async function confirm() {
    if (busy || !status?.action) return;
    setBusy(true);
    const result = await post<SubmitResponse>("submit", {
      token,
      pin,
      deviceKey: device.current,
      coordinates,
      action: status.action,
    });
    if (result) {
      setDone(result);
      setPin("");
    }
    setBusy(false);
  }

  /* ---------------- Pantallas ---------------- */

  if (!token) {
    return (
      <div className="notice bad">
        Falta el código. Escaneá el QR desde la pantalla de la oficina.
      </div>
    );
  }

  if (done) {
    return (
      <>
        <div className="notice ok">
          <strong>{done.title}</strong>
          <br />
          {done.person}
        </div>
        <div className="card rows">
          <div className="row"><span>Entrada</span><span>{done.entry}</span></div>
          <div className="row"><span>Salida</span><span>{done.exit}</span></div>
          {done.lateMinutes > 0 && (
            <div className="row"><span>Tardanza computada</span><span>{done.lateMinutes} min</span></div>
          )}
        </div>
        {done.deviceBoundNow && (
          <div className="notice warn">
            Este teléfono quedó vinculado a tu legajo. De ahora en más vas a marcar desde acá.
          </div>
        )}
        <p className="muted center">Ya podés cerrar esta pantalla.</p>
      </>
    );
  }

  if (locating) {
    return (
      <div className="card center">
        <p className="muted" style={{ margin: 0 }}>Obteniendo tu ubicación…</p>
      </div>
    );
  }

  if (!coordinates) {
    return (
      <>
        {error && <div className="notice bad">{error}</div>}
        <button onClick={locate}>Reintentar</button>
      </>
    );
  }

  if (status) {
    return (
      <>
        <div className="card">
          <h2 style={{ marginBottom: 2 }}>{status.person.name}</h2>
          <p className="muted" style={{ marginTop: 0 }}>Documento {status.person.nationalId}</p>
          {status.schedule && (
            <p className="muted" style={{ margin: 0 }}>
              Horario de hoy: {status.schedule.start} a {status.schedule.end}
            </p>
          )}
        </div>

        {status.blocked ? (
          <div className="notice warn">{status.blocked}</div>
        ) : (
          <>
            {status.day?.entry && status.day.entry !== "—" && (
              <div className="card rows">
                <div className="row"><span>Entrada registrada</span><span>{status.day.entry}</span></div>
                {status.day.lateMinutes > 0 && (
                  <div className="row"><span>Tardanza</span><span>{status.day.lateMinutes} min</span></div>
                )}
              </div>
            )}
            {error && <div className="notice bad">{error}</div>}
            <button onClick={confirm} disabled={busy}>
              {busy ? "Registrando…" : status.actionLabel}
            </button>
          </>
        )}

        <button
          className="secondary"
          onClick={() => { setStatus(null); setPin(""); setError(null); }}
        >
          Volver
        </button>
      </>
    );
  }

  return (
    <form onSubmit={identify}>
      <div className="card">
        <label htmlFor="pin">Ingresá tu PIN</label>
        <input
          id="pin"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="••••"
        />
      </div>
      {error && <div className="notice bad">{error}</div>}
      <button type="submit" disabled={busy || pin.length < 4} style={{ marginTop: 14 }}>
        {busy ? "Verificando…" : "Continuar"}
      </button>
    </form>
  );
}
