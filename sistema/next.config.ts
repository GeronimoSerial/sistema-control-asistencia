import type { NextConfig } from "next";

/**
 * Este sistema se sirve desde un servidor propio, no desde una plataforma sin estado: la base es
 * un archivo en disco y tiene que sobrevivir entre peticiones.
 */
const nextConfig: NextConfig = {
  // Genera una carpeta autocontenida en .next/standalone que se copia al servidor y se ejecuta
  // con `node server.js`, sin necesidad de instalar dependencias ahí.
  output: "standalone",

  // `node:sqlite` es un módulo nativo de Node: no debe pasar por el empaquetador.
  serverExternalPackages: ["node:sqlite"],

  // Las pantallas de marcación no deben quedar cacheadas por un proxy intermedio.
  async headers() {
    return [
      {
        source: "/:nivel/marcar",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
