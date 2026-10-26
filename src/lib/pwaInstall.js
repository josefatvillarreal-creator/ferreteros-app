// ---------------------------------------------------------------------------
// Prompt nativo de "instalar app" (Chrome/Android vía beforeinstallprompt).
// ---------------------------------------------------------------------------
// iOS Safari nunca dispara este evento (no tiene instalación con un clic) —
// ahí `canInstall` se queda en false y hay que instalar a mano (Compartir ->
// Agregar a inicio); el llamador debe mostrar esas instrucciones como
// respaldo cuando `canInstall` es false y `isStandalone` también.
import { useCallback, useEffect, useState } from "react";

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [justInstalled, setJustInstalled] = useState(false);

  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault(); // evita el mini-banner automático; se dispara a mano con el botón
      setDeferredPrompt(e);
    }
    function onAppInstalled() {
      setDeferredPrompt(null);
      setJustInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const isStandalone =
    justInstalled ||
    (typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true));

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === "accepted";
  }, [deferredPrompt]);

  return { canInstall: Boolean(deferredPrompt) && !isStandalone, isStandalone, promptInstall };
}
