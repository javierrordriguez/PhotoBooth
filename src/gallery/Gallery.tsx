import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { zip } from "fflate";
import { download } from "../shared/download";
import { validGuestToken } from "../../supabase/functions/_shared/guest";
type Picture = { position: number; size: number; url: string };
type Result = {
  state: string;
  name?: string;
  date?: string;
  urlsExpireAt?: string;
  photos?: Picture[];
};
const messages: Record<string, string> = {
  preparing:
    "Estamos preparando tus fotos. Esta página se actualizará automáticamente.",
  invalid: "Este enlace no es válido. Pedile ayuda al organizador.",
  revoked: "El organizador desactivó este enlace.",
  expired: "Este enlace venció. Contactá al organizador.",
  limited: "Hay muchas solicitudes. Esperá un minuto y reintentá.",
  temporarily_unavailable: "No pudimos conectar. Revisá Internet y reintentá.",
};
export async function getGallery(
  token: string,
  signal?: AbortSignal,
): Promise<Result> {
  if (!validGuestToken(token)) return { state: "invalid" };
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/guest-gallery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    },
  );
  const result = (await response.json()) as Result;
  if (
    result.state === "ready" &&
    (!Array.isArray(result.photos) || result.photos.length !== 5)
  )
    throw new Error("Invalid response");
  if (
    !response.ok &&
    !["invalid", "limited", "expired", "revoked"].includes(result.state)
  )
    throw new Error("Unavailable");
  return result;
}
const filename = (position: number) =>
  position === 0 ? "tira.jpg" : `foto-${position}.jpg`;
export function Gallery() {
  const { token = "" } = useParams();
  return <GallerySession key={token} token={token} />;
}
function GallerySession({ token }: { token: string }) {
  const [result, setResult] = useState<Result>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const load = async () => {
      try {
        const value = await getGallery(token, abort.signal);
        if (!active) return;
        setResult(value);
        if (value.state === "preparing")
          timer = setTimeout(() => void load(), 10000);
        if (value.state === "limited")
          timer = setTimeout(() => void load(), 60000);
        // Clear private URLs and reauthorize before their expiry; also catches revocation.
        if (value.state === "ready")
          timer = setTimeout(() => {
            setResult({ state: "loading" });
            void load();
          }, 90000);
      } catch {
        if (active) setResult({ state: "temporarily_unavailable" });
      }
    };
    void load();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [token, attempt]);
  async function save(position?: number) {
    setBusy(true);
    setError("");
    try {
      const fresh = await getGallery(token);
      setResult(fresh);
      if (fresh.state !== "ready" || !fresh.photos) return;
      const selected =
        position === undefined
          ? fresh.photos
          : fresh.photos.filter((p) => p.position === position);
      const files: Record<string, Uint8Array> = {};
      for (const p of selected) {
        const response = await fetch(p.url, {
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error("Download failed");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== p.size) throw new Error("Incomplete download");
        files[filename(p.position)] = bytes;
      }
      if (position !== undefined)
        download(
          new Blob([new Uint8Array(files[filename(position)]!)], {
            type: "image/jpeg",
          }),
          filename(position),
        );
      else {
        const blob = await new Promise<Blob>((resolve, reject) =>
          zip(files, { level: 0 }, (err, data) =>
            err
              ? reject(err)
              : resolve(
                  new Blob([new Uint8Array(data)], { type: "application/zip" }),
                ),
          ),
        );
        download(blob, "recuerdos-tami.zip");
      }
    } catch {
      setError("La descarga no se completó. Volvé a intentarlo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="guest-gallery">
      <header>
        <span className="eyebrow">UN RECUERDO DE MIS QUINCE</span>
        <h1>{result.name || "Tami"}</h1>
        <p>Tus fotos, tu noche ✦</p>
      </header>
      {result.state === "ready" ? (
        <>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Preparando descarga…" : "Descargar mis cinco imágenes"}
          </button>
          <div className="guest-photos">
            {result.photos?.map((p) => (
              <figure
                key={p.position}
                className={p.position === 0 ? "guest-strip" : ""}
              >
                <img
                  src={p.url}
                  referrerPolicy="no-referrer"
                  alt={
                    p.position === 0
                      ? "Tu tira fotográfica"
                      : `Tu foto ${p.position}`
                  }
                  onError={() =>
                    setError(
                      "Una imagen venció o no pudo cargar. Pulsá Actualizar.",
                    )
                  }
                />
                <figcaption>
                  <span>
                    {p.position === 0 ? "Tu tira" : `Foto ${p.position}`}
                  </span>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void save(p.position)}
                  >
                    Descargar
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      ) : (
        <section className="guest-message" role="status">
          <h2>
            {result.state === "loading"
              ? "Abriendo tu recuerdo…"
              : result.state === "preparing"
                ? "Ya casi están"
                : "Tu galería"}
          </h2>
          <p>{messages[result.state] || ""}</p>
        </section>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() => {
          setError("");
          setResult({ state: "loading" });
          setAttempt((x) => x + 1);
        }}
      >
        Actualizar
      </button>
      <footer>
        Este enlace es privado. Cualquier persona con el enlace puede ver las
        fotos.
      </footer>
    </main>
  );
}
