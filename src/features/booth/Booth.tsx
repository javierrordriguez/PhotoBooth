import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaults,
  transition,
  validateSettings,
  type Settings,
  type Photo,
  type Session,
  type Phase,
} from "../../sessions/model";
import {
  db,
  createDraft,
  saveOriginal,
  confirmSession,
  discardDraft,
  storageError,
} from "../../persistence/db";
import {
  openCamera,
  stopCamera,
  capture,
  delay,
  cameraError,
} from "../../camera/camera";
import { compose } from "../../composition/strip";
import { backup, download, photoName } from "../../shared/download";
import { PhotoImage } from "../../shared/PhotoImage";
import { DevicePanel, SyncMonitor } from "../../sync/SyncPanel";
import {SessionQR} from '../../gallery/SessionQR';

export function Booth() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [form, setForm] = useState<Settings>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>("welcome");
  const phaseRef = useRef<Phase>("welcome");
  const [session, setSession] = useState<Session | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const [strip, setStrip] = useState<Photo | null>(null);
  const [count, setCount] = useState(3);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [cameraRetry, setCameraRetry] = useState(0);
  const [panel, setPanel] = useState<"settings" | "library" | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [exporting, setExporting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [storageInfo, setStorageInfo] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const move = useCallback((next: Phase) => {
    phaseRef.current = transition(phaseRef.current, next);
    setPhase(next);
  }, []);
  const cameraActive =
    phase === "welcome" || phase === "countdown" || phase === "capturing";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    db.settings
      .get("event")
      .then((s) => {
        if (alive) {
          const v = s ? validateSettings(s.value) : defaults;
          setSettings(v);
          setForm(v);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive)
          setError("No se pudo abrir el almacenamiento: " + storageError(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!cameraActive) return;
    let disposed = false;
    let stream: MediaStream | null = null;
    setReady(false);
    void openCamera(deviceId || undefined)
      .then(async (s) => {
        if (disposed) {
          stopCamera(s);
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play();
        }
        if (disposed) return;
        setReady(true);
        setDevices(
          (await navigator.mediaDevices.enumerateDevices()).filter(
            (d) => d.kind === "videoinput",
          ),
        );
      })
      .catch((e) => {
        if (!disposed) {
          setError(cameraError(e));
          setReady(false);
        }
      });
    const changed = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => {
          if (!disposed) setDevices(d.filter((x) => x.kind === "videoinput"));
        })
        .catch(() => {});
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => {
      disposed = true;
      stopCamera(stream);
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    };
  }, [cameraActive, deviceId, cameraRetry]);
  const reset = useCallback(() => {
    controller.current?.abort();
    setSession(null);
    setPhotos([]);
    photosRef.current = [];
    setStrip(null);
    setError("");
    setNotice("");
    setPanel(null);
    if (phaseRef.current !== "welcome") move("welcome");
  }, [move]);
  useEffect(() => {
    if (phase !== "done" || exporting) return;
    setRemaining(settings.returnAfter);
    const interval = setInterval(
      () => setRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    const timeout = setTimeout(reset, settings.returnAfter * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [phase, settings.returnAfter, reset, exporting]);

  async function start() {
    if (lock.current || !ready || !loaded) return;
    lock.current = true;
    setError("");
    setNotice("");
    setPhotos([]);
    photosRef.current = [];
    setStrip(null);
    setSession(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const s = await createDraft(settings);
      if (!mounted.current) return;
      setSession(s);
      move("countdown");
      for (let position = 1; position <= 4; position++) {
        if (position > 1) {
          setCount(3);
          move("countdown");
          await delay(settings.interval * 1000, abort.signal);
        }
        for (let n = 3; n > 0; n--) {
          setCount(n);
          await delay(1000, abort.signal);
        }
        move("capturing");
        const p = await capture(video.current!, s.id, position);
        if (!mounted.current) return;
        if (abort.signal.aborted)
          throw new DOMException("Cancelado", "AbortError");
        photosRef.current = [...photosRef.current, p];
        setPhotos(photosRef.current);
        await saveOriginal(p);
      }
      move("review");
    } catch (e) {
      if (mounted.current) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setError(storageError(e));
        if (
          phaseRef.current === "countdown" ||
          phaseRef.current === "capturing"
        )
          move(photosRef.current.length ? "review" : "welcome");
      }
    } finally {
      lock.current = false;
    }
  }
  async function confirm() {
    if (!session || photos.length !== 4 || lock.current) return;
    lock.current = true;
    setError("");
    move("saving");
    try {
      for (const p of photos) await saveOriginal(p);
      const result = await compose(photos, session.settings);
      await confirmSession(session.id, result);
      if (!mounted.current) return;
      setStrip(result);
      setSession({ ...session, status: "pending" });
      move("done");
    } catch (e) {
      if (mounted.current) {
        setError(storageError(e));
        move("review");
      }
    } finally {
      lock.current = false;
    }
  }
  async function repeat() {
    if (lock.current) return;
    lock.current = true;
    try {
      if (session) await discardDraft(session.id);
      reset();
    } catch (e) {
      setError(storageError(e));
    } finally {
      lock.current = false;
    }
  }
  async function openPanel(which: "settings" | "library") {
    setError("");
    try {
      if (which === "library")
        setSessions(await db.sessions.orderBy("createdAt").reverse().toArray());
      else {
        setForm(settings);
        const estimate = await navigator.storage?.estimate();
        const persistent = await navigator.storage?.persisted();
        setStorageInfo(
          `${estimate?.usage ? Math.ceil(estimate.usage / 1024 / 1024) : 0} MB utilizados · almacenamiento ${persistent ? "persistente" : "no garantizado"}`,
        );
      }
      setPanel(which);
    } catch (e) {
      setError(storageError(e));
    }
  }
  async function saveSettings() {
    try {
      const value = validateSettings(form);
      await db.settings.put({ id: "event", value });
      setSettings(value);
      setPanel(null);
      setNotice("Configuración guardada en esta laptop.");
    } catch (e) {
      setError(storageError(e));
    }
  }
  async function recover(s: Session) {
    if (lock.current) return;
    lock.current = true;
    try {
      const all = await db.photos
        .where("sessionId")
        .equals(s.id)
        .sortBy("position");
      const originals = all.filter((p) => p.type === "original");
      setSession(s);
      setPhotos(originals);
      photosRef.current = originals;
      setStrip(all.find((p) => p.type === "strip") ?? null);
      setPanel(null);
      setError("");
      move("review");
      if (s.status === "pending") {
        move("saving");
        move("done");
      }
    } catch (e) {
      setError(storageError(e));
    } finally {
      lock.current = false;
    }
  }
  async function exportSessions(all = false) {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const chosen = all
        ? await db.sessions.toArray()
        : session
          ? [session]
          : [];
      if (!chosen.length)
        throw new Error("Todavía no hay sesiones para exportar.");
      const saved = all
        ? await db.photos.toArray()
        : [...photos, ...(strip ? [strip] : [])];
      download(
        await backup(chosen, saved),
        all ? "tami-respaldo-local.zip" : `tami-${session!.id}.zip`,
      );
    } catch (e) {
      setError(storageError(e));
    } finally {
      setExporting(false);
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Este navegador no permite pantalla completa. Podés usar F11.");
    }
  }
  const busy =
    phase === "countdown" || phase === "capturing" || phase === "saving";
  return (
    <div className="app-shell">
      <SyncMonitor sessionId={session?.id} />
      <header className="topbar">
        <a className="brand" href="/booth" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">✦</span>
          <span>
            tami<span className="brand-caption">PHOTO BOOTH</span>
          </span>
        </a>
        <div className="top-actions">
          <span className="local-badge">
            <i /> Cabina Tami
          </span>
          <button
            className="icon-button"
            onClick={() => void fullscreen()}
            title="Pantalla completa"
            aria-label="Pantalla completa"
          >
            ⛶
          </button>
          {phase === "welcome" && (
            <button
              className="text-button"
              onClick={() => void openPanel("settings")}
            >
              Configuración
            </button>
          )}
        </div>
      </header>
      <main className="main-grid">
        <section className="intro">
          <div className="eyebrow">
            <span /> UNA NOCHE PARA RECORDAR
          </div>
          <h1>
            {settings.name}
            <span>mis quince.</span>
          </h1>
          <p className="intro-copy">
            Cuatro fotos, mil recuerdos.
            <br />
            Este momento también es tuyo.
          </p>
          <div className="steps">
            <div>
              <b>01</b>
              <span>Elegí tu mejor pose</span>
            </div>
            <div>
              <b>02</b>
              <span>Sonreí cuatro veces</span>
            </div>
            <div>
              <b>03</b>
              <span>Llevate tu recuerdo</span>
            </div>
          </div>
          <div className="event-note">
            <span>✧</span>
            <p>
              Hecho de sonrisas.
              <br />
              <strong>Guardado para siempre.</strong>
            </p>
          </div>
        </section>
        <section className="booth-card" aria-label="Cabina fotográfica">
          <div className="card-heading">
            <span className="eyebrow">
              {phase === "review"
                ? "TU MOMENTO"
                : phase === "done"
                  ? "UN RECUERDO PARA VOS"
                  : "LA CÁMARA TE ESTÁ ESPERANDO"}
            </span>
            <span className="tiny-star">✦</span>
          </div>
          {cameraActive ? (
            <div className="camera-frame">
              <video
                ref={video}
                muted
                playsInline
                autoPlay
                aria-label="Vista previa de cámara"
              />
              {!ready && (
                <div className="camera-empty">
                  <span>◎</span>
                  <h2>Tu momento empieza acá</h2>
                  <p>
                    Permití el acceso a la cámara
                    <br />
                    para ver la vista previa.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setCameraRetry((v) => v + 1);
                    }}
                  >
                    Activar cámara
                  </button>
                </div>
              )}
              {ready && phase === "welcome" && (
                <span className="camera-label">
                  <i /> CÁMARA EN VIVO
                </span>
              )}
              {phase === "countdown" && (
                <div className="countdown" aria-live="polite">
                  <strong>{count}</strong>
                  <span>FOTO {photos.length + 1} DE 4</span>
                </div>
              )}
              {phase === "capturing" && <div className="flash" />}
              <span className="corner tl" />
              <span className="corner tr" />
              <span className="corner bl" />
              <span className="corner br" />
            </div>
          ) : phase === "done" && strip ? (
            <div className="finished">
              <PhotoImage
                blob={strip.blob}
                alt="Tira fotográfica final"
                className="strip-preview"
              />
              <div>
                <span className="saved-check">✓</span>
                <h2>¡Qué lindo recuerdo!</h2>
                <p>
                  Las cuatro fotos y tu tira están guardadas en esta laptop.
                </p>
                <span className="saved-label">
                  GUARDADA EN ESTE DISPOSITIVO
                </span>
                {session && <SessionQR key={session.id} sessionId={session.id}/>}
              </div>
            </div>
          ) : (
            <div className="review-grid">
              {photos.map((p) => (
                <div key={p.position}>
                  <PhotoImage blob={p.blob} alt={`Foto ${p.position}`} />
                  <span>0{p.position}</span>
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <div className="card-controls">
            {phase === "welcome" && (
              <>
                <div className="camera-options">
                  <label>
                    Cámara
                    <select
                      aria-label="Seleccionar cámara"
                      value={deviceId}
                      onChange={(e) => {
                        setError("");
                        setDeviceId(e.target.value);
                      }}
                    >
                      <option value="">Predeterminada</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Cámara"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>
                    4 fotos <span>·</span> 3 segundos para posar
                  </span>
                </div>
                <button
                  className="primary"
                  disabled={!ready || !loaded}
                  onClick={() => void start()}
                >
                  Comenzar mi sesión <span>↗</span>
                </button>
                <p className="privacy-note">
                  Primero guardamos tus fotos en esta laptop.
                </p>
              </>
            )}
            {(phase === "countdown" || phase === "capturing") && (
              <>
                <div className="progress-dots">
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={photos.length >= n ? "taken" : ""}>
                      {photos.length >= n ? "✓" : n}
                    </span>
                  ))}
                </div>
                <button
                  className="text-button"
                  onClick={() => controller.current?.abort()}
                >
                  Cancelar captura
                </button>
              </>
            )}
            {(phase === "review" || phase === "saving") && (
              <>
                <h2>
                  {photos.length === 4
                    ? "¿Nos quedamos con estas?"
                    : "Sesión incompleta"}
                </h2>
                <p className="small">
                  {photos.length === 4
                    ? "Conservamos tus originales completos. La tira tiene su propio encuadre."
                    : `Se recuperaron ${photos.length} de 4 fotos. Podés respaldarlas antes de repetir.`}
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void repeat()}
                  >
                    Repetir sesión
                  </button>
                  <button
                    className="primary"
                    disabled={photos.length !== 4 || busy}
                    onClick={() => void confirm()}
                  >
                    {phase === "saving" ? "Guardando…" : "Confirmar mis fotos"}
                  </button>
                </div>
                <button
                  className="text-button"
                  disabled={exporting || busy}
                  onClick={() => void exportSessions()}
                >
                  {exporting
                    ? "Preparando respaldo…"
                    : "Respaldar capturas en ZIP"}
                </button>
              </>
            )}
            {phase === "done" && (
              <>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={exporting}
                    onClick={() => void exportSessions()}
                  >
                    {exporting ? "Preparando ZIP…" : "Descargar sesión ZIP"}
                  </button>
                  <button
                    className="primary"
                    disabled={exporting}
                    onClick={reset}
                  >
                    Nueva sesión <span>↗</span>
                  </button>
                </div>
                <div className="individual-downloads">
                  {[...photos, ...(strip ? [strip] : [])].map((p) => (
                    <button
                      key={p.position}
                      onClick={() =>
                        download(p.blob, `tami-${session!.id}-${photoName(p)}`)
                      }
                    >
                      {p.type === "strip" ? "↓ Tira" : `↓ Foto ${p.position}`}
                    </button>
                  ))}
                </div>
                <p className="privacy-note" role="status">
                  Volvemos al inicio en {remaining} segundos.
                </p>
              </>
            )}
          </div>
        </section>
      </main>
      <footer>
        <span>✦ &nbsp; QUE ESTA NOCHE DURE PARA SIEMPRE</span>
        {phase === "welcome" && (
          <button
            className="text-button"
            onClick={() => void openPanel("library")}
          >
            Sesiones locales y respaldo ↗
          </button>
        )}
        <span>
          {settings.date
            ? settings.date.split("-").reverse().join(" / ")
            : "UNA FECHA ESPECIAL"}
        </span>
      </footer>
      {panel && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              panel === "settings" ? "Configuración local" : "Sesiones locales"
            }
          >
            <div className="modal-title">
              <h2>
                {panel === "settings"
                  ? "Preparar la noche"
                  : "Sesiones de esta laptop"}
              </h2>
              <button
                className="icon-button"
                aria-label="Cerrar"
                onClick={() => {
                  setPanel(null);
                  setError("");
                }}
              >
                ×
              </button>
            </div>
            <p className="small">
              Panel local del operador. No tiene autenticación en esta fase.
            </p>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            {panel === "settings" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveSettings();
                }}
                className="settings-form"
              >
                <label>
                  Nombre
                  <input
                    required
                    maxLength={40}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label>
                  Fecha del evento
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </label>
                <label>
                  Pausa entre fotos (segundos)
                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={form.interval}
                    onChange={(e) =>
                      setForm({ ...form, interval: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Volver al inicio después de (segundos)
                  <input
                    type="number"
                    min={15}
                    max={300}
                    value={form.returnAfter}
                    onChange={(e) =>
                      setForm({ ...form, returnAfter: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Marco de la tira
                  <select
                    value={form.frame}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        frame: e.target.value as Settings["frame"],
                      })
                    }
                  >
                    <option value="lavender">Lavanda</option>
                    <option value="rose">Rosa</option>
                    <option value="midnight">Noche dorada</option>
                  </select>
                </label>
                <p className="small">
                  La pausa se suma a la cuenta regresiva de 3 segundos.
                </p>
                <p className="small">{storageInfo}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void (async () => {
                      try {
                        const granted = await navigator.storage?.persist();
                        setStorageInfo(
                          granted
                            ? "Almacenamiento persistente concedido."
                            : "El navegador no concedió persistencia. Mantené un respaldo externo.",
                        );
                      } catch (e) {
                        setError(storageError(e));
                      }
                    })()
                  }
                >
                  Solicitar almacenamiento persistente
                </button>
                <DevicePanel />
                <button className="primary" type="submit">
                  Guardar configuración
                </button>
              </form>
            ) : (
              <>
                <button
                  className="primary"
                  disabled={exporting || !sessions.length}
                  onClick={() => void exportSessions(true)}
                >
                  {exporting ? "Preparando respaldo…" : "Exportar todas en ZIP"}
                </button>
                <div className="session-list">
                  {!sessions.length && (
                    <p>Todavía no hay sesiones guardadas.</p>
                  )}
                  {sessions.map((s) => (
                    <article key={s.id}>
                      <div>
                        <strong>
                          {new Date(s.createdAt).toLocaleString("es-UY")}
                        </strong>
                        <p>
                          {s.status === "draft"
                            ? "Borrador · revisar capturas"
                            : "Guardada localmente"}{" "}
                          · {s.id.slice(0, 8)}
                        </p>
                      </div>
                      <button
                        className="secondary"
                        disabled={exporting}
                        onClick={() => void recover(s)}
                      >
                        {s.status === "draft" ? "Recuperar" : "Ver"}
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
