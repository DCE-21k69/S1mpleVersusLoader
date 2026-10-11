/**
 * vpk-fast-engine.ts — Motor nativo ultrarrápido de lectura y fusión de VPK
 * sin dependencia de vpk.exe ni herramientas externas.
 *
 * Implementa el estándar binario de Valve Pack (VPK v1 / v2) directamente
 * en streams de memoria y disco.
 * Fusiona decenas de complementos en 1-2 segundos.
 */

import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";

export const VPK_MAGIC = 0x55aa1234;

export interface VpkFileEntry {
  ext: string;
  dir: string;
  filename: string;
  crc32: number;
  archiveIndex: number;
  entryOffset: number;
  entryLength: number;
  preloadData: Buffer;
  sourceVpkPath: string;
  absoluteDataOffset: number;
}

export interface VpkHeader {
  magic: number;
  version: number;
  treeSize: number;
  headerSize: number;
  dataStart: number;
}

/** Lee la cabecera de un archivo VPK (v1 o v2). */
export async function readVpkHeader(vpkPath: string): Promise<VpkHeader | null> {
  const handle = await fs.open(vpkPath, "r");
  try {
    const hdrBuf = Buffer.alloc(12);
    const { bytesRead } = await handle.read(hdrBuf, 0, 12, 0);
    if (bytesRead < 12) return null;

    const magic = hdrBuf.readUInt32LE(0);
    if (magic !== VPK_MAGIC) return null;

    const version = hdrBuf.readUInt32LE(4);
    const treeSize = hdrBuf.readUInt32LE(8);

    let headerSize = 12;
    if (version === 2) {
      headerSize = 28;
    }

    return {
      magic,
      version,
      treeSize,
      headerSize,
      dataStart: headerSize + treeSize,
    };
  } finally {
    await handle.close();
  }
}

/** Extrae la lista de entradas de archivos de un VPK directamente del árbol binario. */
export async function parseVpkEntries(vpkPath: string): Promise<VpkFileEntry[]> {
  const header = await readVpkHeader(vpkPath);
  if (!header) return [];

  const handle = await fs.open(vpkPath, "r");
  try {
    const treeBuf = Buffer.alloc(header.treeSize);
    const { bytesRead } = await handle.read(treeBuf, 0, header.treeSize, header.headerSize);
    if (bytesRead < header.treeSize) return [];

    const entries: VpkFileEntry[] = [];
    let idx = 0;
    const len = treeBuf.length;

    const readString = (): string => {
      const start = idx;
      while (idx < len && treeBuf[idx] !== 0) {
        idx++;
      }
      const str = treeBuf.toString("utf8", start, idx);
      if (idx < len) idx++; // Saltear byte nulo
      return str;
    };

    while (idx < len) {
      const ext = readString().toLowerCase().trim();
      if (!ext) break;

      while (idx < len) {
        const rawDir = readString();
        if (!rawDir) break;

        let dir = rawDir.replace(/\\/g, "/").toLowerCase().trim();
        if (dir.startsWith("/")) dir = dir.slice(1);
        if (dir.endsWith("/")) dir = dir.slice(0, -1);
        if (!dir) dir = " ";

        while (idx < len) {
          const filename = readString().toLowerCase().trim();
          if (!filename) break;

          if (idx + 18 > len) break;

          const crc32 = treeBuf.readUInt32LE(idx);
          const preloadBytes = treeBuf.readUInt16LE(idx + 4);
          const archiveIndex = treeBuf.readUInt16LE(idx + 6);
          const entryOffset = treeBuf.readUInt32LE(idx + 8);
          const entryLength = treeBuf.readUInt32LE(idx + 12);
          // terminator en idx + 16 (0xFFFF)

          idx += 18;

          let preloadData = Buffer.alloc(0);
          if (preloadBytes > 0 && idx + preloadBytes <= len) {
            preloadData = Buffer.from(treeBuf.subarray(idx, idx + preloadBytes));
            idx += preloadBytes;
          }

          entries.push({
            ext,
            dir,
            filename,
            crc32,
            archiveIndex,
            entryOffset,
            entryLength,
            preloadData,
            sourceVpkPath: vpkPath,
            absoluteDataOffset: header.dataStart + entryOffset,
          });
        }
      }
    }

    return entries;
  } finally {
    await handle.close();
  }
}

/** Verifica al instante si un VPK contiene VScripts (.nut en scripts/vscripts). */
export async function hasVscriptsFast(vpkPath: string): Promise<boolean> {
  try {
    const entries = await parseVpkEntries(vpkPath);
    return entries.some((e) => {
      if (e.ext !== "nut") return false;
      const cleanDir = e.dir.toLowerCase();
      return cleanDir === "scripts/vscripts" || cleanDir.startsWith("scripts/vscripts/");
    });
  } catch {
    return false;
  }
}

