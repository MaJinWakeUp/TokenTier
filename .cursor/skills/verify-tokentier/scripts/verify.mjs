#!/usr/bin/env node
// Drive one isolated TokenTier dev server and a headless Chrome profile.
// State lives in TOKENTIER_VERIFY_DIR. Evidence in that directory is kept on stop.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const chromeBin = process.env.CHROME_PATH || "google-chrome";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function statePath(dir) {
  return path.join(dir, "state.json");
}

function readState(dir) {
  const file = statePath(dir);
  if (!existsSync(file)) fail(`No verification instance at ${dir}. Run launch first.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeState(dir, state) {
  writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`);
}

function requireDir(args) {
  const dir = args.dir || process.env.TOKENTIER_VERIFY_DIR;
  if (!dir) fail("Set TOKENTIER_VERIFY_DIR or pass --dir. Launch prints the export line.");
  return dir;
}

function pidAlive(pid) {
  if (!pid || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killGroup(pid) {
  if (!pid || pid <= 1) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
}

function killGroupHard(pid) {
  if (!pid || pid <= 1) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

function parentPid(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const line = status.split("\n").find((entry) => entry.startsWith("PPid:"));
    return line ? Number(line.split(/\s+/)[1]) : 0;
  } catch {
    return 0;
  }
}

function isInProcessTree(ancestor, pid) {
  let current = pid;
  for (let hop = 0; hop < 30 && current > 1; hop += 1) {
    if (current === ancestor) return true;
    const parent = parentPid(current);
    if (!parent || parent === current) return false;
    current = parent;
  }
  return false;
}

function listeningPids(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.trim().split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      const localPort = parts[1]?.split(":")[1];
      const tcpState = parts[3];
      const inode = parts[9];
      if (localPort?.toUpperCase() === hex && tcpState === "0A") inodes.add(inode);
    }
  }
  const pids = [];
  let procIds = [];
  try { procIds = readdirSync("/proc").filter((name) => /^\d+$/.test(name)); } catch { return pids; }
  for (const pid of procIds) {
    let fds = [];
    try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      try {
        const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match && inodes.has(match[1])) {
          pids.push(Number(pid));
          break;
        }
      } catch { /* fd vanished */ }
    }
  }
  return pids;
}

function freePort(start) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => {
      if (start > 65000) reject(new Error("no free port"));
      else resolve(freePort(start + 1));
    });
    server.listen(start, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : start;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      const body = await response.text();
      if (response.status === 200 && body.includes("TokenTier")) return body;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`TokenTier did not become ready at ${url} (${last}).`);
}

function titleOf(html) {
  const match = /<title>([^<]*)<\/title>/.exec(html);
  return match ? match[1].trim() : "";
}

function evidenceFile(dir, filePath) {
  const evidence = path.join(dir, "evidence");
  mkdirSync(evidence, { recursive: true });
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(evidence, filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 0;
    ws.addEventListener("error", () => reject(new Error(`CDP connection failed for ${wsUrl}`)));
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message || "CDP error"}`));
      else waiter.resolve(message.result || {});
    });
    const session = {
      send(method, params = {}) {
        const id = ++nextId;
        return new Promise((resolveSend, rejectSend) => {
          pending.set(id, { resolve: resolveSend, reject: rejectSend });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { ws.close(); },
    };
    ws.addEventListener("open", () => resolve(session));
  });
}

async function ensureChrome(dir, state) {
  if (state.chromePid && pidAlive(state.chromePid) && state.chromePort) {
    try {
      const version = await fetch(`http://127.0.0.1:${state.chromePort}/json/version`);
      if (version.ok) return state;
    } catch { /* restart below */ }
  }
  const which = spawnSync("which", [chromeBin], { encoding: "utf8" });
  if (which.status !== 0) fail(`google-chrome is required to drive TokenTier. Set CHROME_PATH if it is not on PATH.`);
  const chromePort = await freePort(state.chromePort || 9222);
  const profile = path.join(dir, "chrome-profile");
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const logFd = openSync(path.join(dir, "chrome.log"), "a");
  const child = spawn(chromeBin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,1100",
    "--lang=en-US",
    "about:blank",
  ], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, LANG: "en_US.UTF-8" },
  });
  child.unref();
  closeSync(logFd);
  state.chromePid = child.pid;
  state.chromePort = chromePort;
  state.chromeProfile = profile;
  writeState(dir, state);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const version = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
      if (version.ok) return state;
    } catch { /* chrome still starting */ }
    if (!pidAlive(child.pid)) fail(`Chrome exited during startup. See ${path.join(dir, "chrome.log")}`);
    await delay(200);
  }
  fail(`Chrome did not open a debugging port. See ${path.join(dir, "chrome.log")}`);
}

