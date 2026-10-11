import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  readVpkHeader,
  parseVpkEntries,
  hasVscriptsFast,
  readAddonInfoFast,
  mergeVpksFast,
  VPK_MAGIC,
} from "../src/main/domain/index.js";

/** Función helper para construir un VPK v1 sintético y válido en disco */
function createSyntheticVpk(
  filePath: string,
  files: Array<{ ext: string; dir: string; filename: string; content: string }>,
): void {
  // Agrupar por ext -> dir -> filename
  const map = new Map<string, Map<string, Map<string, Buffer>>>();
  for (const f of files) {
    let extMap = map.get(f.ext);
    if (!extMap) {
      extMap = new Map();
      map.set(f.ext, extMap);
    }
    let dirMap = extMap.get(f.dir);
    if (!dirMap) {
      dirMap = new Map();
      extMap.set(f.dir, dirMap);
    }
    dirMap.set(f.filename, Buffer.from(f.content, "utf8"));
  }

  const treeChunks: Buffer[] = [];
  const dataChunks: Buffer[] = [];
  let currentOffset = 0;

  for (const [ext, dirs] of map.entries()) {
    treeChunks.push(Buffer.from(ext + "\0", "utf8"));
    for (const [dir, fileMap] of dirs.entries()) {
      treeChunks.push(Buffer.from(dir + "\0", "utf8"));
      for (const [fn, data] of fileMap.entries()) {
        const entry = Buffer.alloc(18);
        entry.writeUInt32LE(0x12345678, 0); // CRC
        entry.writeUInt16LE(0, 4); // Preload = 0
        entry.writeUInt16LE(0x7fff, 6); // Embedded
        entry.writeUInt32LE(currentOffset, 8);
        entry.writeUInt32LE(data.length, 12);
        entry.writeUInt16LE(0xffff, 16); // Terminator

        treeChunks.push(Buffer.from(fn + "\0", "utf8"));
        treeChunks.push(entry);

        dataChunks.push(data);
        currentOffset += data.length;
      }
      treeChunks.push(Buffer.from([0]));
    }
    treeChunks.push(Buffer.from([0]));
  }
  treeChunks.push(Buffer.from([0]));

  const treeBuf = Buffer.concat(treeChunks);
  const hdrBuf = Buffer.alloc(12);
  hdrBuf.writeUInt32LE(VPK_MAGIC, 0);
  hdrBuf.writeUInt32LE(1, 4);
  hdrBuf.writeUInt32LE(treeBuf.length, 8);

  const fd = fs.openSync(filePath, "w");
  fs.writeSync(fd, hdrBuf);
  fs.writeSync(fd, treeBuf);
  for (const chunk of dataChunks) {
    fs.writeSync(fd, chunk);
  }
  fs.closeSync(fd);
}

describe("Motor Nativo Ultrarrápido VPK (sin vpk.exe)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vpk-fast-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lee correctamente la cabecera y entradas de un VPK", async () => {
    const vpkPath = path.join(tmpDir, "test.vpk");
    createSyntheticVpk(vpkPath, [
      { ext: "txt", dir: " ", filename: "addoninfo", content: "Title: Test Mod" },
      { ext: "vmt", dir: "materials/models", filename: "skin", content: "VertexLitGeneric" },
    ]);

    const header = await readVpkHeader(vpkPath);
    expect(header).not.toBeNull();
    expect(header?.magic).toBe(VPK_MAGIC);
    expect(header?.version).toBe(1);

    const entries = await parseVpkEntries(vpkPath);
    expect(entries.length).toBe(2);
    expect(entries.some((e) => e.filename === "addoninfo" && e.ext === "txt")).toBe(true);
    expect(entries.some((e) => e.filename === "skin" && e.ext === "vmt")).toBe(true);
  });

  it("detecta VScripts (.nut en scripts/vscripts) en milisegundos", async () => {
    const safeVpk = path.join(tmpDir, "safe.vpk");
    createSyntheticVpk(safeVpk, [
      { ext: "vmt", dir: "materials", filename: "texture", content: "mat" },
    ]);

    const vscriptVpk = path.join(tmpDir, "vscript.vpk");
    createSyntheticVpk(vscriptVpk, [
      { ext: "nut", dir: "scripts/vscripts", filename: "exploit", content: "print(1);" },
    ]);

    expect(await hasVscriptsFast(safeVpk)).toBe(false);
    expect(await hasVscriptsFast(vscriptVpk)).toBe(true);
  });

  it("lee el texto de addoninfo.txt instantáneamente", async () => {
    const vpkPath = path.join(tmpDir, "info.vpk");
    createSyntheticVpk(vpkPath, [
      { ext: "txt", dir: " ", filename: "addoninfo", content: "AddonTitle: AK47 Redline" },
    ]);

    const info = await readAddonInfoFast(vpkPath);
    expect(info).toBe("AddonTitle: AK47 Redline");
  });

  it("fusiona múltiples VPKs en un pak01_dir.vpk consolidado con resolución de colisiones", async () => {
    const vpk1 = path.join(tmpDir, "100.vpk");
    createSyntheticVpk(vpk1, [
      { ext: "vmt", dir: "materials", filename: "rifle", content: "rifle v1" },
      { ext: "mdl", dir: "models", filename: "survivor", content: "model data" },
    ]);

    const vpk2 = path.join(tmpDir, "200.vpk");
    createSyntheticVpk(vpk2, [
      // Mismo archivo que vpk1 (colisión: vpk2 debe ganar)
      { ext: "vmt", dir: "materials", filename: "rifle", content: "rifle v2 override" },
      { ext: "wav", dir: "sound", filename: "fire", content: "bang" },
    ]);

    const outPak = path.join(tmpDir, "pak01_dir.vpk");
    const result = await mergeVpksFast(
      [
        { id: "100", vpkPath: vpk1 },
        { id: "200", vpkPath: vpk2 },
      ],
      outPak,
    );

    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(3); // rifle (sobreescrito), survivor, fire
    expect(fs.existsSync(outPak)).toBe(true);

    const mergedEntries = await parseVpkEntries(outPak);
    expect(mergedEntries.length).toBe(3);

    // Verificar que el rifle contiene el contenido de vpk2 (último gana)
    const rifleEntry = mergedEntries.find((e) => e.filename === "rifle" && e.ext === "vmt");
    expect(rifleEntry).toBeDefined();

    const fd = fs.openSync(outPak, "r");
    const buf = Buffer.alloc(rifleEntry!.entryLength);
    fs.readSync(fd, buf, 0, rifleEntry!.entryLength, rifleEntry!.absoluteDataOffset);
    fs.closeSync(fd);

    expect(buf.toString("utf8")).toBe("rifle v2 override");
  });
});
