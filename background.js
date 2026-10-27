// Off the Table for ChatGPT - service worker
if (!globalThis.CBDI18n && typeof importScripts === "function") importScripts("i18n.js");
const PROTOCOL = 3;
const tabJobs = new Map();

// Last accent and language each page reported, so badges keep the page's theme color
// and titles/errors use ChatGPT's language (the browser's until a page reports one).
const tabThemes = new Map();
const tabLocales = new Map();
function remember(tabId, status) {
  if (status?.badgeColor) tabThemes.set(tabId, status);
  if (status?.locale) tabLocales.set(tabId, status.locale);
}
function t(tabId, key, params) {
  return globalThis.CBDI18n.create(tabLocales.get(tabId), chrome.i18n?.getUILanguage?.()).t(key, params);
}

// Toolbar icon: the cat's pose shows the state (sitting: OFF, swatting: ON, asleep: not a
// ChatGPT page). The icons are black on transparent; on ChatGPT tabs they are tinted with
// the page's accent, elsewhere with a neutral gray that shows on light and dark toolbars.
const ICON_SIZES = [16, 32];
const NEUTRAL_ICON = "#8e8e93";
const iconPath = (state, size) => `icons/toolbar_${state}_${size}.png`;
const iconBitmaps = new Map();
async function iconBitmap(state, size) {
  const key = iconPath(state, size);
  if (!iconBitmaps.has(key)) {
    iconBitmaps.set(key, fetch(chrome.runtime.getURL(key)).then(r => r.blob()).then(createImageBitmap));
    iconBitmaps.get(key).catch(() => iconBitmaps.delete(key));
  }
  return iconBitmaps.get(key);
}
async function tintedIcon(state, color) {
  const imageData = {};
  for (const size of ICON_SIZES) {
    const ctx = new OffscreenCanvas(size, size).getContext("2d");
    ctx.drawImage(await iconBitmap(state, size), 0, 0, size, size);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    imageData[size] = ctx.getImageData(0, 0, size, size);
  }
  return imageData;
}
// tabId undefined sets the default for every tab without its own icon.
async function setIcon(tabId, state, color = NEUTRAL_ICON) {
  const target = tabId === undefined ? {} : { tabId };
  try {
    if (typeof OffscreenCanvas !== "function") throw new Error("no canvas");
    await chrome.action.setIcon({ ...target, imageData: await tintedIcon(state, color) });
  } catch {
    // Untinted icons still show the state.
    await chrome.action.setIcon?.({ ...target, path: Object.fromEntries(ICON_SIZES.map(size => [size, iconPath(state, size)])) })
      .catch(() => {});
  }
}

// The badge is only for errors; the icon shows ON/OFF.
async function setBadge(tabId, enabled, count = 0, error = "", theme) {
  remember(tabId, theme);
  const colors = tabThemes.get(tabId);
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: error ? "ERR" : "" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#b3261e" }),
    // setBadgeTextColor exists from Chrome 110; older builds keep the default white.
    chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" }),
    chrome.action.setTitle({ tabId, title: error || t(tabId, enabled ? "bgTitleOn" : "sideTitle", { n: count }) }),
    setIcon(tabId, enabled ? "active" : "inactive", colors?.badgeColor),
  ]);
}

function sendToContent(tabId, message, timeoutMs = 4000) {
  let timer;
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(t(tabId, "bgPageTimeout"))), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function isSupportedURL(value) {
  try { return new URL(value).origin === "https://chatgpt.com"; }
  catch { return false; }
}

async function ensureContent(tabId) {
  const tab = await chrome.tabs.get(tabId);
  // Unsupported pages are an expected no-op, not an extension failure.
  if (!isSupportedURL(tab.url)) return { ok: false, unsupported: true };
  try {
    const status = await sendToContent(tabId, { type: "cbd-status" });
    remember(tabId, status);
    if (status?.protocol === PROTOCOL && status.ok) return status;
  } catch { /* The page may predate extension installation. */ }
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["panel.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["delete-queue.js", "i18n.js", "content.js"] });
  const status = await sendToContent(tabId, { type: "cbd-status" });
  remember(tabId, status);
  if (status?.protocol !== PROTOCOL || !status.ok) {
    throw new Error(t(tabId, "bgInit"));
  }
  return status;
}

// Serialize actions per tab so quick clicks cannot race during injection.
function runForTab(tabId, operation) {
  const previous = tabJobs.get(tabId) || Promise.resolve();
  const job = previous.catch(() => {}).then(operation);
  tabJobs.set(tabId, job);
  job.finally(() => { if (tabJobs.get(tabId) === job) tabJobs.delete(tabId); }).catch(() => {});
  return job;
}

async function toggleTab(tabId) {
  try {
    let status = await ensureContent(tabId);
    if (status.unsupported) return status;
    status = await sendToContent(tabId, { type: "cbd-set-mode", enabled: !status.enabled });
    if (!status?.ok) {
      await setBadge(tabId, Boolean(status?.enabled), status?.count, status?.error || t(tabId, "bgToggle"));
      return status;
    }
    await setBadge(tabId, status.enabled, status.count, "", status);
    return status;
  } catch (error) {
    await setBadge(tabId, false, 0, error.message).catch(() => {});
    return { ok: false, error: error.message };
  }
}

// Content scripts report mode/count changes so the badge follows the page.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "cbd-mode" && sender.tab) {
    setBadge(sender.tab.id, message.enabled, message.count, "", message).catch(() => {});
  }
});

