// Browser-only integration tests. No real requests are sent.
// Call await runCBDUITests({ contentSource, queueSource }) on a blank test page.
globalThis.runCBDUITests = async function ({ contentSource, queueSource, userAgent = "Chrome/Test" }) {
  const results = [];
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
    results.push(label);
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const until = async condition => {
    for (let i = 0; i < 180; i++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Test timed out");
  };
  // A deterministic frame scheduler also works when the test tab is hidden.
  let frameId = 0;
  const frames = new Map();
  const frame = callback => {
    const id = ++frameId;
    frames.set(id, callback);
    queueMicrotask(() => { if (frames.delete(id)) callback(performance.now()); });
    return id;
  };
  const cancelFrame = id => frames.delete(id);
  const fixture = document.createElement("section");
  const nav = document.createElement("nav");
  const main = document.createElement("main");
  fixture.append(nav, main);
  document.body.append(fixture);
  const add = (id, root = nav, href = `/c/${id}`) => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = id;
    root.append(anchor);
    return anchor;
  };
  const first = add("alpha");
  const beta = add("beta");
  const duplicate = add("alpha");
  const gamma = add("gamma", nav, "/g/test-project/c/gamma");
  add("outside", main);
  add("foreign", nav, "https://example.com/c/foreign");

  const messageListeners = [];
  const publications = [];
  const chromeMock = { runtime: {
    id: "test-extension",
    onMessage: {
      addListener(fn) { messageListeners.push(fn); },
      removeListener(fn) { const i = messageListeners.indexOf(fn); if (i >= 0) messageListeners.splice(i, 1); },
    },
    sendMessage(message) { publications.push(message); return Promise.resolve(); },
  } };
  const isolated = {};
  new Function("globalThis", queueSource)(isolated);
  const pendingResponses = [];
  const requests = [];
  let autoRelease = false;
  let active = 0;
  let peak = 0;
  let requestCount = 0;
  const fakeFetch = async (url, options) => {
    if (url === "/api/auth/session") return { ok: true, json: async () => ({ accessToken: "test-placeholder" }) };
    const codexDelete = url.startsWith("/backend-api/wham/tasks/") && options.method === "DELETE";
    if (!codexDelete && (!url.startsWith("/backend-api/conversation/") || options.method !== "PATCH")) throw new Error("Unexpected mock request");
    requests.push({ url, method: options.method, headers: options.headers });
    const id = decodeURIComponent(url.split("/").pop());
    requestCount++;
    active++;
    peak = Math.max(peak, active);
    const response = { ok: id !== "gamma", status: id === "gamma" ? 500 : 200, headers: { get: () => null } };
    if (autoRelease) { active--; return response; }
    return new Promise(resolve => pendingResponses.push(() => { active--; resolve(response); }));
  };
  const createContent = new Function("document", "chrome", "globalThis", "fetch", "confirm", "requestAnimationFrame", "cancelAnimationFrame", "navigator", contentSource);
  const initialize = (...args) => createContent(...args, frame, cancelFrame, { userAgent });
  const send = message => {
    let response;
    for (const fn of messageListeners) fn(message, {}, value => { response = value; });
    return response;
  };
  const status = () => send({ type: "cbd-status" });
  const mode = enabled => send({ type: "cbd-set-mode", enabled });
  // Resolve by structure, since the selection button label changes with state.
  const label = button => button.getAttribute("aria-label");
  const selectionButton = () => document.querySelector(".cbd-bar > .cbd-actions > button:not(.cbd-danger)");
  const deleteButton = () => document.querySelector(".cbd-bar > .cbd-actions > .cbd-danger");
  try {
    initialize(document, chromeMock, isolated, fakeFetch, () => true);
    assert(status().count === 0, "Nothing is counted while delete mode is OFF");
    assert(document.querySelector(".cbd-summary-text").textContent === "대화 목록이 비어 있습니다" && !document.querySelector(".cbd-num"),
      "An empty list says so without numbers");
    assert(!status().enabled && document.querySelector(".cbd-bar").hidden, "Starts OFF");
    assert(!document.querySelector(".cbd-mode-switch"), "There is no floating mode switch");
    const focus = send({ type: "cbd-focus-state" });
    assert(focus.ok && focus.protocol === 3 && Number.isFinite(focus.lastActiveAt), "Focus state is queryable without switching mode");
    const previousInteraction = focus.lastInteractionAt;
    nav.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    assert(send({ type: "cbd-focus-state" }).lastInteractionAt === previousInteraction, "Synthetic events cannot forge trusted pane interaction");
    send({ type: "cbd-show-local-toggle" });
    assert(!document.querySelector(".cbd-mode-switch"), "An ambiguous toolbar click no longer adds a floating switch");
    const visibleLabels = button => [...button.querySelectorAll(".cbd-label[data-cbd-active]")].map(span => span.textContent);
    assert(selectionButton().querySelectorAll(".cbd-label").length === 2 && visibleLabels(selectionButton()).join() === "전체 선택",
      "Both labels stay in the button (fixed width); only the current one is shown");
    // Sidebar header like ChatGPT's: [search (in a wrapper)] [sidebar toggle].
    const header = document.createElement("div");
    header.innerHTML = '<span class="tip"><button class="Button-q" data-color="secondary" data-variant="transparent" data-size="3xs">'
      + '<span class="ButtonInner-U"><svg><use href="/cdn/icons.svg#codex-icon-magnifying-glass-lg-light-20"></use></svg></span></button></span>'
      + '<button class="toggle">toggle</button>'
      + '<button class="mode" aria-haspopup="menu" aria-label="모드 전환, 현재 모드: Codex">Codex</button>';
    nav.prepend(header);
    // Expanded profile row: a transparent overlay button over a row that draws the hover.
    const profileRow = document.createElement("div");
    profileRow.className = "group hover-row";
    profileRow.innerHTML = '<span class="avatar"></span><span class="name">Me</span>'
      + '<button class="overlay" aria-haspopup="menu" aria-label="프로필 메뉴 열기"></button>';
    nav.append(profileRow);
    const profile = profileRow.querySelector("button");
    // Other languages: found by structure, not by label.
    const foreign = document.createElement("div");
    foreign.innerHTML = '<button class="f-mode" aria-haspopup="menu" aria-label="Changer de mode">ChatGPT</button>'
      + '<button class="f-avatar" aria-haspopup="menu" aria-label="Menu du compte"><img alt=""></button>'
      + '<div class="group gpt-row"><a href="/g/g-abc"><img alt="">GPT</a><button class="f-gpt" aria-haspopup="menu" aria-label="Options"></button></div>'
      + '<button class="f-explore" aria-haspopup="menu" aria-label="Explorer">Explorer</button>';
    nav.append(foreign);
    await settle();
    const side = header.querySelector(".cbd-side-switch");
    assert(side && side.nextElementSibling === header.querySelector(".tip") && side.classList.contains("Button-q")
      && side.dataset.variant === "transparent" && side.firstElementChild.className === "ButtonInner-U" && side.querySelector("svg"),
      "The trash switch sits left of search and borrows its classes");
    side.click();
    assert(status().enabled && side.getAttribute("aria-pressed") === "true", "The sidebar switch turns delete mode ON");
    const barStyle = document.querySelector(".cbd-bar").style;
    assert(barStyle.getPropertyValue("--cbd-bar-left") && barStyle.getPropertyValue("--cbd-bar-top"), "The panel is positioned at the chat area's top-left");
    // A page whose <main> spans under the sidebar (e.g. schedules) must not pin the panel to the wall.
    const rect = (left, width, top = 0) => () => ({ left, right: left + width, width, top, bottom: top + 800, height: 800 });
    nav.getBoundingClientRect = rect(0, 260);
    main.getBoundingClientRect = rect(0, 1200);
    side.click(); side.click();
    assert(barStyle.getPropertyValue("--cbd-bar-left") === "276px", "The panel starts right of the sidebar when <main> spans under it");
    main.getBoundingClientRect = rect(300, 900, 10);
    side.click(); side.click();
    assert(barStyle.getPropertyValue("--cbd-bar-left") === "316px" && barStyle.getPropertyValue("--cbd-bar-top") === "74px",
      "Otherwise it follows the chat area's top-left");
    delete nav.getBoundingClientRect; delete main.getBoundingClientRect;
    const searchBtn = header.querySelector(".tip > .Button-q"), toggleBtn = header.querySelector(".toggle");
    assert([searchBtn, toggleBtn].every(b => b.hasAttribute("data-cbd-disabled") && b.getAttribute("aria-disabled") === "true" && b.getAttribute("tabindex") === "-1")
      && !side.hasAttribute("data-cbd-disabled"), "Search and sidebar toggle are disabled in delete mode");
    assert(header.querySelector(".mode").hasAttribute("data-cbd-disabled") && profile.hasAttribute("data-cbd-disabled"),
      "The ChatGPT/Codex mode switch and the account menu are disabled in delete mode");
    assert(profileRow.hasAttribute("data-cbd-lock-area") && !header.hasAttribute("data-cbd-lock-area"),
      "The row drawn around an overlay button is locked too, but a shared header row is not");
    assert(foreign.querySelector(".f-mode").hasAttribute("data-cbd-disabled") && foreign.querySelector(".f-avatar").hasAttribute("data-cbd-disabled")
      && !foreign.querySelector(".f-gpt").hasAttribute("data-cbd-disabled") && !foreign.querySelector(".f-explore").hasAttribute("data-cbd-disabled"),
      "Mode and account menus are found in any language; GPT row and other menus stay usable");
    let pageGot = 0;
    toggleBtn.addEventListener("click", () => pageGot++);
    const lockedClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    toggleBtn.dispatchEvent(lockedClick);
    assert(pageGot === 0 && lockedClick.defaultPrevented, "Clicks on disabled header buttons are refused");
    side.click();
    assert(!status().enabled && side.getAttribute("aria-pressed") === "false", "...and OFF again");
    assert(!header.querySelector("[data-cbd-disabled]") && !toggleBtn.hasAttribute("tabindex") && !toggleBtn.hasAttribute("aria-disabled"),
      "OFF restores the header buttons");
    assert(!profile.hasAttribute("data-cbd-disabled") && !profileRow.hasAttribute("data-cbd-lock-area"), "OFF restores the account menu");
    assert(profileRow.hasAttribute("data-cbd-fade") && profile.hasAttribute("data-cbd-fade"), "Unlocked controls keep the fade marker so they fade back in");
    header.remove(); profileRow.remove(); foreign.remove();
    await settle();
    assert(!document.querySelector(".cbd-side-switch"), "Without a sidebar header there is no switch on the page");
    mode(true);
    const helpBtn = document.querySelector(".cbd-help-btn"), helpTip = document.querySelector(".cbd-help-tip");
    assert(helpBtn && helpTip && !document.querySelector(".cbd-hint") && helpBtn.closest(".cbd-summary")
      && helpTip.textContent.includes("Shift+클릭") && helpTip.textContent.includes("최대 2개"), "Usage help lives in a ? tooltip on the panel's top row");
    helpBtn.click();
    assert(helpBtn.getAttribute("aria-expanded") === "true" && "open" in helpBtn.parentElement.dataset, "Clicking ? pins the tooltip open");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    assert(helpBtn.getAttribute("aria-expanded") === "false", "A press outside closes the pinned tooltip");
    const summary = () => document.querySelector(".cbd-summary-text");
    const nums = () => [...summary().querySelectorAll(".cbd-num")].map(n => n.textContent);
    assert(!document.querySelector(".cbd-summary strong") && summary().textContent === `대화 ${status().count}개`
      && nums().join() === String(status().count), "With nothing selected the panel reads \"대화 N개\", only N themed");
    document.querySelector("a[data-cbd-href]").click();
    assert(summary().textContent === `대화 ${status().count}개, 1개 선택됨` && nums().join() === String(status().count)
      && summary().querySelector(".cbd-sr-only").textContent === ", 1개 선택됨",
      "With a selection only \"대화 N개\" is visible; the selected count is for screen readers");
    assert(!deleteButton().querySelector(".cbd-delete-count").hidden && deleteButton().querySelector(".cbd-delete-count").textContent === "1"
      && deleteButton().getAttribute("aria-label") === "선택한 1개 삭제" && deleteButton().querySelector(".cbd-delete-count").dataset.pop,
      "The trash button shows the selected count, which pops when it changes");
    document.querySelector("a[data-cbd-href]").click();
    const sel = a => a.dataset.cbdItem === "selected";
    assert(document.querySelectorAll("[data-cbd-item]").length === 4 && document.documentElement.hasAttribute("data-cbd-mode") && !document.querySelector(".cbd-check"),
      "ON marks every matching sidebar link without adding checkboxes");
    assert(document.querySelectorAll(".cbd-bar > .cbd-actions > button").length === 2, "Only selection toggle and delete buttons are rendered");
    const deleteCount = () => deleteButton().querySelector(".cbd-delete-count");
    assert(deleteButton().querySelector("svg") && deleteCount().hidden && deleteCount().textContent === ""
      && deleteButton().getAttribute("aria-label") === "선택 삭제", "Delete is a trash icon with no number while nothing is selected");
    assert(label(selectionButton()) === "전체 선택" && !selectionButton().disabled && deleteButton().disabled, "Zero selection offers select all and disables deletion");
    first.click();
    assert(status().selected === 1 && label(selectionButton()) === "전체 해제" && !selectionButton().disabled && !deleteButton().disabled, "Zero to one selection switches immediately to clear all");
    assert(sel(first) && sel(duplicate) && first.getAttribute("aria-selected") === "true", "Duplicate links share the same selected state");
    selectionButton().click();
    assert(status().selected === 0 && label(selectionButton()) === "전체 선택" && deleteButton().disabled, "Toggle clears a partial selection rather than selecting the rest");
    selectionButton().click();
    assert(status().selected === 3 && label(selectionButton()) === "전체 해제" && !selectionButton().disabled, "Select all uses unique detected IDs and remains available to clear");
    selectionButton().click();
    assert(status().selected === 0 && label(selectionButton()) === "전체 선택" && deleteButton().disabled, "Toggle clears a full selection");
    selectionButton().click();
    first.click();
    assert(status().selected === 2 && label(selectionButton()) === "전체 해제", "Individual deselection from all keeps the clear all action");
    beta.click();
    assert(status().selected === 1 && label(selectionButton()) === "전체 해제", "Partial selection of one still offers clear all");
    gamma.click();
    assert(status().selected === 0 && label(selectionButton()) === "전체 선택" && deleteButton().disabled, "Individual deselection of the last item restores select all");
    const shiftClick = a => a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
    const key = (name, extra = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }));
    first.click();
    shiftClick(gamma);
    assert(status().selected === 3 && sel(beta), "Shift+click checks every box from the last operated one");
    // Real Shift+click: press, then a click the browser may or may not deliver.
    const shiftPress = a => {
      for (const type of ["pointerdown", "mousedown"]) a.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
    };
    first.click();
    shiftPress(gamma);
    assert(status().selected === 0, "Shift+press applies the range without waiting for click");
    shiftClick(gamma);
    assert(status().selected === 0, "The click after a Shift+press does not apply it again");
    first.click();
    shiftClick(gamma);
    assert(status().selected === 3, "A later Shift+click without a press still applies its range");
    beta.click();
    shiftClick(first);
    assert(status().selected === 1 && sel(gamma) && !sel(first), "Shift+click from an unchecked anchor unchecks the range");
    const closedMenu = document.createElement("div");
    closedMenu.setAttribute("role", "menu");
    closedMenu.hidden = true;
    document.body.append(closedMenu);
    key("Escape");
    closedMenu.remove();
    assert(status().selected === 0 && status().enabled, "Escape clears the selection first, ignoring closed menus left in the DOM");
    const claimed = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
    claimed.preventDefault();
    document.body.dispatchEvent(claimed);
    assert(status().selected === 3, "Shortcuts work even if the page already claimed the key");
    key("Escape");
    key("a", { ctrlKey: true });
    assert(status().selected === 3, "Ctrl+A selects every detected conversation");
    key("Escape");
    key("Escape");
    assert(!status().enabled && !document.querySelector('[data-cbd-item="selected"]') && !document.documentElement.hasAttribute("data-cbd-mode"), "Escape with nothing selected leaves delete mode");
    mode(true);
    const pageEvents = [];
    const spy = event => pageEvents.push(event.type);
    for (const type of ["pointerdown", "mousedown", "click"]) document.addEventListener(type, spy, true);
    for (const type of ["pointerdown", "mousedown"]) first.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    const chatClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    first.dispatchEvent(chatClick);
    for (const type of ["pointerdown", "mousedown", "click"]) document.removeEventListener(type, spy, true);
    assert(chatClick.defaultPrevented && pageEvents.length === 0 && status().selected === 1, "Chat clicks only toggle selection and never reach page listeners");
    first.click();
    assert(status().selected === 0, "Second click unselects");
    const popBefore = first.dataset.pop;
    first.click();
    assert(first.dataset.pop && first.dataset.pop !== popBefore, "Toggling restarts the row's press animation");
    first.click();
    const pointer = (a, type, extra = {}) => a.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...extra }));
    pointer(first, "pointerdown");
    pointer(first, "mousedown");
    assert(status().selected === 1, "Pressing a chat toggles it immediately");
    pointer(gamma, "pointermove");
    assert(status().selected === 3 && sel(beta), "Dragging paints every chat between the pressed one and the pointer");
    pointer(beta, "pointermove");
    assert(status().selected === 2 && !sel(gamma), "Dragging back restores chats that left the range");
    pointer(beta, "pointerup", { buttons: 0 });
    pointer(gamma, "pointermove", { buttons: 0 });
    assert(status().selected === 2, "Moving after release paints nothing");
    pointer(beta, "pointerdown");
    pointer(gamma, "pointermove");
    pointer(gamma, "pointerup", { buttons: 0 });
    assert(status().selected === 1 && sel(first), "Dragging from a checked chat unchecks the range");
    pointer(first, "pointerdown");
    pointer(first, "pointerup", { buttons: 0 });
    const afterPress = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    first.dispatchEvent(afterPress);
    assert(status().selected === 0 && afterPress.defaultPrevented, "A press-and-release toggles once; its click is blocked but not applied again");
    const touch = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1 });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    first.dispatchEvent(touch);
    assert(status().selected === 0, "Touch presses do not select, so scrolling the list never does");
    first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    assert(status().selected === 1, "A tap's click selects");
    first.click();
    add("delta");
    await settle();
    assert(status().count === 4 && document.querySelector(".cbd-summary-text").textContent === "대화 4개", "New sidebar links update detected count automatically");
    add("delta");
    first.remove(); duplicate.remove();
    await settle();
    assert(status().count === 4, "Duplicates and virtualized removal do not inflate or lose detected IDs");
    selectionButton().click();
    assert(status().selected === 4, "Select all includes previously detected offscreen IDs");
    add("epsilon");
    await settle();
    assert(status().count === 5 && status().selected === 4 && label(selectionButton()) === "전체 해제" && !selectionButton().disabled, "New items stay unselected without replacing clear all with select all");
    beta.href = "/c/zeta";
    await settle();
    assert(status().count === 6, "React-style href replacement is detected");
    assert(!beta.hasAttribute("href") && beta.dataset.cbdHref === "/c/zeta" && beta.getAttribute("tabindex") === "0",
      "In delete mode chat links are stripped of href, so the browser cannot open them");
    const etaLink = add("eta");
    mode(false);
    if (!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      assert(document.querySelector(".cbd-bar").hidden && document.querySelector(".cbd-bar").hasAttribute("data-cbd-leaving"),
        "OFF hides immediately but keeps exit animations on screen");
    }
    await settle();
    assert(!document.querySelector('[data-cbd-item="selected"]') && document.querySelector(".cbd-bar").hidden && !document.documentElement.hasAttribute("data-cbd-mode"), "OFF stays undecorated after a queued refresh");
    assert(beta.getAttribute("href") === "/c/zeta" && !beta.hasAttribute("tabindex") && !document.querySelector("[data-cbd-href]"),
      "OFF restores every link");
    const themeTag = document.createElement("style");
    themeTag.textContent = ":root { --muted-accent-text: rgb(120, 120, 120); --test-theme-accent: rgb(139, 92, 246); }";
    document.head.append(themeTag);
    mode(true);
    const themeCss = document.getElementById("cbd-theme")?.textContent || "";
    if (getComputedStyle(document.documentElement).getPropertyValue("--test-theme-accent").trim()) {
      assert(themeCss.includes("--cbd-accent: var(--test-theme-accent)"), "The page's saturated accent variable is linked, not a gray one");
    }
    assert(/--cbd-surface: rgb\(/.test(themeCss) && /--cbd-text: rgb\(/.test(themeCss), "Surface and text colors are read from the page");
    // ChatGPT-style palette: every selectable accent is defined; only one is the account's.
    themeTag.textContent = ":root { --color-chat-accent-cyan: rgb(0, 177, 255); --color-chat-accent-purple: rgb(140, 90, 250);"
      + " --color-chat-accent-green: rgb(30, 200, 90); }";
    document.documentElement.dataset.chatTheme = "purple";
    mode(false); mode(true);
    if (getComputedStyle(document.documentElement).getPropertyValue("--color-chat-accent-cyan").trim()) {
      assert(document.getElementById("cbd-theme").textContent.includes("var(--color-chat-accent-purple)"),
        "From a palette, the entry named on <html> wins over the most saturated one");
      delete document.documentElement.dataset.chatTheme;
      themeTag.textContent += ":root { --color-chat-accent: rgb(30, 200, 90); }";
      mode(false); mode(true);
      assert(document.getElementById("cbd-theme").textContent.includes("var(--color-chat-accent)"),
        "A non-palette accent variable matching a palette color is the account's choice");
    }
    delete document.documentElement.dataset.chatTheme;
    themeTag.remove();
    assert(status().selected === 0 && label(selectionButton()) === "전체 선택", "Turning delete mode OFF and ON again resets the selection");
    const enter = () => etaLink.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    enter();
    assert(status().selected === 1, "Enter toggles a focused chat even without an href");
    enter();
    selectionButton().click();
    assert(status().count === 5 && status().selected === 5, "Re-enabling re-detects only the chats now in the sidebar");
    initialize(document, chromeMock, isolated, fakeFetch, () => true);
    assert(document.querySelectorAll(".cbd-bar").length === 1 && messageListeners.length === 1, "Reinjection does not duplicate UI or listeners");
    assert(status().selected === 5 && label(selectionButton()) === "전체 해제" && !beta.hasAttribute("href"),
      "Selection survives reinjection, which restores and re-strips links");
    selectionButton().click();
    assert(status().selected === 0 && label(selectionButton()) === "전체 선택", "Clear all removes offscreen selections after new items arrive");
    selectionButton().click();
    assert(status().selected === 5, "Select all covers the detected conversations");
    const confirmBox = document.querySelector(".cbd-confirm");
    const confirmButtons = () => [...confirmBox.querySelectorAll("button")];
    deleteButton().click();
    await settle();
    assert(!confirmBox.hidden && document.querySelector(".cbd-bar > .cbd-actions").hidden && requestCount === 0
      && confirmBox.textContent.includes("5개의 대화를 모두 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."),
      "Five or more chats ask for confirmation in the panel before any request");
    confirmButtons()[0].click();
    assert(confirmBox.hidden && !document.querySelector(".cbd-bar > .cbd-actions").hidden && requestCount === 0 && status().selected === 5,
      "Cancel returns to the actions without deleting");
    deleteButton().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert(confirmBox.hidden && status().selected === 5 && status().enabled, "Esc cancels the confirmation first, keeping the selection");
    deleteButton().click();
    confirmButtons()[1].click();
    await until(() => pendingResponses.length === 2);
    assert(peak === 2 && requestCount === 2 && status().busy, "Deletion starts exactly two concurrent requests");
    assert([...document.querySelectorAll(".cbd-bar button:not(.cbd-help-btn)")].every(node => node.disabled)
      && !document.querySelector(".cbd-help-btn").disabled, "Selection controls are disabled while deleting; help stays usable");
    const blocked = mode(false);
    assert(!blocked.ok && blocked.enabled, "OFF is rejected without corrupting mode while deleting");
    autoRelease = true;
    pendingResponses.splice(0).forEach(release => release());
    await until(() => !status().busy);
    assert(peak === 2 && requestCount === 5, "Queue completes all items without exceeding two in flight");
    assert(status().selected === 1 && status().count === 1, "Successful deletions leave only failed items selected and detected");
    assert(/^\d+개 삭제 완료 · 실패 1개/.test(document.querySelector(".cbd-feedback").textContent), "The result reads \"N개 삭제 완료\" plus the failure count");
    const hiddenRows = () => [...nav.querySelectorAll("a")].filter(a => ["deleted", "vanishing"].includes(a.dataset.cbd));
    assert(hiddenRows().length === 5, "Deleted conversations are hidden from the sidebar without a reload");
    mode(false);
    await settle();
    assert(hiddenRows().length === 5 && !document.querySelector('[data-cbd-item="selected"]'), "Deleted rows stay hidden after delete mode is turned off");
    mode(true);
    assert(status().selected === 0 && status().count === 1, "Re-enabling starts with no selection; the failed item is still detected");
    selectionButton().click();
    await new Promise(resolve => setTimeout(resolve, 300));
    await settle();
    assert(hiddenRows().every(a => a.dataset.cbd === "deleted"), "Collapse animation settles into the hidden state");
    assert(label(selectionButton()) === "전체 해제" && !selectionButton().disabled && !deleteButton().disabled, "Failed selection keeps clear all and retry deletion available");
    add("theta");
    await settle();
    assert(status().count === 2 && status().selected === 1 && label(selectionButton()) === "전체 해제", "New arrivals after failure do not change the clear all action");
    selectionButton().click();
    assert(status().selected === 0 && label(selectionButton()) === "전체 선택" && deleteButton().disabled, "Clear all also clears retained failed selections");
    selectionButton().click();
    assert(status().selected === 2 && label(selectionButton()) === "전체 해제", "Select all includes both the failed item and newly detected item");
    assert(publications.some(message => message.count === 5 && message.selected === 4), "Dynamic counts are published to the background");
    assert(publications.every(message => /^#[\da-f]{6}$/.test(message.badgeColor)), "Every status carries the page's accent for the toolbar badge");
    // Gaps: a wrapper around the link, and a virtualized list with absolute rows.
    const wrap = document.createElement("div");
    const wrapped = add("wrapped", wrap);
    wrap.append(document.createElement("button"));
    nav.append(wrap);
    const virtual = document.createElement("div");
    virtual.style.position = "relative";
    nav.append(virtual);
    const slot = (id, y) => {
      const row = document.createElement("div");
      row.style.cssText = `position:absolute;top:0;height:40px;transform:translateY(${y}px)`;
      add(id, row);
      row.append(document.createElement("button"));
      virtual.append(row);
      return row;
    };
    const v1 = slot("v1", 0), v2 = slot("v2", 40), v3 = slot("v3", 80);
    await settle();
    // The row structure ChatGPT renders today.
    const listItem = document.createElement("div");
    listItem.setAttribute("role", "listitem");
    listItem.innerHTML = '<div class="contents"><div role="group" class="group sidebar-item" data-sidebar-cycle-item="">'
      + '<div class="flex"><div class="flex"><div data-thread-title-trigger="true"><a href="/c/real" data-interactive-row-link="true"><span>real</span></a></div></div>'
      + '<div class="trailing-placeholder"></div></div>'
      + '<div class="contents"><div class="actions"><div role="presentation"><button aria-label="채팅 액션"></button></div><button aria-label="채팅 고정"></button></div></div>'
      + '</div></div>';
    nav.append(listItem);
    await settle();
    const realGroup = listItem.querySelector('[role="group"]');
    const realLink = listItem.querySelector("a");
    realLink.click();
    assert(realGroup.dataset.cbdItem === "selected" && !realLink.hasAttribute("data-cbd-item"),
      "Selection tints ChatGPT's rounded row, not the inner link");
    realLink.click();
    assert(realGroup.dataset.cbdItem === "", "Unselecting clears the tint but keeps the mark for the fade");
    if (status().selected) selectionButton().click();
    wrapped.click();
    v2.querySelector("a").click();
    assert(status().selected === 2, "Wrapped and virtualized chats are selectable");
    deleteButton().click();
    await until(() => !status().busy);
    assert(["vanishing", "deleted"].includes(wrap.dataset.cbdRow), "The wrapper of a deleted chat is hidden too, leaving no gap");
    assert(["vanishing", "deleted"].includes(v2.dataset.cbdRow), "The virtualized row slot is hidden");
    assert(v1.style.translate === "" && v3.style.translate === "0 -40px", "Rows below a deleted virtual slot move up by its height");
    v2.querySelector("a").click();
    assert(status().selected === 0, "Hidden rows cannot be toggled");
    v1.style.transform = "translateY(0px)";
    await settle();
    assert(v3.style.translate === "0 -40px", "Shift survives unrelated re-renders of the list");
    // ChatGPT refetches: the virtualizer reuses the deleted row's element for the next chat.
    v2.querySelector("a").href = "/c/v3";
    v3.remove();
    await settle();
    assert(!v2.dataset.cbdRow && v2.style.translate === "" && !document.querySelector("[data-cbd-shift]"),
      "After a refetch the reused row is shown and no row is shifted twice");
    // Codex tasks: /remote/task_… links, deleted with DELETE /backend-api/wham/tasks/<id>.
    const codexRow = document.createElement("div");
    codexRow.setAttribute("role", "listitem");
    codexRow.innerHTML = '<div role="group" class="sidebar-item" data-sidebar-cycle-item="">'
      + '<div><a href="/remote/task_e_abc123">codex task</a></div><div class="actions"><button>…</button></div></div>';
    nav.append(codexRow);
    await settle();
    if (status().selected) selectionButton().click();
    codexRow.querySelector("a").click();
    assert(status().selected === 1 && codexRow.querySelector('[role="group"]').dataset.cbdItem === "selected", "Codex tasks are selectable");
    requests.length = 0;
    deleteButton().click();
    await until(() => !status().busy);
    assert(requests.length === 1 && requests[0].method === "DELETE" && requests[0].url === "/backend-api/wham/tasks/task_e_abc123",
      "Codex tasks are deleted through the wham tasks endpoint");
    assert(["vanishing", "deleted"].includes(codexRow.dataset.cbdRow), "A deleted Codex task is hidden like a conversation");
    // Simulate an extension reload: the running instance loses its runtime.
    const orphanChrome = { runtime: {
      id: "test-extension",
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage() { return Promise.resolve(); },
    } };
    initialize(document, orphanChrome, isolated, fakeFetch, () => true);
    assert(messageListeners.length === 0 && document.querySelectorAll(".cbd-bar").length === 1, "Reinjection always replaces the previous instance");
    delete orphanChrome.runtime.id;
    orphanChrome.runtime.sendMessage = () => { throw new Error("Extension context invalidated."); };
    const late = add("iota");
    let preventedBefore = null;
    const guard = event => { preventedBefore = event.defaultPrevented; event.preventDefault(); };
    document.addEventListener("click", guard);
    late.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    document.removeEventListener("click", guard);
    await settle();
    assert(preventedBefore === false && !document.querySelector(".cbd-bar") && !document.querySelector("[data-cbd-item]") && !document.documentElement.hasAttribute("data-cbd-mode") && !document.getElementById("cbd-theme") && !isolated.__cbdInstanceV2,
      "Orphaned instance stops intercepting clicks and removes its UI");
    return results;
  } finally {
    autoRelease = true;
    pendingResponses.splice(0).forEach(release => release());
    isolated.__cbdInstanceV2?.destroy();
    fixture.remove();
  }
};
