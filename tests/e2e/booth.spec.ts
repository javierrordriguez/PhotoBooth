import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith("permiso denegado")) return;
  // A real MediaStream from Canvas avoids native fake-device driver failures
  // on Windows. Capture, JPEG encoding, video playback and IndexedDB stay real.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d")!;
      let frame = 0;
      const draw = () => {
        ctx.fillStyle = `hsl(${(frame++ * 4) % 360} 45% 65%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        ctx.font = "100px Georgia";
        ctx.fillText(`Cámara simulada · ${frame}`, 100, 500);
      };
      draw();
      const stream = canvas.captureStream(10);
      const timer = setInterval(draw, 100);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
      }
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [];
  });
});
test("captura, repite, confirma, descarga, recupera y aísla la siguiente sesión sin red", async ({
  page,
  context,
}) => {
  await page.goto("/booth");
  await expect(
    page.getByRole("button", { name: "Comenzar mi sesión" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Configuración", exact: true })
    .click();
  await page.getByLabel("Fecha del evento").fill("2026-12-12");
  await page.getByLabel("Pausa entre fotos").fill("0");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await page.getByRole("button", { name: "Comenzar mi sesión" }).click();
  await expect(
    page.getByRole("button", { name: "Confirmar mis fotos" }),
  ).toBeEnabled({ timeout: 25000 });
  await expect(page.getByAltText("Foto 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Repetir sesión" }).click();
  await expect(page.getByAltText("Foto 1", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Comenzar mi sesión" }),
  ).toBeEnabled();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Comenzar mi sesión" }).click();
  await expect(
    page.getByRole("button", { name: "Confirmar mis fotos" }),
  ).toBeEnabled({ timeout: 25000 });
  await page.getByRole("button", { name: "Confirmar mis fotos" }).click();
  await expect(page.getByText("¡Qué lindo recuerdo!")).toBeVisible();
  const image = page.getByAltText("Tira fotográfica final");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate((el: HTMLImageElement) => [
      el.naturalWidth,
      el.naturalHeight,
    ]),
  ).toEqual([1200, 3600]);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar sesión ZIP" }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.zip$/);
  await page.screenshot({
    path: "test-results/finalizada.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Nueva sesión" }).click();
  await expect(page.getByAltText("Tira fotográfica final")).toHaveCount(0);
  await context.setOffline(false);
  await page.reload();
  await page
    .getByRole("button", { name: "Sesiones locales y respaldo" })
    .click();
  await expect(page.locator(".session-list article")).toHaveCount(1);
  await page.getByRole("button", { name: "Ver", exact: true }).click();
  await expect(page.getByAltText("Tira fotográfica final")).toBeVisible();
});
test("recupera un borrador tras recargar y puede confirmarlo", async ({
  page,
}) => {
  await page.goto("/booth");
  await expect(
    page.getByRole("button", { name: "Comenzar mi sesión" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Comenzar mi sesión" }).click();
  await expect(
    page.getByRole("button", { name: "Confirmar mis fotos" }),
  ).toBeEnabled({ timeout: 25000 });
  await page.reload();
  await page
    .getByRole("button", { name: "Sesiones locales y respaldo" })
    .click();
  await page.getByRole("button", { name: "Recuperar", exact: true }).click();
  await expect(page.getByAltText("Foto 4", { exact: true })).toBeVisible();
  await page.clock.install();
  await page.getByRole("button", { name: "Confirmar mis fotos" }).click();
  await expect(page.getByText("¡Qué lindo recuerdo!")).toBeVisible();
  await page.clock.runFor(46000);
  await expect(
    page.getByRole("button", { name: "Comenzar mi sesión" }),
  ).toBeVisible();
  await expect(page.getByAltText("Tira fotográfica final")).toHaveCount(0);
});
test("permiso denegado, reintento, diseño móvil y rutas futuras", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("No", "NotAllowedError"));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/booth");
  await expect(page.getByRole("alert")).toContainText("Permití el acceso");
  await expect(
    page.getByRole("button", { name: "Comenzar mi sesión" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/bienvenida-movil.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/s/token-de-prueba");
  await expect(
    page.getByText("Este enlace no es válido. Pedile ayuda al organizador."),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Administración" }),
  ).toBeVisible();
});