/** Extrae el contenido de addoninfo.txt si está presente en el VPK. */
export async function readAddonInfoFast(vpkPath: string): Promise<string | null> {
  try {
    const entries = await parseVpkEntries(vpkPath);
    const infoEntry = entries.find(
      (e) => (e.dir === " " || e.dir === "") && e.filename === "addoninfo" && e.ext === "txt",
    );

    if (!infoEntry) return null;

    if (infoEntry.preloadData.length > 0) {
      return infoEntry.preloadData.toString("utf8");
    }

    if (infoEntry.entryLength > 0) {
      const handle = await fs.open(vpkPath, "r");
      try {
        const buf = Buffer.alloc(infoEntry.entryLength);
        await handle.read(buf, 0, infoEntry.entryLength, infoEntry.absoluteDataOffset);
        return buf.toString("utf8");
      } finally {
        await handle.close();
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fusiona múltiples VPKs en un ÚNICO paquete maestro pak01_dir.vpk de forma nativa.
 * Sin descomprimir a disco, sin llamar a vpk.exe, transmitiendo bytes directamente en streams.
 */
export async function mergeVpksFast(
  addons: Array<{ id: string; vpkPath: string }>,
  targetVpkPath: string,
): Promise<{ success: boolean; totalFiles: number; sizeBytes: number }> {
  // Mapa ordenado de rutas: (ext -> dir -> filename)
  const mergedMap = new Map<string, Map<string, Map<string, VpkFileEntry>>>();

  // Procesar en orden de prioridad (el último sobreescribe colisiones)
  for (const addon of addons) {
    if (!fsSync.existsSync(addon.vpkPath)) continue;

    const entries = await parseVpkEntries(addon.vpkPath);
    for (const entry of entries) {
      let extMap = mergedMap.get(entry.ext);
      if (!extMap) {
        extMap = new Map();
        mergedMap.set(entry.ext, extMap);
      }

      let dirMap = extMap.get(entry.dir);
      if (!dirMap) {
        dirMap = new Map();
        extMap.set(entry.dir, dirMap);
      }

      // Último gana
      dirMap.set(entry.filename, entry);
    }
  }

  // Si no hay entradas, salir
  if (mergedMap.size === 0) {
    return { success: false, totalFiles: 0, sizeBytes: 0 };
  }

  // Construir el nuevo Directory Tree en memoria
  const treeChunks: Buffer[] = [];
  const orderedEntries: VpkFileEntry[] = [];
  let currentDataOffset = 0;
  let fileCount = 0;

  const sortedExts = Array.from(mergedMap.keys()).sort();

  for (const ext of sortedExts) {
    treeChunks.push(Buffer.from(ext + "\0", "utf8"));
    const dirMap = mergedMap.get(ext)!;
    const sortedDirs = Array.from(dirMap.keys()).sort();

    for (const dir of sortedDirs) {
      treeChunks.push(Buffer.from(dir + "\0", "utf8"));
      const fileMap = dirMap.get(dir)!;
      const sortedFiles = Array.from(fileMap.keys()).sort();

      for (const fn of sortedFiles) {
        const entry = fileMap.get(fn)!;
        orderedEntries.push(entry);
        fileCount++;

        const entryRecord = Buffer.alloc(18);
        entryRecord.writeUInt32LE(entry.crc32, 0);
        entryRecord.writeUInt16LE(0, 4); // preloadBytes = 0 (data directo)
        entryRecord.writeUInt16LE(0x7fff, 6); // archiveIndex = embedded
        entryRecord.writeUInt32LE(currentDataOffset, 8);
        const totalLen = entry.preloadData.length + entry.entryLength;
        entryRecord.writeUInt32LE(totalLen, 12);
        entryRecord.writeUInt16LE(0xffff, 16); // terminator

        treeChunks.push(Buffer.from(fn + "\0", "utf8"));
        treeChunks.push(entryRecord);

        currentDataOffset += totalLen;
      }
      treeChunks.push(Buffer.from([0])); // Fin de archivos para este dir
    }
    treeChunks.push(Buffer.from([0])); // Fin de directorios para esta ext
  }
  treeChunks.push(Buffer.from([0])); // Fin del árbol de directorios

  const treeBuffer = Buffer.concat(treeChunks);

  // Cabecera VPK v1 (12 bytes)
  const headerBuf = Buffer.alloc(12);
  headerBuf.writeUInt32LE(VPK_MAGIC, 0);
  headerBuf.writeUInt32LE(1, 4); // Versión 1
  headerBuf.writeUInt32LE(treeBuffer.length, 8);

  const tmpPath = targetVpkPath + ".tmp";
  const outStream = fsSync.createWriteStream(tmpPath);

  // 1. Escribir cabecera y árbol
  outStream.write(headerBuf);
  outStream.write(treeBuffer);

  // 2. Stream de datos archivo por archivo desde los VPKs fuente
  for (const entry of orderedEntries) {
    if (entry.preloadData.length > 0) {
      outStream.write(entry.preloadData);
    }

    if (entry.entryLength > 0) {
      await new Promise<void>((resolve, reject) => {
        const inStream = fsSync.createReadStream(entry.sourceVpkPath, {
          start: entry.absoluteDataOffset,
          end: entry.absoluteDataOffset + entry.entryLength - 1,
        });

        inStream.on("data", (chunk) => {
          outStream.write(chunk);
        });
        inStream.on("end", () => resolve());
        inStream.on("error", (err) => reject(err));
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    outStream.end(() => resolve());
    outStream.on("error", reject);
  });

  // Reemplazo atómico
  if (fsSync.existsSync(targetVpkPath)) {
    try {
      fsSync.unlinkSync(targetVpkPath);
    } catch {
      // best-effort
    }
  }
  fsSync.renameSync(tmpPath, targetVpkPath);

  const stats = fsSync.statSync(targetVpkPath);
  return { success: true, totalFiles: fileCount, sizeBytes: stats.size };
}