async function withPage(dir, fn) {
  const state = readState(dir);
  if (state.status !== "running") fail(`Instance at ${dir} is ${state.status}. Launch a new directory.`);
  await ensureChrome(dir, state);
  const list = await fetch(`http://127.0.0.1:${state.chromePort}/json/list`).then((response) => response.json());
  const page = list.find((target) => target.type === "page");
  if (!page?.webSocketDebuggerUrl) fail("Chrome has no page target.");
  const session = await connectCdp(page.webSocketDebuggerUrl);
  try {
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    return await fn(session, state);
  } finally {
    session.close();
  }
}

async function evaluate(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "page evaluation failed";
    fail(text);
  }
  return result.result?.value;
}

const pageHelpers = `
function accName(el) {
  const labelled = el.getAttribute("aria-label");
  if (labelled) return labelled.trim();
  const clone = el.cloneNode(true);
  for (const hidden of clone.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  return (clone.innerText || clone.textContent || "").replace(/\\s+/g, " ").trim();
}
function nameMatches(actual, expected) {
  return actual === expected || actual.startsWith(expected + " ");
}
function scope(group) {
  if (!group) return document;
  const found = [...document.querySelectorAll("[role='group']")].find((el) => el.getAttribute("aria-label") === group);
  if (!found) throw new Error("No group named " + group);
  return found;
}
function findControl(role, name, group) {
  const root = scope(group);
  const selector = role === "link" ? "a, [role='link']" : role === "button" ? "button, [role='button']" : "[role='" + role + "']";
  const match = [...root.querySelectorAll(selector)].find((el) => nameMatches(accName(el), name));
  if (!match) throw new Error("No " + role + " named " + name + (group ? " in " + group : ""));
  return match;
}
function setNativeValue(el, value) {
  const prototype = el instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("No value setter");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function labeledControl(labelText) {
  const label = [...document.querySelectorAll("label")].find((el) => {
    const span = el.querySelector(":scope > span");
    return (span?.textContent || "").trim() === labelText;
  });
  const control = label?.querySelector("input, select, textarea");
  if (!control) throw new Error("No control labeled " + labelText);
  return control;
}
`;

