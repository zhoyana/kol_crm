import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "20260826";
const packageName = `kol-crm-server-${version}`;
const distRoot = path.join(projectRoot, "dist");
const outputRoot = path.join(distRoot, packageName);
const archive = path.join(distRoot, `${packageName}.zip`);

function resetOutput() {
  if (path.dirname(path.resolve(outputRoot)) !== path.resolve(distRoot)) throw new Error("Invalid server package output path.");
  rmSync(outputRoot, { recursive: true, force: true });
  rmSync(archive, { force: true });
  mkdirSync(outputRoot, { recursive: true });
}

function copy(relativeSource, relativeTarget = relativeSource) {
  const source = path.join(projectRoot, relativeSource);
  if (!existsSync(source)) throw new Error(`Missing deployment source: ${relativeSource}`);
  cpSync(source, path.join(outputRoot, relativeTarget), {
    recursive: true,
    force: true,
    filter: (entry) => ![".env", ".env.local", ".env.production", "node_modules", "dist", ".next", ".next-dev", ".next-build"].includes(path.basename(entry))
  });
}

resetOutput();
for (const directory of ["app", "lib", "prisma", "public", "worker", "deploy"]) copy(directory);
mkdirSync(path.join(outputRoot, "local-agent"), { recursive: true });
copy("local-agent/contracts.ts");
for (const file of ["next.config.mjs", "next-env.d.ts", "tsconfig.json"]) copy(file);

const sourcePackage = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const sourceLock = JSON.parse(readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
const exactVersions = (dependencies) => Object.fromEntries(Object.keys(dependencies).map((name) => {
  const version = sourceLock.packages?.[`node_modules/${name}`]?.version;
  if (!version) throw new Error(`Missing locked version for ${name}`);
  return [name, version];
}));
const productionPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: "module",
  scripts: {
    build: "next build",
    start: "next start",
    worker: "node --env-file=.env.production worker/agent-worker.mjs",
    "db:generate": "prisma generate"
  },
  dependencies: exactVersions(sourcePackage.dependencies),
  devDependencies: exactVersions(sourcePackage.devDependencies)
};
writeFileSync(path.join(outputRoot, "package.json"), JSON.stringify(productionPackage, null, 2) + "\n");
cpSync(path.join(projectRoot, "deploy", ".env.production.example"), path.join(outputRoot, ".env.production.example"));
writeFileSync(path.join(outputRoot, "DEPLOYMENT-NOTICE.txt"), [
  "KOL CRM center web deployment package.",
  "No database password, .env file, backup, browser profile, or local Agent runtime is included.",
  "Read deploy/README-IT.md before deployment.",
  "Apply the included local-agent-channel SQL migration, then start both kol-crm-web and kol-crm-worker."
].join("\r\n"));

console.log("[server-package] Generating a clean cross-platform package lock...");
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error("npm CLI path is unavailable; run this builder through npm run server:package.");
execFileSync(process.execPath, [npmCli,
  "install", "--package-lock-only", "--include=optional", "--ignore-scripts", "--no-audit", "--no-fund"
], {
  cwd: outputRoot,
  stdio: "inherit",
  env: { ...process.env, npm_config_cache: path.join(projectRoot, ".npm-cache") }
});

execFileSync("powershell.exe", [
  "-NoProfile", "-Command",
  `Compress-Archive -LiteralPath '${outputRoot.replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}' -CompressionLevel Optimal`
], { stdio: "inherit" });

console.log(`SERVER_PACKAGE=${archive}`);
console.log(`BYTES=${statSync(archive).size}`);
