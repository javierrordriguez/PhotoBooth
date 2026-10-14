import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../persistence/db";
import { supabase, syncApi, projectUrl, configError } from "./client";
import { adoptLocal, retryJobs, startSync } from "./engine";
import type { Binding, SyncJob } from "./types";
import { ApiError } from "../../supabase/functions/_shared/protocol";
const messages: Record<string, string> = {
  authentication_required: "Iniciá sesión con el usuario de la laptop.",
  operation_forbidden:
    "Dispositivo deshabilitado, sesión revocada/vencida o usuario no autorizado.",
  binding_mismatch: "Esta sesión pertenece a otro dispositivo o evento.",
  project_mismatch: "La sesión pertenece a otro proyecto Supabase.",
  invalid_manifest:
    "Archivo fuera de los límites: JPEG de hasta 12 MiB y 12 megapíxeles.",
  invalid_jpeg:
    "El servidor no pudo validar el JPEG. Conservá el respaldo local.",
  content_mismatch: "El contenido no coincide con el manifiesto guardado.",
  storage_conflict:
    "El objeto remoto no coincide. Requiere revisión del operador.",
  session_conflict:
    "La sesión remota está incompleta o tiene un manifiesto diferente.",
  session_limit: "Se alcanzó el límite de sesiones del dispositivo.",
  network_or_storage_error:
    "Error de red o almacenamiento. Se reintentará automáticamente.",
  rate_limited:
    "Límite temporal de solicitudes. Se reintentará automáticamente.",
  local_content_changed:
    "Los archivos locales cambiaron. No se sustituirán fotos remotas.",
};
export function syncMessage(code?: string) {
  return code
    ? (messages[code] ??
        "No se pudo sincronizar. Revisá la conexión y la configuración del dispositivo.")
    : "";
}
function useJobs() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.syncJobs.toArray()).subscribe({
      next: setJobs,
      error: () => {},
    });
    return () => sub.unsubscribe();
  }, []);
  return jobs;
}
export function SyncMonitor({ sessionId }: { sessionId?: string }) {
  const jobs = useJobs();
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setAuthenticated(Boolean(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setAuthenticated(Boolean(session)),
    );
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (authenticated) return startSync(syncApi);
  }, [authenticated]);
  const current = jobs.find((j) => j.sessionId === sessionId);
  const pending = jobs.filter((j) => j.state !== "synced").length;
  if (!supabase)
    return (
      <div className="sync-banner">
        {configError ||
          "Sincronización sin configurar · tus fotos se conservan en esta laptop."}
      </div>
    );
  return (
    <div className="sync-banner" role="status">
      {current?.state === "synced"
        ? "✓ Cinco archivos confirmados en Supabase."
        : current?.state === "syncing"
          ? `Sincronizando sesión · ${current.uploaded.length}/5 archivos`
          : current?.error
            ? syncMessage(current.error)
            : !authenticated
              ? "Sincronización pausada · conectá el dispositivo en Configuración."
              : `${pending} sesiones pendientes · las copias locales se conservan.`}
    </div>
  );
}
export function DevicePanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [binding, setBinding] = useState<Binding>();
  const [unbound, setUnbound] = useState(0);
  const jobs = useJobs();
  useEffect(() => {
    const sub = liveQuery(async () => ({
      active: (await db.connection.get("active"))?.binding,
      unbound: (
        await db.sessions.where("status").equals("pending").toArray()
      ).filter((s) => !s.binding).length,
    })).subscribe({
      next: (x) => {
        setBinding(x.active);
        setUnbound(x.unbound);
      },
      error: () => setError("No se pudo leer el almacenamiento local."),
    });
    return () => sub.unsubscribe();
  }, []);
  async function connect() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setPassword("");
      if (error)
        throw new Error(
          "No se pudo iniciar sesión. Revisá las credenciales del dispositivo.",
        );
      const c = await syncApi.context();
      const value = {
        projectUrl,
        deviceId: c.deviceId,
        eventId: c.eventId,
        eventName: c.eventName,
      };
      await db.connection.put({ id: "active", binding: value });
      await retryJobs();
    } catch (e) {
      setPassword("");
      setError(
        e instanceof ApiError
          ? syncMessage(e.code)
          : e instanceof Error
            ? e.message
            : "Error de conexión.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await db.connection.delete("active");
      await supabase?.auth.signOut({ scope: "local" });
    } catch {
      setError("No se pudo desconectar. Reintentá.");
    } finally {
      setBusy(false);
    }
  }
  async function adopt() {
    if (!binding) return;
    setBusy(true);
    setError("");
    try {
      const c = await syncApi.context();
      if (c.deviceId !== binding.deviceId || c.eventId !== binding.eventId)
        throw new ApiError(403, "binding_mismatch");
      await adoptLocal(binding);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? syncMessage(e.code)
          : "No se pudieron vincular las sesiones.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="device-panel">
      <legend>Dispositivo y sincronización</legend>
      {!supabase ? (
        <p className="small">
          {configError ||
            "Agregá VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env.local y reiniciá la aplicación. El modo local sigue disponible."}
        </p>
      ) : (
        <>
          {binding && (
            <p className="small">
              Vinculado a <strong>{binding.eventName}</strong> · dispositivo{" "}
              {binding.deviceId.slice(0, 8)}. Las nuevas sesiones conservarán
              esta vinculación.
            </p>
          )}
          <p className="small">
            Usá la cuenta exclusiva de la laptop, registrada y habilitada por el
            organizador.
          </p>
          <label>
            Correo del dispositivo
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Contraseña del dispositivo
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={busy || !email || !password}
            onClick={() => void connect()}
          >
            Conectar dispositivo
          </button>
          {binding && (
            <>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Desconectar esta laptop
              </button>
              {unbound > 0 && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void adopt()}
                >
                  Vincular y subir {unbound} sesiones locales a{" "}
                  {binding.eventName}
                </button>
              )}
            </>
          )}
          <p className="small">
            {jobs.filter((j) => j.state === "synced").length} sincronizadas ·{" "}
            {jobs.filter((j) => j.state !== "synced").length} pendientes. Los
            archivos locales no se borran.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void retryJobs().catch(() =>
                setError("No se pudo reactivar la cola."),
              )
            }
          >
            Reintentar pendientes
          </button>
          {jobs
            .filter((j) => j.error)
            .slice(0, 5)
            .map((j) => (
              <p key={j.sessionId} className="small">
                {j.sessionId.slice(0, 8)}: {syncMessage(j.error)}
              </p>
            ))}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