// Whale can report both panes as active and pass the left pane to onClicked.
// Read focus history from each page, not service-worker memory (which can expire).
async function resolveTargetTab(actionTab) {
  let activeTabs;
  try {
    activeTabs = await chrome.tabs.query({ active: true, windowId: actionTab.windowId });
  } catch (error) {
    throw new Error(t(actionTab.id, "bgActiveTab"));
  }
  const candidates = [...new Map(activeTabs.filter(tab => Number.isInteger(tab.id)).map(tab => [tab.id, tab])).values()];
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error(t(actionTab.id, "bgNoActive"));

  const probes = await Promise.all(candidates.map(async tab => {
    try {
      // Bootstrap pages opened before extension installation, but never toggle here.
      const status = await ensureContent(tab.id);
      if (status.unsupported) return { tab, focus: null, unsupported: true };
      const focus = await sendToContent(tab.id, { type: "cbd-focus-state" }, 500);
      if (focus?.ok && focus.protocol === PROTOCOL) return { tab, focus };
    } catch { /* A pane can be on an unsupported site or still be loading. */ }
    return { tab, focus: null };
  }));
  if (probes.every(item => item.unsupported)) return null;
  const visible = probes.filter(item => item.focus?.visible);
  const focused = visible.filter(item => item.focus.focused);
  if (focused.length === 1) return focused[0].tab;

  const hasUnknownPane = probes.some(item => !item.focus);
  // History is comparable only when every active pane can report it.
  // Otherwise a recent ChatGPT click could steal a different site's pane.
  const eligible = hasUnknownPane ? [] : visible.filter(item =>
    Number.isFinite(item.focus.lastActiveAt) && item.focus.lastActiveAt > 0
  ).sort((a, b) => b.focus.lastActiveAt - a.focus.lastActiveAt);
  if (eligible.length && (eligible.length === 1 || eligible[0].focus.lastActiveAt > eligible[1].focus.lastActiveAt)) {
    return eligible[0].tab;
  }
  const ready = probes.filter(item => item.focus);
  await Promise.all(ready.map(item =>
    sendToContent(item.tab.id, { type: "cbd-show-local-toggle" }, 500).catch(() => {})
  ));
  const error = new Error(t(ready[0]?.tab.id ?? actionTab.id, "bgAmbiguous"));
  // ChatGPT panes that can show the error, even when the browser passed another pane.
  error.tabIds = ready.map(item => item.tab.id);
  throw error;
}

// The toolbar icon itself switches only the pane the user was interacting with.
chrome.action.onClicked.addListener(tab => {
  if (!Number.isInteger(tab.id)) return;
  resolveTargetTab(tab).then(target => target ? runForTab(target.id, () => toggleTab(target.id)) : undefined)
    .catch(error => {
      const tabIds = new Set(error.tabIds || []);
      if (isSupportedURL(tab.url)) tabIds.add(tab.id);
      return Promise.all([...tabIds].map(id => setBadge(id, false, 0, error.message).catch(() => {})));
    });
});

chrome.tabs.onRemoved?.addListener(tabId => { tabThemes.delete(tabId); tabLocales.delete(tabId); });

// A tab that leaves ChatGPT gets the sleeping cat back (its URL is only visible to us on
// chatgpt.com, so an unreadable URL also means another site).
chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading" || isSupportedURL(tab?.url)) return;
  tabThemes.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  setIcon(tabId, "unavailable").catch(() => {});
});
// Default for every tab: asleep and gray until a ChatGPT page reports its state.
setIcon(undefined, "unavailable").catch(() => {});
