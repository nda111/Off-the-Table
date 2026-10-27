/* Browser-free regression tests for the actual background.js event handlers.
 * Load this file, then await CBDBackgroundTests.run(backgroundSource).
 * Timers are fake and pending until explicitly fired; no network/browser APIs run.
 */
(function () {
  "use strict";
  const P = 3;
  const LEFT = 11, RIGHT = 22, THIRD = 33;
  const tab = (id, extra = {}) => ({ id, windowId: 7, active: true, url: "https://chatgpt.com/", ...extra });
  const focus = (focused, lastActiveAt = 0, extra = {}) => ({ ok: true, protocol: P, visible: true, focused, lastActiveAt, ...extra });
  const pending = () => new Promise(() => {});
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const equal = (actual, expected, message) => {
    assert(JSON.stringify(actual) === JSON.stringify(expected), message + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  };
  async function flush(rounds = 160) { for (let i = 0; i < rounds; i++) await Promise.resolve(); }
  async function until(predicate, message) {
    for (let i = 0; i < 800; i++) { if (predicate()) return; await Promise.resolve(); }
    throw new Error(message || "Microtask condition did not complete");
  }
  function harness(source, config = {}) {
    const specs = config.tabs || [tab(LEFT)];
    const states = new Map(specs.map(t => [t.id, { enabled: false, count: 7, ...config.states?.[t.id] }]));
    const log = [], timers = new Map(), timerHistory = [];
    const DEFAULT = Symbol("default response");
    let timerId = 0, onClick, onMessage;
    const h = { log, timers, timerHistory, states, DEFAULT, pending };
    const record = (kind, data) => { log.push({ kind, ...data }); };
    const chrome = {
      action: {
        onClicked: { addListener(fn) { assert(!onClick, "One action listener"); onClick = fn; } },
        async setBadgeText(data) { record("badge", data); },
        async setBadgeBackgroundColor(data) { record("color", data); },
        async setTitle(data) { record("title", data); }
      },
      runtime: { onMessage: { addListener(fn) { assert(!onMessage, "One runtime listener"); onMessage = fn; } } },
      tabs: {
        async query(query) {
          record("query", { query });
          equal(Object.keys(query).sort(), ["active", "windowId"], "Query must use explicit active/window scope");
          equal(query.active, true, "Query must request active tabs");
          if (config.queryError) throw new Error("query unavailable");
          if (config.queryResult) return config.queryResult;
          return specs.filter(t => t.active && t.windowId === query.windowId);
        },
        async get(tabId) {
          record("get", { tabId });
          const found = specs.find(t => t.id === tabId);
          if (!found) throw new Error("Unknown tab " + tabId);
          return found;
        },
        async sendMessage(tabId, message, options) {
          record("send", { tabId, message: { ...message }, options });
          equal(options, { frameId: 0 }, "Only top frame may receive messages");
          assert(states.has(tabId), "Message to unknown tab");
          if (config.send) {
            const result = config.send(tabId, message, h);
            if (result !== DEFAULT) return result;
          }
          const state = states.get(tabId);
          if (message.type === "cbd-status") return { ok: true, protocol: P, ...state };
          if (message.type === "cbd-focus-state") return config.focus?.[tabId] || focus(false);
          if (message.type === "cbd-show-local-toggle") return { ok: true, protocol: P };
          if (message.type === "cbd-set-mode") {
            assert(typeof message.enabled === "boolean", "Mode payload must be boolean");
            state.enabled = message.enabled;
            return { ok: true, protocol: P, ...state };
          }
          throw new Error("Unexpected content message " + message.type);
        }
      },
      scripting: {
        async insertCSS(data) {
          record("css", data);
          equal(data.files, ["panel.css"], "Recovery CSS");
          if (config.css) return config.css(data, h);
        },
        async executeScript(data) {
          record("script", data);
          equal(data.files, ["delete-queue.js", "content.js"], "Recovery must inject queue before content");
          if (config.script) return config.script(data, h);
        }
      }
    };
    const fakeSetTimeout = (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, ms }); timerHistory.push(ms);
      return id;
    };
    const fakeClearTimeout = id => { timers.delete(id); };
    new Function("chrome", "setTimeout", "clearTimeout", source)(chrome, fakeSetTimeout, fakeClearTimeout);
    assert(typeof onClick === "function" && typeof onMessage === "function", "Actual background listeners installed");
    Object.assign(h, {
      click(clickedTab = specs[0]) { onClick(clickedTab); },
      request(message, sender = {}) {
        let keepAlive;
        const result = new Promise(resolve => { keepAlive = onMessage(message, sender, resolve); });
        return { result, keepAlive };
      },
      fire(ms) {
        const entries = [...timers].filter(([, timer]) => timer.ms === ms);
        assert(entries.length > 0, "Expected pending " + ms + "ms timer");
        for (const [id, timer] of entries) { timers.delete(id); timer.fn(); }
      },
      sends(type) { return log.filter(e => e.kind === "send" && e.message.type === type); },
      modes() { return h.sends("cbd-set-mode").map(e => [e.tabId, e.message.enabled]); },
      helpers() { return h.sends("cbd-show-local-toggle").map(e => e.tabId).sort((a, b) => a - b); },
      badges() { return log.filter(e => e.kind === "badge").map(e => [e.tabId, e.text]); }
    });
    return h;
  }
  function dual(source, options = {}) {
    return harness(source, { tabs: [tab(LEFT), tab(RIGHT)], ...options });
  }
  function safeAmbiguity(h, ready = [LEFT, RIGHT], clicked = LEFT) {
    equal(h.modes(), [], "Ambiguity must never toggle either pane");
    equal(h.helpers(), [...ready].sort((a,b) => a-b), "Every ready pane gets a local helper");
    assert(h.badges().some(([id, text]) => id === clicked && text === "ERR"), "Ambiguity must show ERR on clicked tab");
  }
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  test("single active tab: action click toggles ON then OFF", async source => {
    const h = harness(source); h.click(); await flush();
    equal(h.modes(), [[LEFT, true]], "First click");
    h.click(); await flush();
    equal(h.modes(), [[LEFT, true], [LEFT, false]], "Second click");
    equal(h.badges(), [[LEFT, "ON"], [LEFT, "OFF"]], "ON/OFF badges");
    equal(h.timers.size, 0, "Resolved calls clear fake timers");
    equal(h.log.filter(e => e.kind === "script" || e.kind === "css"), [], "Healthy content needs no injection");
  });
  test("Whale two active panes: left callback routes only to focused right", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 900), [RIGHT]: focus(true, 100) } });
    h.click(); await flush(); equal(h.modes(), [[RIGHT, true]], "Document focus beats callback and history");
    equal(h.helpers(), [], "Known target needs no helper");
  });
  test("Whale focused left wins despite newer right history", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(true, 100), [RIGHT]: focus(false, 900) } });
    h.click(tab(RIGHT)); await flush(); equal(h.modes(), [[LEFT, true]], "Focused left");
  });
  test("toolbar blurs both panes: latest right history wins", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 100), [RIGHT]: focus(false, 200) } });
    h.click(); await flush(); equal(h.modes(), [[RIGHT, true]], "Latest right");
  });
  test("toolbar blurs both panes: latest left history wins", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 200), [RIGHT]: focus(false, 100) } });
    h.click(tab(RIGHT)); await flush(); equal(h.modes(), [[LEFT, true]], "Latest left");
  });
  test("stale inactive third tab cannot become target", async source => {
    const h = dual(source, { tabs: [tab(LEFT), tab(RIGHT), tab(THIRD, { active: false })], focus: {
      [LEFT]: focus(false, 100), [RIGHT]: focus(false, 200), [THIRD]: focus(true, 999999)
    } });
    h.click(tab(THIRD, { active: false })); await flush();
    equal(h.modes(), [[RIGHT, true]], "Inactive callback/history ignored");
    assert(!h.log.some(e => e.tabId === THIRD && (e.kind === "send" || e.kind === "get")), "Inactive third must not be probed");
  });
  test("equal focus history: local helper in both panes and ERR, no toggle", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 123), [RIGHT]: focus(false, 123) } });
    h.click(); await flush(); safeAmbiguity(h);
  });
  test("missing focus history: local helpers and ERR, no callback fallback", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, undefined, { lastActiveAt: undefined }), [RIGHT]: focus(false, 0) } });
    h.click(); await flush(); safeAmbiguity(h);
  });
  test("unsupported other pane blocks history-only routing safely", async source => {
    const h = dual(source, { tabs: [tab(LEFT), tab(RIGHT, { url: "https://example.com/" })], focus: { [LEFT]: focus(false, 999) } });
    h.click(); await flush(); safeAmbiguity(h, [LEFT]);
    assert(!h.log.some(e => (e.kind === "script" || e.kind === "css") && e.target.tabId === RIGHT), "No unsupported pane injection");
  });
  test("unknown other pane permits known document.focused=true target", async source => {
    const h = dual(source, { tabs: [tab(LEFT, { url: "https://example.com/" }), tab(RIGHT)], focus: { [RIGHT]: focus(true, 0) } });
    h.click(); await flush(); equal(h.modes(), [[RIGHT, true]], "Known focused pane is definitive");
    equal(h.helpers(), [], "Definitive focus needs no local helper");
  });
  test("500ms focus timeout stays pending until fired, then local helper plus ERR", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 100) }, send(id, message, env) {
      return id === RIGHT && message.type === "cbd-focus-state" ? pending() : env.DEFAULT;
    } });
    h.click(); await flush();
    equal(h.modes(), [], "No mode while probe is pending"); equal(h.badges(), [], "Fake timeout must not auto-fire");
    assert([...h.timers.values()].some(t => t.ms === 500), "Focus deadline is 500ms");
    h.fire(500); await flush(); safeAmbiguity(h, [LEFT]);
    equal(h.timers.size, 0, "Timeout cleanup");
  });
  test("4000ms status timeout with missing startup scripts cannot choose wrong pane", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 900) }, send(id, message, env) {
      return id === RIGHT && message.type === "cbd-status" ? pending() : env.DEFAULT;
    }, script(data) { if (data.target.tabId === RIGHT) throw new Error("startup unavailable"); } });
    h.click(); await flush(); equal(h.modes(), [], "Pending status must not route");
    assert([...h.timers.values()].some(t => t.ms === 4000), "Status deadline is 4000ms");
    h.fire(4000); await flush(); safeAmbiguity(h, [LEFT]);
    equal(h.log.filter(e => e.kind === "script").map(e => e.files), [["delete-queue.js", "content.js"]], "Both startup scripts attempted");
  });
  test("startup missing script in one pane: ready pane helper plus ERR", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 900) }, send(id, message, env) {
      if (id === RIGHT && message.type === "cbd-status") throw new Error("No receiver");
      return env.DEFAULT;
    }, script(data) { if (data.target.tabId === RIGHT) throw new Error("Missing file"); } });
    h.click(); await flush(); safeAmbiguity(h, [LEFT]);
  });
  test("focus protocol mismatch is unknown, never trusted for routing", async source => {
    const h = dual(source, { focus: { [LEFT]: focus(false, 1), [RIGHT]: focus(true, 999, { protocol: 2 }) } });
    h.click(); await flush(); safeAmbiguity(h, [LEFT]);
  });
  test("fresh worker uses content focus history, not previous worker memory", async source => {
    const old = dual(source, { focus: { [LEFT]: focus(true, 100), [RIGHT]: focus(false, 10) } });
    old.click(); await flush(); equal(old.modes(), [[LEFT, true]], "Old worker left target");
    const restarted = dual(source, { focus: { [LEFT]: focus(false, 100), [RIGHT]: focus(false, 200) } });
    restarted.click(); await flush(); equal(restarted.modes(), [[RIGHT, true]], "New worker derives right target from content");
  });
  test("rapid clicks serialize per tab and alternate ON/OFF", async source => {
    let release, held = false;
    const h = harness(source, { send(id, message, env) {
      if (message.type === "cbd-status" && !held) {
        held = true;
        return new Promise(resolve => { release = () => resolve({ ok: true, protocol: P, enabled: false, count: 7 }); });
      }
      return env.DEFAULT;
    } });
    h.click(); h.click(); await flush();
    equal(h.sends("cbd-status").length, 1, "Second job cannot enter ensureContent before first job ends");
    equal(h.modes(), [], "First job remains pending");
    release(); await flush(); equal(h.modes(), [[LEFT, true], [LEFT, false]], "Queued toggles use latest state");
    equal(h.badges(), [[LEFT, "ON"], [LEFT, "OFF"]], "Serialized badges");
  });
  test("missing content recovers by injecting queue and content in order", async source => {
    let first = true;
    const h = harness(source, { send(id, message, env) {
      if (message.type === "cbd-status" && first) { first = false; throw new Error("No receiver"); }
      return env.DEFAULT;
    } });
    h.click(); await flush();
    equal(h.log.filter(e => e.kind === "css" || e.kind === "script").map(e => [e.kind, e.target, e.files]), [
      ["css", { tabId: LEFT }, ["panel.css"]], ["script", { tabId: LEFT }, ["delete-queue.js", "content.js"]]
    ], "Full recovery sequence");
    equal(h.modes(), [[LEFT, true]], "Recovered action toggles");
    equal(h.sends("cbd-status").length, 2, "Status rechecked after injection");
  });
  test("protocol 2 status must bootstrap before protocol 3 action", async source => {
    let calls = 0;
    const h = harness(source, { send(id, message, env) {
      if (message.type === "cbd-status" && ++calls === 1) return { ok: true, protocol: 2, enabled: false };
      return env.DEFAULT;
    } });
    h.click(); await flush();
    equal(h.log.filter(e => e.kind === "script").length, 1, "Old protocol reinjected");
    equal(h.modes(), [[LEFT, true]], "Protocol 3 handshake then toggle");
  });
  test("persistently wrong protocol fails closed after reinjection", async source => {
    const h = harness(source, { send(id, message, env) {
      return message.type === "cbd-status" ? { ok: true, protocol: 2, enabled: false } : env.DEFAULT;
    } });
    h.click(); await flush(); equal(h.modes(), [], "Cannot toggle old content protocol");
    equal(h.badges(), [[LEFT, "ERR"]], "Initialization error badge");
  });
  test("unsupported site cannot message or inject content", async source => {
    const h = harness(source, { tabs: [tab(LEFT, { url: "https://example.com/" })] });
    h.click(); await flush(); equal(h.modes(), [], "Unsupported site no mode change");
    equal(h.log.filter(e => ["send", "script", "css"].includes(e.kind)), [], "Unsupported site is untouched");
    equal(h.badges(), [], "Unsupported site is a quiet no-op");
    equal(h.log.filter(e => ["title", "color"].includes(e.kind)), [], "Unsupported site has no error UI");
  });
  test("different-window document focus ignored; query scopes action window", async source => {
    const h = harness(source, { tabs: [tab(LEFT), tab(RIGHT), tab(THIRD, { windowId: 8 })], focus: {
      [LEFT]: focus(false, 100), [RIGHT]: focus(false, 200), [THIRD]: focus(true, 99999)
    } });
    h.click(); await flush(); equal(h.modes(), [[RIGHT, true]], "Other window cannot steal target");
    equal(h.log.filter(e => e.kind === "query").map(e => e.query), [{ active: true, windowId: 7 }], "Correct window scope");
    assert(!h.log.some(e => e.kind === "send" && e.tabId === THIRD), "Do not probe other window");
  });
  test("empty active query errors without falling back to callback tab", async source => {
    const h = harness(source, { queryResult: [] }); h.click(); await flush();
    equal(h.modes(), [], "No callback fallback");
    equal(h.log.filter(e => ["get", "send", "script", "css"].includes(e.kind)), [], "Empty query does not touch callback content");
    equal(h.badges(), [[LEFT, "ERR"]], "Empty query error badge");
  });
  test("failed active query errors without fallback", async source => {
    const h = harness(source, { queryError: true }); h.click(); await flush();
    equal(h.modes(), [], "Query failure no fallback"); equal(h.badges(), [[LEFT, "ERR"]], "Query failure badge");
    equal(h.sends("cbd-status"), [], "Failed query cannot contact callback content");
  });
  test("runtime cbd-mode notification uses sender tab only", async source => {
    const h = harness(source);
    h.request({ type: "cbd-mode", tabId: RIGHT, enabled: true, count: 42 }, { tab: tab(LEFT) });
    await flush(); equal(h.badges(), [[LEFT, "ON"]], "Sender id wins");
    assert(h.log.some(e => e.kind === "title" && e.tabId === LEFT && e.title.includes("42")), "Count included in title");
    equal(h.modes(), [], "Notification does not send a new mode command");
  });
  test("unsupported clicked pane still shows ambiguity ERR on the ChatGPT pane", async source => {
    const h = dual(source, { tabs: [tab(LEFT, { url: "https://example.com/" }), tab(RIGHT)], focus: { [RIGHT]: focus(false, 999) } });
    h.click(); await flush();
    equal(h.modes(), [], "Ambiguity must not toggle");
    equal(h.helpers(), [RIGHT], "ChatGPT pane gets a local helper");
    assert(h.badges().some(([id, text]) => id === RIGHT && text === "ERR"), "ERR shown on the ChatGPT pane");
    assert(!h.badges().some(([id]) => id === LEFT), "No badge on the unsupported clicked pane");
  });
  test("badge uses the accent color the page reports, errors stay red", async source => {
    const h = harness(source);
    h.request({ type: "cbd-mode", enabled: true, count: 3, badgeColor: "#8c5afa", badgeText: "#ffffff" }, { tab: tab(LEFT) });
    await flush();
    const colors = () => h.log.filter(e => e.kind === "color").map(e => e.color);
    equal(colors().at(-1), "#8c5afa", "Theme accent badge");
    h.request({ type: "cbd-mode", enabled: false, count: 3 }, { tab: tab(LEFT) });
    await flush();
    equal(colors().at(-1), "#8c5afa", "Accent is remembered for later updates without colors");
  });
  test("invalid toolbar tab id is ignored", async source => {
    const h = harness(source); h.click({ id: undefined, windowId: 7 }); await flush();
    equal(h.log, [], "Invalid tab must not invoke any browser operation");
  });

  test("extensions/internal/foreign/missing URLs are silent no-ops", async source => {
    for (const url of ["chrome://extensions/", "whale://extensions/", "edge://extensions/", "about:blank", "http://chatgpt.com/", "https://chatgpt.com.example.org/", undefined]) {
      const h = harness(source, { tabs: [tab(LEFT, { url })] });
      h.click(); await flush();
      equal(h.modes(), [], "No toggle on " + url);
      equal(h.log.filter(e => ["send", "script", "css", "badge", "title", "color"].includes(e.kind)), [], "No content or error UI on " + url);
    }
  });
  test("all unsupported dual panes stay quiet without local helpers", async source => {
    const h = dual(source, { tabs: [tab(LEFT, { url: "chrome://extensions/" }), tab(RIGHT, { url: "https://example.com/" })] });
    h.click(); await flush();
    equal(h.modes(), [], "No unsupported dual mode changes");
    equal(h.log.filter(e => ["send", "script", "css", "badge", "title", "color"].includes(e.kind)), [], "Unsupported dual pages stay untouched");
  });
  test("offsite query errors are not displayed as extension failures", async source => {
    const h = harness(source, { tabs: [tab(LEFT, { url: "chrome://extensions/" })], queryError: true });
    h.click(); await flush();
    equal(h.badges(), [], "No error on internal page");
    equal(h.modes(), [], "Query failure cannot toggle another page");
  });

  globalThis.CBDBackgroundTests = {
    run: async function (backgroundSource) {
      if (typeof backgroundSource !== "string") throw new TypeError("backgroundSource must be source text");
      const tests = [];
      for (const item of cases) {
        try { await item.fn(backgroundSource); tests.push({ name: item.name, passed: true }); }
        catch (error) { tests.push({ name: item.name, passed: false, error: String(error?.message || error) }); }
      }
      const passed = tests.filter(t => t.passed).length;
      return { passed, failed: tests.length - passed, tests };
    }
  };
})();