async function launch(args) {
  const runId = `tokentier-${Date.now().toString(36)}`;
  const dir = path.resolve(args.dir || path.join("/tmp/tokentier-verify", runId));
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "evidence"), { recursive: true });
  if (existsSync(statePath(dir))) {
    const existing = JSON.parse(readFileSync(statePath(dir), "utf8"));
    if (existing.status === "running" && pidAlive(existing.pid)) {
      fail(`Refusing to launch over a live instance at ${dir} (pid ${existing.pid}). Use another --dir.`);
    }
  }
  const port = args.port ? Number(args.port) : await freePort(4173);
  const logFd = openSync(path.join(dir, "dev.log"), "a");
  const child = spawn("npm", ["run", "dev", "--", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  const state = {
    status: "running",
    runId,
    dir,
    pid: child.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    evidenceDir: path.join(dir, "evidence"),
    logPath: path.join(dir, "dev.log"),
    repoRoot,
  };
  writeState(dir, state);
  const deadline = Date.now() + 90000;
  let last = "no response";
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) {
      const tail = existsSync(state.logPath) ? readFileSync(state.logPath, "utf8") : "";
      state.status = "stopped";
      writeState(dir, state);
      if (tail.includes("already running")) {
        fail(`vinext allows one dev server per checkout. This run did not start the server named in ${state.logPath}. Do not kill it and do not drive its URL.\n${tail}`);
      }
      fail(`Dev server exited before it was ready.\n${tail.split("\n").slice(-40).join("\n")}`);
    }
    try {
      const response = await fetch(`${state.url}/`, { redirect: "follow" });
      const body = await response.text();
      if (response.status === 200 && body.includes("TokenTier")) {
        console.error(`TokenTier ready at ${state.url}/`);
        console.error(`pid ${state.pid}`);
        console.error(`evidence ${state.evidenceDir}`);
        console.log(`export TOKENTIER_VERIFY_DIR=${dir}`);
        return;
      }
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  killGroup(child.pid);
  await delay(500);
  killGroupHard(child.pid);
  state.status = "stopped";
  writeState(dir, state);
  const tail = existsSync(state.logPath) ? readFileSync(state.logPath, "utf8").split("\n").slice(-40).join("\n") : "";
  fail(`TokenTier did not become ready at ${state.url}/ (${last}).\n${tail}`);
}

async function doctor(args) {
  const dir = requireDir(args);
  const state = readState(dir);
  if (state.status !== "running" || !pidAlive(state.pid)) {
    fail(`Instance is not running (status ${state.status}, pid ${state.pid}).`);
  }
  const listeners = listeningPids(state.port);
  const owned = listeners.some((pid) => isInProcessTree(state.pid, pid));
  if (!owned) {
    fail(`Port ${state.port} is not owned by pid ${state.pid} (listeners: ${listeners.join(",") || "none"}). Refusing to drive it.`);
  }
  const response = await fetch(`${state.url}/`);
  const body = await response.text();
  if (response.status !== 200 || !body.includes("TokenTier")) {
    fail(`HTTP ${response.status} from ${state.url}/ did not look like TokenTier.`);
  }
  console.log(`status: running`);
  console.log(`url: ${state.url}/`);
  console.log(`pid: ${state.pid}`);
  console.log(`port: ${state.port}`);
  console.log(`listener: owned`);
  console.log(`http: ${response.status}`);
  console.log(`title: ${titleOf(body)}`);
  console.log(`dir: ${dir}`);
  console.log(`evidence: ${state.evidenceDir}`);
}

async function stop(args) {
  const dir = requireDir(args);
  const state = readState(dir);
  killGroup(state.pid);
  killGroup(state.chromePid);
  await delay(800);
  if (pidAlive(state.pid)) killGroupHard(state.pid);
  if (pidAlive(state.chromePid)) killGroupHard(state.chromePid);
  if (state.chromeProfile) rmSync(state.chromeProfile, { recursive: true, force: true });
  state.status = "stopped";
  state.stoppedAt = new Date().toISOString();
  writeState(dir, state);
  console.log(`stopped pid ${state.pid}`);
  console.log(`evidence ${state.evidenceDir}`);
}

async function openPage(args) {
  const dir = requireDir(args);
  const targetPath = args.path || args._[1] || "/";
  await withPage(dir, async (session, state) => {
    const url = new URL(targetPath, `${state.url}/`).toString();
    await session.send("Page.navigate", { url });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const ready = await evaluate(session, "document.readyState === 'complete' && document.body && document.body.innerText.includes('TokenTier')");
      if (ready) {
        console.log(url);
        return;
      }
      await delay(200);
    }
    fail(`Page did not finish loading ${url}`);
  });
}

async function click(args) {
  const dir = requireDir(args);
  const name = args.name || args.label;
  if (!name) fail("click needs --label or --role and --name.");
  const finder = args.label && !args.role
    ? `document.querySelector(${JSON.stringify(`[aria-label="${name}"]`)})`
    : `findControl(${JSON.stringify(args.role || "button")}, ${JSON.stringify(name)}, ${JSON.stringify(args.group || "")})`;
  await withPage(dir, async (session) => {
    const clicked = await evaluate(session, `(() => {
      ${pageHelpers}
      const el = ${finder};
      if (!el) throw new Error(${JSON.stringify(`No control named ${name}`)});
      el.click();
      return accName(el);
    })()`);
    console.log(clicked);
  });
}

async function selectValue(args) {
  const dir = requireDir(args);
  if (!args.value) fail("select needs --value.");
  await withPage(dir, async (session) => {
    const finder = args.id
      ? `document.getElementById(${JSON.stringify(args.id)})`
      : `labeledControl(${JSON.stringify(args.labeled || args.label)})`;
    const selected = await evaluate(session, `(() => {
      ${pageHelpers}
      const el = ${finder};
      if (!el) throw new Error("Select not found");
      setNativeValue(el, ${JSON.stringify(args.value)});
      return el.value;
    })()`);
    console.log(selected);
  });
}

async function fill(args) {
  const dir = requireDir(args);
  if (args.value === undefined) fail("fill needs --value.");
  await withPage(dir, async (session) => {
    const finder = args.label
      ? `document.querySelector(${JSON.stringify(`[aria-label="${args.label}"]`)})`
      : `labeledControl(${JSON.stringify(args.labeled)})`;
    const filled = await evaluate(session, `(() => {
      ${pageHelpers}
      const el = ${finder};
      if (!el) throw new Error("Field not found");
      el.focus();
      setNativeValue(el, ${JSON.stringify(args.value)});
      return el.value;
    })()`);
    console.log(filled);
  });
}

async function readText(args) {
  const dir = requireDir(args);
  await withPage(dir, async (session) => {
    const finder = args.id
      ? `document.getElementById(${JSON.stringify(args.id)})`
      : `document.querySelector(${JSON.stringify(args.selector)})`;
    const value = await evaluate(session, `(() => { const el = ${finder}; if (!el) throw new Error("Element not found"); return (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim(); })()`);
    console.log(value);
  });
}

