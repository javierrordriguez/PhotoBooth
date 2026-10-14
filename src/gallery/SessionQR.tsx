import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { QRCodeSVG } from "qrcode.react";
import { db } from "../persistence/db";
import { syncApi } from "../sync/client";
import { galleryOrigin, registerLink } from "./links";
export function SessionQR({ sessionId }: { sessionId: string }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const origin = galleryOrigin(import.meta.env.VITE_GALLERY_ORIGIN);
  useEffect(() => {
    setToken("");
    setError("");
    let alive = true;
    const sub = liveQuery(async () => ({
      link: await db.guestLinks.get(sessionId),
      job: await db.syncJobs.get(sessionId),
    })).subscribe({
      next: ({ link, job }) => {
        if (link?.registered) setToken(link.token);
        else if (job?.state === "synced")
          void registerLink(sessionId, job.binding, syncApi).catch(() => {
            if (alive)
              setError(
                "No se pudo preparar el enlace. Volvé a abrir la sesión para reintentar.",
              );
          });
      },
      error: () => setError("No se pudo leer el enlace local."),
    });
    return () => {
      alive = false;
      sub.unsubscribe();
    };
  }, [sessionId]);
  if (!origin)
    return (
      <p className="small">
        La galería necesita una dirección HTTPS configurada para mostrar el QR.
      </p>
    );
  if (!token)
    return (
      <p className="small" role="status">
        {error ||
          "Preparando tu enlace privado. Necesitamos conexión para registrarlo."}
      </p>
    );
  const url = `${origin}/s/${token}`;
  return (
    <section className="session-qr">
      <QRCodeSVG
        value={url}
        size={224}
        level="M"
        marginSize={4}
        title="QR de tu galería privada"
      />
      <p>Escaneá para llevarte tus fotos.</p>
      <a href={url} target="_blank" rel="noreferrer">
        Abrir mi galería
      </a>
      <p className="small">
        Este enlace da acceso a tus fotos. Compartilo solo con quien quieras.
      </p>
    </section>
  );
}
