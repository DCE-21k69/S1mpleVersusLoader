import { promises as fs } from "node:fs";

import type { FileReadResult, FileSystemProbe } from "../domain/index.js";
import { pathExists } from "./node-fs-helpers.js";

/** FileSystemProbe real (Tarea 20.4, bloque 1): consumida por PathDetector (Sección 5). */
export class RealFileSystemProbe implements FileSystemProbe {
  async readTextFile(target: string): Promise<FileReadResult> {
    const cleanTarget = process.platform === "win32" ? target : target.replace(/\\/g, "/");
    try {
      const content = await fs.readFile(cleanTarget, "utf8");
      return { ok: true, content };
    } catch {
      return { ok: false };
    }
  }

  async exists(target: string): Promise<boolean> {
    const cleanTarget = process.platform === "win32" ? target : target.replace(/\\/g, "/");
    if (cleanTarget.toLowerCase().endsWith("modsvs") || cleanTarget.toLowerCase().endsWith("modsvs/")) {
      const parent = cleanTarget.replace(/[\\/]modsvs[\\/]?$/i, "");
      if ((await pathExists(parent)) && !(await pathExists(cleanTarget))) {
        try {
          await fs.mkdir(cleanTarget, { recursive: true });
        } catch {
          // Si no se puede crear por permisos, pathExists retornará su estado actual
        }
      }
    }
    return pathExists(target);
  }
}