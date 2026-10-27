// ChatGPT Bulk Delete - service worker
const PROTOCOL = 3;
const tabJobs = new Map();

// Last accent each page reported, so error/status badges keep the page's theme color.
const tabThemes = new Map();

async function setBadge(tabId, enabled, count = 0, error = "", theme) {
  if (theme?.badgeColor) tabThemes.set(tabId, theme);
  const colors = tabThemes.get(tabId);
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: enabled ? "ON" : error ? "ERR" : "OFF" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: error ? "#b3261e" : colors?.badgeColor || "#d93025" }),
    // setBadgeTextColor exists from Chrome 110; older builds keep the default white.
    chrome.action.setBadgeTextColor?.({ tabId, color: error ? "#ffffff" : colors?.badgeText || "#ffffff" }),
    chrome.action.setTitle({ tabId, title: error || (enabled ? `삭제 모드 ON · 대화 ${count}개 감지` : "삭제 모드 켜기/끄기") }),
  ]);
}

function sendToContent(tabId, message, timeoutMs = 4000) {
  let timer;
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("페이지 응답 시간 초과. ChatGPT를 새로고침해 주세요.")), timeoutMs); }),
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
    if (status?.protocol === PROTOCOL && status.ok) return status;
  } catch { /* The page may predate extension installation. */ }
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["panel.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["delete-queue.js", "content.js"] });
  const status = await sendToContent(tabId, { type: "cbd-status" });
  if (status?.protocol !== PROTOCOL || !status.ok) {
    throw new Error("확장 스크립트 초기화 실패. 확장과 ChatGPT를 새로고침해 주세요.");
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
      await setBadge(tabId, Boolean(status?.enabled), status?.count, status?.error || "삭제 모드를 변경하지 못했습니다.");
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
    throw new Error("활성 탭을 확인하지 못했습니다. 조작할 ChatGPT 화면을 클릭한 뒤 다시 시도해 주세요.");
  }
  const candidates = [...new Map(activeTabs.filter(tab => Number.isInteger(tab.id)).map(tab => [tab.id, tab])).values()];
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error("활성 탭을 찾지 못했습니다. ChatGPT 화면을 클릭한 뒤 다시 시도해 주세요.");

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
  const error = new Error("듀얼탭 대상을 구분할 수 없습니다. 원하는 화면 사이드바의 휴지통 버튼을 사용하거나 화면을 클릭한 뒤 다시 시도해 주세요.");
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

chrome.tabs.onRemoved?.addListener(tabId => tabThemes.delete(tabId));
