import { describe, it, expect } from "vitest";
import { isNewerVersion, UpdateService } from "../src/main/domain/index.js";

describe("Fase 5: Sistema de Auto-Actualización Obligatoria (UpdateService)", () => {
  describe("isNewerVersion (Comparador Semver)", () => {
    it("detecta versiones superiores con o sin prefijo 'v'", () => {
      expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
      expect(isNewerVersion("v1.1.0", "1.0.9")).toBe(true);
      expect(isNewerVersion("2.0.0", "v1.9.9")).toBe(true);
      expect(isNewerVersion("v1.0.10", "v1.0.9")).toBe(true);
    });

    it("devuelve false si las versiones son idénticas", () => {
      expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
      expect(isNewerVersion("v1.0.0", "1.0.0")).toBe(false);
      expect(isNewerVersion("1.2.3", "v1.2.3")).toBe(false);
    });

    it("devuelve false si la versión remota es anterior", () => {
      expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
      expect(isNewerVersion("v1.0.0", "1.0.1")).toBe(false);
    });
  });

  describe("UpdateService.checkForUpdates", () => {
    it("devuelve offline si la red o API falla sin lanzar excepciones", async () => {
      // Instanciar contra un repo inexistente para simular fallo/offline
      const service = new UpdateService("dce-invalid-owner", "nonexistent-repo", "1.0.0");
      const info = await service.checkForUpdates();

      expect(info).toBeDefined();
      expect(info.currentVersion).toBe("1.0.0");
      expect(info.updateAvailable).toBe(false);
    });
  });
});
