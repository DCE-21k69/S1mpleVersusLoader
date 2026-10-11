/**
 * renderer.ts — Lógica del proceso renderer de S1mple Versus Loader.
 *
 * Se conecta al backend (proceso main) exclusivamente a través de la API tipada
 * que el preload expone en window.l4d2Api. NO importa módulos de Node.js ni de
 * Electron directamente.
 */

// ─── Tipos de dominio (resueltos en build-time, no en runtime) ─────────────
import type { AddonManifestEntry, ScannedAddon, UpdateInfo } from "../main/domain/index.js";

// ─── Llave de persistencia del tema ────────────────────────────────────────
const THEME_KEY = "s1mple-theme";

// ─── Estado global de la UI ────────────────────────────────────────────────
interface AppState {
  addons: ScannedAddon[];
  /** Índice addonId → prioridad (1-based, orden de selección). */
  selected: Map<string, number>;
  activeManifest: AddonManifestEntry[];
  gameRunning: boolean;
  busy: boolean;
}

const state: AppState = {
  addons: [],
  selected: new Map(),
  activeManifest: [],
  gameRunning: false,
  busy: false,
};

// ─── Elementos del DOM ─────────────────────────────────────────────────────
const body              = document.body;
const themeToggle       = document.getElementById("theme-toggle")!;
const gameGuard         = document.getElementById("game-guard")!;
const headerBadge       = document.getElementById("header-badge")!;
const statusActive      = document.getElementById("status-active")!;
const statusInactive    = document.getElementById("status-inactive")!;
const statusTotal       = document.getElementById("status-total")!;
const progressContainer = document.getElementById("progress-container")!;
const progressBar       = document.getElementById("progress-bar")!;
const progressLabel     = document.getElementById("progress-label")!;
const loadingState      = document.getElementById("loading-state")!;
const errorState        = document.getElementById("error-state")!;
const errorMessage      = document.getElementById("error-message")!;
const retryBtn          = document.getElementById("retry-btn")!;
const addonListEl       = document.getElementById("addon-list")!;
const btnApply          = document.getElementById("btn-apply") as HTMLButtonElement;
const btnVanilla        = document.getElementById("btn-vanilla") as HTMLButtonElement;

// Modal de Actualización Obligatoria
const updateModal       = document.getElementById("update-modal")!;
const updateVersionTag  = document.getElementById("update-version-tag")!;
const btnUpdateDownload = document.getElementById("btn-update-download") as HTMLButtonElement;

// Contenedor de toasts (lo inyectamos si no existe)
let toastContainer = document.getElementById("toast-container");
if (!toastContainer) {
  toastContainer = document.createElement("div");
  toastContainer.id = "toast-container";
  document.body.appendChild(toastContainer);
}

// ─── API del backend ───────────────────────────────────────────────────────
const api = window.l4d2Api;

// =============================================================================
// TEMA (Dark / Light)
// =============================================================================
function applyTheme(theme: "dark" | "light"): void {
  body.classList.remove("dark", "light");
  body.classList.add(theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  themeToggle.title = theme === "dark" ? "Cambiar a tema Claro" : "Cambiar a tema Oscuro";
  localStorage.setItem(THEME_KEY, theme);
}

function loadTheme(): void {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "light" ? "light" : "dark");
}

