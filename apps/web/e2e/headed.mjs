import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "../../..");
const out = join(root, "agent-temp");
mkdirSync(out, { recursive: true });

function loadDevVars() {
  const vars = {};
  try {
    const raw = readFileSync(join(root, "apps/web/.dev.vars"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const cut = line.indexOf("=");
      if (cut < 1 || line.startsWith("#")) continue;
      vars[line.slice(0, cut)] = line.slice(cut + 1);
    }
  } catch {
    // use process env only
  }
  return vars;
}

const { chromium } = createRequire(join(root, "agent-temp/package.json"))("playwright");
const fileVars = loadDevVars();
const BASE = process.env.SL_BASE || "http://127.0.0.1:8787";
const ADMIN = process.env.BOOTSTRAP_USERNAME || fileVars.BOOTSTRAP_USERNAME || process.env.SL_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.BOOTSTRAP_PASSWORD || fileVars.BOOTSTRAP_PASSWORD || process.env.SL_ADMIN_PASS || "";

if (!ADMIN_PASS) {
  console.error("missing BOOTSTRAP_PASSWORD or SL_ADMIN_PASS");
  process.exit(2);
}

const results = [];
const consoleMsgs = [];

const browser = await chromium.launch({
  headless: false,
  slowMo: 40,
  args: ["--start-maximized"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleMsgs.push({ type: msg.type(), text: msg.text() });
  }
});
page.on("pageerror", (err) => consoleMsgs.push({ type: "error", text: err.message }));

async function shot(name) {
  await page.screenshot({ path: join(out, `e2e-${name}.png`), fullPage: true });
}

async function step(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, ok: true });
    console.log(`PASS ${id} ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ id, name, ok: false, error: message });
    console.log(`FAIL ${id} ${name}: ${message}`);
    await shot(`${id}-fail`).catch(() => {});
  }
}

await step("S01", "login page", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByLabel("ชื่อผู้ใช้").waitFor();
  await shot("01-login");
});

await step("S02", "bad password stays out", async () => {
  await page.getByLabel("ชื่อผู้ใช้").fill(ADMIN);
  await page.getByLabel("รหัสผ่าน").fill("wrong-password-xx");
  await page.locator("#login-go").click();
  await page.locator("#msg").filter({ hasText: "เข้าไม่ได้" }).waitFor({ timeout: 20000 });
  await shot("02-bad-login");
});

await step("S03", "admin enters workspace", async () => {
  await page.getByLabel("รหัสผ่าน").fill(ADMIN_PASS);
  await page.locator("#login-go").click();
  await page.waitForURL("**/app/**", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#who").waitFor();
  await shot("03-home");
});

await step("S04", "scout shows H+ JD", async () => {
  await page.locator("aside nav button[data-tab=scout]").click();
  const jd = await page.locator("#jd-text").inputValue();
  if (!jd.includes("Hotel Plus") && !jd.includes("Tech Lead")) throw new Error("missing H+ JD");
  await page.locator("#source-picks").waitFor({ timeout: 20000 });
  const picks = await page.locator("#source-picks").innerText();
  if (!picks.includes("LinkedIn")) throw new Error("source picks missing LinkedIn");
  if (!picks.includes("GitHub")) throw new Error("source picks missing GitHub");
  await shot("04-scout");
});

await step("S05", "pipeline filters exist", async () => {
  await page.locator("aside nav button[data-tab=board]").click();
  await page.locator("#filter-stage").waitFor();
  await page.locator("#board").waitFor();
  await shot("05-board");
});

await step("S06", "week calendar grid", async () => {
  await page.locator("aside nav button[data-tab=schedule]").click();
  await page.locator("#week-grid").waitFor();
  const cells = await page.locator("#week-grid .c").count();
  if (cells < 20) throw new Error(`expected hour cells, got ${cells}`);
  await shot("06-calendar");
});

await step("S07", "profile password and MCP connector", async () => {
  await page.locator("aside nav button[data-tab=profile]").click();
  await page.locator("#me-password").waitFor();
  await page.locator("#mcp-url").waitFor();
  const mcp = (await page.locator("#mcp-url").innerText()).trim();
  if (!mcp.includes("/mcp")) throw new Error(`expected mcp url, got ${mcp}`);
  await page.locator("#copy-mcp-url").click();
  await shot("07-profile");
});

await step("S08", "logout", async () => {
  await page.locator("#logout").click();
  await page.waitForURL((url) => !url.pathname.includes("/app"), { timeout: 15000 });
  await page.getByLabel("ชื่อผู้ใช้").waitFor();
  await shot("08-logout");
});

await browser.close();

const failed = results.filter((r) => !r.ok);
const report = { ok: failed.length === 0, results, console: consoleMsgs };
writeFileSync(join(out, "e2e-results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: failed.length, console: consoleMsgs.length }));
process.exit(failed.length ? 1 : 0);
