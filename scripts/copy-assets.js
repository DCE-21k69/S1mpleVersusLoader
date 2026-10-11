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
