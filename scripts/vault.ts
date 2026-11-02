/**
 * Server-side administration.
 *
 *   npm run vault:init                 create the vault (prompts for a passphrase)
 *   npm run vault:passwd               change the passphrase
 *   npm run vault:reset-2fa            turn off two-factor auth (needs the passphrase)
 *   npm run vault:import -- <dir>      import an old PHP vault (or any folder tree)
 *
 * Stop the web server while importing: both processes share the job queue.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { config } from "../lib/server/config";
import { db, setMeta } from "../lib/server/db";
import { onUnsealed } from "../lib/server/events";
import { changePassphrase, initVault, isInitialized, unlock, validatePassphrase, verifyPassphrase } from "../lib/server/keyring";
import { createAlbum, findAlbumByName, insertItem } from "../lib/server/media";
import { ingest, kick, recoverJobs } from "../lib/server/processing";
import { sniff } from "../lib/server/sniff";
import { sanitizeName } from "../lib/server/uploads";

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
    muted = hidden;
  });
}

async function passphrase(prompt = "Passphrase: "): Promise<string> {
  return process.env.VAULT_PASSPHRASE ?? (await ask(prompt, true));
}

async function unlockOrDie(): Promise<string> {
  if (!isInitialized()) die("Vault is not initialized. Run `npm run vault:init` first.");
  const p = await passphrase();
  if ((await unlock(p)) !== "ok") die("Wrong passphrase.");
  return p;
}

function die(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function cmdInit() {
  if (isInitialized()) die(`A vault already exists in ${config.dataDir}`);
  const a = await passphrase("New passphrase (10+ characters): ");
  const problem = validatePassphrase(a);
  if (problem) die(problem);
  if (!process.env.VAULT_PASSPHRASE && a !== (await ask("Repeat passphrase: ", true))) die("Passphrases don't match.");
  console.log("Deriving keys (this takes a moment on purpose)…");
  await initVault(a);
  console.log(`✔ Vault created in ${config.dataDir}`);
  console.log("  There is no recovery: if the passphrase is lost, so is the data.");
}

async function cmdPasswd() {
  const cur = await passphrase("Current passphrase: ");
  const next = await ask("New passphrase: ", true);
  if (next !== (await ask("Repeat new passphrase: ", true))) die("Passphrases don't match.");
  if (!(await changePassphrase(cur, next))) die("Current passphrase is wrong.");
  db().prepare("DELETE FROM sessions").run();
  console.log("✔ Passphrase changed. All sessions were signed out.");
}

async function cmdReset2fa() {
  const p = await passphrase();
  if (!(await verifyPassphrase(p))) die("Wrong passphrase.");
  setMeta("totp_secret", null);
  setMeta("totp_last", null);
  setMeta("totp_pending", null);
  console.log("✔ Two-factor authentication is off.");
}

const SKIP_DIRS = new Set(["src", "trash", "compressed", "node_modules", ".git", "data", ".next"]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

async function mediaFiles(dir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) => collator.compare(a.name, b.name));
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive && !SKIP_DIRS.has(e.name)) out.push(...(await mediaFiles(full, true)));
    } else if (e.isFile()) out.push(full);
  }
  return out;
}

async function importFile(file: string, albumId: string | null): Promise<"ok" | "skipped" | "failed"> {
  const fh = await fsp.open(file, "r");
  const head = Buffer.alloc(4096);
  const { bytesRead } = await fh.read(head, 0, 4096, 0);
  const { size, mtimeMs } = await fh.stat();
  await fh.close();
  const kind = sniff(head.subarray(0, bytesRead));
  if (!kind || size === 0) return "skipped";

  const item = insertItem({ albumId, kind: kind.kind, name: sanitizeName(path.basename(file)), mime: kind.mime, size, takenAt: Math.round(mtimeMs) });
  await fsp.mkdir(config.workDir, { recursive: true, mode: 0o700 });
  const src = path.join(config.workDir, `ingest-${item.id}`);
  await fsp.copyFile(file, src); // ingest consumes (and shreds) its copy; the source is left untouched
  try {
    await ingest(item, { src });
    return "ok";
  } catch (err) {
    console.error(`  ✖ ${file}: ${(err as Error).message}`);
    db().prepare("DELETE FROM items WHERE id = ?").run(item.id);
    await fsp.rm(src, { force: true });
    return "failed";
  }
}

async function cmdImport(root: string | undefined) {
  if (!root) die("Usage: npm run vault:import -- /path/to/old/vault");
  const dir = path.resolve(root);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) die(`Not a directory: ${dir}`);
  await unlockOrDie();
  recoverJobs();
  onUnsealed(kick);

  const plan: { album: string | null; files: string[] }[] = [{ album: null, files: await mediaFiles(dir, false) }];
  for (const e of (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) => collator.compare(a.name, b.name))) {
    if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const name = e.name.charAt(0).toUpperCase() + e.name.slice(1);
    plan.push({ album: name, files: await mediaFiles(path.join(dir, e.name), true) });
  }

  const totals = { ok: 0, skipped: 0, failed: 0 };
  for (const group of plan) {
    if (!group.files.length) continue;
    let albumId: string | null = null;
    if (group.album) albumId = (findAlbumByName(group.album) ?? createAlbum(group.album)).id;
    console.log(`\n▸ ${group.album ?? "Unsorted"} (${group.files.length} files)`);
    for (const [i, f] of group.files.entries()) {
      const r = await importFile(f, albumId);
      totals[r]++;
      process.stdout.write(`\r  ${i + 1}/${group.files.length}  ${r === "ok" ? "✔" : r === "skipped" ? "·" : "✖"} ${path.basename(f).slice(0, 60).padEnd(60)}`);
    }
    process.stdout.write("\n");
  }

  // Video conversion / storyboards were queued by ingest; let them finish.
  kick();
  for (;;) {
    const { n } = db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('pending','running')").get() as { n: number };
    if (!n) break;
    process.stdout.write(`\r  finishing ${n} background job(s)…   `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`\n✔ Imported ${totals.ok}, skipped ${totals.skipped} non-media, ${totals.failed} failed.`);
  console.log("  Originals were left untouched. Once you've checked the vault, delete the old folder securely.");
}

const [cmd, arg] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  init: cmdInit,
  passwd: cmdPasswd,
  "reset-2fa": cmdReset2fa,
  import: () => cmdImport(arg),
};
if (!commands[cmd]) die(`Unknown command "${cmd}". Use: init | passwd | reset-2fa | import <dir>`);
commands[cmd]()
  .then(() => process.exit(0))
  .catch((e) => die(e.message));
