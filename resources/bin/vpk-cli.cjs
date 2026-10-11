#!/usr/bin/env node
/**
 * Standalone Valve VPK CLI Tool for S1mpleVersusLoader.
 * 
 * Implements the standard Valve VPK CLI contract:
 *   - list:    vpk l <file.vpk>
 *   - extract: vpk x <file.vpk> [internalPaths...] (writes relative to cwd)
 *   - pack:    vpk <folder> (generates <folder>.vpk)
 *
 * Fully compliant with standard Valve VPK v1 / v2 specification.
 * Zero external dependencies (uses standard Node.js built-ins).
 */

const fs = require("node:fs");
const path = require("node:path");

const VPK_SIGNATURE = 0x55aa1234;

// Standard CRC32 table (IEEE 802.3)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function calculateCrc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Parses the directory tree of a VPK file.
 * Returns an array of entry objects:
 * { fullPath, ext, dir, filename, crc, preloadBytes, archiveIndex, entryOffset, entryLength, preloadData }
 */
function parseVpkEntries(vpkPath) {
  if (!fs.existsSync(vpkPath)) {
    throw new Error(`File not found: ${vpkPath}`);
  }

  const fd = fs.openSync(vpkPath, "r");
  try {
    const headerBuf = Buffer.alloc(28);
    const bytesRead = fs.readSync(fd, headerBuf, 0, 28, 0);
    if (bytesRead < 12) {
      throw new Error(`Invalid VPK file (header too small): ${vpkPath}`);
    }

    const signature = headerBuf.readUInt32LE(0);
    if (signature !== VPK_SIGNATURE) {
      throw new Error(`Invalid VPK signature 0x${signature.toString(16)} (expected 0x55aa1234): ${vpkPath}`);
    }

    const version = headerBuf.readUInt32LE(4);
    const treeSize = headerBuf.readUInt32LE(8);

    let headerSize = 12;
    if (version === 2) {
      headerSize = 28;
    }

    const treeBuf = Buffer.alloc(treeSize);
    fs.readSync(fd, treeBuf, 0, treeSize, headerSize);

    const dataSectionOffset = headerSize + treeSize;

    let pos = 0;
    function readNullTerminatedString() {
      const start = pos;
      while (pos < treeBuf.length && treeBuf[pos] !== 0) {
        pos++;
      }
      const str = treeBuf.toString("utf8", start, pos);
      pos++; // skip null terminator
      return str;
    }

    const entries = [];

    while (pos < treeBuf.length) {
      const ext = readNullTerminatedString();
      if (!ext) break;

      while (pos < treeBuf.length) {
        const dir = readNullTerminatedString();
        if (!dir) break;

        while (pos < treeBuf.length) {
          const filename = readNullTerminatedString();
          if (!filename) break;

          const crc = treeBuf.readUInt32LE(pos); pos += 4;
          const preloadBytes = treeBuf.readUInt16LE(pos); pos += 2;
          const archiveIndex = treeBuf.readUInt16LE(pos); pos += 2;
          const entryOffset = treeBuf.readUInt32LE(pos); pos += 4;
          const entryLength = treeBuf.readUInt32LE(pos); pos += 4;
          const terminator = treeBuf.readUInt16LE(pos); pos += 2;

          let preloadData = null;
          if (preloadBytes > 0) {
            preloadData = treeBuf.subarray(pos, pos + preloadBytes);
            pos += preloadBytes;
          }

          const fullPath = (dir === " " || dir === "")
            ? (ext === " " || ext === "" ? filename : `${filename}.${ext}`)
            : (ext === " " || ext === "" ? `${dir}/${filename}` : `${dir}/${filename}.${ext}`);

          entries.push({
            fullPath,
            ext,
            dir,
            filename,
            crc,
            preloadBytes,
            archiveIndex,
            entryOffset,
            entryLength,
            preloadData,
            dataOffsetInVpk: dataSectionOffset + entryOffset,
          });
        }
      }
    }

    return { fd, entries, dataSectionOffset };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

/**
 * Command: list
 * Usage: vpk l <vpkPath>
 */
function handleList(vpkPath) {
  const { fd, entries } = parseVpkEntries(vpkPath);
  try {
    for (const entry of entries) {
      process.stdout.write(entry.fullPath + "\n");
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Command: extract
 * Usage: vpk x <vpkPath> [internalPaths...]
 * Writes files relative to current working directory (process.cwd()).
 */
function handleExtract(vpkPath, requestedPaths) {
  const { fd, entries, dataSectionOffset } = parseVpkEntries(vpkPath);
  try {
    const cwd = process.cwd();
    const entryMap = new Map();
    for (const entry of entries) {
      // Normalize internal path separators to forward slash
      const normalized = entry.fullPath.replace(/\\/g, "/");
      entryMap.set(normalized, entry);
    }

    const pathsToExtract = requestedPaths.length > 0
      ? requestedPaths.map(p => p.replace(/\\/g, "/"))
      : Array.from(entryMap.keys());

    for (const reqPath of pathsToExtract) {
      const entry = entryMap.get(reqPath);
      if (!entry) {
        // Warning if specific requested file is not in archive
        process.stderr.write(`Warning: file not found in VPK: ${reqPath}\n`);
        continue;
      }

      const outRelative = path.normalize(entry.fullPath);
      const outFull = path.resolve(cwd, outRelative);

      // Create target directory if needed
      fs.mkdirSync(path.dirname(outFull), { recursive: true });

      const outFd = fs.openSync(outFull, "w");
      try {
        if (entry.preloadBytes > 0 && entry.preloadData) {
          fs.writeSync(outFd, entry.preloadData);
        }

        if (entry.entryLength > 0 && entry.archiveIndex === 0x7fff) {
          // Stream in 64 KiB chunks
          const CHUNK_SIZE = 64 * 1024;
          const chunk = Buffer.alloc(CHUNK_SIZE);
          let remaining = entry.entryLength;
          let currentPos = entry.dataOffsetInVpk;

          while (remaining > 0) {
            const toRead = Math.min(remaining, CHUNK_SIZE);
            const read = fs.readSync(fd, chunk, 0, toRead, currentPos);
            if (read <= 0) break;
            fs.writeSync(outFd, chunk, 0, read);
            remaining -= read;
            currentPos += read;
          }
        }
      } finally {
        fs.closeSync(outFd);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Recursively scans a directory for files.
 */
function scanDirectory(dir, base = "") {
  let results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    const rel = base ? `${base}/${item.name}` : item.name;
    if (item.isDirectory()) {
      results = results.concat(scanDirectory(full, rel));
    } else if (item.isFile()) {
      results.push({ full, rel: rel.replace(/\\/g, "/") });
    }
  }
  return results;
}

/**
 * Command: pack
 * Usage: vpk <sourceDir>
 * Generates <sourceDir>.vpk.
 */
function handlePack(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }
  const stat = fs.statSync(sourceDir);
  if (!stat.isDirectory()) {
    throw new Error(`Source is not a directory: ${sourceDir}`);
  }

  const vpkOutput = `${sourceDir.replace(/[\\/]+$/, "")}.vpk`;
  const scannedFiles = scanDirectory(sourceDir);

  // Group by extension -> directory -> filename
  const tree = new Map();
  const fileEntries = [];
  let currentDataOffset = 0;

  for (const f of scannedFiles) {
    const parts = f.rel.split("/");
    const fullName = parts.pop();
    const dir = parts.length > 0 ? parts.join("/") : " ";
    const dotIndex = fullName.lastIndexOf(".");
    const ext = dotIndex !== -1 ? fullName.slice(dotIndex + 1) : " ";
    const filename = dotIndex !== -1 ? fullName.slice(0, dotIndex) : fullName;

    const fileStat = fs.statSync(f.full);
    const length = fileStat.size;

    // Read file data to compute CRC32
    const content = fs.readFileSync(f.full);
    const crc = calculateCrc32(content);

    const entry = {
      fullPath: f.rel,
      diskPath: f.full,
      ext,
      dir,
      filename,
      crc,
      offset: currentDataOffset,
      length,
    };
    fileEntries.push(entry);
    currentDataOffset += length;

    if (!tree.has(ext)) tree.set(ext, new Map());
    const extMap = tree.get(ext);
    if (!extMap.has(dir)) extMap.set(dir, []);
    extMap.get(dir).push(entry);
  }

  // Construct directory tree buffer
  const treeChunks = [];
  for (const [ext, dirMap] of tree.entries()) {
    treeChunks.push(Buffer.from(ext + "\0", "utf8"));
    for (const [dir, entries] of dirMap.entries()) {
      treeChunks.push(Buffer.from(dir + "\0", "utf8"));
      for (const e of entries) {
        treeChunks.push(Buffer.from(e.filename + "\0", "utf8"));
        const meta = Buffer.alloc(18);
        meta.writeUInt32LE(e.crc, 0);
        meta.writeUInt16LE(0, 4);      // preloadBytes = 0
        meta.writeUInt16LE(0x7fff, 6);  // archiveIndex = 0x7fff (self)
        meta.writeUInt32LE(e.offset, 8);
        meta.writeUInt32LE(e.length, 12);
        meta.writeUInt16LE(0xffff, 16); // terminator
        treeChunks.push(meta);
      }
      treeChunks.push(Buffer.from("\0", "utf8")); // end of dir
    }
    treeChunks.push(Buffer.from("\0", "utf8")); // end of ext
  }
  treeChunks.push(Buffer.from("\0", "utf8")); // end of tree
  const treeBuf = Buffer.concat(treeChunks);

  // VPK v1 Header (12 bytes)
  const headerBuf = Buffer.alloc(12);
  headerBuf.writeUInt32LE(VPK_SIGNATURE, 0);
  headerBuf.writeUInt32LE(1, 4); // version 1
  headerBuf.writeUInt32LE(treeBuf.length, 8);

  // Write file
  const outFd = fs.openSync(vpkOutput, "w");
  try {
    fs.writeSync(outFd, headerBuf);
    fs.writeSync(outFd, treeBuf);

    // Stream file data in chunks to keep memory usage low
    const CHUNK_SIZE = 64 * 1024;
    const chunk = Buffer.alloc(CHUNK_SIZE);
    for (const e of fileEntries) {
      const inFd = fs.openSync(e.diskPath, "r");
      try {
        let remaining = e.length;
        let pos = 0;
        while (remaining > 0) {
          const toRead = Math.min(remaining, CHUNK_SIZE);
          const read = fs.readSync(inFd, chunk, 0, toRead, pos);
          if (read <= 0) break;
          fs.writeSync(outFd, chunk, 0, read);
          remaining -= read;
          pos += read;
        }
      } finally {
        fs.closeSync(inFd);
      }
    }
  } finally {
    fs.closeSync(outFd);
  }
}

// Main CLI entry point
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("Usage: vpk <folder> | vpk l <vpkfile> | vpk x <vpkfile> [path...]\n");
    process.exit(1);
  }

  const firstArg = args[0];

  try {
    if (firstArg === "l" || firstArg === "list") {
      if (args.length < 2) {
        throw new Error("Missing VPK file path for list command");
      }
      handleList(args[1]);
    } else if (firstArg === "x" || firstArg === "extract") {
      if (args.length < 2) {
        throw new Error("Missing VPK file path for extract command");
      }
      const vpkPath = args[1];
      const paths = args.slice(2);
      handleExtract(vpkPath, paths);
    } else {
      // Pack command: vpk <sourceDir>
      handlePack(firstArg);
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

main();
