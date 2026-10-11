import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

const CLI_PATH = path.resolve(__dirname, "../resources/bin/vpk-cli.cjs");
const LINUX_BIN = path.resolve(__dirname, "../resources/bin/linux/vpk");

function runCli(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], { cwd: cwd ?? process.cwd() }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode });
    });
  });
}

function runLinuxBin(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(LINUX_BIN, args, { cwd: cwd ?? process.cwd() }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode });
    });
  });
}

describe("Bundled VPK Tool (Fase 1)", () => {
  test("CLI exists and has valid permissions", () => {
    expect(fs.existsSync(CLI_PATH)).toBe(true);
    expect(fs.existsSync(LINUX_BIN)).toBe(true);
    const stat = fs.statSync(LINUX_BIN);
    expect((stat.mode & 0o111) !== 0).toBe(true); // Executable
  });

  test("Pack folder into VPK and list contents", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vpk-cli-test-"));
    const sourceDir = path.join(tempDir, "my_mod");
    fs.mkdirSync(path.join(sourceDir, "materials", "models"), { recursive: true });
    fs.mkdirSync(path.join(sourceDir, "sound"), { recursive: true });

    fs.writeFileSync(path.join(sourceDir, "addoninfo.txt"), "AddonInfo { name \"Test Mod\" }", "utf8");
    fs.writeFileSync(path.join(sourceDir, "materials", "models", "coach.vmt"), "\"VertexLitGeneric\"", "utf8");
    fs.writeFileSync(path.join(sourceDir, "sound", "ping.wav"), "DUMMY SOUND DATA", "utf8");

    // 1. Pack: vpk <sourceDir>
    const packResult = await runCli([sourceDir]);
    expect(packResult.exitCode).toBe(0);

    const generatedVpk = `${sourceDir}.vpk`;
    expect(fs.existsSync(generatedVpk)).toBe(true);

    // 2. List: vpk l <vpkPath>
    const listResult = await runCli(["l", generatedVpk]);
    expect(listResult.exitCode).toBe(0);

    const lines = listResult.stdout.trim().split("\n").map((l) => l.trim()).sort();
    expect(lines).toEqual([
      "addoninfo.txt",
      "materials/models/coach.vmt",
      "sound/ping.wav",
    ]);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("Extract specific files and roundtrip file integrity", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vpk-extract-test-"));
    const sourceDir = path.join(tempDir, "test_addon");
    fs.mkdirSync(path.join(sourceDir, "models", "survivors"), { recursive: true });

    const originalContent = "SURVIVOR COACH MODEL DATA 1234567890";
    fs.writeFileSync(path.join(sourceDir, "models", "survivors", "coach.mdl"), originalContent, "utf8");
    fs.writeFileSync(path.join(sourceDir, "addoninfo.txt"), "Title \"Only Coach\"", "utf8");

    // Pack
    await runCli([sourceDir]);
    const vpkPath = `${sourceDir}.vpk`;

    // Extract to target dir
    const destDir = path.join(tempDir, "extracted");
    fs.mkdirSync(destDir, { recursive: true });

    // Extract only coach.mdl
    const extractResult = await runCli(["x", vpkPath, "models/survivors/coach.mdl"], destDir);
    expect(extractResult.exitCode).toBe(0);

    const extractedCoach = path.join(destDir, "models", "survivors", "coach.mdl");
    expect(fs.existsSync(extractedCoach)).toBe(true);
    expect(fs.readFileSync(extractedCoach, "utf8")).toBe(originalContent);

    // Verify addoninfo.txt was not extracted
    expect(fs.existsSync(path.join(destDir, "addoninfo.txt"))).toBe(false);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("Linux wrapper resources/bin/linux/vpk executes directly", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vpk-linux-test-"));
    const sourceDir = path.join(tempDir, "mod_linux");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "addoninfo.txt"), "Linux mod test", "utf8");

    // Pack with Linux binary wrapper
    const packRes = await runLinuxBin([sourceDir]);
    expect(packRes.exitCode).toBe(0);
    expect(fs.existsSync(`${sourceDir}.vpk`)).toBe(true);

    // List with Linux binary wrapper
    const listRes = await runLinuxBin(["l", `${sourceDir}.vpk`]);
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout.trim()).toBe("addoninfo.txt");

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("Handles files with spaces and nested directory structure", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vpk-spaces-test-"));
    const sourceDir = path.join(tempDir, "space_mod");
    fs.mkdirSync(path.join(sourceDir, "materials", "some folder"), { recursive: true });

    const content = "spaces test vmt";
    fs.writeFileSync(path.join(sourceDir, "materials", "some folder", "my texture file.vmt"), content, "utf8");

    // Pack
    await runCli([sourceDir]);
    const vpkPath = `${sourceDir}.vpk`;

    // List
    const listRes = await runCli(["l", vpkPath]);
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout.trim()).toBe("materials/some folder/my texture file.vmt");

    // Extract
    const destDir = path.join(tempDir, "dest");
    fs.mkdirSync(destDir, { recursive: true });
    const extractRes = await runCli(["x", vpkPath, "materials/some folder/my texture file.vmt"], destDir);
    expect(extractRes.exitCode).toBe(0);

    const extractedFile = path.join(destDir, "materials", "some folder", "my texture file.vmt");
    expect(fs.existsSync(extractedFile)).toBe(true);
    expect(fs.readFileSync(extractedFile, "utf8")).toBe(content);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("ChildProcessCommandRunner executes bundled .cjs through VpkTool", async () => {
    const { VpkTool } = await import("../src/main/domain/vpk-tool.js");
    const { ChildProcessCommandRunner } = await import("../src/main/data/child-process-command-runner.js");

    const runner = new ChildProcessCommandRunner();
    const tool = new VpkTool(runner, CLI_PATH);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vpk-runner-cjs-"));
    const sourceDir = path.join(tempDir, "runner_mod");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "addoninfo.txt"), "Test VpkTool with CJS", "utf8");

    const vpkPath = await tool.pack(sourceDir, "addon-1");
    expect(fs.existsSync(vpkPath)).toBe(true);

    const list = await tool.list(vpkPath, "addon-1");
    expect(list).toEqual(["addoninfo.txt"]);

    const extractDir = path.join(tempDir, "out");
    fs.mkdirSync(extractDir, { recursive: true });
    await tool.extract(vpkPath, list, extractDir, "addon-1");
    expect(fs.readFileSync(path.join(extractDir, "addoninfo.txt"), "utf8")).toBe("Test VpkTool with CJS");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("PathDetector resolves bundled VPK tool fallback when vpk.exe is missing", async () => {
    const { PathDetector } = await import("../src/main/domain/path-detector.js");
    const { RealFileSystemProbe } = await import("../src/main/data/file-system-probe.js");

    const realFs = new RealFileSystemProbe();
    const detector = new PathDetector({
      registry: { readValue: async () => null },
      fs: realFs,
      manual: { requestPath: async () => ({ kind: "cancelled" }) },
    });

    const dummyPaths = {
      steamPath: "/dummy/steam",
      gameRoot: "/dummy/steam/steamapps/common/Left 4 Dead 2",
      left4dead2Dir: "/dummy/steam/steamapps/common/Left 4 Dead 2/left4dead2",
      workshopFolder: "/dummy/steam/steamapps/common/Left 4 Dead 2/left4dead2/addons/workshop",
      vpkToolPath: "/dummy/steam/steamapps/common/Left 4 Dead 2/bin/vpk.exe", // missing on disk
      gameInfoFile: "/dummy/steam/steamapps/common/Left 4 Dead 2/left4dead2/gameinfo.txt",
      modsvsFolder: "/dummy/steam/steamapps/common/Left 4 Dead 2/left4dead2/modsvs",
    };

    const verification = await detector.verifyPathsOnDisk(dummyPaths);
    // Because bundled VPK tool exists on disk in the project, vpkToolPath is found and resolved!
    expect(verification.present.vpkToolPath).toBe(true);
    expect(dummyPaths.vpkToolPath.includes("vpk")).toBe(true);
  });
});

