const { execFileSync } = require("node:child_process");
const {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (item.startsWith("--")) {
    args.set(item.slice(2), process.argv[index + 1]);
    index += 1;
  }
}

const platform = args.get("platform") || process.platform;
const arch = args.get("arch") || process.arch;
const uv = args.get("uv") || process.env.UV || "uv";
const pythonVersion = args.get("python-version") || process.env.SECOND_BRAIN_RUNTIME_PYTHON_VERSION || "3.12";
const runtimeDir = path.join(rootDir, "resources", "production-runtime", `${platform}-${arch}`);
const standaloneInstallDir = path.join(rootDir, ".runtime-python-install", `${platform}-${arch}`);
const packages = [
  "graphifyy[pdf,office,openai,mcp]",
  "fpdf2",
  "pypdf"
];

function run(command, commandArgs, options = {}) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });
}

function pythonLibVersion() {
  return pythonVersion.startsWith("3.12") || pythonVersion === "3.12" ? "python3.12" : `python${pythonVersion}`;
}

function findPythonInstallRoot(directory) {
  if (!existsSync(directory)) {
    throw new Error(`Python install directory was not created: ${directory}`);
  }

  const entries = readdirSync(directory)
    .map((entry) => path.join(directory, entry))
    .filter((entry) => {
      try {
        return statSync(entry).isDirectory();
      } catch {
        return false;
      }
    });
  const candidates = [directory, ...entries];
  for (const candidate of candidates) {
    const executable = findPythonExecutable(candidate);
    if (executable) {
      return candidate;
    }
  }

  throw new Error(`No managed Python executable found in ${directory}`);
}

function findPythonExecutable(directory) {
  const candidates = platform === "win32"
    ? [
        path.join(directory, "python.exe"),
        path.join(directory, "Scripts", "python.exe")
      ]
    : [
        path.join(directory, "bin", "python3"),
        path.join(directory, "bin", "python3.12"),
        path.join(directory, "bin", "python")
      ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function copyDirectoryContents(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    cpSync(path.join(source, entry), path.join(destination, entry), {
      recursive: true,
      dereference: true
    });
  }
}

function ensureRuntimePythonAliases() {
  if (platform === "win32") {
    return;
  }

  const binDir = path.join(runtimeDir, "bin");

  const targetName = ["python3.12", "python3", "python"].find((name) => {
    try {
      const candidate = path.join(binDir, name);
      return existsSync(candidate) && !lstatSync(candidate).isSymbolicLink();
    } catch {
      return false;
    }
  });

  if (!targetName) {
    return;
  }

  for (const alias of ["python3", "python"]) {
    if (alias === targetName) {
      continue;
    }

    const aliasPath = path.join(binDir, alias);
    rmSync(aliasPath, { force: true });
    try {
      symlinkSync(targetName, aliasPath);
    } catch {
      copyFileSync(path.join(binDir, targetName), aliasPath);
      chmodSync(aliasPath, 0o755);
    }
  }
}

function bundledSitePackagesPath() {
  if (platform === "win32") {
    return path.join(runtimeDir, "Lib", "site-packages");
  }

  return path.join(runtimeDir, "lib", pythonLibVersion(), "site-packages");
}

function createGraphifyLauncher() {
  if (platform === "win32") {
    const scriptsDir = path.join(runtimeDir, "Scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, "graphify.cmd"),
      "@echo off\r\n\"%~dp0\\..\\python.exe\" -m graphify %*\r\n",
      "utf8"
    );
    return;
  }

  const binDir = path.join(runtimeDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const launcher = path.join(binDir, "graphify");
  writeFileSync(
    launcher,
    "#!/usr/bin/env sh\nSCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\nexec \"$SCRIPT_DIR/python3\" -m graphify \"$@\"\n",
    "utf8"
  );
  chmodSync(launcher, 0o755);
}

function removeUnixRuntimeHelperScripts() {
  if (platform === "win32") {
    return;
  }

  const binDir = path.join(runtimeDir, "bin");
  if (!existsSync(binDir)) {
    return;
  }

  const keep = new Set(["python", "python3", "python3.12", "graphify"]);
  for (const entry of readdirSync(binDir)) {
    if (keep.has(entry)) {
      continue;
    }

    if (
      entry === "2to3" ||
      entry.startsWith("2to3-") ||
      entry === "idle3" ||
      entry.startsWith("idle3.") ||
      entry === "pydoc3" ||
      entry.startsWith("pydoc3.") ||
      entry === "python-config" ||
      entry.startsWith("python3-config") ||
      entry.endsWith("-config")
    ) {
      rmSync(path.join(binDir, entry), { force: true });
    }
  }
}

function pruneDirectory(directory) {
  if (!existsSync(directory)) {
    return;
  }

  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    let stats;
    try {
      stats = lstatSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isSymbolicLink()) {
      try {
        const target = readlinkSync(fullPath);
        const resolvedTarget = path.resolve(path.dirname(fullPath), target);
        if (!resolvedTarget.startsWith(`${runtimeDir}${path.sep}`) && resolvedTarget !== runtimeDir) {
          rmSync(fullPath, { force: true });
          continue;
        }
        statSync(fullPath);
      } catch {
        rmSync(fullPath, { force: true });
      }
    } else if (stats.isDirectory()) {
      if (
        entry === "__pycache__" ||
        entry === "tests" ||
        entry === "test" ||
        entry === "testing" ||
        entry === "docs" ||
        entry === "doc" ||
        entry === "idlelib" ||
        entry === "tkinter" ||
        entry === "ensurepip"
      ) {
        rmSync(fullPath, { recursive: true, force: true });
      } else {
        pruneDirectory(fullPath);
      }
    } else if (/\.(pyc|pyo|a|lib)$/i.test(entry)) {
      rmSync(fullPath, { force: true });
    }
  }
}

rmSync(runtimeDir, { recursive: true, force: true });
rmSync(standaloneInstallDir, { recursive: true, force: true });
mkdirSync(path.dirname(runtimeDir), { recursive: true });
mkdirSync(path.dirname(standaloneInstallDir), { recursive: true });

run(uv, [
  "python",
  "install",
  pythonVersion,
  "--install-dir",
  standaloneInstallDir,
  "--managed-python",
  "--reinstall",
  "--force",
  "--no-progress",
  ...(platform === "win32" ? ["--no-registry"] : [])
]);

const installRoot = findPythonInstallRoot(standaloneInstallDir);
copyDirectoryContents(installRoot, runtimeDir);
ensureRuntimePythonAliases();

const pythonBin = findPythonExecutable(runtimeDir);
if (!pythonBin) {
  throw new Error(`No runtime Python executable found in ${runtimeDir}`);
}

const sitePackages = bundledSitePackagesPath();
mkdirSync(sitePackages, { recursive: true });
run(pythonBin, ["-m", "pip", "install", "--break-system-packages", "--upgrade", "--target", sitePackages, ...packages], {
  env: { ...process.env, PYTHONNOUSERSITE: "1" }
});
createGraphifyLauncher();
run(pythonBin, ["-c", "import graphify, fpdf, pypdf; print('runtime ok')"], {
  env: { ...process.env, PYTHONNOUSERSITE: "1" }
});

removeUnixRuntimeHelperScripts();
pruneDirectory(runtimeDir);
pruneDirectory(runtimeDir);
ensureRuntimePythonAliases();
pruneDirectory(runtimeDir);
rmSync(standaloneInstallDir, { recursive: true, force: true });
console.log(`Prepared production runtime: ${runtimeDir}`);
