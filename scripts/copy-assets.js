import fs from "node:fs";
import path from "node:path";

const srcDir = path.resolve("src/renderer");
const distDir = path.resolve("dist/src/renderer");

fs.mkdirSync(distDir, { recursive: true });
for (const file of ["index.html", "style.css"]) {
  const srcFile = path.join(srcDir, file);
  const destFile = path.join(distDir, file);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, destFile);
    console.log(`[copy-assets] Copiado ${file} -> dist/src/renderer/`);
  }
}

// Copiar preload.cjs
const preloadSrc = path.resolve("src/preload/preload.cjs");
const preloadDistDir = path.resolve("dist/src/preload");
fs.mkdirSync(preloadDistDir, { recursive: true });
if (fs.existsSync(preloadSrc)) {
  fs.copyFileSync(preloadSrc, path.join(preloadDistDir, "preload.cjs"));
  console.log("[copy-assets] Copiado preload.cjs -> dist/src/preload/");
}

// Asegurar permisos de ejecutable para los binarios y scripts en resources/bin
for (const binPath of ["resources/bin/linux/vpk", "resources/bin/vpk-cli.cjs"]) {
  const full = path.resolve(binPath);
  if (fs.existsSync(full)) {
    try {
      fs.chmodSync(full, 0o755);
    } catch {}
  }
}
