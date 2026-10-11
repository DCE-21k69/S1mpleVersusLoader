import { describe, it, expect } from "vitest";
import {
  ProcessGuard,
  type ProcessListProvider,
  PathDetector,
  type RegistryReader,
  type FileSystemProbe,
  type ManualPathProvider,
} from "../src/main/domain/index.js";

describe("Fase 4: Adaptador Multiplataforma (Linux / Steam Deck y Windows)", () => {
  describe("ProcessGuard en Linux / SteamOS", () => {
    it("detecta el proceso nativo hl2_linux", async () => {
      const mockProvider: ProcessListProvider = {
        listRunningProcessNames: async () => ["bash", "hl2_linux", "steam"],
      };
      const guard = new ProcessGuard(mockProvider);
      expect(await guard.isGameRunning()).toBe(true);
    });

    it("detecta el proceso nativo left4dead2", async () => {
      const mockProvider: ProcessListProvider = {
        listRunningProcessNames: async () => ["systemd", "left4dead2", "pipewire"],
      };
      const guard = new ProcessGuard(mockProvider);
      expect(await guard.isGameRunning()).toBe(true);
    });

    it("detecta el ejecutable de Windows corriendo bajo Proton (left4dead2.exe)", async () => {
      const mockProvider: ProcessListProvider = {
        listRunningProcessNames: async () => ["wineserver", "left4dead2.exe"],
      };
      const guard = new ProcessGuard(mockProvider);
      expect(await guard.isGameRunning()).toBe(true);
    });

    it("no da falso positivo con hl2.exe u otros procesos", async () => {
      const mockProvider: ProcessListProvider = {
        listRunningProcessNames: async () => ["hl2.exe", "discord", "steam"],
      };
      const guard = new ProcessGuard(mockProvider);
      expect(await guard.isGameRunning()).toBe(false);
    });
  });

  describe("PathDetector en Linux / Steam Deck", () => {
    it("encuentra Steam en rutas estándar si el registro de Windows no existe", async () => {
      const mockRegistry: RegistryReader = {
        readValue: async () => null, // En Linux no hay registro
      };

      const existingPaths = new Set(["/home/test/.local/share/Steam"]);
      const mockFs: FileSystemProbe = {
        exists: async (p) => existingPaths.has(p),
        readTextFile: async () => ({ ok: false }),
      };

      const mockManual: ManualPathProvider = {
        requestPath: async () => ({ kind: "cancelled" }),
      };

      // Mockear HOME para el test
      const oldHome = process.env["HOME"];
      process.env["HOME"] = "/home/test";

      try {
        const detector = new PathDetector({
          registry: mockRegistry,
          fs: mockFs,
          manual: mockManual,
        });

        const detected = await detector.readSteamPath();
        expect(detected).toBe("/home/test/.local/share/Steam");
      } finally {
        process.env["HOME"] = oldHome;
      }
    });
  });
});
