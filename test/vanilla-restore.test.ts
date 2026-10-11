import { describe, it, expect, vi } from "vitest";
import {
  removeModsvsInContent,
  GameInfoEditor,
  MergeOrchestrator,
  type GameInfoFileSystem,
  type MergeOrchestratorFileSystem,
  type GamePaths,
  type AddonManifestEntry,
} from "../src/main/domain/index.js";

describe("Fase 3: Seguridad, Carpeta Oculta y Restauración Vanilla", () => {
  describe("removeModsvsInContent", () => {
    it("elimina Game modsvs preservando los demás SearchPaths", () => {
      const input = [
        '"GameInfo"',
        "{",
        "    FileSystem",
        "    {",
        "        SearchPaths",
        "        {",
        "            Game    modsvs",
        "            Game    update",
        "            Game    left4dead2_dlc3",
        "            Game    |gameinfo_path|.",
        "        }",
        "    }",
        "}",
      ].join("\r\n");

      const result = removeModsvsInContent(input);
      expect(result.changed).toBe(true);
      expect(result.content).not.toContain("modsvs");
      expect(result.content).toContain("Game    update");
      expect(result.content).toContain("Game    left4dead2_dlc3");
    });

    it("es idempotente si no existe ninguna entrada modsvs", () => {
      const input = [
        '"GameInfo"',
        "{",
        "    FileSystem",
        "    {",
        "        SearchPaths",
        "        {",
        "            Game    update",
        "            Game    left4dead2_dlc3",
        "        }",
        "    }",
        "}",
      ].join("\n");

      const result = removeModsvsInContent(input);
      expect(result.changed).toBe(false);
      expect(result.content).toBe(input);
    });

    it("elimina múltiples entradas repetidas de modsvs", () => {
      const input = [
        '"GameInfo"',
        "{",
        "    FileSystem",
        "    {",
        "        SearchPaths",
        "        {",
        '            Game    "modsvs"',
        "            Game    update",
        "            Game    MODSVS",
        "            Game    left4dead2",
        "        }",
        "    }",
        "}",
      ].join("\n");

      const result = removeModsvsInContent(input);
      expect(result.changed).toBe(true);
      expect(result.content).not.toContain("modsvs");
      expect(result.content).not.toContain("MODSVS");
      expect(result.content).toContain("Game    update");
      expect(result.content).toContain("Game    left4dead2");
    });
  });

  describe("GameInfoEditor.removeModsvs", () => {
    it("lee del FS, modifica y escribe de vuelta solo si hubo cambios", async () => {
      let fileData = [
        '"GameInfo"',
        "{",
        "    FileSystem",
        "    {",
        "        SearchPaths",
        "        {",
        "            Game    modsvs",
        "            Game    update",
        "        }",
        "    }",
        "}",
      ].join("\n");

      let writeCalled = false;
      const fs: GameInfoFileSystem = {
        readTextFile: async () => fileData,
        writeTextFile: async (_p, content) => {
          writeCalled = true;
          fileData = content;
        },
      };

      const editor = new GameInfoEditor(fs);
      const changed = await editor.removeModsvs("C:\\L4D2\\left4dead2\\gameinfo.txt");

      expect(changed).toBe(true);
      expect(writeCalled).toBe(true);
      expect(fileData).not.toContain("modsvs");
      expect(fileData).toContain("Game    update");
    });
  });

  describe("MergeOrchestrator.restoreVanilla", () => {
    it("aborta si el juego está en ejecución", async () => {
      const orchestrator = new MergeOrchestrator({
        processGuard: { isGameRunning: async () => true } as any,
        elevationService: {} as any,
        backupManager: {} as any,
        mergeEngine: {} as any,
        gameInfoEditor: {} as any,
        localStore: {} as any,
        addonScanner: {} as any,
        fs: {} as any,
        paths: { gameRoot: "C:\\L4D2" } as any,
        workRoot: "C:\\Temp",
      });

      const res = await orchestrator.restoreVanilla();
      expect(res.status).toBe("failure");
      if (res.status === "failure") {
        expect(res.error).toContain("ejecución");
      }
    });

    it("elimina la carpeta modsvs, remueve el SearchPath y limpia el manifest", async () => {
      let removedDir: string | null = null;
      let removedModsvsCalled = false;
      let savedManifest: AddonManifestEntry[] | null = null;

      const mockFs: MergeOrchestratorFileSystem = {
        ensureDir: async () => {},
        copyFile: async () => {},
        removeDir: async (dir) => {
          removedDir = dir;
        },
      };

      const mockGameInfo = {
        ensureModsvsFirst: vi.fn(),
        removeModsvs: vi.fn(async () => {
          removedModsvsCalled = true;
          return true;
        }),
      };

      const mockStore = {
        getManifest: () => [{ addonId: "123", priorityOrder: 1 }],
        saveManifest: (entries: AddonManifestEntry[]) => {
          savedManifest = entries;
        },
        getPendingSession: () => null,
        clearPendingSession: vi.fn(),
        getPaths: () => null,
        savePaths: vi.fn(),
      };

      const mockPaths: GamePaths = {
        steamPath: "C:\\Steam",
        gameRoot: "C:\\L4D2",
        left4dead2Dir: "C:\\L4D2\\left4dead2",
        gameInfoFile: "C:\\L4D2\\left4dead2\\gameinfo.txt",
        modsvsFolder: "C:\\L4D2\\left4dead2\\modsvs",
        workshopFolder: "C:\\L4D2\\left4dead2\\addons\\workshop",
        vpkToolPath: "C:\\L4D2\\bin\\vpk.exe",
      };

      const orchestrator = new MergeOrchestrator({
        processGuard: { isGameRunning: async () => false } as any,
        elevationService: {
          ensureCanWrite: async () => ({ kind: "already-writable" }),
          handleWriteFailure: async () => ({ kind: "already-writable" }),
        } as any,
        backupManager: {} as any,
        mergeEngine: {} as any,
        gameInfoEditor: mockGameInfo as any,
        localStore: mockStore as any,
        addonScanner: {} as any,
        fs: mockFs,
        paths: mockPaths,
        workRoot: "C:\\Temp",
      });

      const res = await orchestrator.restoreVanilla();
      expect(res.status).toBe("success");
      expect(removedDir).toBe("C:\\L4D2\\left4dead2\\modsvs");
      expect(removedModsvsCalled).toBe(true);
      expect(savedManifest).toEqual([]);
    });
  });
});
