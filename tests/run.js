/* Runs every test suite in Node with jsdom:  npm test
 * - delete queue, i18n and background tests (plain JS, fake browser APIs)
 * - UI tests on a jsdom page, with Chrome and Whale user agents
 * - a document_start smoke test (content.js loads before <html> exists)
 * - if samples/*.html exist (saved ChatGPT pages, not committed): the extension on each
 *   page, also with every aria-label scrambled to check language-independent locking
 * Exits with code 1 if anything fails.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.resolve(__dirname, "..");
const src = file => fs.readFileSync(path.join(root, file), "utf8");
let failed = false;
const report = (label, passed, failures) => {
  console.log(`${label}: ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.log("  FAIL", failure);
  if (failures.length) failed = true;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Page consoles show only errors and warnings; jsdom's "not implemented" notices (canvas,
// used for theme colors), CSS it can't parse and the extension's info logs are noise here.
function quietConsole() {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", (...args) => console.error(...args));
  virtualConsole.on("warn", (...args) => console.warn(...args));
  // Saved ChatGPT pages also use CSS syntax jsdom can't parse; that doesn't affect the checks.
  virtualConsole.on("jsdomError", error => { if (!/Not implemented|Could not parse CSS/.test(error.message)) console.error(error); });
  return virtualConsole;
}

// Loads the content scripts into a jsdom window, like the manifest does.
function loadExtension(window, listeners) {
  window.chrome = {
    runtime: { id: "test", onMessage: { addListener: fn => listeners.push(fn), removeListener() {} }, sendMessage: () => Promise.resolve() },
  };
  for (const file of ["delete-queue.js", "i18n.js", "content.js"]) window.eval(src(file));
}
const ask = (listeners, message) => { let response; listeners[0](message, {}, value => { response = value; }); return response; };

async function documentStartSmoke() {
  const dom = new JSDOM("", { url: "https://chatgpt.com/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: quietConsole() });
  const { window } = dom, document = window.document;
  document.documentElement.remove(); // nothing parsed yet
  const listeners = [];
  loadExtension(window, listeners);
  // The page registers its own capture listener afterwards, like ChatGPT's router.
  let pageSaw = 0;
  window.addEventListener("click", () => pageSaw++, true);
  const html = document.createElement("html");
  document.append(html);
  html.append(document.createElement("body"));
  document.body.innerHTML = '<nav><a href="/c/one">one</a><a href="/c/two">two</a><a href="/c/three">three</a></nav>';
  await wait(100);
  ask(listeners, { type: "cbd-set-mode", enabled: true });
  const links = [...document.querySelectorAll("nav a")];
  links[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  const shift = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, shiftKey: true });
  links[2].dispatchEvent(shift);
  const status = ask(listeners, { type: "cbd-status" });
  const checks = [
    [document.querySelector("body > .cbd-bar"), "panel is added once <body> exists"],
    [status.count === 3 && status.selected === 3, "chats rendered after load are detected; click + Shift+click selects all three"],
    [shift.defaultPrevented && pageSaw === 0, "clicks are kept from the page in delete mode"],
  ];
  report("document_start", checks.filter(([ok]) => ok).length, checks.filter(([ok]) => !ok).map(([, name]) => name));
}

async function sampleRun(file, scramble) {
  let html = fs.readFileSync(path.join(root, "samples", file), "utf8").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  if (scramble) html = html.replace(/aria-label="[^"]*"/g, (_, at) => `aria-label="label-${at}"`);
  const dom = new JSDOM(html, { url: "https://chatgpt.com/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: quietConsole() });
  const { window } = dom, document = window.document;
  // A saved page may contain the extension's own UI from when it was captured.
  document.querySelectorAll(".cbd-bar, .cbd-side-switch, .cbd-tip, #cbd-theme").forEach(node => node.remove());
  const listeners = [];
  loadExtension(window, listeners);
  await wait(100);
  ask(listeners, { type: "cbd-set-mode", enabled: true });
  const link = document.querySelector("a[data-cbd-href]");
  link?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  const status = ask(listeners, { type: "cbd-status" });
  const item = link?.closest("[data-cbd-item]");
  const locked = [...document.querySelectorAll("[data-cbd-disabled]")].map(button => button.textContent.trim().slice(0, 20));
  return { status, rowSelected: item?.dataset.cbdItem === "selected", sideSwitch: Boolean(document.querySelector(".cbd-side-switch")), locked };
}

async function samples() {
  const dir = path.join(root, "samples");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith(".html")) : [];
  if (!files.length) { console.log("samples: skipped (no samples/*.html)"); return; }
  const failures = [];
  let passed = 0;
  for (const file of files) {
    const plain = await sampleRun(file, false), scrambled = await sampleRun(file, true);
    const checks = [
      [plain.status.count > 0 && plain.status.selected === 1 && plain.rowSelected, "chats are detected and a click tints the row"],
      [plain.sideSwitch, "the switch is placed in the sidebar header"],
      [plain.locked.length > 0, "header and menu buttons are locked"],
      [JSON.stringify(plain.locked) === JSON.stringify(scrambled.locked), "the same buttons lock with scrambled labels"],
    ];
    for (const [ok, name] of checks) ok ? passed++ : failures.push(`${file}: ${name}`);
  }
  report(`samples (${files.length} pages)`, passed, failures);
}

(async () => {
  new Function(src("delete-queue.js"))();
  new Function(src("tests/delete-queue.test.js"))();
  const queue = await globalThis.CBDDeleteQueueTests.run(globalThis.CBDDeleteQueue.run);
  report("queue", queue.passed, []);

  new Function(src("i18n.js"))();
  new Function(src("tests/i18n.test.js"))();
  const i18n = globalThis.CBDI18nTests.run();
  report("i18n", i18n.filter(r => r.passed).length, i18n.filter(r => !r.passed).map(r => r.name));

  new Function(src("tests/background.test.js"))();
  const background = await globalThis.CBDBackgroundTests.run(src("background.js"));
  report("background", background.passed, background.tests.filter(t => !t.passed).map(t => `${t.name} - ${t.error}`));

  for (const userAgent of ["Chrome/Test", "Mozilla/5.0 Whale/3.0"]) {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://chatgpt.com/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: quietConsole() });
    dom.window.eval(src("tests/ui.test.js"));
    try {
      const results = await dom.window.runCBDUITests({ contentSource: src("content.js"), queueSource: src("delete-queue.js"), i18nSource: src("i18n.js"), userAgent });
      report(`ui (${userAgent})`, results.length, []);
    } catch (error) {
      report(`ui (${userAgent})`, 0, [error.message]);
    }
  }

  await documentStartSmoke();
  await samples();
  // jsdom windows keep animation-frame timers alive, so exit explicitly.
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