themeToggle.addEventListener("click", () => {
  const current = body.classList.contains("dark") ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

// =============================================================================
// TOAST NOTIFICATIONS
// =============================================================================
function showToast(msg: string, type: "success" | "error" | "info" = "info", ms = 3500): void {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  toastContainer!.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(10px)";
    t.style.transition = "opacity 0.3s, transform 0.3s";
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// =============================================================================
// PROGRESO
// =============================================================================
const PROGRESS_STEPS: Record<string, { label: string; pct: number }> = {
  guard:       { label: "Verificando que el juego esté cerrado...", pct: 5 },
  scan:        { label: "Escaneando addons de la Workshop...",      pct: 15 },
  elevation:   { label: "Verificando permisos...",                  pct: 20 },
  backup:      { label: "Creando backup de seguridad...",           pct: 30 },
  merge:       { label: "Fusionando mods en pak01_dir.vpk...",      pct: 60 },
  install:     { label: "Instalando mods en el juego...",           pct: 80 },
  gameinfo:    { label: "Actualizando gameinfo.txt...",             pct: 90 },
  saveManifest:{ label: "Guardando configuración...",               pct: 95 },
  done:        { label: "¡Mods activos! Listo para jugar. 🔥",     pct: 100 },
};

function showProgress(step: string): void {
  const info = PROGRESS_STEPS[step];
  progressContainer.classList.remove("progress-hidden");
  if (info) {
    progressLabel.textContent = info.label;
    progressBar.classList.remove("indeterminate");
    progressBar.style.width = `${info.pct}%`;
  } else {
    progressBar.classList.add("indeterminate");
  }
}

function hideProgress(): void {
  progressContainer.classList.add("progress-hidden");
  progressBar.style.width = "0%";
  progressBar.classList.remove("indeterminate");
}

// =============================================================================
// STATUS BAR
// =============================================================================
function updateStatusBar(): void {
  const totalAddons = state.addons.length;
  const activeCount = state.selected.size;
  const inactiveCount = totalAddons - activeCount;

  statusActive.textContent = `${activeCount} ${activeCount === 1 ? "mod activo" : "mods activos"}`;
  statusInactive.textContent = `${inactiveCount} ${inactiveCount === 1 ? "mod inactivo" : "mods inactivos"}`;
  statusTotal.textContent = `${totalAddons} en total`;
}

function updateHeaderBadge(): void {
  if (state.activeManifest.length > 0) {
    headerBadge.textContent = `${state.activeManifest.length} mods en Versus`;
    headerBadge.classList.remove("badge-hidden");
  } else {
    headerBadge.classList.add("badge-hidden");
  }
}

// =============================================================================
// GUARD DE PROCESO
// =============================================================================
function setGameRunning(running: boolean): void {
  state.gameRunning = running;
  if (running) {
    gameGuard.classList.remove("guard-hidden");
  } else {
    gameGuard.classList.add("guard-hidden");
  }
  refreshButtons();
}

async function pollGameState(): Promise<void> {
  try {
    const running = await api.isGameRunning();
    setGameRunning(running);
  } catch {
    // best-effort
  }
}

// =============================================================================
// BOTONES
// =============================================================================
function refreshButtons(): void {
  const canWrite = !state.gameRunning && !state.busy;
  btnApply.disabled = !canWrite || state.selected.size === 0;
  btnVanilla.disabled = !canWrite;
}

function setBusy(busy: boolean): void {
  state.busy = busy;
  refreshButtons();
}

// =============================================================================
// RENDER DE LISTA DE ADDONS
// =============================================================================
function renderAddonList(): void {
  addonListEl.innerHTML = "";

  if (state.addons.length === 0) {
    loadingState.classList.remove("hidden");
    loadingState.innerHTML = `<span style="font-size:32px">📦</span><span>No se encontraron addons en la Workshop.<br>Suscríbete a algunos en Steam y reinicia la app.</span>`;
    return;
  }

  // Ordenar: activos primero, luego por nombre
  const sorted = [...state.addons].sort((a, b) => {
    const aActive = state.selected.has(a.id) ? 0 : 1;
    const bActive = state.selected.has(b.id) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aName = a.info?.title ?? a.id;
    const bName = b.info?.title ?? b.id;
    return aName.localeCompare(bName);
  });

  for (const addon of sorted) {
    const isActive = state.selected.has(addon.id);
    const title = addon.info?.title ?? `Workshop ${addon.id}`;
    const authorLabel = addon.info?.author ? ` · por ${addon.info.author}` : "";

    const li = document.createElement("li");
    li.className = `addon-item${isActive ? " is-active" : ""}`;
    li.dataset["id"] = addon.id;

    li.innerHTML = `
      <label class="addon-check" title="${isActive ? "Desactivar" : "Activar"} este mod">
        <input type="checkbox" ${isActive ? "checked" : ""} />
        <span class="addon-check-box"></span>
      </label>
      <div class="addon-info">
        <span class="addon-name" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="addon-meta">${escapeHtml(addon.id + authorLabel)}</span>
      </div>
    `;

    const checkbox = li.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.addEventListener("change", () => toggleAddon(addon.id, checkbox.checked));
    li.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("label")) return;
      checkbox.checked = !checkbox.checked;
      toggleAddon(addon.id, checkbox.checked);
    });

    addonListEl.appendChild(li);
  }
}

