// ChatGPT Bulk Delete: sidebar UI and private API integration.
(() => {
  const VERSION = "0.11.0";
  const INSTANCE = "__cbdInstanceV2";
  // Always replace a previous instance. After an extension reload the old script is
  // orphaned but can share this world's globals, so a version check would keep a dead
  // instance alive. Its selection is carried over instead.
  let inherited = null;
  try { inherited = globalThis[INSTANCE]?.exportState?.() || null; } catch { /* broken instance */ }
  try { globalThis[INSTANCE]?.destroy?.(); } catch { /* already invalidated */ }
  try { delete globalThis[INSTANCE]; } catch { /* ignore */ }

  const DELETE_CONCURRENCY = 3;
  const DELETE_DELAY_MS = 500;
  // Deleting this many chats or more asks for confirmation inside the panel first.
  const CONFIRM_AT = 5;
  const SIDEBAR_SELECTOR = "nav, aside";
  // In delete mode chat links lose their href (kept in data-cbd-href), so both forms match.
  // ChatGPT conversations are /c/<id> (or /g/<project>/c/<id>); Codex tasks are
  // /remote/task_…. In delete mode links lose their href (kept in data-cbd-href).
  const CHAT_LINK_SELECTOR = ['/c/', '/remote/task_']
    .flatMap(path => [`nav a[href*="${path}"]`, `aside a[href*="${path}"]`])
    .concat('nav a[data-cbd-href]', 'aside a[data-cbd-href]').join(", ");
  // Sidebar menus disabled in delete mode besides the header row, found without relying
  // on the UI language: the ChatGPT/Codex mode menu (it swaps the whole list; its text is
  // the untranslated product name) and the profile/account menu (an avatar image in the
  // button or in the row it covers). Known labels remain as a fallback.
  const MENU_SELECTOR = 'button[aria-haspopup="menu"]';
  const MODE_NAMES = /^(?:chatgpt|codex)$/i;
  const MENU_LABELS = /모드 전환|switch mode|프로필|profile|account/i;
  const LEAVE_MS = 180; // matches --cbd-dur-out in panel.css
  const VANISH_MS = 260; // matches cbd-row-out in panel.css
  const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
  const view = document.defaultView;
  const state = {
    enabled: false, busy: false,
    known: new Set(), selected: new Set(), deleted: new Set(),
    // Sidebar order of every chat seen this session, including rows a virtualized list
    // has since unmounted, so "to the end" ranges also cover chats scrolled out of view.
    order: [],
    vanishing: new Set(), // deleted just now; collapsing before being hidden
    slots: new Map(), // deleted id -> { container, y, h } for absolutely positioned rows
    anchorId: null, anchorValue: true,
    message: "", progress: null, cooldownUntil: 0, confirming: 0,
  };
  if (inherited) {
    state.enabled = Boolean(inherited.enabled);
    for (const key of ["known", "selected", "deleted"]) state[key] = new Set(inherited[key] || []);
  }
  let scheduled = 0;
  let rootsScheduled = 0;
  let destroyed = false;
  let lastPublished = "";
  let sidebarRoots = [];
  let lastSelectedCount = -1;
  const leaveTimers = new Map();
  // The last pointer gesture on a chat link, used to catch navigations that bypass click.
  let gesture = null;
  const listeners = [];

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "role" || key.startsWith("aria-")) node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const child of children) node.append(child);
    return node;
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  function listen(target, type, fn, capture = false) {
    target.addEventListener(type, fn, capture);
    listeners.push(() => target.removeEventListener(type, fn, capture));
  }
  function idFromURL(value) {
    try {
      const url = new URL(value, "https://chatgpt.com");
      if (url.origin !== "https://chatgpt.com") return null;
      return url.pathname.match(/^\/(?:g\/[^/]+\/)?c\/([\w-]+)\/?$/)?.[1]
        || url.pathname.match(/^\/remote\/(task_[\w-]+)\/?$/)?.[1] || null;
    } catch { return null; }
  }
  function chatId(a) {
    if (!a?.matches?.(CHAT_LINK_SELECTOR)) return null;
    // A live href wins: React may have rendered a new one over a stripped link.
    return idFromURL(a.getAttribute("href") ?? a.dataset.cbdHref);
  }
  function linkOf(event) {
    const a = event.target?.closest?.(CHAT_LINK_SELECTOR);
    const id = chatId(a);
    return id ? { a, id } : null;
  }
  function chatLinks() {
    return [...document.querySelectorAll(CHAT_LINK_SELECTOR)]
      .map(a => ({ a, id: chatId(a) })).filter(item => item.id);
  }
  // Unique selectable IDs in sidebar order, for Shift+click ranges.
  function orderedIds() {
    return [...new Set(chatLinks().map(item => item.id))].filter(id => !state.deleted.has(id));
  }
  function reduceMotion() {
    try { return view.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; }
    catch { return false; }
  }
  // Restart a short "pop" animation by alternating between two identical keyframes.
  function pop(node) {
    node.dataset.pop = node.dataset.pop === "a" ? "b" : "a";
  }
  // `hidden` flips immediately so state stays truthful; CSS keeps the node visible while
  // data-cbd-leaving plays the exit animation.
  function setShown(node, shown) {
    const wasShown = !node.hidden;
    node.hidden = !shown;
    if (shown) {
      clearTimeout(leaveTimers.get(node));
      leaveTimers.delete(node);
      delete node.dataset.cbdLeaving;
      return;
    }
    // Already hidden: a repeated render must not cut a running exit animation short.
    if (!wasShown || reduceMotion()) return;
    node.dataset.cbdLeaving = "";
    clearTimeout(leaveTimers.get(node));
    leaveTimers.set(node, setTimeout(() => {
      leaveTimers.delete(node);
      delete node.dataset.cbdLeaving;
    }, LEAVE_MS));
  }
  // An orphaned instance (extension reloaded) must stop intercepting the page.
  function alive() {
    if (destroyed) return false;
    try { if (chrome.runtime?.id) return true; } catch { /* invalidated */ }
    destroy();
    return false;
  }

  // UI language follows ChatGPT's <html lang> (its language setting), then the browser.
  const pageLanguage = () => document.documentElement?.getAttribute("lang") || "";
  let i18n = globalThis.CBDI18n.create(pageLanguage(), navigator?.language);
  const t = (key, params) => i18n.t(key, params);

  // One status line; only its numbers carry the theme color.
  const summaryText = el("span", { className: "cbd-summary-text", role: "status", "aria-live": "polite" });
  // The selected count is shown on the trash button; screen readers still hear it here.
  function renderSummary(total, selected) {
    const parts = !total ? [t("empty")] : i18n.parts("chats", { n: total }).map(part =>
      typeof part === "string" ? part : el("span", { className: "cbd-num", textContent: part.value }));
    if (selected) parts.push(el("span", { className: "cbd-sr-only", textContent: t("srSelected", { n: selected }) }));
    const text = parts.map(part => typeof part === "string" ? part : part.textContent).join("");
    if (summaryText.textContent !== text) summaryText.replaceChildren(...parts);
  }
  const selectAllBtn = el("button", { type: "button" });
  // Trash icon plus the selected count (no number while nothing is selected).
  const deleteBtn = el("button", { type: "button", className: "cbd-danger cbd-delete" });
  const deleteCount = el("span", { className: "cbd-delete-count", hidden: true });
  const feedback = el("div", { className: "cbd-feedback", role: "status", "aria-live": "polite", hidden: true });
  // Usage help: a "?" at the panel's top-right whose tooltip opens on hover, keyboard
  // focus, or a click (so it also works on touch and can be pinned open).
  // [key label, description] message keys, in tooltip order.
  const HELP_ROWS = [
    ["kClick", "hClick"], ["kDrag", "hDrag"], ["kShiftClick", "hShiftClick"], ["kShiftEnd", "hShiftEnd"],
    ["kShiftHome", "hShiftHome"], ["kSelectAll", "hSelectAll"], ["kEsc", "hEsc"], ["kDelete", "hDelete"],
  ];
  const helpRows = el("tbody");
  const helpQueue = el("p");
  const helpTip = el("div", { className: "cbd-help-tip", id: "cbd-help-tip", role: "tooltip" }, [el("table", {}, [helpRows]), helpQueue]);
  const helpBtn = el("button", {
    type: "button", className: "cbd-help-btn", textContent: "?",
    "aria-describedby": "cbd-help-tip", "aria-expanded": "false",
  });
  const help = el("div", { className: "cbd-help" }, [helpBtn, helpTip]);
  function setHelpOpen(open) {
    setMark(help, "open", open ? "" : null);
    helpBtn.setAttribute("aria-expanded", String(open));
  }
  listen(helpBtn, "click", () => setHelpOpen(!("open" in help.dataset)));
  // A pinned tooltip closes on any press outside it.
  listen(view, "pointerdown", event => {
    if ("open" in help.dataset && !help.contains(event.target)) setHelpOpen(false);
  }, true);
  const actions = el("div", { className: "cbd-actions" }, [selectAllBtn, deleteBtn]);
  const confirmText = el("p", { className: "cbd-confirm-text", id: "cbd-confirm-text" });
  const cancelDeleteBtn = el("button", { type: "button" });
  const confirmDeleteBtn = el("button", { type: "button", className: "cbd-danger" });
  const confirmBox = el("div", {
    className: "cbd-confirm", role: "alertdialog", "aria-labelledby": "cbd-confirm-text", hidden: true,
  }, [confirmText, el("div", { className: "cbd-actions" }, [cancelDeleteBtn, confirmDeleteBtn])]);
  const bar = el("div", { className: "cbd-bar", hidden: true, role: "region" }, [
    el("div", { className: "cbd-summary" }, [summaryText, help]),
    actions, confirmBox, feedback,
  ]);
  // Both labels share one grid cell and only the current one is visible, so the button
  // keeps the width of its longer label. The current label is the accessible name.
  function twoLabels(button, labels) {
    button.classList.add("cbd-two-labels");
    button.replaceChildren(...labels.map(text => el("span", { className: "cbd-label", textContent: text, "aria-hidden": "true" })));
  }
  function showLabel(button, text) {
    for (const span of button.children) setMark(span, "cbdActive", span.textContent === text ? "" : null);
    if (button.getAttribute("aria-label") !== text) button.setAttribute("aria-label", text);
  }
  // The main switch lives in ChatGPT's sidebar header, next to its search button, and
  // borrows that button's classes so it looks native while OFF.
  const TRASH_ICON = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"'
    + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5'
    + 'M5.5 5.5l.7 10a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10M8.5 8.5v5M11.5 8.5v5"/></svg>';
  const sideBtn = el("button", { type: "button", "aria-pressed": "false" });
  const sideInner = el("span");
  sideInner.innerHTML = TRASH_ICON;
  sideBtn.append(sideInner);
  deleteBtn.innerHTML = TRASH_ICON;
  deleteBtn.append(deleteCount);
  function searchButton() {
    const icon = document.querySelector('nav use[href*="magnifying-glass"], aside use[href*="magnifying-glass"]');
    return icon?.closest("button") || null;
  }
  // Inserted before the search button (or the wrapper that holds only it), so the row
  // reads, from the right: sidebar toggle, search, delete mode.
  function placeSideButton() {
    const search = searchButton();
    if (!search) { sideBtn.remove(); return false; }
    let slot = search;
    while (slot.parentElement && slot.parentElement.children.length === 1 && !slot.parentElement.matches(SIDEBAR_SELECTOR)) slot = slot.parentElement;
    if (sideBtn.nextElementSibling !== slot) slot.before(sideBtn);
    const className = `${search.className} cbd-side-switch`;
    if (sideBtn.className !== className) sideBtn.className = className;
    for (const name of ["data-color", "data-variant", "data-size", "data-uniform"]) {
      const value = search.getAttribute(name);
      if (value === null) sideBtn.removeAttribute(name);
      else if (sideBtn.getAttribute(name) !== value) sideBtn.setAttribute(name, value);
    }
    const innerClass = search.firstElementChild?.className || "";
    if (sideInner.className !== innerClass) sideInner.className = innerClass;
    return true;
  }
  // In delete mode the other sidebar header buttons (search, sidebar toggle) are
  // disabled. They belong to React, so instead of `disabled` they get a mark that the
  // stylesheet greys out and the capture listeners refuse.
  function headerButtons() {
    let row = sideBtn.parentElement;
    while (row && row.querySelectorAll("button").length < 3 && row.parentElement
      && !row.parentElement.matches(SIDEBAR_SELECTOR) && !row.parentElement.querySelector(CHAT_LINK_SELECTOR)) {
      row = row.parentElement;
    }
    return row ? [...row.querySelectorAll("button")].filter(button => button !== sideBtn) : [];
  }
  // Some controls are a transparent button laid over a row that draws the visuals and
  // the hover (e.g. the expanded profile row). That row is dimmed and made inert too:
  // the nearest ancestor with hover styling that still holds only this control. Going
  // further could dim a sticky footer whose background hides the list behind it.
  const CONTROL_SELECTOR = 'button, [role="button"], a[href], a[data-cbd-href]';
  function lockArea(button) {
    for (let parent = button.parentElement; parent && !parent.matches(SIDEBAR_SELECTOR); parent = parent.parentElement) {
      if (parent.querySelectorAll(CONTROL_SELECTOR).length !== 1) break;
      if (parent.matches('.group, [class*="hover:"]')) return parent;
    }
    return button;
  }
  function lockedMenu(button) {
    if (button === sideBtn || !button.closest(SIDEBAR_SELECTOR) || button.closest("[data-cbd-item]")) return false;
    if (MODE_NAMES.test(button.textContent.trim()) || MENU_LABELS.test(button.getAttribute("aria-label") || "")) return true;
    // A menu row with links (a GPT or project) is not the account menu even with an image.
    const area = lockArea(button);
    return Boolean(button.querySelector("img") || (area !== button && area.querySelector("img")));
  }
  function lockHeader(locked) {
    const modeSwitches = [...document.querySelectorAll(MENU_SELECTOR)].filter(lockedMenu);
    const targets = locked ? [...new Set([...headerButtons(), ...modeSwitches])] : [];
    const areas = new Set(targets.map(lockArea).filter((area, i) => area !== targets[i]));
    for (const area of document.querySelectorAll("[data-cbd-lock-area]")) {
      if (!areas.has(area)) delete area.dataset.cbdLockArea;
    }
    // data-cbd-fade stays after unlocking so the way back fades too (removed on destroy).
    for (const area of areas) { setMark(area, "cbdLockArea", ""); setMark(area, "cbdFade", ""); }
    for (const button of document.querySelectorAll("[data-cbd-disabled]")) {
      if (targets.includes(button)) continue;
      if ("cbdTabindex" in button.dataset) {
        const previous = button.dataset.cbdTabindex;
        if (previous) button.setAttribute("tabindex", previous); else button.removeAttribute("tabindex");
      }
      button.removeAttribute("aria-disabled");
      delete button.dataset.cbdTabindex;
      delete button.dataset.cbdDisabled;
    }
    for (const button of targets) {
      if ("cbdDisabled" in button.dataset) continue;
      button.dataset.cbdFade = "";
      button.dataset.cbdDisabled = "";
      button.dataset.cbdTabindex = button.getAttribute("tabindex") ?? "";
      button.setAttribute("tabindex", "-1");
      button.setAttribute("aria-disabled", "true");
    }
  }
  // Every fixed label; re-run when ChatGPT's language changes. Counts are set in render().
  function applyLanguage() {
    bar.lang = i18n.locale;
    bar.setAttribute("aria-label", t("region"));
    helpRows.replaceChildren(...HELP_ROWS.map(([key, action]) =>
      el("tr", {}, [el("th", { textContent: t(key) }), el("td", { textContent: t(action) })])));
    setText(helpQueue, t("helpQueue", { n: DELETE_CONCURRENCY }));
    helpBtn.setAttribute("aria-label", t("helpLabel"));
    deleteBtn.title = t("deleteSelected");
    setText(cancelDeleteBtn, t("cancel"));
    setText(confirmDeleteBtn, t("delete"));
    sideBtn.title = t("sideTitle");
    twoLabels(selectAllBtn, [t("selectAll"), t("clearAll")]);
  }
  applyLanguage();
  let lastFocusedAt = 0;
  let lastInteractionAt = 0;
  function recordFocus() {
    if (document.visibilityState === "visible" && document.hasFocus()) lastFocusedAt = Date.now();
  }
  function recordInteraction(event) {
    if (event.isTrusted && document.visibilityState === "visible") {
      lastInteractionAt = Date.now();
      lastFocusedAt = lastInteractionAt;
    }
  }
  function getFocusState() {
    return {
      ok: true, protocol: 3,
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
      lastFocusedAt, lastInteractionAt,
      lastActiveAt: Math.max(lastFocusedAt, lastInteractionAt),
    };
  }
  // Registered on window before the blocking listeners so blocked clicks still count.
  listen(view, "focus", recordFocus, true);
  listen(document, "focusin", recordFocus, true);
  listen(document, "visibilitychange", recordFocus);
  listen(view, "pointerdown", recordInteraction, true);
  listen(view, "keydown", recordInteraction, true);
  recordFocus();

  function getStatus() {
    return {
      ok: true, protocol: 3, enabled: state.enabled, busy: state.busy, count: state.known.size, selected: state.selected.size,
      // The toolbar badge uses the page's accent too.
      badgeColor: badgeTheme.color, badgeText: badgeTheme.text,
      // Lets the toolbar title and errors use the page's language.
      locale: i18n.locale,
    };
  }
  function publish() {
    if (!alive()) return;
    const status = getStatus();
    const signature = JSON.stringify(status);
    if (signature === lastPublished) return;
    lastPublished = signature;
    // sendMessage throws synchronously once the extension context is invalidated.
    try { chrome.runtime.sendMessage({ type: "cbd-mode", ...status })?.catch?.(() => {}); }
    catch { destroy(); }
  }
  function render() {
    if (destroyed) return;
    // At document_start there is no body yet; the root observer retries once it exists.
    if (document.body) {
      if (!bar.isConnected) document.body.append(bar);
    }
    const docked = placeSideButton();
    lockHeader(docked && state.enabled);
    sideBtn.disabled = state.busy;
    sideBtn.setAttribute("aria-pressed", String(state.enabled));
    sideBtn.setAttribute("aria-label", t(state.enabled ? "sideTurnOff" : "sideTurnOn"));
    setShown(bar, state.enabled);
    if (state.enabled) { observeMain(); placeBar(); }
    // Lets the stylesheet hide ChatGPT's hover actions while in delete mode. Re-applied
    // on every render in case the page rewrites <html> attributes.
    if (document.documentElement) setMark(document.documentElement, "cbdMode", state.enabled ? "" : null);
    renderSummary(state.known.size, state.selected.size);
    if (state.selected.size && lastSelectedCount >= 0 && lastSelectedCount !== state.selected.size && state.enabled) pop(deleteCount);
    lastSelectedCount = state.selected.size;
    showLabel(selectAllBtn, t(state.selected.size ? "clearAll" : "selectAll"));
    selectAllBtn.disabled = state.busy || (!state.selected.size && !state.known.size);
    deleteBtn.disabled = state.busy || !state.selected.size;
    setText(deleteCount, state.selected.size ? i18n.number(state.selected.size) : "");
    deleteCount.hidden = !state.selected.size;
    const deleteLabel = state.selected.size ? t("deleteN", { n: state.selected.size }) : t("deleteSelected");
    if (deleteBtn.getAttribute("aria-label") !== deleteLabel) deleteBtn.setAttribute("aria-label", deleteLabel);
    // A changed selection invalidates the question; ask again with the new count.
    if (state.confirming && (state.busy || state.selected.size !== state.confirming)) state.confirming = 0;
    actions.hidden = Boolean(state.confirming);
    cancelDeleteBtn.disabled = confirmDeleteBtn.disabled = state.busy;
    confirmBox.hidden = !state.confirming;
    if (state.confirming) setText(confirmText, t("confirm", { n: state.confirming }));
    let text = state.message;
    if (state.busy && state.progress) {
      const progress = state.progress;
      text = t("progress", { done: progress.completed, total: progress.total });
      if (state.cooldownUntil > Date.now()) text += ` · ${t("cooldown", { n: Math.ceil((state.cooldownUntil - Date.now()) / 1000) })}`;
      if (state.message) text += ` · ${state.message}`;
    }
    feedback.hidden = !text;
    setText(feedback, text);
  }
  function refresh({ notify = true } = {}) {
    if (destroyed) return getStatus();
    // Virtualized lists can reuse a hidden row's element for another chat.
    for (const row of document.querySelectorAll("[data-cbd-row]")) {
      const links = [...row.querySelectorAll(CHAT_LINK_SELECTOR)];
      if (!links.some(a => state.deleted.has(chatId(a)))) delete row.dataset.cbdRow;
    }
    const links = chatLinks();
    if (state.enabled) mergeOrder(links.map(item => item.id));
    for (const { a, id } of links) {
      markRow(a, id);
      if (!state.enabled) continue;
      // Detected chats are counted per delete-mode session: the mode menu is locked while
      // ON, so ChatGPT conversations and Codex tasks never mix in one count.
      if (!state.deleted.has(id)) state.known.add(id);
      stripLink(a);
      if (state.deleted.has(id)) continue;
      // Selection is shown by tinting the chat's own rounded row, not by a checkbox.
      const item = itemOf(a);
      const mark = state.selected.has(id) ? "selected" : "";
      if (item.dataset.cbdItem !== undefined && item.dataset.cbdItem !== mark) pop(item);
      setMark(item, "cbdItem", mark);
      item.setAttribute("aria-selected", String(Boolean(mark)));
    }
    if (state.slots.size || document.querySelector("[data-cbd-shift]")) compensate();
    render();
    if (notify) publish();
    return getStatus();
  }
  function setMark(node, key, value) {
    if (value === null) { if (key in node.dataset) delete node.dataset[key]; }
    else if (node.dataset[key] !== value) node.dataset[key] = value;
  }
  // ChatGPT only drops deleted chats from its list after a refetch, so they are hidden
  // here instead (in either mode). Nodes are never removed, since React owns them;
  // a re-rendered node simply gets the mark again on the next refresh.
  function markRow(a, id) {
    let mark = null;
    if (state.deleted.has(id)) mark = state.vanishing.has(id) ? "vanishing" : "deleted";
    // An empty mark while ON keeps the attribute, so unselecting still transitions.
    else if (state.enabled) mark = state.selected.has(id) ? "selected" : "";
    if (!state.deleted.has(id)) return setMark(a, "cbd", mark);
    const row = rowOf(a);
    rememberSlot(id, row); // measure before the mark starts the collapse
    setMark(a, "cbd", mark);
    if (row !== a) setMark(row, "cbdRow", mark);
  }
  // The outermost wrapper holding this chat and no other link: the chat's list slot.
  // Hiding only the link would leave the wrapper's height behind as a gap.
  function rowOf(a) {
    let row = a;
    for (let parent = a.parentElement; parent && !parent.matches(SIDEBAR_SELECTOR); parent = parent.parentElement) {
      if (parent.querySelectorAll("a[href], a[data-cbd-href]").length !== 1) break;
      row = parent;
    }
    return row;
  }
  function isHidden(row) {
    return ["deleted", "vanishing"].includes(row.dataset.cbdRow || row.dataset.cbd);
  }
  // Virtualized lists position rows with inline translateY/top instead of normal flow.
  function slotY(row) {
    const transform = row.style.transform || "";
    const match = /translateY\((-?[\d.]+)px\)/.exec(transform)
      || /translate(?:3d)?\(\s*-?[\d.]+px\s*,\s*(-?[\d.]+)px/.exec(transform);
    if (match) return parseFloat(match[1]);
    return /px$/.test(row.style.top) ? parseFloat(row.style.top) : null;
  }
  function rememberSlot(id, row) {
    if (state.slots.has(id) || !row.parentElement) return;
    const y = slotY(row);
    if (y === null || view.getComputedStyle(row).position !== "absolute") return;
    const h = row.getBoundingClientRect().height || parseFloat(row.style.height) || 0;
    if (h > 0) state.slots.set(id, { container: row.parentElement, y, h });
  }
  // Absolutely positioned rows do not reflow when one is hidden, so rows below a
  // deleted slot are moved up by its height. `translate` composes with the list's own
  // `transform`, which keeps changing as it scrolls.
  function compensate() {
    const byContainer = new Map();
    for (const [id, slot] of state.slots) {
      if (!slot.container.isConnected) continue;
      // After ChatGPT refetches, a live chat occupies the deleted slot's position and the
      // list has closed the gap itself; keeping the slot would shift rows twice. A slot
      // that merely scrolled out of the rendered window has no row there and is kept.
      const taken = [...slot.container.children].some(row => slotY(row) === slot.y && !isHidden(row)
        && [...row.querySelectorAll(CHAT_LINK_SELECTOR)].some(a => !state.deleted.has(chatId(a))));
      if (taken) { state.slots.delete(id); continue; }
      if (!byContainer.has(slot.container)) byContainer.set(slot.container, []);
      byContainer.get(slot.container).push(slot);
    }
    for (const row of document.querySelectorAll("[data-cbd-shift]")) {
      if (!byContainer.has(row.parentElement)) { row.style.translate = ""; delete row.dataset.cbdShift; }
    }
    for (const [container, slots] of byContainer) {
      for (const row of container.children) {
        const y = slotY(row);
        if (y === null || isHidden(row)) continue;
        const shift = slots.reduce((sum, slot) => slot.y < y ? sum + slot.h : sum, 0);
        const value = shift ? `0 ${-shift}px` : "";
        if (row.style.translate !== value) row.style.translate = value;
        setMark(row, "cbdShift", shift ? "" : null);
      }
    }
  }
  function vanish(id) {
    state.deleted.add(id);
    if (reduceMotion()) return;
    state.vanishing.add(id);
    setTimeout(() => {
      state.vanishing.delete(id);
      scheduleRefresh();
    }, VANISH_MS);
  }
  // Some browsers (Whale) open Shift/Ctrl/Alt/middle-clicked links in a new window even
  // when the click is prevented, so in delete mode chat links stop being links at all.
  // The tabindex keeps them focusable for Space/Enter.
  function stripLink(a) {
    const href = a.getAttribute("href");
    if (href === null) return;
    a.dataset.cbdHref = href;
    a.removeAttribute("href");
    if (!a.hasAttribute("tabindex")) {
      a.setAttribute("tabindex", "0");
      a.dataset.cbdTab = "";
    }
  }
  function restoreLinks() {
    for (const a of document.querySelectorAll("a[data-cbd-href]")) {
      if (!a.hasAttribute("href")) a.setAttribute("href", a.dataset.cbdHref);
      delete a.dataset.cbdHref;
      if ("cbdTab" in a.dataset) {
        a.removeAttribute("tabindex");
        delete a.dataset.cbdTab;
      }
    }
  }
  // The visible rounded row around a chat link (ChatGPT's `sidebar-item` group). It must
  // hold only this chat; otherwise the link itself is used.
  function itemOf(a) {
    const item = a.closest('[data-sidebar-cycle-item], .sidebar-item, [role="group"]');
    return item && item.querySelectorAll("a[href], a[data-cbd-href]").length === 1 ? item : a;
  }
  // Deleted rows stay hidden unless the whole instance is torn down (`all`). Item marks
  // are kept but emptied when only the mode is turned off, so the tint fades out.
  function undecorate({ all = false } = {}) {
    restoreLinks();
    for (const item of document.querySelectorAll("[data-cbd-item]")) {
      if (all) delete item.dataset.cbdItem;
      else item.dataset.cbdItem = "";
      item.removeAttribute("aria-selected");
      delete item.dataset.pop;
    }
    document.querySelectorAll("[data-cbd]").forEach(a => {
      if (all || !["deleted", "vanishing"].includes(a.dataset.cbd)) delete a.dataset.cbd;
    });
    if (!all) return;
    document.querySelectorAll("[data-cbd-row]").forEach(row => delete row.dataset.cbdRow);
    document.querySelectorAll("[data-cbd-shift]").forEach(row => {
      row.style.translate = "";
      delete row.dataset.cbdShift;
    });
  }
  function setEnabled(on) {
    if (state.busy && !on) {
      state.message = t("busyOff");
      render();
      throw new Error(state.message);
    }
    state.enabled = on;
    state.anchorId = null;
    endDrag();
    if (on) applyTheme();
    // Turning the mode off discards the selection and detected count, so a later ON
    // (possibly in the other ChatGPT/Codex mode) starts clean.
    if (!on) { state.selected.clear(); state.known.clear(); state.order = []; state.confirming = 0; setHelpOpen(false); }
    if (!on) undecorate();
    refresh();
  }
  function scheduleRefresh() {
    if (scheduled || destroyed) return;
    scheduled = requestAnimationFrame(() => { scheduled = 0; refresh(); });
  }

  // Only the sidebar is observed in detail. The document-level observer just notices
  // when sidebars mount/unmount or our UI is removed, at most once per frame, so
  // streaming answers do not pay for per-mutation checks.
  const sidebarObserver = new MutationObserver(scheduleRefresh);
  function syncRoots() {
    rootsScheduled = 0;
    if (destroyed) return;
    const roots = [...document.querySelectorAll(SIDEBAR_SELECTOR)];
    const changed = roots.length !== sidebarRoots.length || roots.some((root, i) => root !== sidebarRoots[i]);
    if (changed) {
      sidebarObserver.disconnect();
      for (const root of roots) {
        sidebarObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
      }
      sidebarRoots = roots;
    }
    if (changed || !themeStyle.isConnected) { watchThemeTargets(); scheduleTheme(); }
    if (changed || !bar.isConnected || (!sideBtn.isConnected && searchButton())) scheduleRefresh();
    observeMain();
  }
  const rootObserver = new MutationObserver(() => {
    if (!rootsScheduled && !destroyed) rootsScheduled = requestAnimationFrame(syncRoots);
  });
  rootObserver.observe(document, { childList: true, subtree: true });

  // ---------- Panel position ----------

  // The panel sits at the top-left of the chat area, below its header, and follows it
  // when the sidebar opens, closes or resizes. Some pages (schedules, ...) have no <main>
  // or one that spans under the sidebar, so the sidebar's right edge is a lower bound.
  let barResize = null;
  let observed = [];
  function chatSidebar() {
    return [...document.querySelectorAll(SIDEBAR_SELECTOR)].find(root =>
      root.contains(sideBtn) || root.querySelector(CHAT_LINK_SELECTOR)) || null;
  }
  function placeBar() {
    const mainBox = document.querySelector("main")?.getBoundingClientRect();
    const sideBox = chatSidebar()?.getBoundingClientRect();
    const sideRight = sideBox && sideBox.width > 0 && sideBox.left < view.innerWidth / 2 ? sideBox.right : 0;
    const mainLeft = mainBox && mainBox.width > 0 ? mainBox.left : 0;
    const left = `${Math.round(Math.max(mainLeft, sideRight) + 16)}px`;
    const top = `${Math.round((mainBox && mainBox.height > 0 ? mainBox.top : 0) + 64)}px`;
    if (bar.style.getPropertyValue("--cbd-bar-left") !== left) bar.style.setProperty("--cbd-bar-left", left);
    if (bar.style.getPropertyValue("--cbd-bar-top") !== top) bar.style.setProperty("--cbd-bar-top", top);
  }
  function observeMain() {
    if (typeof ResizeObserver !== "function") return;
    const targets = [document.querySelector("main"), chatSidebar()].filter(Boolean);
    if (targets.length === observed.length && targets.every((t, i) => t === observed[i])) return;
    barResize ??= new ResizeObserver(() => { if (state.enabled && !destroyed) placeBar(); });
    barResize.disconnect();
    for (const target of targets) barResize.observe(target);
    observed = targets;
  }
  listen(view, "resize", () => { if (state.enabled) placeBar(); });

  // ---------- Theme ----------

  // ChatGPT's per-account accent color has no documented variable name, so it is found
  // at runtime: collect the page's custom properties, keep those named like an accent,
  // and take the most saturated one. The chosen variable is linked, not copied, so a
  // light/dark switch recolors our UI without another scan. Surface and text colors are
  // read from the page and re-read whenever the theme may have changed.
  const themeStyle = el("style", { id: "cbd-theme" });
  const badgeTheme = { color: "#d93025", text: "#ffffff" };
  let themeRetry = 0;
  let themeSignature = "";
  let themeScheduled = 0;
  let canvasContext;
  const colorCache = new Map();
  function rgbaOf(value) {
    if (!value) return null;
    if (colorCache.has(value)) return colorCache.get(value);
    if (colorCache.size > 500) colorCache.clear();
    const color = parseColor(value);
    colorCache.set(value, color);
    return color;
  }
  function parseColor(value) {
    // Canvas normalizes any CSS color (oklch, color-mix, ...) to sRGB pixels.
    if (canvasContext === undefined) {
      try { canvasContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true }) || null; }
      catch { canvasContext = null; }
    }
    if (canvasContext) {
      canvasContext.clearRect(0, 0, 1, 1);
      canvasContext.fillStyle = "#010203";
      canvasContext.fillStyle = value;
      if (canvasContext.fillStyle === "#010203" && !/^#010203$/i.test(value)) return null; // unparsable
      canvasContext.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvasContext.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    }
    const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
    if (hex) {
      const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join("") : hex[1];
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
    }
    const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(value);
    if (!rgb) return null;
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [+rgb[1], +rgb[2], +rgb[3], alpha];
  }
  const saturation = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  function customPropertyNames() {
    const names = new Set();
    const scan = text => { for (const match of text.matchAll(/--[\w-]+(?=\s*:)/g)) names.add(match[0]); };
    for (const node of [document.documentElement, document.body]) {
      if (!node) continue;
      try {
        const computed = view.getComputedStyle(node);
        for (let i = 0; i < computed.length; i++) if (computed[i].startsWith("--")) names.add(computed[i]);
      } catch { /* not enumerable in every engine */ }
      scan(node.getAttribute("style") || "");
    }
    for (const style of document.querySelectorAll("style")) if (style !== themeStyle) scan(style.textContent || "");
    const walk = rules => {
      for (const rule of rules) {
        if (rule.style) for (let i = 0; i < rule.style.length; i++) if (rule.style[i].startsWith("--")) names.add(rule.style[i]);
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* cross-origin sheet */ }
    }
    return names;
  }
  // ChatGPT defines every selectable accent as a palette (--color-chat-accent-cyan,
  // -purple, ...), so the most saturated accent variable is just one palette entry.
  // The account's choice is found, in order of reliability, from: a non-palette accent
  // variable (e.g. --color-chat-accent), a palette key named on <html>/<body> or in
  // localStorage, or the palette color the rendered page actually uses.
  function findAccent(names) {
    const scopes = [document.body, document.documentElement].filter(Boolean).map(node => view.getComputedStyle(node));
    const valueOf = name => scopes.map(style => style.getPropertyValue(name).trim()).find(Boolean) || "";
    const usable = color => color && color[3] >= 0.6 && saturation(color) >= 0.2;
    const same = (a, b) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 3);
    const accents = [...names].filter(name => /accent/i.test(name) && !name.startsWith("--cbd-"))
      .map(name => ({ name, color: rgbaOf(valueOf(name)) })).filter(item => usable(item.color));

    const families = new Map();
    for (const item of accents) {
      const match = /^(.*accent)-([a-z]+)$/i.exec(item.name);
      if (!match) continue;
      if (!families.has(match[1])) families.set(match[1], []);
      families.get(match[1]).push({ ...item, key: match[2].toLowerCase() });
    }
    const palette = [...families.values()].filter(members => members.length >= 3).flat();
    const inPalette = new Set(palette.map(item => item.name));

    // 1. An accent variable outside the palette, preferably one equal to a palette color.
    const direct = accents.filter(item => !inPalette.has(item.name))
      .map(item => ({ ...item, score: saturation(item.color) + (palette.some(p => same(p.color, item.color)) ? 1 : 0)
        + (/(^--(color-)?(chat-|theme-|user-)?accent)$/i.test(item.name) ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score)[0];
    if (direct && (!palette.length || direct.score >= 1)) return { ...direct, via: "variable" };
    if (!palette.length) return direct ? { ...direct, via: "variable" } : null;

    // 2. A palette key named on the root elements or in the page's saved settings.
    const words = new Set();
    const addWords = text => { for (const word of String(text).toLowerCase().split(/[^a-z]+/)) if (word) words.add(word); };
    for (const node of [document.documentElement, document.body]) {
      for (const attr of node?.attributes || []) if (attr.name !== "style" && !attr.name.startsWith("data-cbd")) addWords(attr.value);
    }
    const byKey = palette.find(item => words.has(item.key));
    if (byKey) return { ...byKey, via: "attribute" };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!/accent|theme|color/i.test(key)) continue;
        const value = (localStorage.getItem(key) || "").slice(0, 2000).toLowerCase();
        const stored = palette.find(item => new RegExp(`(^|[^a-z])${item.key}([^a-z]|$)`).test(value));
        if (stored) return { ...stored, via: `localStorage ${key}` };
      }
    } catch { /* storage blocked */ }

    // 3. The palette color most used by rendered elements.
    const counts = new Map();
    const elements = document.body ? document.body.getElementsByTagName("*") : [];
    for (let i = 0; i < Math.min(elements.length, 4000); i++) {
      const node = elements[i];
      if (node.closest?.(".cbd-bar, .cbd-side-switch, [data-cbd-item]")) continue;
      const style = view.getComputedStyle(node);
      for (const value of [style.color, style.backgroundColor, style.borderTopColor, style.fill]) {
        const color = rgbaOf(value);
        if (!usable(color)) continue;
        const hit = palette.find(item => same(item.color, color));
        if (hit) counts.set(hit, (counts.get(hit) || 0) + 1);
      }
    }
    const used = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (used) return { ...used[0], via: `used by ${used[1]} elements` };
    console.log("[cbd] 테마 팔레트는 찾았지만 선택된 색을 알 수 없음:", palette.map(item => item.name).join(", "));
    return null;
  }

  // The first opaque background from the sidebar (or body) upward.
  function surfaceColor() {
    for (let node = document.querySelector(SIDEBAR_SELECTOR) || document.body; node; node = node.parentElement) {
      const color = rgbaOf(view.getComputedStyle(node).backgroundColor);
      if (color && color[3] > 0.9) return color;
    }
    return view.matchMedia?.("(prefers-color-scheme: dark)").matches ? [33, 33, 33, 1] : [255, 255, 255, 1];
  }
  const css = ([r, g, b]) => `rgb(${r} ${g} ${b})`;
  function applyTheme() {
    themeScheduled = 0;
    // At document_start <html> may not exist yet; syncRoots retries once it does.
    if (destroyed || !document.documentElement) return;
    const accent = findAccent(customPropertyNames());
    const surface = surfaceColor();
    const text = rgbaOf(view.getComputedStyle(document.body || document.documentElement).color) || [17, 17, 17, 1];
    const accentColor = accent?.color || text;
    // Light themes get a softer selection tint and ON switch; dark themes keep full strength.
    const light = luminance(surface) > 0.5;
    const switchMix = light ? 0.8 : 1;
    const switchColor = accentColor.slice(0, 3).map((v, i) => Math.round(v * switchMix + surface[i] * (1 - switchMix)));
    const rules = [
      `--cbd-accent: ${accent ? `var(${accent.name})` : css(text)};`,
      `--cbd-on-accent: ${luminance(accentColor) > 0.6 ? "#111" : "#fff"};`,
      `--cbd-on-switch: ${luminance(switchColor) > 0.6 ? "#111" : "#fff"};`,
      `--cbd-switch-mix: ${switchMix * 100}%;`,
      `--cbd-tint: ${light ? 14 : 30}%;`,
      `--cbd-tint-hover: ${light ? 20 : 38}%;`,
      // Floating UI: black shadows vanish on dark pages, so there the surface is lifted
      // slightly and the shadow becomes a light glow (no ring, no border).
      `--cbd-raised: ${light ? "var(--cbd-surface)" : "color-mix(in srgb, var(--cbd-surface) 92%, #fff)"};`,
      // On dark pages the "shadow" is a soft white glow plus a faint ring.
      `--cbd-shadow-lg: ${light ? "0 8px 20px rgba(0, 0, 0, .28)" : "0 0 20px rgba(255, 255, 255, .5)"};`,
      // Dark pages rely on the glow alone; the hairline border is for light pages.
      `--cbd-border: ${light ? "color-mix(in srgb, var(--cbd-text) 12%, transparent)" : "transparent"};`,
      // Secondary/hint text opacity; dark surfaces need more to stay readable.
      `--cbd-muted: ${light ? 65 : 82}%;`,
      `--cbd-faint: ${light ? 45 : 66}%;`,
      // Accent used as text: lifted toward white on dark surfaces so it stays readable.
      `--cbd-accent-text: ${light ? "var(--cbd-accent)" : "color-mix(in srgb, var(--cbd-accent) 65%, #fff)"};`,
      `--cbd-surface: ${css(surface)};`,
      `--cbd-text: ${css(text)};`,
    ];
    const hex = rgb => "#" + rgb.slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join("");
    badgeTheme.color = hex(accentColor);
    badgeTheme.text = luminance(accentColor) > 0.6 ? "#111111" : "#ffffff";
    const signature = rules.join("");
    if (signature !== themeSignature) {
      themeSignature = signature;
      themeStyle.textContent = `:root { ${signature} }`;
      console.log("[cbd] 테마 색:", accent ? `${accent.name} = ${css(accent.color)} (${accent.via})` : "강조색을 찾지 못해 글자색 사용",
        `· ${light ? "라이트" : "다크"} (배경 ${css(surface)})`);
      publish();
    }
    if (!themeStyle.isConnected) (document.head || document.documentElement).append(themeStyle);
  }
  // Read again once ChatGPT's own background transition has settled; a read taken
  // mid-transition can mistake a dark page for a light one.
  function scheduleTheme() {
    if (destroyed) return;
    if (!themeScheduled) themeScheduled = requestAnimationFrame(applyTheme);
    clearTimeout(themeRetry);
    themeRetry = setTimeout(() => { themeRetry = 0; if (!themeScheduled) themeScheduled = requestAnimationFrame(applyTheme); }, 450);
  }
  // Changing ChatGPT's language rewrites <html lang> without a reload.
  function updateLanguage() {
    const next = globalThis.CBDI18n.create(pageLanguage(), navigator?.language);
    if (next.locale === i18n.locale) return;
    i18n = next;
    applyLanguage();
    render();
    publish();
  }
  // Theme switches show up as attribute changes on <html>/<body> or new style tags.
  const themeObserver = new MutationObserver(records => {
    if (records.some(r => r.attributeName === "lang")) updateLanguage();
    if (records.some(r => r.type === "attributes" ? !r.attributeName?.startsWith("data-cbd")
      : [...r.addedNodes, ...r.removedNodes].some(n => n.nodeName === "STYLE" || n.nodeName === "LINK" || n.nodeName === "BODY"))) {
      scheduleTheme();
    }
  });
  function watchThemeTargets() {
    if (document.documentElement) themeObserver.observe(document.documentElement, { attributes: true, childList: true });
    if (document.head) themeObserver.observe(document.head, { childList: true });
    if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  }
  const darkQuery = view.matchMedia?.("(prefers-color-scheme: dark)");
  if (darkQuery?.addEventListener) listen(darkQuery, "change", scheduleTheme);

  // ---------- Selection ----------

  function select(id, value) {
    if (state.deleted.has(id)) return;
    value ? state.selected.add(id) : state.selected.delete(id);
  }
  function choose(id, { range = false } = {}) {
    if (state.busy || state.deleted.has(id)) return;
    const order = range && state.anchorId && state.anchorId !== id ? orderedIds() : [];
    const from = order.indexOf(state.anchorId);
    const to = order.indexOf(id);
    if (from >= 0 && to >= 0) {
      // Shift+click applies the last operated box's state to the whole range.
      const [start, end] = from < to ? [from, to] : [to, from];
      for (const rangeId of order.slice(start, end + 1)) select(rangeId, state.anchorValue);
    } else {
      select(id, !state.selected.has(id));
      state.anchorValue = state.selected.has(id);
    }
    state.anchorId = id;
    state.message = "";
    refresh();
  }
  // Fits the rendered sequence into the remembered order: an unseen ID goes right after
  // the rendered row above it (or before the one below it, for the first rows).
  function mergeOrder(ids) {
    const order = state.order;
    let position = new Map(order.map((id, i) => [id, i]));
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (position.has(id)) continue;
      const prev = ids.slice(0, i).reverse().find(other => position.has(other));
      const next = prev === undefined ? ids.slice(i + 1).find(other => position.has(other)) : undefined;
      const at = prev !== undefined ? position.get(prev) + 1 : next !== undefined ? position.get(next) : order.length;
      order.splice(at, 0, id);
      position = new Map(order.map((other, j) => [other, j]));
    }
  }
  // Shift+End / Shift+Home: from the last operated chat to the end (older chats) or the
  // start of the list, applying that chat's state like a Shift+click range.
  function chooseToEdge(toEnd) {
    if (state.busy) return;
    const order = state.order.filter(id => !state.deleted.has(id) && state.known.has(id));
    const from = order.indexOf(state.anchorId);
    if (from < 0) { state.message = t("needAnchor"); render(); return; }
    const ids = toEnd ? order.slice(from) : order.slice(0, from + 1);
    for (const id of ids) select(id, state.anchorValue);
    state.message = "";
    refresh();
  }
  function selectAll() {
    refresh({ notify: false });
    for (const id of state.known) state.selected.add(id);
    state.message = "";
    refresh();
  }
  function clearSelection() {
    state.selected.clear();
    state.anchorId = null;
    state.message = "";
    refresh();
  }

  // ---------- Blocking navigation in delete mode ----------

  // Listeners sit on window in the capture phase and the script runs at document_start,
  // so they are registered before any of ChatGPT's own; stopImmediatePropagation then
  // keeps ChatGPT's listeners (including ones on window) from seeing the event.
  function block(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  for (const type of ["pointerdown", "mousedown", "click", "keydown"]) {
    listen(view, type, event => {
      if (state.enabled && event.target?.closest?.("[data-cbd-disabled]") && alive()) block(event);
    }, true);
  }
  for (const type of ["pointerdown", "mousedown", "touchstart"]) {
    listen(view, type, event => {
      if (!state.enabled) return;
      const link = linkOf(event);
      if (!link || !alive()) return;
      // pointerdown and the mousedown that follows are one gesture.
      const now = Date.now();
      if (type !== "mousedown" || gesture?.id !== link.id || now - gesture.at > 1000) {
        gesture = { id: link.id, at: now, handled: false };
      }
      event.stopImmediatePropagation();
      if (type === "pointerdown" && event.button === 0 && !gesture.handled && !state.busy) {
        if (event.shiftKey) {
          // Applied on press: the browser may treat Shift+click on a link as
          // "open in new window" and never deliver the click to the page.
          gesture.handled = true;
          choose(link.id, { range: true });
        } else if (event.pointerType !== "touch") {
          // Touch presses are left to click, so scrolling the list never selects.
          gesture.handled = true;
          beginDrag(link, event);
        }
      }
      if (type === "mousedown" && (event.button === 0 || event.button === 1)) {
        // No text selection while dragging, no autoscroll on middle click. Focus is
        // moved by hand so keyboard shortcuts still work after a click.
        event.preventDefault();
        if (event.button === 0) link.a.focus?.({ preventScroll: true });
      }
    }, true);
  }

  // ---------- Drag selection ----------

  // Pressing a chat toggles it; dragging paints every chat between the pressed one and
  // the one under the pointer with that new state. Chats that leave the range while
  // dragging back get their pre-drag state again.
  let drag = null;
  function scrollParent(node) {
    for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
      const overflow = view.getComputedStyle(el).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  }
  function beginDrag(link, event) {
    endDrag();
    drag = {
      startId: link.id, lastId: link.id, value: !state.selected.has(link.id),
      before: new Set(state.selected), x: event.clientX, y: event.clientY,
      scroller: scrollParent(link.a), frame: 0,
    };
    state.anchorId = link.id;
    state.anchorValue = drag.value;
    paintTo(link.id);
    if (drag.scroller) drag.frame = requestAnimationFrame(autoScroll);
  }
  function paintTo(id) {
    const order = orderedIds();
    const to = order.indexOf(id);
    if (to < 0) return;
    const from = order.indexOf(drag.startId);
    if (from >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from];
      order.forEach((rangeId, i) => select(rangeId, i >= start && i <= end ? drag.value : drag.before.has(rangeId)));
    } else {
      // The start row left a virtualized list's rendered window: extend from the last
      // painted chat instead (nothing is restored in this case).
      const last = order.indexOf(drag.lastId);
      const [start, end] = last < 0 ? [to, to] : last < to ? [last, to] : [to, last];
      for (const rangeId of order.slice(start, end + 1)) select(rangeId, drag.value);
    }
    drag.lastId = id;
    state.anchorId = id;
    state.message = "";
    refresh();
  }
  function hitTest() {
    const target = document.elementFromPoint?.(drag.x, drag.y);
    const id = chatId(target?.closest?.(CHAT_LINK_SELECTOR));
    if (id && id !== drag.lastId && !state.deleted.has(id)) paintTo(id);
  }
  // Scrolls the sidebar while the pointer rests near its top or bottom edge.
  function autoScroll() {
    if (!drag?.scroller) return;
    const box = drag.scroller.getBoundingClientRect();
    const edge = 40;
    const step = drag.y < box.top + edge ? -Math.ceil((box.top + edge - drag.y) / 4)
      : drag.y > box.bottom - edge ? Math.ceil((drag.y - box.bottom + edge) / 4) : 0;
    if (step) {
      drag.scroller.scrollTop += step;
      hitTest();
    }
    drag.frame = requestAnimationFrame(autoScroll);
  }
  function endDrag() {
    if (drag?.frame) cancelAnimationFrame(drag.frame);
    drag = null;
  }
  listen(view, "pointermove", event => {
    if (!drag) return;
    if (!state.enabled || !(event.buttons & 1)) return endDrag();
    drag.x = event.clientX;
    drag.y = event.clientY;
    const id = chatId(event.target?.closest?.(CHAT_LINK_SELECTOR));
    if (id && id !== drag.lastId && !state.deleted.has(id)) paintTo(id);
    event.stopImmediatePropagation();
  }, true);
  // Registered before the link-blocking listeners below, which stop propagation.
  for (const type of ["pointerup", "pointercancel"]) listen(view, type, endDrag, true);
  // Only the window losing focus ends a drag; element blurs also reach this listener.
  listen(view, "blur", event => { if (event.target === view) endDrag(); }, true);

  for (const type of ["pointerup", "mouseup", "touchend", "dblclick", "auxclick", "dragstart"]) {
    listen(view, type, event => {
      if (state.enabled && linkOf(event) && alive()) block(event);
    }, true);
  }
  listen(view, "click", event => {
    if (!state.enabled) return;
    const link = linkOf(event);
    if (!link || !alive()) return;
    block(event);
    if (event.button !== 0) return;
    // The click consumes its press, so a later click without a press (keyboard Enter)
    // is never mistaken for a duplicate.
    const pressed = gesture?.id === link.id && Date.now() - gesture.at < 1500 ? gesture : null;
    if (pressed) gesture = null;
    if (pressed?.handled) return; // already applied on press
    choose(link.id, { range: event.shiftKey });
  }, true);

  // Fallback for routers that navigate before click (e.g. on pointerdown in a listener
  // registered earlier on window): cancel a same-document navigation to the chat that
  // was just pressed, and toggle it if click never reached us.
  const navigation = view.navigation;
  if (navigation?.addEventListener) {
    listen(navigation, "navigate", event => {
      if (!state.enabled || !event.cancelable || !gesture || Date.now() - gesture.at > 1500) return;
      if (idFromURL(event.destination?.url) !== gesture.id || !alive()) return;
      event.preventDefault();
      if (!gesture.handled) {
        gesture.handled = true;
        choose(gesture.id);
      }
    });
  }

  // ---------- Keyboard shortcuts ----------

  // ChatGPT keeps closed menus/dialogs mounted, so only rendered ones count.
  function overlayOpen() {
    return [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="alertdialog"]')].some(node =>
      !bar.contains(node) && node.getClientRects().length > 0 && view.getComputedStyle(node).visibility !== "hidden");
  }
  function typingTarget(event) {
    const target = event.target;
    if (!target?.closest || target.closest(SIDEBAR_SELECTOR)) return false;
    return Boolean(target.closest(EDITABLE_SELECTOR));
  }
  listen(view, "keydown", event => {
    // defaultPrevented is not checked: ChatGPT may claim keys such as Escape globally.
    if (!state.enabled || event.isComposing || typingTarget(event)) return;
    if (bar.contains(event.target) && (event.key === "Enter" || event.key === " ")) return;
    const mod = event.ctrlKey || event.metaKey;
    const link = linkOf(event);
    let handled = true;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
      if (!state.busy) selectAll();
    } else if (event.key === "Escape" && !mod) {
      // Leave Escape to ChatGPT while one of its dialogs or menus is actually open.
      if (overlayOpen()) return;
      if (state.confirming) cancelDelete();
      else if (state.selected.size) { if (!state.busy) clearSelection(); }
      else if (!state.busy) setEnabled(false);
    } else if ((event.key === "End" || event.key === "Home") && event.shiftKey && !mod && !event.altKey) {
      chooseToEdge(event.key === "End");
    } else if (event.key === "Delete" && !mod) {
      if (state.confirming) confirmDeleteBtn.click();
      else if (!deleteBtn.disabled) deleteBtn.click();
    } else if ((event.key === " " || event.key === "Enter") && link && !mod) {
      // Without an href, Enter no longer synthesizes a click, so both keys toggle here.
      choose(link.id, { range: event.shiftKey });
    } else {
      handled = false;
    }
    if (handled && alive()) block(event);
  }, true);

  function toggleFromPage(event) {
    // Keep ChatGPT's sidebar header handlers from treating this as one of its clicks.
    event.stopPropagation();
    try { setEnabled(!state.enabled); }
    catch (error) { state.message = error.message; render(); }
  }
  listen(sideBtn, "click", toggleFromPage);
  listen(selectAllBtn, "click", () => {
    if (state.busy) return;
    refresh({ notify: false });
    if (state.selected.size) clearSelection();
    else selectAll();
  });

  // ---------- API ----------

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    catch (error) {
      if (error.name === "AbortError") throw new Error(t("errTimeout", { n: 30 }));
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function getSession() {
    const response = await request("/api/auth/session");
    if (!response.ok) throw new Error(t("errLogin", { status: response.status }));
    const data = await response.json();
    if (!data.accessToken) throw new Error(t("errNotLoggedIn"));
    // Codex requests carry the workspace id; fall back to ChatGPT's account cookie.
    const cookie = document.cookie.match(/(?:^|;\s*)_account=([^;]+)/)?.[1];
    return { token: data.accessToken, accountId: data.account?.id || (cookie && decodeURIComponent(cookie)) || "" };
  }
  // Conversations are hidden with a PATCH (what ChatGPT's own delete does); Codex
  // tasks use the wham tasks endpoint the Codex sidebar calls.
  async function deleteConversation(session, id) {
    const headers = { Authorization: `Bearer ${session.token}` };
    const codex = id.startsWith("task_");
    if (codex && session.accountId) headers["chatgpt-account-id"] = session.accountId;
    const response = codex
      ? await request(`/backend-api/wham/tasks/${encodeURIComponent(id)}`, { method: "DELETE", headers })
      : await request(`/backend-api/conversation/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ is_visible: false }),
      });
    if (!response.ok) {
      const error = new Error(t("errDelete", { status: response.status }));
      error.status = response.status;
      error.retryAfter = response.headers.get("Retry-After");
      throw error;
    }
  }
  function cancelDelete() {
    state.confirming = 0;
    render();
    deleteBtn.focus({ preventScroll: true });
  }
  listen(cancelDeleteBtn, "click", cancelDelete);
  listen(confirmDeleteBtn, "click", () => {
    if (!state.confirming) return;
    state.confirming = 0;
    deleteSelected();
  });
  listen(deleteBtn, "click", () => {
    if (state.busy || !state.selected.size) return;
    if (state.selected.size < CONFIRM_AT) { deleteSelected(); return; }
    state.confirming = state.selected.size;
    render();
    confirmDeleteBtn.focus({ preventScroll: true });
  });
  async function deleteSelected() {
    if (state.busy || !state.selected.size) return;
    const ids = [...state.selected];
    state.busy = true;
    state.message = "";
    state.progress = { completed: 0, total: ids.length };
    refresh();
    try {
      if (!globalThis.CBDDeleteQueue?.run) throw new Error(t("errModule"));
      const session = await getSession();
      const result = await globalThis.CBDDeleteQueue.run(ids, {
        concurrency: DELETE_CONCURRENCY, delayMs: DELETE_DELAY_MS, maxRetries: 3,
        deleteOne: id => deleteConversation(session, id),
        onResult: ({ id, ok, completed, total }) => {
          if (ok) { state.selected.delete(id); state.known.delete(id); vanish(id); }
          state.progress = { completed, total };
          refresh();
        },
        onCooldown: ms => { state.cooldownUntil = Date.now() + ms; render(); },
      });
      const parts = [t("done", { n: result.succeeded.length })];
      if (result.failed.length) parts.push(t("failed", { n: result.failed.length }));
      if (result.pending.length) parts.push(t("pending", { n: result.pending.length }));
      if (result.fatal) parts.push(t("aborted", { msg: result.fatal.message }));
      state.message = parts.join(" · ");
      if (result.failed.length || result.pending.length) state.message += ` ${t("keepSelected")}`;
      if (state.deleted.has(idFromURL(document.location?.href))) state.message += ` · ${t("currentDeleted")}`;
    } catch (error) {
      state.message = t("error", { msg: error.message });
    } finally {
      state.busy = false;
      state.progress = null;
      state.cooldownUntil = 0;
      refresh();
    }
  }

  function onMessage(message, _sender, sendResponse) {
    if (!alive()) return;
    if (message.type === "cbd-focus-state") { sendResponse(getFocusState()); return; }
    // Kept for older background scripts; the sidebar switch is always page-local now.
    if (message.type === "cbd-show-local-toggle") { sendResponse(getStatus()); return; }
    if (!["cbd-status", "cbd-set-mode", "cbd-toggle"].includes(message.type)) return;
    try {
      if (message.type === "cbd-set-mode") {
        if (typeof message.enabled !== "boolean") throw new Error(t("badMode"));
        setEnabled(message.enabled);
      } else if (message.type === "cbd-toggle") setEnabled(!state.enabled);
      sendResponse(refresh());
    } catch (error) {
      sendResponse({ ...getStatus(), ok: false, error: error.message });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    rootObserver.disconnect();
    themeObserver.disconnect();
    if (themeScheduled) cancelAnimationFrame(themeScheduled);
    clearTimeout(themeRetry);
    themeStyle.remove();
    sidebarObserver.disconnect();
    if (scheduled) cancelAnimationFrame(scheduled);
    if (rootsScheduled) cancelAnimationFrame(rootsScheduled);
    endDrag();
    for (const remove of listeners) remove();
    for (const timer of leaveTimers.values()) clearTimeout(timer);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* invalidated */ }
    undecorate({ all: true });
    if (document.documentElement) delete document.documentElement.dataset.cbdMode;
    bar.remove();
    lockHeader(false);
    for (const node of document.querySelectorAll("[data-cbd-fade]")) delete node.dataset.cbdFade;
    sideBtn.remove();
    barResize?.disconnect();
    if (globalThis[INSTANCE]?.destroy === destroy) delete globalThis[INSTANCE];
  }
  globalThis[INSTANCE] = {
    version: VERSION, getStatus, destroy,
    exportState: () => ({
      enabled: state.enabled,
      known: [...state.known], selected: [...state.selected], deleted: [...state.deleted],
    }),
  };
  syncRoots();
  watchThemeTargets();
  applyTheme();
  refresh();
  console.log("[cbd] content script v" + VERSION);
})();
