/**
 * update-service.ts — Servicio de verificación y actualización obligatoria
 * mediante la API pública de GitHub Releases.
 *
 * Repositorio oficial: DCE-21k69/S1mpleVersusLoader
 */

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  downloadUrl: string | null;
  publishedAt: string;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubReleaseResponse {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: ReleaseAsset[];
}

/** Compara dos versiones semver simples (ej: "1.0.1" vs "1.0.0"). Devuelve true si latest > current. */
export function isNewerVersion(latest: string, current: string): boolean {
  const cleanLatest = latest.replace(/^v/i, "").trim();
  const cleanCurrent = current.replace(/^v/i, "").trim();

  if (cleanLatest === cleanCurrent) return false;

  const latestParts = cleanLatest.split(".").map((p) => parseInt(p, 10) || 0);
  const currentParts = cleanCurrent.split(".").map((p) => parseInt(p, 10) || 0);

  const maxLen = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < maxLen; i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }

  return false;
}

export class UpdateService {
  readonly #repoOwner: string;
  readonly #repoName: string;
  readonly #currentVersion: string;

  constructor(repoOwner = "DCE-21k69", repoName = "S1mpleVersusLoader", currentVersion = "1.0.0") {
    this.#repoOwner = repoOwner;
    this.#repoName = repoName;
    this.#currentVersion = currentVersion;
  }

  /** Consulta el último release de GitHub y evalúa si hay una actualización pendiente. */
  async checkForUpdates(): Promise<UpdateInfo> {
    const apiUrl = `https://api.github.com/repos/${this.#repoOwner}/${this.#repoName}/releases/latest`;

    try {
      const response = await fetch(apiUrl, {
        headers: {
          "User-Agent": "S1mpleVersusLoader-Updater",
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        // Si el release no existe aún (404), no hay actualización pendiente
        return {
          updateAvailable: false,
          currentVersion: this.#currentVersion,
          latestVersion: this.#currentVersion,
          releaseName: "Versión actual",
          releaseNotes: "",
          downloadUrl: null,
          publishedAt: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as GitHubReleaseResponse;
      const latestTag = data.tag_name || "";
      const updateAvailable = isNewerVersion(latestTag, this.#currentVersion);

      // Buscar asset adecuado según plataforma (Setup.exe para Windows, tar.gz para Linux)
      let matchedUrl: string | null = null;
      const isWin = process.platform === "win32";

      for (const asset of data.assets ?? []) {
        const name = asset.name.toLowerCase();
        if (isWin && (name.endsWith(".exe") || name.includes("setup"))) {
          matchedUrl = asset.browser_download_url;
          break;
        } else if (!isWin && (name.endsWith(".tar.gz") || name.endsWith(".appimage"))) {
          matchedUrl = asset.browser_download_url;
          break;
        }
      }

      return {
        updateAvailable,
        currentVersion: this.#currentVersion,
        latestVersion: latestTag,
        releaseName: data.name ?? latestTag,
        releaseNotes: data.body ?? "",
        downloadUrl: matchedUrl,
        publishedAt: data.published_at ?? new Date().toISOString(),
      };
    } catch {
      // Si no hay conexión o falla la red, permitir continuar en modo offline
      return {
        updateAvailable: false,
        currentVersion: this.#currentVersion,
        latestVersion: this.#currentVersion,
        releaseName: "Offline",
        releaseNotes: "",
        downloadUrl: null,
        publishedAt: new Date().toISOString(),
      };
    }
  }
}