async function readAttr(args) {
  const dir = requireDir(args);
  if (!args.name) fail("attr needs --name.");
  await withPage(dir, async (session) => {
    const finder = args.id
      ? `document.getElementById(${JSON.stringify(args.id)})`
      : `document.querySelector(${JSON.stringify(args.selector)})`;
    const value = await evaluate(session, `(() => { const el = ${finder}; if (!el) throw new Error("Element not found"); return el.getAttribute(${JSON.stringify(args.name)}) ?? el[${JSON.stringify(args.name)}] ?? ""; })()`);
    console.log(value);
  });
}

async function readUrl(args) {
  const dir = requireDir(args);
  await withPage(dir, async (session) => {
    console.log(await evaluate(session, "location.href"));
  });
}

async function readStorage(args) {
  const dir = requireDir(args);
  if (!args.key) fail("storage needs --key.");
  await withPage(dir, async (session) => {
    const value = await evaluate(session, `localStorage.getItem(${JSON.stringify(args.key)})`);
    console.log(value === null || value === undefined ? "null" : value);
  });
}

async function waitFor(args) {
  const dir = requireDir(args);
  await withPage(dir, async (session) => {
    const deadline = Date.now() + Number(args.timeout || 15000);
    let last = "";
    while (Date.now() < deadline) {
      if (args["url-includes"]) {
        last = await evaluate(session, "location.href");
        if (String(last).includes(args["url-includes"])) {
          console.log(last);
          return;
        }
      } else if (args.id && args.value !== undefined) {
        last = await evaluate(session, `document.getElementById(${JSON.stringify(args.id)})?.value ?? ""`);
        if (last === args.value) {
          console.log(last);
          return;
        }
      } else if (args.id && args.text) {
        last = await evaluate(session, `document.getElementById(${JSON.stringify(args.id)})?.innerText ?? ""`);
        if (String(last).includes(args.text)) {
          console.log(String(last).replace(/\s+/g, " ").trim());
          return;
        }
      } else if (args.selector && args.text) {
        last = await evaluate(session, `document.querySelector(${JSON.stringify(args.selector)})?.innerText ?? ""`);
        if (String(last).includes(args.text)) {
          console.log(String(last).replace(/\s+/g, " ").trim());
          return;
        }
      } else {
        fail("wait needs --url-includes, or --id with --text or --value, or --selector with --text.");
      }
      await delay(200);
    }
    fail(`Timed out waiting. Last value: ${String(last).replace(/\s+/g, " ").trim()}`);
  });
}

async function snapshot(args) {
  const dir = requireDir(args);
  if (!args.path) fail("snapshot needs --path.");
  await withPage(dir, async (session) => {
    await session.send("Accessibility.enable");
    const tree = await session.send("Accessibility.getFullAXTree");
    const keep = new Set(["RootWebArea", "heading", "button", "link", "combobox", "searchbox", "textbox", "spinbutton", "checkbox", "radio", "navigation", "status", "alert", "group"]);
    const lines = [];
    for (const node of tree.nodes || []) {
      if (node.ignored) continue;
      const role = node.role?.value;
      const name = node.name?.value || "";
      if (!keep.has(role) || !name) continue;
      const pressed = (node.properties || []).find((property) => property.name === "pressed");
      const pressedText = pressed ? ` pressed=${pressed.value?.value}` : "";
      lines.push(`${role}${pressedText} "${name}"`);
    }
    const file = evidenceFile(dir, args.path);
    writeFileSync(file, `${lines.join("\n")}\n`);
    console.log(file);
  });
}

async function screenshot(args) {
  const dir = requireDir(args);
  if (!args.path) fail("screenshot needs --path.");
  await withPage(dir, async (session) => {
    const image = await session.send("Page.captureScreenshot", { format: "png" });
    const file = evidenceFile(dir, args.path);
    writeFileSync(file, Buffer.from(image.data, "base64"));
    console.log(file);
  });
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const commands = {
  launch,
  doctor,
  stop,
  open: openPage,
  click,
  select: selectValue,
  fill,
  text: readText,
  attr: readAttr,
  url: readUrl,
  storage: readStorage,
  wait: waitFor,
  snapshot,
  screenshot,
};

if (!commands[command]) {
  fail(`Usage: verify.mjs <launch|doctor|stop|open|click|select|fill|text|attr|url|storage|wait|snapshot|screenshot>`);
}
await commands[command](args);