function toggleAddon(id: string, checked: boolean): void {
  if (checked) {
    const nextPriority = state.selected.size + 1;
    state.selected.set(id, nextPriority);
  } else {
    state.selected.delete(id);
    // Re-numerar prioridades
    let i = 1;
    for (const [k] of state.selected) {
      state.selected.set(k, i++);
    }
  }
  renderAddonList();
  updateStatusBar();
  refreshButtons();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// =============================================================================
// APLICAR MODS
// =============================================================================
btnApply.addEventListener("click", async () => {
  if (state.gameRunning) {
    showToast("⚠️ Cerrá Left 4 Dead 2 antes de aplicar cambios.", "error");
    return;
  }
  if (state.selected.size === 0) {
    showToast("Seleccioná al menos un mod primero.", "info");
    return;
  }

  setBusy(true);
  showProgress("guard");

  const entries: AddonManifestEntry[] = Array.from(state.selected.entries()).map(
    ([addonId, priorityOrder]) => ({ addonId, priorityOrder }),
  );

  // Suscripción al progreso
  const unsub = api.onProgress((evt) => {
    showProgress(evt.step);
  });

  try {
    const result = await api.applyActiveSet(entries);

    if (result.status === "success") {
      state.activeManifest = result.installedManifest ?? entries;
      updateHeaderBadge();
      showProgress("done");
      showToast(`🔥 ¡${entries.length} ${entries.length === 1 ? "mod activado" : "mods activados"} en Versus!`, "success", 4000);
      setTimeout(() => hideProgress(), 2000);
    } else if (result.status === "elevating") {
      showToast("Solicitando permisos de administrador...", "info");
      hideProgress();
    } else {
      showToast(`❌ Error: ${result.error ?? "fallo desconocido"}`, "error", 5000);
      hideProgress();
    }
  } catch (err) {
    showToast(`❌ Error inesperado: ${String(err)}`, "error", 5000);
    hideProgress();
  } finally {
    unsub();
    setBusy(false);
  }
});

// =============================================================================
// RESTAURAR VANILLA
// =============================================================================
btnVanilla.addEventListener("click", async () => {
  if (state.gameRunning) {
    showToast("⚠️ Cerrá Left 4 Dead 2 antes de restaurar.", "error");
    return;
  }

  setBusy(true);
  showProgress("guard");
  progressLabel.textContent = "Restaurando Left 4 Dead 2 a Vanilla...";

  try {
    const result = await api.restoreVanilla();

    if (result.status === "success") {
      state.selected.clear();
      state.activeManifest = [];
      updateHeaderBadge();
      updateStatusBar();
      renderAddonList();
      hideProgress();
      showToast("🧹 Left 4 Dead 2 restaurado a estado Vanilla.", "success", 4000);
    } else if (result.status === "elevating") {
      showToast("Solicitando permisos de administrador...", "info");
      hideProgress();
    } else {
      showToast(`❌ Error: ${result.error ?? "fallo desconocido"}`, "error", 5000);
      hideProgress();
    }
  } catch (err) {
    showToast(`❌ Error: ${String(err)}`, "error", 5000);
    hideProgress();
  } finally {
    setBusy(false);
    refreshButtons();
  }
});

function showUpdateModal(info: UpdateInfo): void {
  updateVersionTag.textContent = `Versión disponible: ${info.latestVersion}`;
  updateModal.classList.remove("hidden");
  btnApply.disabled = true;
  btnVanilla.disabled = true;

  btnUpdateDownload.addEventListener("click", () => {
    const targetUrl =
      info.downloadUrl ??
      "https://github.com/DCE-21k69/S1mpleVersusLoader/releases/latest";
    void api.openExternalUrl(targetUrl);
    showToast("Abriendo enlace de descarga oficial...", "info");
  });
}

// =============================================================================
// CARGA INICIAL
// =============================================================================
async function initApp(): Promise<void> {
  loadTheme();

  // 0. Verificación de Actualización Obligatoria (Forced Updater)
  try {
    const updateInfo = await api.checkForUpdates();
    if (updateInfo.updateAvailable) {
      showUpdateModal(updateInfo);
      return; // Bloqueo total de la app hasta que actualicen
    }
  } catch {
    // Si falla la red, continuar offline
  }

  // 1. Detectar rutas
  showLoadingState("Detectando Steam y Left 4 Dead 2...");
  let paths;
  try {
    paths = await api.detectPaths();
  } catch (err) {
    showErrorState(`No se pudieron detectar las rutas de Steam: ${String(err)}`);
    return;
  }

  if (paths.kind !== "ready") {
    showErrorState("No se encontró Steam o Left 4 Dead 2 instalado. Verificá tu instalación.");
    return;
  }

  // 2. Cargar manifest activo
  try {
    const manifest = await api.getActiveSet();
    state.activeManifest = manifest;
    // Pre-seleccionar los activos
    for (const entry of manifest) {
      state.selected.set(entry.addonId, entry.priorityOrder);
    }
    updateHeaderBadge();
  } catch {
    // best-effort
  }

  // 3. Escanear addons
  showLoadingState("Escaneando Workshop...");
  try {
    const addons = await api.scanAddons();
    state.addons = addons;
  } catch (err) {
    showErrorState(`Error escaneando addons: ${String(err)}`);
    return;
  }

  // 4. Verificar juego
  await pollGameState();

  // 5. Renderizar
  loadingState.classList.add("hidden");
  addonListEl.classList.remove("hidden");
  renderAddonList();
  updateStatusBar();
  refreshButtons();

  // 6. Polling de proceso del juego cada 5 segundos
  setInterval(() => { void pollGameState(); }, 5000);

  // 7. Resume state (instancia elevada)
  try {
    const resume = await api.getResumeState();
    if (resume) {
      for (const evt of resume.bufferedEvents) showProgress(evt.step);
      if (resume.result?.status === "success") {
        state.activeManifest = resume.result.installedManifest ?? [];
        updateHeaderBadge();
        showToast("🔥 Mods aplicados con permisos de administrador.", "success", 4000);
        setTimeout(() => hideProgress(), 2000);
      }
    }
  } catch {
    // best-effort
  }
}

function showLoadingState(msg: string): void {
  loadingState.classList.remove("hidden");
  errorState.classList.add("hidden");
  addonListEl.classList.add("hidden");
  const span = loadingState.querySelector("span");
  if (span) span.textContent = msg;
}

function showErrorState(msg: string): void {
  loadingState.classList.add("hidden");
  addonListEl.classList.add("hidden");
  errorState.classList.remove("hidden");
  errorMessage.textContent = msg;
}

retryBtn.addEventListener("click", () => {
  void initApp();
});

// ─── Arranque ─────────────────────────────────────────────────────────────
void initApp();
