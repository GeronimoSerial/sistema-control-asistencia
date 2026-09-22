"use client";

import { useCallback, useEffect, useState } from "react";

type QrData = {
  image: string;
  expiresAt: string;
  ttlMinutes: number;
  now: string;
};

/**
 * Exhibe el QR y lo renueva cuando vence.
 *
 * El reloj se calcula contra la hora que informa el servidor y no contra la del navegador: el
 * monitor donde se proyecta esta pantalla puede tener la hora corrida, y la cuenta regresiva
 * quedaría mintiendo.
 */
export default function QrScreen({
  nivel,
  timeZone,
  locale,
  sede,
}: {
  nivel: string;
  timeZone: string;
  locale: string;
  /** Código de la sede cuyo QR se muestra. Sin esto, el servidor usa la sede principal. */
  sede?: string | null;
}) {
  const [qr, setQr] = useState<QrData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [clock, setClock] = useState("");

  const refresh = useCallback(async () => {
    try {
      const url = `/api/${encodeURIComponent(nivel)}/qr${sede ? `?sede=${encodeURIComponent(sede)}` : ""}`;
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "No se pudo generar el código.");
        return;
      }
      setError(null);
      setQr(data as QrData);
      setOffsetMs(new Date(data.now).getTime() - Date.now());
    } catch {
      setError("Sin conexión con el servidor.");
    }
  }, [nivel, sede]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      const serverNow = Date.now() + offsetMs;
      setClock(
        new Intl.DateTimeFormat(locale, {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(new Date(serverNow))
      );
      if (!qr) return;
      const left = Math.max(0, Math.round((new Date(qr.expiresAt).getTime() - serverNow) / 1000));
      setRemaining(left);
      if (left === 0) void refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, [qr, offsetMs, refresh, timeZone, locale]);

  const today = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.now() + offsetMs));

  return (
    <>
      <div className="card center">
        <p className="clock">{clock || "--:--:--"}</p>
        <p className="muted" style={{ marginTop: 4 }}>{today}</p>
      </div>

      {error ? (
        <div className="notice bad">{error}</div>
      ) : (
        <div className="qr-frame">
          {qr ? (
            // El QR ya viene como imagen generada en el servidor.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.image} alt="Código QR para registrar asistencia" />
          ) : (
            <p className="muted">Generando el código…</p>
          )}
        </div>
      )}

      {qr && !error && (
        <div className="center">
          <span className="countdown">
            <span className="dot" aria-hidden="true" />
            Se renueva en {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </span>
        </div>
      )}
    </>
  );
}
