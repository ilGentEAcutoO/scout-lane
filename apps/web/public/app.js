const $ = (sel) => document.querySelector(sel);
const api = (path, opt = {}) =>
  fetch(path, {
    credentials: "same-origin",
    ...opt,
    headers: { ...(opt.body instanceof FormData ? {} : { "content-type": "application/json" }), ...opt.headers },
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) location.href = "/";
    if (!res.ok) throw new Error(data.error || "request_failed");
    return data;
  });

const state = {
  shortlist: [],
  shortFilter: "all",
  jobId: null,
  stages: [],
  session: null,
  interviews: [],
  scoutLog: [],
  scoutActive: false,
  scoutRunId: null,
  scoutRuns: {},
  jobs: [],
  origin: "thai",
  lanes: null,
  analysis: null,
  sourceModes: null,
  hasShopKey: false,
  sourceGroups: [],
  candidates: [],
  boardView: "board",
  peopleView: "list",
  peoplePage: 1,
  peopleTotal: 0,
  jobsPage: 1,
  jobsTotal: 0,
  jobSort: "ran",
  jobDir: "desc",
  jobGroup: "none",
  busy: [],
  people: [],
  users: [],
  editUserId: null,
  prompts: {},
  promptKey: null,
  calMode: "share",
  calWho: "all",
  calTeam: false,
  calMe: false,
  week: startOfWeek(new Date()),
  day: startOfDay(new Date()),
  calView: "week",
  pick: null,
  meetId: null,
  minutes: 45,
  screenWait: new Map(),
  screenLog: [],
  screenAppId: null,
  screenAppIds: new Set(),
  screenFiles: new Map(),
  screenLast: null,
  ready: {},
  liveTimer: 0,
  liveDelay: 500,
  gapSeen: new Set(),
  gapCandidateId: null,
  aiReady: false,
};

const PLACEHOLDER_NAME = "ผู้สมัครจากเรซูเม่";
const APP_TABS = new Set(["home", "scout", "jobs", "screen", "board", "people", "schedule", "users", "profile", "settings"]);

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const TITLES = {
  home: ["ภาพรวม", "ภาพรวม"],
  scout: ["สรรหา", "ค้นหา Candidate"],
  jobs: ["สรรหา", "ตำแหน่ง"],
  screen: ["สรรหา", "คัดกรอง Resume"],
  board: ["ติดตาม", "คัมบัง"],
  people: ["ติดตาม", "ผู้สมัคร"],
  schedule: ["การสัมภาษณ์", "การสัมภาษณ์"],
  users: ["ระบบ", "ผู้ใช้"],
  settings: ["ระบบ", "ตั้งค่า"],
  profile: ["ระบบ", "โปรไฟล์"],
};

function startOfWeek(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

function can(perm) {
  return Boolean(state.session?.can?.[perm]);
}

function isReady(key) {
  return Boolean(state.ready?.[key]);
}

function markReady(key) {
  state.ready = state.ready || {};
  state.ready[key] = true;
}

function waitHtml(kind, cols = 8) {
  const inner = `<div class="data-wait" aria-busy="true"><span class="spin"></span>กำลังโหลด</div>`;
  if (kind === "tr") return `<tr><td colspan="${Number(cols) || 8}">${inner}</td></tr>`;
  return inner;
}

function motionOk() {
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let choiceOpen = null;
let choiceIgnoreScroll = 0;

function closeChoice() {
  if (!choiceOpen) return;
  const ui = choiceOpen;
  choiceOpen = null;
  ui.menu.hidden = true;
  ui.wrap.classList.remove("is-open");
  ui.btn.setAttribute("aria-expanded", "false");
  ui.btn.querySelector(".choice-caret")?.classList.remove("is-flip");
}

function enhanceSelect(sel) {
  if (!sel || sel.dataset.choice === "1" || sel.closest(".choice-menu")) return;
  sel.dataset.choice = "1";
  const wrap = document.createElement("div");
  wrap.className = "choice";
  if (sel.classList.contains("stage-dd")) wrap.classList.add("is-pill");
  if (sel.closest(".lane-bar")) wrap.classList.add("is-bar");
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add("choice-native");
  sel.tabIndex = -1;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "choice-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  if (sel.id) btn.id = `${sel.id}-face`;
  const labelled = sel.getAttribute("aria-label") || sel.labels?.[0]?.textContent || "";
  if (labelled) btn.setAttribute("aria-label", labelled);
  const label = document.createElement("span");
  label.className = "choice-label";
  const caret = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  caret.setAttribute("class", "choice-caret");
  caret.setAttribute("width", "12");
  caret.setAttribute("height", "8");
  caret.setAttribute("viewBox", "0 0 12 8");
  caret.setAttribute("aria-hidden", "true");
  const caretPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  caretPath.setAttribute("d", "M1.4 1.6 6 6.2 10.6 1.6");
  caret.appendChild(caretPath);
  btn.append(label, caret);
  wrap.appendChild(btn);

  const menu = document.createElement("div");
  menu.className = "choice-menu";
  menu.hidden = true;
  menu.tabIndex = -1;
  menu.setAttribute("role", "listbox");
  const menuId = `${sel.id || `choice-${Math.random().toString(36).slice(2, 8)}`}-menu`;
  menu.id = menuId;
  btn.setAttribute("aria-controls", menuId);
  document.body.appendChild(menu);

  const ui = { sel, wrap, btn, label, menu, hi: 0, query: "", search: null };
  sel._choice = ui;

  const protoVal = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  Object.defineProperty(sel, "value", {
    configurable: true,
    enumerable: true,
    get() {
      return protoVal.get.call(this);
    },
    set(v) {
      protoVal.set.call(this, v);
      syncChoiceFace(ui);
    },
  });

  const syncDisabled = () => {
    btn.disabled = sel.disabled;
    wrap.classList.toggle("is-disabled", sel.disabled);
  };
  const syncFace = () => syncChoiceFace(ui);
  syncFace();
  syncDisabled();

  const mo = new MutationObserver(() => {
    syncFace();
    syncDisabled();
    if (choiceOpen === ui) paintChoiceMenu(ui);
  });
  mo.observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"] });
  ui.mo = mo;

  sel.addEventListener("change", syncFace);
  sel.addEventListener("invalid", (e) => {
    e.preventDefault();
    wrap.classList.add("is-invalid");
    btn.focus();
  });

  wrap.addEventListener("click", (e) => e.stopPropagation());
  wrap.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (sel.disabled) return;
    if (choiceOpen === ui) closeChoice();
    else openChoice(ui);
  });
  btn.addEventListener("keydown", (e) => onChoiceKey(ui, e, true));
  menu.addEventListener("keydown", (e) => onChoiceKey(ui, e, false));
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  menu.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-value]");
    if (!opt || opt.getAttribute("aria-disabled") === "true") return;
    pickChoice(ui, opt.dataset.value);
  });
}

function syncChoiceFace(ui) {
  const opt = ui.sel.selectedOptions[0];
  const text = (opt?.textContent || "").trim();
  ui.label.textContent = text || "เลือก";
  ui.label.classList.toggle("is-ph", !text);
  ui.wrap.classList.remove("is-invalid");
}

function choiceRows(ui) {
  const q = (ui.query || "").trim().toLowerCase();
  return [...ui.sel.options].map((o, i) => ({
    i,
    value: o.value,
    text: (o.textContent || "").trim(),
    disabled: o.disabled,
    selected: o.selected,
  })).filter((o) => !q || o.text.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
}

function paintChoiceMenu(ui) {
  const rows = choiceRows(ui);
  const showSearch = ui.sel.options.length > 8;
  ui.menu.replaceChildren();
  if (showSearch) {
    const search = document.createElement("input");
    search.type = "search";
    search.className = "choice-search";
    search.placeholder = "ค้น…";
    search.setAttribute("aria-label", "ค้นในรายการ");
    search.value = ui.query;
    search.autocomplete = "off";
    search.addEventListener("input", () => {
      ui.query = search.value;
      ui.hi = 0;
      paintChoiceMenu(ui);
      ui.search?.focus({ preventScroll: true });
    });
    ui.menu.appendChild(search);
    ui.search = search;
  } else {
    ui.search = null;
  }
  const list = document.createElement("div");
  list.className = "choice-list";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "choice-empty";
    empty.textContent = ui.sel.options.length ? "ไม่พบ" : isReady("jobsList") || isReady("board") ? "ยังไม่มีรายการ" : "กำลังโหลด";
    list.appendChild(empty);
  } else {
    if (ui.hi >= rows.length) ui.hi = rows.length - 1;
    if (ui.hi < 0) ui.hi = 0;
    rows.forEach((row, idx) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "choice-opt";
      el.dataset.value = row.value;
      el.setAttribute("role", "option");
      el.setAttribute("aria-selected", row.selected ? "true" : "false");
      if (row.disabled) el.setAttribute("aria-disabled", "true");
      if (row.selected) el.classList.add("is-on");
      if (idx === ui.hi) el.classList.add("is-hi");
      const name = document.createElement("span");
      name.textContent = row.text || "—";
      el.appendChild(name);
      if (row.selected) {
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        tick.setAttribute("class", "choice-tick");
        tick.setAttribute("width", "14");
        tick.setAttribute("height", "14");
        tick.setAttribute("viewBox", "0 0 14 14");
        tick.setAttribute("aria-hidden", "true");
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", "M2.5 7.2 5.6 10.4 11.5 3.6");
        tick.appendChild(p);
        el.appendChild(tick);
      }
      list.appendChild(el);
    });
  }
  ui.menu.appendChild(list);
  placeChoiceMenu(ui);
  list.querySelector(".is-hi")?.scrollIntoView({ block: "nearest" });
}

function placeChoiceMenu(ui) {
  const r = ui.btn.getBoundingClientRect();
  const gap = 6;
  const width = Math.min(Math.max(r.width, 220), window.innerWidth - 16);
  ui.menu.style.width = `${width}px`;
  ui.menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
  const below = window.innerHeight - r.bottom - 12;
  const above = r.top - 12;
  if (below >= 168 || below >= above) {
    ui.menu.style.top = `${r.bottom + gap}px`;
    ui.menu.style.bottom = "auto";
    ui.menu.style.maxHeight = `${Math.max(140, below)}px`;
  } else {
    ui.menu.style.top = "auto";
    ui.menu.style.bottom = `${window.innerHeight - r.top + gap}px`;
    ui.menu.style.maxHeight = `${Math.max(140, above)}px`;
  }
}

function openChoice(ui) {
  closeChoice();
  ui.query = "";
  const selected = [...ui.sel.options].findIndex((o) => o.selected);
  ui.hi = Math.max(0, selected);
  choiceOpen = ui;
  const host = ui.sel.closest("dialog") || document.body;
  if (ui.menu.parentNode !== host) host.appendChild(ui.menu);
  ui.menu.hidden = false;
  ui.wrap.classList.add("is-open");
  ui.btn.setAttribute("aria-expanded", "true");
  ui.btn.querySelector(".choice-caret")?.classList.add("is-flip");
  choiceIgnoreScroll = performance.now() + 280;
  paintChoiceMenu(ui);
  (ui.search || ui.menu).focus({ preventScroll: true });
}

function pickChoice(ui, value) {
  const before = ui.sel.value;
  ui.sel.value = value;
  syncChoiceFace(ui);
  closeChoice();
  ui.btn.focus({ preventScroll: true });
  if (before !== ui.sel.value) ui.sel.dispatchEvent(new Event("change", { bubbles: true }));
}

function onChoiceKey(ui, e, fromBtn) {
  const open = choiceOpen === ui;
  if (fromBtn && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
    if (!open) {
      e.preventDefault();
      openChoice(ui);
      return;
    }
  }
  if (!open) return;
  const rows = choiceRows(ui);
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeChoice();
    ui.btn.focus({ preventScroll: true });
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    ui.hi = Math.min(rows.length - 1, ui.hi + 1);
    paintChoiceMenu(ui);
    (ui.search || ui.menu).focus({ preventScroll: true });
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    ui.hi = Math.max(0, ui.hi - 1);
    paintChoiceMenu(ui);
    (ui.search || ui.menu).focus({ preventScroll: true });
    return;
  }
  if (e.key === "Home") {
    e.preventDefault();
    ui.hi = 0;
    paintChoiceMenu(ui);
    (ui.search || ui.menu).focus({ preventScroll: true });
    return;
  }
  if (e.key === "End") {
    e.preventDefault();
    ui.hi = Math.max(0, rows.length - 1);
    paintChoiceMenu(ui);
    (ui.search || ui.menu).focus({ preventScroll: true });
    return;
  }
  if (e.key === "Enter" || (e.key === " " && e.target === ui.btn)) {
    e.preventDefault();
    const row = rows[ui.hi];
    if (row && !row.disabled) pickChoice(ui, row.value);
  }
}

function teardownChoice(sel) {
  const ui = sel._choice;
  if (!ui) return;
  if (choiceOpen === ui) closeChoice();
  ui.mo?.disconnect();
  ui.menu.remove();
  sel._choice = null;
}

function bindNiceSelects() {
  document.querySelectorAll("select").forEach(enhanceSelect);
  if (bindNiceSelects.watching) return;
  bindNiceSelects.watching = true;
  document.addEventListener("pointerdown", (e) => {
    if (!choiceOpen) return;
    if (choiceOpen.wrap.contains(e.target) || choiceOpen.menu.contains(e.target)) return;
    closeChoice();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !choiceOpen) return;
      e.preventDefault();
      e.stopPropagation();
      const ui = choiceOpen;
      closeChoice();
      ui.btn.focus({ preventScroll: true });
    },
    true,
  );
  document.addEventListener(
    "scroll",
    (e) => {
      if (!choiceOpen) return;
      if (performance.now() < choiceIgnoreScroll) return;
      if (choiceOpen.menu.contains(e.target)) return;
      closeChoice();
    },
    true,
  );
  addEventListener("resize", () => {
    if (choiceOpen) placeChoiceMenu(choiceOpen);
  });
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.("select")) enhanceSelect(n);
        n.querySelectorAll?.("select").forEach(enhanceSelect);
      }
      for (const n of m.removedNodes) {
        if (n.nodeType !== 1) continue;
        const gone = [];
        if (n.matches?.("select")) gone.push(n);
        n.querySelectorAll?.("select").forEach((s) => gone.push(s));
        gone.forEach((s) => {
          if (!document.contains(s)) teardownChoice(s);
        });
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function bindFeel() {
  document.addEventListener("pointermove", (e) => {
    const mx = (e.clientX / innerWidth) * 100;
    const my = (e.clientY / innerHeight) * 100;
    document.documentElement.style.setProperty("--mx", `${mx}%`);
    document.documentElement.style.setProperty("--my", `${my}%`);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (choiceOpen) return;
      if ($("#leave-modal")?.open || $("#gap-modal")?.open || $("#ask-modal")?.open || $("#meet-modal")?.open || $("#user-modal")?.open || $("#job-modal")?.open) return;
      closeDrawer();
    }
  });
  addEventListener("resize", placeNavPill);
  const veil = $("#drawer-veil");
  if (veil) veil.onclick = closeDrawer;
}

function placeNavPill() {
  const nav = document.querySelector(".side nav");
  const on = nav?.querySelector("[data-tab].on");
  const pill = $("#nav-pill");
  if (!nav || !on || !pill) return;
  const nr = nav.getBoundingClientRect();
  const br = on.getBoundingClientRect();
  pill.style.height = `${br.height}px`;
  pill.style.transform = `translateY(${br.top - nr.top}px)`;
}

function countTo(el, n) {
  if (!el) return;
  const end = Number(n) || 0;
  if (el.dataset.n === String(end)) return;
  el.dataset.n = String(end);
  if (!motionOk()) {
    el.textContent = String(end);
    return;
  }
  const start = Number(el.textContent) || 0;
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 640);
    const ease = 1 - (1 - k) * (1 - k) * (1 - k);
    el.textContent = String(Math.round(start + (end - start) * ease));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function tiltChip(chip, e) {
  if (!motionOk()) return;
  const r = chip.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  chip.style.transform = `rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-2px)`;
}

async function closeDrawer() {
  const d = $("#person-drawer");
  const v = $("#drawer-veil");
  if (!d || d.hidden) return;
  if (!(await askLeaveIfDirty(isDrawerDirty()))) return;
  d.classList.remove("is-open");
  if (v) v.classList.remove("is-open");
  const hide = () => {
    d.hidden = true;
    if (v) v.hidden = true;
    markDrawerClean();
    markPanelClean("board");
  };
  if (!motionOk()) hide();
  else setTimeout(hide, 280);
}

function openDrawer() {
  const d = $("#person-drawer");
  const v = $("#drawer-veil");
  if (!d) return;
  d.hidden = false;
  if (v) v.hidden = false;
  requestAnimationFrame(() => {
    d.classList.add("is-open");
    if (v) v.classList.add("is-open");
  });
}

async function readSession() {
  for (let i = 0; i < 5; i++) {
    const session = await api("/api/session");
    if (session.authenticated) return session;
    await new Promise((r) => setTimeout(r, 120));
  }
  return { authenticated: false };
}

async function boot() {
  const session = await readSession();
  if (!session.authenticated) {
    location.href = "/";
    return;
  }
  state.session = session;
  state.aiReady = Boolean(session.aiReady);
  applyLimits(session.limits || {});
  applyCaps();
  bindNav();
  bindFeel();
  bindNiceSelects();
  if ($("#who")) $("#who").textContent = `${session.username} · ${session.role}`;
  const initial = String(session.username || "A").slice(0, 1).toUpperCase();
  const mark = $("#who-mark");
  const topAv = $("#top-avatar");
  if (mark) mark.textContent = initial;
  if (topAv) topAv.textContent = initial;
  $("#logout")?.addEventListener("click", async () => {
    if (!(await askLeaveIfDirty())) return;
    await api("/api/logout", { method: "POST", body: "{}" });
    location.href = "/";
  });
  $("#leave-stay")?.addEventListener("click", () => settleLeave(false));
  $("#leave-go")?.addEventListener("click", () => settleLeave(true));
  $("#leave-modal")?.addEventListener("cancel", (e) => {
    e.preventDefault();
    settleLeave(false);
  });
  $("#jd-search")?.addEventListener("click", runScout);
  $("#jd-draft")?.addEventListener("click", draftJob);
  $("#job-draft")?.addEventListener("click", draftJob);
  $("#job-jd-keep")?.addEventListener("click", () => applyJdDraft(true));
  $("#job-jd-drop")?.addEventListener("click", () => dropJdDraft(true));
  $("#scout-jd-keep")?.addEventListener("click", () => applyJdDraft(false));
  $("#scout-jd-drop")?.addEventListener("click", () => dropJdDraft(false));
  $("#job-new")?.addEventListener("click", newJob);
  $("#job-search")?.addEventListener("input", onJobSearch);
  $("#job-search")?.addEventListener("keydown", onJobSearchKey);
  $("#job-group")?.addEventListener("change", onJobGroup);
  $("#job-table")?.addEventListener("click", onJobListClick);
  $("#job-table")?.addEventListener("keydown", onJobListKey);
  $("#people-q")?.addEventListener("input", onPeopleSearch);
  $("#people-stage")?.addEventListener("change", () => {
    state.peoplePage = 1;
    loadPeople();
  });
  $("#people-source")?.addEventListener("change", () => {
    state.peoplePage = 1;
    loadPeople();
  });
  $("#people-job")?.addEventListener("change", () => {
    state.peoplePage = 1;
    loadPeople();
  });
  $("#people-view-list")?.addEventListener("click", () => setPeopleView("list"));
  $("#people-view-grid")?.addEventListener("click", () => setPeopleView("grid"));
  $("#people-grid")?.addEventListener("click", onPeopleGridClick);
  $("#people-grid")?.addEventListener("keydown", onPeopleGridKey);
  $("#job-save")?.addEventListener("click", saveJob);
  $("#job-use")?.addEventListener("click", useJob);
  $("#job-results")?.addEventListener("click", () => {
    if (state.jobId) viewJobResults(state.jobId);
  });
  $("#job-del")?.addEventListener("click", () => {
    if (state.jobId) deleteJob(state.jobId);
  });
  $("#goto-jobs")?.addEventListener("click", () => showTab("jobs"));
  $("#scout-job-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-job]");
    if (btn?.dataset.job) pickScoutJob(btn.dataset.job);
  });
  $("#jd-title")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if ($("#jd-text")?.value.trim()) runScout();
    else draftJob();
  });
  $("#jd-title")?.addEventListener("input", syncScoutSearchBtn);
  $("#jd-text")?.addEventListener("input", syncScoutSearchBtn);
  $("#jd-notes")?.addEventListener("input", syncScoutSearchBtn);
  $("#origin-row")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-origin]");
    if (!btn) return;
    state.origin = btn.dataset.origin || "any";
    $("#origin-row").querySelectorAll("[data-origin]").forEach((el) => {
      el.classList.toggle("on", el === btn);
    });
    loadLatestShortlist().catch(() => {});
  });
  $("#approve")?.addEventListener("click", approveSelected);
  if ($("#screen-form")) $("#screen-form").onsubmit = runScreen;
  bindScreenDrop();
  $("#gap-form")?.addEventListener("submit", saveGap);
  $("#gap-later")?.addEventListener("click", closeGap);
  $("#manual-add")?.addEventListener("click", addManual);
  bindAskModal();
  bindMeetModal();
  bindUserModal();
  bindJobModal();
  $("#mint-token")?.addEventListener("click", mintToken);
  $("#copy-mcp-url")?.addEventListener("click", copyMcpUrl);
  $("#me-password-save")?.addEventListener("click", changeMyPassword);
  $("#me-cal-save")?.addEventListener("click", saveMyCalendar);
  $("#cal-settings-save")?.addEventListener("click", saveCalendarSettings);
  $("#src-settings-save")?.addEventListener("click", saveSourceSettings);
  $("#shop-key-clear")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    btn.classList.toggle("on");
    btn.textContent = btn.classList.contains("on") ? "จะลบเมื่อบันทึก" : "ลบคีย์ที่เก็บ";
    refreshSourceLocks();
  });
  $("#shop-key")?.addEventListener("input", refreshSourceLocks);
  $("#ai-settings-save")?.addEventListener("click", saveAiSettings);
  $("#prompt-save")?.addEventListener("click", savePrompt);
  $("#top-avatar")?.addEventListener("click", () => showTab("profile"));
  $("#who-mark")?.addEventListener("click", () => showTab("profile"));
  $("#user-open-add")?.addEventListener("click", openUserCreate);
  $("#approve-all")?.addEventListener("click", approveAllHits);
  $("#view-board")?.addEventListener("click", () => setBoardView("board"));
  $("#view-list")?.addEventListener("click", () => setBoardView("list"));
  $("#person-edit")?.addEventListener("submit", savePerson);
  $("#person-del")?.addEventListener("click", () => deletePerson());
  $("#new-job-add")?.addEventListener("click", addJob);
  $("#cal-prev")?.addEventListener("click", () => shiftCal(-1));
  $("#cal-next")?.addEventListener("click", () => shiftCal(1));
  $("#cal-today")?.addEventListener("click", () => {
    const now = new Date();
    state.week = startOfWeek(now);
    state.day = startOfDay(now);
    loadBusy().then(() => renderCalendar());
  });
  $("#cal-view-week")?.addEventListener("click", () => setCalView("week"));
  $("#cal-view-month")?.addEventListener("click", () => setCalView("month"));
  document.querySelector("[data-panel=home]")?.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) showTab(go.dataset.go);
  });
  $("#dur-pills")?.addEventListener("click", (e) => {
    const min = e.target.closest("[data-min]")?.dataset.min;
    if (!min) return;
    setMeetMinutes(Number(min));
    paintMeetWhen();
    renderCalendar();
  });
  $("#book-when")?.addEventListener("change", () => {
    const raw = $("#book-when")?.value;
    if (!raw) return;
    const next = new Date(raw);
    if (Number.isNaN(next.getTime())) return;
    state.pick = next;
    paintMeetWhen();
  });
  $("#drawer-close")?.addEventListener("click", closeDrawer);
  $("#step-prev")?.addEventListener("click", () => shiftStep(-1));
  $("#step-next")?.addEventListener("click", () => shiftStep(1));
  connectLive();
  renderHome();
  const opening = showTab(tabFromPath(), { push: false, replace: true, skipDirty: true });
  const loads = [loadJobs(), loadBoard(), loadInterviews(), opening];
  if (can("settings.read")) {
    loads.push(loadPrompts(), loadCalendarSettings(), loadSourceSettings(), loadAiSettings());
  }
  if (can("users.read")) loads.push(loadUsers());
  await Promise.all(loads);
  renderHome();
  placeNavPill();
  syncAiLocks();
  const params = new URLSearchParams(location.search);
  const g = params.get("google");
  if (g && $("#book-msg")) {
    $("#book-msg").textContent =
      g === "ok" ? "เชื่อมปฏิทินแล้ว" : g === "fail" ? "เชื่อมปฏิทินไม่สำเร็จ" : "ยกเลิกการเชื่อมปฏิทิน";
  }
}

function applyCaps() {
  const usersTab = document.querySelector("nav [data-tab=users]");
  if (usersTab) usersTab.hidden = !can("users.read");
  const usersPanel = document.querySelector("[data-panel=users]");
  if (usersPanel && !can("users.read")) usersPanel.hidden = true;
  const userAdd = $("#user-open-add");
  if (userAdd) userAdd.hidden = !can("users.write");
  const settingsTab = document.querySelector("nav [data-tab=settings]");
  if (settingsTab) settingsTab.hidden = !can("settings.read");
  const settingsPanel = document.querySelector("[data-panel=settings]");
  if (settingsPanel && !can("settings.read")) settingsPanel.hidden = true;
  const onTab = document.querySelector("[data-panel=settings] .page-tab.on")?.dataset.ptab || "sources";
  syncSettingsSave(onTab);
  if (!can("settings.write")) {
    document.querySelectorAll("[data-set-save]").forEach((btn) => {
      btn.hidden = true;
    });
    const connect = $("#cal-team-connect");
    if (connect) connect.hidden = true;
  }
  document.querySelectorAll("[data-panel=settings] [data-ptab]").forEach((btn) => {
    btn.hidden = !can("settings.read");
  });
}

function applyLimits(L) {
  const set = (sel, max) => {
    const el = $(sel);
    if (el && max) el.maxLength = max;
  };
  set("#jd-title", L.jobTitleMax);
  set("#jd-notes", L.jobDescMax);
  set("#jd-text", L.jobDescMax);
  set("#job-edit-title", L.jobTitleMax);
  set("#job-edit-notes", L.jobDescMax);
  set("#job-edit-desc", L.jobDescMax);
  set("#new-job-title", L.jobTitleMax);
  set("#new-job-desc", L.jobDescMax);
  set("#gap-name", L.candidateNameMax);
  set("#gap-email", L.emailMax);
  set("#manual-name", L.candidateNameMax);
  set("#manual-source", L.sourceMax);
  set("#token-name", L.tokenNameMax);
  set("#user-name", L.usernameMax);
  set("#user-pass", L.passwordMax);
  set("#user-pass-new", L.passwordMax);
  set("#me-password", L.passwordMax);
  const minutes = $("#meet-form [name=minutes]");
  if (minutes && L.interviewMinutesMin) {
    minutes.min = L.interviewMinutesMin;
    minutes.max = L.interviewMinutesMax;
  }
}

function setNavOpen(open) {
  const shell = document.querySelector(".shell");
  const btn = $("#menu-toggle");
  if (shell) shell.classList.toggle("nav-open", open);
  if (btn) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "ปิดเมนู" : "เปิดเมนู");
  }
}

const cleanSnapshots = new Map();
let leaveResolver = null;
let drawerClean = "";
let jobModalClean = "";

function markJobModalClean() {
  const form = $("#job-form");
  jobModalClean = form ? snapshotOf(form) : "";
}

function isJobModalDirty() {
  const dlg = $("#job-modal");
  const form = $("#job-form");
  if (!dlg?.open || !form) return false;
  return snapshotOf(form) !== jobModalClean;
}

function skipDirtyField(el) {
  if (!el || el.disabled) return true;
  if (el.dataset.skipDirty != null || el.closest("[data-skip-dirty]")) return true;
  const type = el.type;
  if (type === "hidden" || type === "button" || type === "submit" || type === "search") return true;
  return false;
}

function snapshotOf(root) {
  if (!root) return "";
  const fields = [...root.querySelectorAll("input, textarea, select")]
    .filter((el) => !skipDirtyField(el))
    .map((el) => {
      if (el.type === "checkbox" || el.type === "radio") return `${el.name}:${el.value}:${el.checked ? 1 : 0}`;
      if (el.type === "file") {
        const f = el.files?.[0];
        return `${el.name}:${f ? `${f.name}:${f.size}` : ""}`;
      }
      return `${el.id || el.name}:${el.value}`;
    });
  const pending = [...root.querySelectorAll("[data-ai-clear].on, #shop-key-clear.on")].map(
    (el) => `flag:${el.id || el.dataset.aiClear}`,
  );
  return fields.concat(pending).join("\n");
}

function currentPanel() {
  return document.querySelector("[data-panel]:not([hidden])");
}

function markPanelClean(name) {
  const root = name ? document.querySelector(`[data-panel="${name}"]`) : currentPanel();
  if (!root) return;
  cleanSnapshots.set(root.dataset.panel, snapshotOf(root));
}

function isPanelDirty(name) {
  const root = name ? document.querySelector(`[data-panel="${name}"]`) : currentPanel();
  if (!root) return false;
  if (root.dataset.panel === "screen") return false;
  const clean = cleanSnapshots.get(root.dataset.panel);
  if (clean == null) return false;
  return snapshotOf(root) !== clean;
}

function isDrawerDirty() {
  const form = $("#person-edit");
  const drawer = $("#person-drawer");
  if (!form || !drawer || drawer.hidden) return false;
  return snapshotOf(form) !== drawerClean;
}

function markDrawerClean() {
  const form = $("#person-edit");
  drawerClean = form ? snapshotOf(form) : "";
}

function settleLeave(ok) {
  const dlg = $("#leave-modal");
  if (dlg?.open) dlg.close();
  const resolve = leaveResolver;
  leaveResolver = null;
  if (resolve) resolve(ok);
}

function askLeaveIfDirty(extra) {
  const dirty = extra === undefined ? isPanelDirty() || isJobModalDirty() : extra;
  if (!dirty) return Promise.resolve(true);
  if (leaveResolver) return Promise.resolve(false);
  const dlg = $("#leave-modal");
  if (!dlg?.showModal) return Promise.resolve(false);
  return new Promise((resolve) => {
    leaveResolver = resolve;
    dlg.showModal();
  });
}

let askResolver = null;

function settleAsk(ok) {
  const dlg = $("#ask-modal");
  if (dlg?.open) dlg.close();
  const resolve = askResolver;
  askResolver = null;
  if (resolve) resolve(ok);
}

function bindAskModal() {
  $("#ask-ok")?.addEventListener("click", () => settleAsk(true));
  $("#ask-no")?.addEventListener("click", () => settleAsk(false));
  $("#ask-modal")?.addEventListener("cancel", (e) => {
    e.preventDefault();
    settleAsk(false);
  });
}

function askModal({ title, body = "", ok = "ตกลง", no = "ยกเลิก", danger = false, alertOnly = false }) {
  const dlg = $("#ask-modal");
  if (!dlg?.showModal) return Promise.resolve(false);
  if (askResolver) return Promise.resolve(false);
  const titleEl = $("#ask-title");
  const bodyEl = $("#ask-body");
  const okBtn = $("#ask-ok");
  const noBtn = $("#ask-no");
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) {
    bodyEl.textContent = body;
    bodyEl.hidden = !body;
  }
  if (okBtn) {
    okBtn.textContent = ok;
    okBtn.classList.toggle("heat", Boolean(danger));
  }
  if (noBtn) {
    noBtn.textContent = no;
    noBtn.hidden = Boolean(alertOnly);
  }
  return new Promise((resolve) => {
    askResolver = resolve;
    dlg.showModal();
  });
}

function notifyModal(title, body) {
  return askModal({ title, body, ok: "ปิด", alertOnly: true });
}

function bindNav() {
  document.querySelector("aside nav")?.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tab]");
    if (!el) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    showTab(el.dataset.tab);
  });
  document.querySelector(".dock")?.addEventListener("click", (e) => {
    const el = e.target.closest("[data-dock]");
    if (!el) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    showTab(el.dataset.dock);
  });
  document.querySelectorAll(".page-tabs").forEach((bar) => {
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ptab]");
      if (!btn || !bar.contains(btn)) return;
      showPageTab(bar, btn.dataset.ptab);
    });
  });
  $("#result-filters")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-src-filter]");
    if (!btn) return;
    state.shortFilter = btn.dataset.srcFilter || "all";
    paintShortlist(state.shortlist);
  });
  $("#menu-toggle")?.addEventListener("click", () => {
    setNavOpen(!document.querySelector(".shell")?.classList.contains("nav-open"));
  });
  $("#nav-veil")?.addEventListener("click", () => setNavOpen(false));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") setNavOpen(false);
  });
  addEventListener("popstate", async () => {
    const next = tabFromPath();
    const current = currentPanel()?.dataset.panel;
    if (current === next) return;
    if (await askLeaveIfDirty()) showTab(next, { push: false, skipDirty: true });
    else history.pushState({ tab: current }, "", urlForTab(current || "home"));
  });
  addEventListener("beforeunload", (e) => {
    if (!isPanelDirty() && !isDrawerDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

function pathForTab(tab) {
  return tab === "home" ? "/app/" : `/app/${tab}`;
}

function tabFromPath() {
  const q = new URLSearchParams(location.search).get("tab");
  const path = location.pathname.replace(/\/index\.html$/i, "").replace(/\/+$/, "") || "/";
  const match = /^\/app(?:\/([a-z]+))?$/.exec(path);
  if (match) {
    const tab = match[1] || (q && APP_TABS.has(q) ? q : "home");
    if (APP_TABS.has(tab)) return tab;
  }
  if (q && APP_TABS.has(q)) return q;
  return "home";
}

function urlForTab(tab) {
  const params = new URLSearchParams(location.search);
  params.delete("tab");
  if (tab !== "schedule" && tab !== "profile") params.delete("google");
  const qs = params.toString();
  const path = pathForTab(tab);
  return qs ? `${path}?${qs}` : path;
}

function showPageTab(bar, id) {
  const scope = bar.closest(".tab-scope") || bar.closest("[data-panel]") || document;
  bar.querySelectorAll("[data-ptab]").forEach((b) => b.classList.toggle("on", b.dataset.ptab === id));
  scope.querySelectorAll("[data-ptab-panel]").forEach((p) => {
    const owner = p.closest(".tab-scope") || p.closest("[data-panel]");
    if (owner !== scope) return;
    p.classList.toggle("is-off", p.dataset.ptabPanel !== id);
  });
  if (bar.closest("[data-panel=settings]")) syncSettingsSave(id);
}

function syncSettingsSave(id) {
  document.querySelectorAll("[data-set-save]").forEach((btn) => {
    btn.hidden = btn.dataset.setSave !== id || (typeof can === "function" && !can("settings.write"));
  });
  const connect = $("#cal-team-connect");
  if (connect) connect.hidden = id !== "calendar";
  const msg = $("#set-msg");
  if (msg) msg.textContent = "";
}

function setSettingsMsg(text) {
  const el = $("#set-msg");
  if (el) el.textContent = text || "";
}

function openPageTab(panel, id) {
  const section = document.querySelector(`[data-panel="${panel}"]`);
  const bar = section?.querySelector(".page-tabs");
  if (bar) showPageTab(bar, id);
}

async function showTab(tab, opts = {}) {
  const btn = document.querySelector(`aside nav [data-tab="${tab}"]`);
  if (!btn || btn.hidden || (tab === "users" && !can("users.read"))) {
    if (tab !== "home") showTab("home", { push: false, replace: true, skipDirty: true });
    return;
  }
  const current = currentPanel()?.dataset.panel;
  if (!opts.skipDirty && current && current !== tab) {
    if (!(await askLeaveIfDirty())) return;
  }
  if (tab !== "jobs") $("#job-modal")?.close();
  document.querySelectorAll("aside nav [data-tab]").forEach((b) => b.classList.toggle("on", b === btn));
  document.querySelectorAll("[data-dock]").forEach((b) => b.classList.toggle("on", b.dataset.dock === tab));
  setNavOpen(false);
  document.querySelectorAll("[data-panel]").forEach((p) => {
    const on = p.dataset.panel === tab;
    p.hidden = !on;
    if (on) {
      p.classList.remove("page-enter");
      void p.offsetWidth;
      p.classList.add("page-enter");
    }
  });
  const names = TITLES[tab] || ["", tab];
  $("#page-mod").textContent = names[0];
  $("#page-title").textContent = names[1];
  placeNavPill();
  const url = urlForTab(tab);
  const here = `${location.pathname}${location.search}`;
  if (opts.replace) history.replaceState({ tab }, "", url);
  else if (opts.push !== false && here !== url) history.pushState({ tab }, "", url);
  const loads = [];
  if (tab === "home") renderHome();
  if (tab === "scout") loads.push(Promise.all([loadSourceLanes(), loadJobs()]).then(() => loadScoutStatus(state.jobId)));
  if (tab === "jobs") {
    loads.push(loadJobs().then(() => loadJobTable()));
  }
  if (tab === "screen") loads.push(loadJobs());
  if (tab === "board") loads.push(loadBoard());
  if (tab === "people") loads.push(loadPeople());
  if (tab === "schedule") loads.push(loadInterviews());
  if (tab === "profile") loads.push(Promise.all([loadTokens(), loadScheduleMeta()]));
  if (tab === "settings" && can("settings.read")) {
    loads.push(Promise.all([loadCalendarSettings(), loadSourceSettings(), loadAiSettings()]));
  }
  await Promise.all(loads).catch(() => {});
  markPanelClean(tab);
}

function homeWhen(d = new Date()) {
  const days = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function homeGreet(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "ยังดึกอยู่";
  if (h < 12) return "สวัสดีตอนเช้า";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

function fmtClock(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderHome() {
  const people = state.peopleCount || document.querySelectorAll("#board .chip").length || (state.candidates || []).length || 0;
  const meets = (state.interviews || []).length;
  const jobs = (state.jobs || []).length || $("#screen-job")?.options.length || 0;
  if ($("#home-when")) $("#home-when").textContent = homeWhen();
  if ($("#home-greet")) $("#home-greet").textContent = homeGreet();
  if ($("#home-pulse")) {
    $("#home-pulse").textContent =
      isReady("board") && isReady("jobsList") && isReady("interviews")
        ? `ท่อมี ${people} คน · ${meets} นัด · ${jobs} ตำแหน่ง`
        : "กำลังโหลด";
  }
  const soon = (state.interviews || [])
    .slice()
    .filter((ev) => new Date(ev.starts_at).getTime() >= Date.now() - 30 * 60 * 1000)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0]
    || (state.interviews || []).slice().sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0];
  const next = $("#home-next");
  if (next) {
    next.innerHTML = !isReady("interviews")
      ? `<span class="desk-next-kicker">นัดถัดไป</span><strong>กำลังโหลด</strong><small>รอข้อมูลนัด</small>`
      : soon
      ? `<span class="desk-next-kicker">นัดถัดไป</span><b class="desk-next-time">${esc(fmtClock(soon.starts_at))}</b><strong>${esc(soon.display_name)}</strong><small>${esc(fmtWhen(soon.starts_at))}</small>`
      : `<span class="desk-next-kicker">นัดถัดไป</span><strong>วันนี้ยังว่าง</strong><small>เปิดปฏิทินเพื่อนัดจากท่อ</small>`;
  }
  const funnel = $("#home-funnel");
  if (funnel && !isReady("board")) {
    funnel.innerHTML = waitHtml();
  } else if (funnel) {
    const stages = (typeof PATH !== "undefined" && PATH) || ["applied", "screening", "prescreen", "interview", "offer", "hired"];
    const counts = {};
    for (const c of state.candidates || []) counts[c.stage] = (counts[c.stage] || 0) + 1;
    const max = Math.max(1, ...stages.map((s) => counts[s] || 0));
    funnel.innerHTML = stages
      .map((s) => {
        const n = counts[s] || 0;
        const pct = Math.round((n / max) * 100);
        return `<button type="button" class="pipe-step${n ? "" : " is-empty"}" data-go="board"><b>${n}</b><span>${esc((typeof STAGE_TH !== "undefined" && STAGE_TH[s]) || s)}</span><i style="--p:${pct}%"></i></button>`;
      })
      .join("");
  }
}

async function loadJobs() {
  try {
    const data = await api("/api/jobs?pageSize=100");
    state.jobs = data.jobs || [];
    const sel = $("#screen-job");
    if (sel) {
      sel.innerHTML = state.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("");
    }
    for (const id of ["filter-job", "people-job"]) {
      const fj = $(`#${id}`);
      if (!fj) continue;
      const cur = fj.value;
      fj.innerHTML =
        `<option value="">ทุกตำแหน่ง</option>` +
        state.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("");
      fj.value = cur;
    }
  } finally {
    markReady("jobsList");
    paintJobUsing();
  }
  if (!state.jobId && state.jobs.length === 1) {
    await fillJob(state.jobs[0].id).catch(() => {});
  }
}

const MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

async function loadJobTable() {
  if (!isReady("jobs")) paintJobList();
  try {
  const q = $("#job-search")?.value || "";
  const data = await api(`/api/jobs?q=${encodeURIComponent(q)}&page=${state.jobsPage || 1}&pageSize=100`);
  state.jobTable = data.jobs || [];
  state.jobsTotal = data.total || 0;
  state.jobsPage = data.page || 1;
  markReady("jobs");
  paintJobList();
  const pager = $("#job-pager");
  if (pager) {
    const need = (state.jobsTotal || 0) > 100;
    pager.hidden = !need;
    if (need) {
      paintPager(pager, { page: state.jobsPage, pageSize: data.pageSize || 100, total: state.jobsTotal }, (p) => {
        state.jobsPage = p;
        loadJobTable();
      });
    }
  }
  } finally {
    markReady("jobs");
    paintJobList();
  }
}

function jobMeta(job) {
  if (job.runCount) {
    const when = String(job.lastRunAt || "").slice(0, 16).replace("T", " ");
    return `${job.lastHitCount ?? 0} คน · ${job.runCount} รอบ${when ? ` · ${when}` : ""}`;
  }
  return "ยังไม่ค้น";
}

function filterJobs(q) {
  const n = String(q || "").trim().toLowerCase();
  const rows = state.jobs || [];
  if (!n) return rows.slice(0, 40);
  return rows.filter((job) => `${job.title} ${job.query || ""}`.toLowerCase().includes(n)).slice(0, 40);
}

function fmtJobDay(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTH_TH[d.getMonth()]}`;
}

function jobMonthKey(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function jobMonthLabel(key) {
  if (key === "unknown") return "ไม่มีวันที่";
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_TH[m - 1]} ${y + 543}`;
}

function jobSortValue(job, key) {
  if (key === "title") return String(job.title || "").toLowerCase();
  if (key === "hits") return Number(job.lastHitCount) || 0;
  if (key === "runs") return Number(job.runCount) || 0;
  if (key === "ran") return Date.parse(job.lastRunAt || "") || 0;
  if (key === "created") return Date.parse(job.createdAt || "") || 0;
  return Date.parse(job.lastRunAt || job.createdAt || "") || 0;
}

function sortedJobs(list) {
  const dir = state.jobDir === "asc" ? 1 : -1;
  const key = state.jobSort || "ran";
  return (list || []).slice().sort((a, b) => {
    const va = jobSortValue(a, key);
    const vb = jobSortValue(b, key);
    let c = 0;
    if (typeof va === "string" || typeof vb === "string") c = String(va).localeCompare(String(vb), "th");
    else if (va !== vb) c = va - vb;
    if (!c) c = String(a.title || "").localeCompare(String(b.title || ""), "th");
    return c * dir;
  });
}

function groupedJobs(list) {
  const rows = sortedJobs(list);
  const mode = state.jobGroup || "none";
  if (mode === "none") return [{ key: "", label: "", rows }];
  const map = new Map();
  for (const job of rows) {
    const key = mode === "month" ? jobMonthKey(job.createdAt) : job.runCount ? "run" : "fresh";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(job);
  }
  const keys = [...map.keys()];
  if (mode === "status") keys.sort((a, b) => Number(b === "run") - Number(a === "run"));
  else {
    keys.sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return b.localeCompare(a);
    });
  }
  return keys.map((key) => ({
    key,
    label: mode === "status" ? (key === "run" ? "เคยค้น" : "ยังไม่ค้น") : jobMonthLabel(key),
    rows: map.get(key),
  }));
}

function jobSortHead(key, label, extra = "") {
  const on = state.jobSort === key;
  const aria = on ? (state.jobDir === "asc" ? "ascending" : "descending") : "none";
  return `<th class="${esc(extra)}" aria-sort="${aria}"><button type="button" class="th-sort" data-sort="${esc(key)}">${esc(label)}<i class="sort-caret" aria-hidden="true"></i></button></th>`;
}

function jobRowHtml(job) {
  const on = job.id === state.jobId && $("#job-modal")?.open;
  const ran = Number(job.runCount) > 0;
  const query = job.query ? `<div class="muted job-query">${esc(job.query)}</div>` : "";
  const hits = ran
    ? `<button type="button" class="job-hits" data-job-results="${esc(job.id)}">${esc(String(job.lastHitCount ?? 0))} คน</button>`
    : "—";
  const view = ran
    ? `<button type="button" class="job-view" data-job-results="${esc(job.id)}">ดูผล</button>`
    : "";
  return `<tr class="${on ? "on" : ""}" data-job="${esc(job.id)}" data-clickable tabindex="0">
    <td><strong>${esc(job.title)}</strong>${query}</td>
    <td><span class="job-pill${ran ? " is-run" : ""}">${ran ? "เคยค้น" : "ยังไม่ค้น"}</span></td>
    <td class="num col-hits">${hits}</td>
    <td class="num col-runs">${esc(String(job.runCount || 0))}</td>
    <td class="col-day col-ran">${esc(fmtJobDay(job.lastRunAt))}</td>
    <td class="col-day col-created">${esc(fmtJobDay(job.createdAt))}</td>
    <td class="col-act">${view}<button type="button" class="job-x" data-job-del="${esc(job.id)}" aria-label="ลบ ${esc(job.title)}">ลบ</button></td>
  </tr>`;
}

function paintJobCount(n) {
  const el = $("#job-count");
  if (!el) return;
  const total = state.jobsTotal || n;
  el.textContent = total ? `${total} ตำแหน่ง` : "";
}

function paintJobList() {
  const box = $("#job-table");
  if (!box) return;
  if (!isReady("jobs")) {
    box.innerHTML = waitHtml();
    return;
  }
  const list = state.jobTable || [];
  paintJobCount(list.length);
  if (!list.length) {
    const miss = Boolean(state.jobsTotal || (state.jobs || []).length || ($("#job-search")?.value || "").trim());
    box.innerHTML = miss
      ? `<div class="job-empty"><strong>ไม่พบตำแหน่งที่ตรงคำค้น</strong><p class="muted">ลองเปลี่ยนคำค้น หรือล้างช่องค้นหา</p></div>`
      : `<div class="job-empty"><strong>ยังไม่มีตำแหน่ง</strong><p class="muted">กดตำแหน่งใหม่เพื่อเปิดแฟ้ม</p></div>`;
    return;
  }
  const groups = groupedJobs(list);
  const body = groups
    .map((group) => {
      const head = group.label
        ? `<tr class="job-group"><td colspan="7">${esc(group.label)} <b>${group.rows.length}</b></td></tr>`
        : "";
      return head + group.rows.map(jobRowHtml).join("");
    })
    .join("");
  box.innerHTML = `<table class="list-table job-table">
    <thead><tr>
      ${jobSortHead("title", "ตำแหน่ง")}
      <th class="job-static">สถานะ</th>
      ${jobSortHead("hits", "ผลล่าสุด", "col-hits")}
      ${jobSortHead("runs", "รอบ", "col-runs")}
      ${jobSortHead("ran", "ค้นล่าสุด", "col-ran")}
      ${jobSortHead("created", "สร้าง", "col-created")}
      <th class="col-act"><span class="sr-only">ลบ</span></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

let jobSearchTimer = 0;
function onJobSearch() {
  state.jobsPage = 1;
  clearTimeout(jobSearchTimer);
  jobSearchTimer = setTimeout(() => loadJobTable(), 160);
}

function onJobGroup() {
  state.jobGroup = $("#job-group")?.value || "none";
  paintJobList();
}

function setJobSort(key) {
  if (!key) return;
  if (state.jobSort === key) state.jobDir = state.jobDir === "asc" ? "desc" : "asc";
  else {
    state.jobSort = key;
    state.jobDir = key === "title" ? "asc" : "desc";
  }
  paintJobList();
}

function onJobSearchKey(e) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const first = $("#job-table [data-job]");
  if (first) openJobRow(first.dataset.job);
}

function onJobListKey(e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (e.target.closest("[data-job-del], [data-job-results], [data-sort]")) return;
  const row = e.target.closest("[data-job]");
  if (!row) return;
  e.preventDefault();
  openJobRow(row.dataset.job);
}

function onJobListClick(e) {
  const sortBtn = e.target.closest("[data-sort]");
  if (sortBtn) {
    e.preventDefault();
    setJobSort(sortBtn.dataset.sort);
    return;
  }
  const del = e.target.closest("[data-job-del]");
  if (del) {
    e.preventDefault();
    e.stopPropagation();
    deleteJob(del.dataset.jobDel);
    return;
  }
  const view = e.target.closest("[data-job-results]");
  if (view) {
    e.preventDefault();
    e.stopPropagation();
    viewJobResults(view.dataset.jobResults);
    return;
  }
  const row = e.target.closest("[data-job]");
  if (!row) return;
  openJobRow(row.dataset.job);
}

function paintScoutJobs() {
  const el = $("#scout-job-list");
  if (!el) return;
  if (!isReady("jobsList")) {
    el.innerHTML = `<li>${waitHtml()}</li>`;
    return;
  }
  const jobs = state.jobs || [];
  if (!jobs.length) {
    el.innerHTML = `<li class="job-pick-empty">ยังไม่มีตำแหน่ง — กดคลังตำแหน่งเพื่อสร้าง</li>`;
    return;
  }
  el.innerHTML = jobs
    .map((job) => {
      const on = job.id === state.jobId;
      return `<li>
        <button type="button" role="option" data-job="${esc(job.id)}" aria-selected="${on ? "true" : "false"}">
          <strong>${esc(job.title)}</strong>
          <em>${esc(jobMeta(job))}</em>
        </button>
      </li>`;
    })
    .join("");
}

function paintJobUsing() {
  paintScoutJobs();
}

async function pickScoutJob(id) {
  if (!id || id === state.jobId) return;
  if (!(await askLeaveIfDirty(isPanelDirty("scout")))) return;
  await fillJob(id);
}

function resetJobForm() {
  state.jobId = null;
  if ($("#job-edit-title")) $("#job-edit-title").value = "";
  if ($("#job-edit-notes")) $("#job-edit-notes").value = "";
  if ($("#job-edit-desc")) $("#job-edit-desc").value = "";
  if ($("#job-detail-head")) $("#job-detail-head").textContent = "ตำแหน่งใหม่";
  if ($("#job-kind")) $("#job-kind").textContent = "ตำแหน่งใหม่";
  if ($("#job-sub")) $("#job-sub").textContent = "ตั้งชื่อ ความรับผิดชอบ แล้วสร้าง job description";
  setHint($("#job-detail-msg"), "");
  if ($("#job-del")) $("#job-del").hidden = true;
  hideJdCompare(true);
  paintJobRuns([]);
  paintJobList();
  paintJobUsing();
  syncJobResultBtn();
  markPanelClean("jobs");
  showJobTab("notes");
}

async function newJob(opts = {}) {
  if (!opts.skipDirty && !(await askLeaveIfDirty(isJobModalDirty()))) return;
  resetJobForm();
  const dlg = $("#job-modal");
  if (dlg && !dlg.open) dlg.showModal();
  showJobTab("notes");
  markJobModalClean();
  $("#job-edit-title")?.focus();
}

async function requestCloseJobModal() {
  if (!(await askLeaveIfDirty(isJobModalDirty()))) return;
  $("#job-modal")?.close();
}

function bindJobModal() {
  $("#job-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveJob();
  });
  $("#job-dismiss")?.addEventListener("click", () => requestCloseJobModal());
  $("#job-modal")?.addEventListener("cancel", (e) => {
    if (choiceOpen) {
      e.preventDefault();
      closeChoice();
      return;
    }
    if (!isJobModalDirty()) return;
    e.preventDefault();
    requestCloseJobModal();
  });
  $("#job-modal")?.addEventListener("close", () => {
    closeChoice();
    paintJobList();
  });
}

async function openJobRow(id) {
  if (!id) return;
  if (id === state.jobId && $("#job-modal")?.open) return;
  if (!(await askLeaveIfDirty(isJobModalDirty()))) return;
  await fillJob(id, { keepText: true });
  const dlg = $("#job-modal");
  if (dlg && !dlg.open) dlg.showModal();
  showJobTab("notes");
  markJobModalClean();
}

async function deleteJob(id) {
  const job = (state.jobs || state.jobTable || []).find((row) => row.id === id);
  const title = job?.title || "ตำแหน่งนี้";
  const fromModal = Boolean($("#job-modal")?.open && state.jobId === id);
  if (fromModal) $("#job-modal")?.close();
  const ok = await askModal({
    title: "ลบตำแหน่งนี้?",
    body: `ลบ “${title}” รวมประวัติค้นของตำแหน่ง — ผู้สมัครในท่อยังอยู่`,
    ok: "ลบตำแหน่ง",
    no: "ไม่ลบ",
    danger: true,
  });
  if (!ok) {
    if (fromModal) openJobRow(id);
    return;
  }
  await api(`/api/jobs/${id}`, { method: "DELETE" });
  state.jobs = (state.jobs || []).filter((row) => row.id !== id);
  if (state.jobId === id) {
    state.jobId = null;
    resetJobForm();
  }
  await loadJobs().catch(() => {});
  await loadJobTable().catch(() => {});
}

function showJobTab(id) {
  const bar = $("#job-tabs");
  if (bar) showPageTab(bar, id);
}

function paintJobRuns(runs) {
  const box = $("#job-runs");
  const tab = document.querySelector("#job-tabs [data-ptab=runs]");
  if (!box) return;
  const rows = runs || [];
  if (tab) tab.hidden = !rows.length;
  if (!rows.length) {
    box.innerHTML = "";
    if (tab?.classList.contains("on")) showJobTab("notes");
    return;
  }
  box.innerHTML = rows
    .map((run) => {
      const when = String(run.createdAt || "").slice(0, 16).replace("T", " ");
      const query = run.query ? ` · ${run.query}` : "";
      return `<li>${esc(when)} · ${esc(String(run.hitCount ?? 0))} คน${esc(query)}</li>`;
    })
    .join("");
}

async function fillJob(id, opt = {}) {
  const data = await api(`/api/jobs/${id}`);
  state.jobId = data.job.id;
  if (!opt.keepText) {
    if ($("#jd-title")) $("#jd-title").value = data.job.title || "";
    if ($("#jd-notes")) $("#jd-notes").value = data.job.notes || data.job.description || "";
    if ($("#jd-text")) $("#jd-text").value = data.job.description || "";
  }
  if ($("#job-edit-title")) $("#job-edit-title").value = data.job.title || "";
  if ($("#job-edit-notes")) $("#job-edit-notes").value = data.job.notes || data.job.description || "";
  if ($("#job-edit-desc")) $("#job-edit-desc").value = data.job.description || "";
  if ($("#job-detail-head")) $("#job-detail-head").textContent = data.job.title || "ตำแหน่ง";
  if ($("#job-kind")) $("#job-kind").textContent = "แก้ไขตำแหน่ง";
  if ($("#job-sub")) $("#job-sub").textContent = "แก้รายละเอียดแล้วบันทึก ดูผลค้นหาเดิม หรือค้นหาใหม่";
  if ($("#job-del")) $("#job-del").hidden = false;
  if (!opt.keepText) setHint($("#job-detail-msg"), "");
  if (!opt.keepText) {
    hideJdCompare(true);
    hideJdCompare(false);
  }
  paintJobRuns(data.runs || []);
  paintJobList();
  paintJobUsing();
  syncJobResultBtn(data.runs);
  markPanelClean("jobs");
  markPanelClean("scout");
  if ($("#job-modal")?.open) markJobModalClean();
  loadScoutStatus(state.jobId).catch(() => {});
}

function syncJobResultBtn(runs) {
  const job =
    (state.jobs || []).find((row) => row.id === state.jobId) ||
    (state.jobTable || []).find((row) => row.id === state.jobId);
  const ran = Number(job?.runCount) > 0 || (Array.isArray(runs) && runs.length > 0);
  const results = $("#job-results");
  const useBtn = $("#job-use");
  if (results) results.hidden = !ran;
  if (useBtn) useBtn.textContent = ran ? "ค้นหาใหม่" : "ใช้ค้นหา";
}

async function viewJobResults(id) {
  if (!id) return;
  if (!(await askLeaveIfDirty(isJobModalDirty()))) return;
  $("#job-modal")?.close();
  markJobModalClean();
  await fillJob(id);
  await showTab("scout", { skipDirty: true });
  openPageTab("scout", "results");
  await loadScoutStatus(id);
  if (!scoutBusyHere() && !(state.shortlist || []).length) {
    $("#scout-meta").textContent = "ยังไม่มีรายชื่อจากรอบค้นนี้";
  }
}

function setHint(el, text, alert) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-alert", Boolean(alert && text));
}

function jobErrorTh(code) {
  const map = {
    invalid_body: "ใส่ชื่อตำแหน่ง และความรับผิดชอบหรือ job description อย่างน้อยหนึ่งบรรทัด",
    llm_rate_limited: "โมเดลเรียกถี่ไป ลองใหม่ในอีกนาที",
    llm_not_configured: "ยังไม่ได้ตั้งค่าโมเดลที่ ตั้งค่า → โมเดล",
    llm_bad_json: "โมเดลเขียน job description ไม่ครบ ลองใหม่อีกครั้ง",
    llm_upstream: "โมเดลตอบไม่ได้ ลองใหม่",
    rate_limited: "ถี่ไป รอสักครู่แล้วลองใหม่",
  };
  return map[String(code || "").split(":")[0]] || code || "ทำรายการไม่สำเร็จ";
}

async function useJob() {
  const saved = await saveJob();
  if (!saved) return;
  markJobModalClean();
  markPanelClean("jobs");
  if ($("#job-edit-title") && $("#jd-title")) $("#jd-title").value = $("#job-edit-title").value;
  if ($("#job-edit-notes") && $("#jd-notes")) $("#jd-notes").value = $("#job-edit-notes").value;
  if ($("#job-edit-desc") && $("#jd-text")) $("#jd-text").value = $("#job-edit-desc").value;
  hideJdCompare(false);
  $("#job-modal")?.close();
  paintJobUsing();
  await showTab("scout", { skipDirty: true });
  openPageTab("scout", "query");
}

async function saveJob() {
  const msg = $("#job-detail-msg");
  const title = $("#job-edit-title")?.value.trim() || "";
  const notes = $("#job-edit-notes")?.value.trim() || "";
  const description = $("#job-edit-desc")?.value.trim() || notes;
  setHint(msg, "");
  if (title.length < 2) {
    setHint(msg, "ใส่ชื่อตำแหน่งอย่างน้อย 2 ตัวอักษร", true);
    return false;
  }
  if (description.length < 10) {
    setHint(msg, "ใส่ความรับผิดชอบหรือ job description อย่างน้อยหนึ่งบรรทัด", true);
    if (!notes) showJobTab("notes");
    return false;
  }
  try {
    if (!state.jobId) {
      const data = await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ title, description, notes }),
      });
      state.jobId = data.id;
    } else {
      await api(`/api/jobs/${state.jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, notes, description }),
      });
    }
    setHint(msg, "บันทึกแล้ว");
    await loadJobs();
    await loadJobTable().catch(() => {});
    if (state.jobId) await fillJob(state.jobId, { keepText: true });
    if ($("#job-del")) $("#job-del").hidden = !state.jobId;
    markJobModalClean();
    return true;
  } catch (err) {
    setHint(msg, jobErrorTh(err.message) || "บันทึกไม่สำเร็จ", true);
    return false;
  }
}

function jobIdForTitle(title) {
  const key = (title || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return null;
  const hit = (state.jobs || []).find((row) => (row.title || "").trim().replace(/\s+/g, " ").toLowerCase() === key);
  return hit?.id || null;
}

function jdScope(onJobs) {
  return {
    live: onJobs ? $("#job-edit-desc") : $("#jd-text"),
    compare: onJobs ? $("#job-jd-compare") : $("#scout-jd-compare"),
    old: onJobs ? $("#job-jd-old") : $("#scout-jd-old"),
    draft: onJobs ? $("#job-jd-draft") : $("#scout-jd-draft"),
    host: onJobs ? $("#job-modal") : document.querySelector(".search-panel"),
  };
}

function hideJdCompare(onJobs) {
  const box = jdScope(onJobs);
  if (box.compare) box.compare.hidden = true;
  box.host?.classList.remove("is-comparing");
}

function showJdCompare(onJobs, current, draft) {
  const box = jdScope(onJobs);
  if (!box.compare) return;
  if (box.old) box.old.textContent = current;
  if (box.draft) box.draft.value = draft;
  box.compare.hidden = false;
  box.host?.classList.add("is-comparing");
}

function applyJdDraft(onJobs) {
  const box = jdScope(onJobs);
  if (box.live) box.live.value = box.draft?.value || "";
  hideJdCompare(onJobs);
}

function dropJdDraft(onJobs) {
  hideJdCompare(onJobs);
}

function showScoutWriteTab(id) {
  const bar = $("#scout-write-tabs");
  if (bar) showPageTab(bar, id);
}

function typewriter(el) {
  let pending = "";
  let shown = "";
  let raf = 0;
  const waiters = [];
  const settle = () => {
    while (waiters.length) waiters.pop()();
  };
  const paint = () => {
    raf = 0;
    if (!el) {
      settle();
      return;
    }
    if (shown.length >= pending.length) {
      settle();
      return;
    }
    const remain = pending.length - shown.length;
    const n = remain > 280 ? 10 : remain > 60 ? 4 : 2;
    shown = pending.slice(0, shown.length + n);
    el.value = shown;
    el.scrollTop = el.scrollHeight;
    if (shown.length < pending.length) raf = requestAnimationFrame(paint);
    else settle();
  };
  return {
    push(text) {
      pending += text;
      if (!el) return;
      if (!motionOk()) {
        shown = pending;
        el.value = shown;
        el.scrollTop = el.scrollHeight;
        settle();
        return;
      }
      if (!raf) raf = requestAnimationFrame(paint);
    },
    flush() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      shown = pending;
      if (el) {
        el.value = shown;
        el.scrollTop = el.scrollHeight;
      }
      settle();
    },
    done() {
      if (shown.length >= pending.length) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

async function readNdjson(res, onRow) {
  if (!res.body) throw new Error("request_failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      onRow(JSON.parse(t));
    }
  }
  const tail = buf.trim();
  if (tail) onRow(JSON.parse(tail));
}

function applyGeneratedJob(onJobs, current, data, hint) {
  state.jobId = data.job.id;
  if ($("#jd-title")) $("#jd-title").value = data.job.title;
  if ($("#job-edit-title")) $("#job-edit-title").value = data.job.title;
  const draft = (data.draft || data.job.description || "").trim();
  if (data.applied || !current) {
    if ($("#jd-text")) $("#jd-text").value = draft;
    if ($("#job-edit-desc")) $("#job-edit-desc").value = draft;
    hideJdCompare(onJobs);
    setHint(hint, "ใส่ job description แล้ว ตรวจได้ก่อนค้นหรือบันทึก");
  } else {
    showJdCompare(onJobs, current, draft);
    setHint(hint, "เทียบแบบร่างกับของเดิม แล้วเลือกใช้หรือคงของเดิม");
  }
}

async function draftJob(ev) {
  if (!state.aiReady) return;
  const onJobs = ev?.currentTarget?.id === "job-draft" || Boolean($("#job-modal")?.open);
  const btn = onJobs ? $("#job-draft") : $("#jd-draft");
  const title = ((onJobs ? $("#job-edit-title") : $("#jd-title"))?.value || "").trim();
  const notes = ((onJobs ? $("#job-edit-notes") : $("#jd-notes"))?.value || "").trim();
  const hint = onJobs ? $("#job-detail-msg") : $("#scout-gen-hint");
  const current = ((onJobs ? $("#job-edit-desc") : $("#jd-text"))?.value || "").trim();
  if (title.length < 2 || notes.length < 10) {
    setHint(hint, "ใส่ชื่องานและความรับผิดชอบอย่างน้อยหนึ่งบรรทัด", true);
    if (onJobs) showJobTab("notes");
    else showScoutWriteTab("notes");
    return;
  }
  if (onJobs) showJobTab("desc");
  else showScoutWriteTab("desc");
  const box = jdScope(onJobs);
  const live = current ? box.draft : box.live;
  if (current) showJdCompare(onJobs, current, "");
  else {
    hideJdCompare(onJobs);
    if (live) live.value = "";
  }
  live?.classList.add("is-streaming");
  live?.setAttribute("aria-busy", "true");
  setHint(hint, "กำลังร่าง job description…");
  btn?.classList.add("is-wait");
  if (btn) btn.disabled = true;
  const typer = typewriter(live);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let donePayload = null;
  try {
    const res = await fetch("/api/jobs/generate-stream", {
      method: "POST",
      credentials: "same-origin",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, notes, jobId: state.jobId || jobIdForTitle(title) || undefined }),
    });
    if (res.status === 401) {
      location.href = "/";
      return;
    }
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok || !ctype.includes("ndjson")) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "request_failed");
    }
    await readNdjson(res, (row) => {
      if (row.type === "status" && hint && !donePayload) setHint(hint, row.text || hint.textContent);
      if (row.type === "delta" && row.text) {
        setHint(hint, "กำลังพิมพ์…");
        typer.push(row.text);
      }
      if (row.type === "error") throw new Error(row.error || "llm_upstream");
      if (row.type === "done") donePayload = row;
    });
    await typer.done();
    if (!donePayload?.job) throw new Error("llm_bad_json");
    applyGeneratedJob(onJobs, current, donePayload, hint);
    await loadJobs();
    await loadJobTable().catch(() => {});
    paintJobUsing();
    if ($("#job-modal")?.open) markJobModalClean();
  } catch (err) {
    typer.flush();
    const aborted = err?.name === "AbortError" || /abort/i.test(String(err?.message || ""));
    const text = aborted ? "โมเดลตอบช้า ลองใหม่อีกครั้ง" : jobErrorTh(err.message) || "สร้าง job description ไม่สำเร็จ";
    setHint(hint, text, true);
  } finally {
    clearTimeout(timer);
    live?.classList.remove("is-streaming");
    live?.removeAttribute("aria-busy");
    btn?.classList.remove("is-wait");
    if (btn) btn.disabled = false;
  }
}

async function addJob() {
  try {
    await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        title: $("#new-job-title").value.trim(),
        description: $("#new-job-desc").value.trim(),
      }),
    });
    $("#new-job-title").value = "";
    await loadJobs();
  } catch (err) {
    await notifyModal("เพิ่มตำแหน่งไม่สำเร็จ", err.message);
  }
}

const SOURCE_ON = {
  thai_code: "self",
  community: "self",
  apify_web: "shop",
  linkedin: "shop",
  job_boards: "link",
};

function onModeFor(id) {
  return SOURCE_ON[id] || "self";
}

function shopLocked(id) {
  return SOURCE_ON[id] === "shop" && !state.hasShopKey;
}

async function loadSourceLanes() {
  const data = await api("/api/scout/sources");
  state.lanes = data.lanes;
  state.analysis = data.analysis;
  state.sourceModes = data.modes || state.sourceModes;
  state.hasShopKey = Boolean(data.hasShopKey);
  state.sourceGroups = data.groups || [];
  paintSourcePicks();
  if (!state.shortlist.length) await loadLatestShortlist();
}

function paintSourcePicks() {
  const root = $("#source-picks");
  if (!root) return;
  const groups = state.sourceGroups.length
    ? state.sourceGroups
    : Object.keys(SOURCE_ON).map((id) => ({ id, label: id, hint: "", on: false, fetch: false }));
  root.innerHTML = groups
    .map((group) => {
      const locked = shopLocked(group.id);
      const on = !locked && (state.sourceModes?.[group.id] || "off") !== "off";
      const kind = locked ? "ใส่คีย์" : "";
      const title = locked ? "ใส่คีย์ Apify ที่ตั้งค่าก่อน จึงจะเปิดแหล่งนี้ได้" : group.hint || "";
      return `<button type="button" class="src-pick${on ? " on" : ""}${locked ? " is-locked" : ""}" data-src="${esc(group.id)}"${locked ? " disabled aria-disabled=\"true\"" : ""} title="${esc(title)}">${esc(group.label)}${kind ? `<em>${kind}</em>` : ""}</button>`;
    })
    .join("");
  root.onclick = (e) => {
    const btn = e.target.closest("[data-src]");
    if (!btn || btn.disabled || shopLocked(btn.dataset.src)) return;
    const id = btn.dataset.src;
    const cur = state.sourceModes?.[id] || "off";
    state.sourceModes = { ...(state.sourceModes || {}), [id]: cur === "off" ? onModeFor(id) : "off" };
    paintSourcePicks();
    paintSourceHint();
  };
  paintSourceHint();
  paintSourceCaption(groups);
  root.onmouseover = (e) => {
    const btn = e.target.closest("[data-src]");
    if (!btn) return;
    const group = groups.find((row) => row.id === btn.dataset.src);
    const cap = $("#source-caption");
    if (group && cap) {
      cap.textContent = `${group.label} · ${sourceKindLabel(group.id)} — ${group.hint || ""}`;
    }
  };
  root.onmouseleave = () => paintSourceCaption(groups);
}

function sourceKindLabel(id) {
  if (shopLocked(id)) return "ใส่คีย์ Apify ก่อน";
  const mode = state.sourceModes?.[id] || "off";
  if (mode === "off") return "ปิดอยู่";
  return "เปิดอยู่";
}

function paintSourceCaption(groups) {
  const cap = $("#source-caption");
  if (!cap) return;
  const rows = groups || state.sourceGroups || [];
  const locked = rows.filter((group) => shopLocked(group.id));
  if (locked.length) {
    cap.textContent = "ใส่คีย์ Apify ที่ตั้งค่าก่อน จึงจะเปิด LinkedIn และค้นเว็บได้";
    return;
  }
  const on = rows.filter((group) => (state.sourceModes?.[group.id] || "off") !== "off");
  if (!on.length) {
    cap.textContent = "เลือกอย่างน้อยหนึ่งแหล่งก่อนค้น";
    return;
  }
  cap.textContent = "ชี้ที่ชิปเพื่อดูว่าแต่ละแหล่งดึงจากไหน";
}

function paintSourceHint() {
  const hint = $("#source-hint");
  const note = $("#source-analysis");
  const modes = usableSourceModes();
  const on = Object.entries(modes).filter(([, mode]) => mode !== "off");
  const text = !on.length
    ? "เลือกอย่างน้อยหนึ่งแหล่งก่อนค้น"
    : `เปิด ${on.length} แหล่ง`;
  if (hint) hint.textContent = text;
  if (note) note.textContent = state.analysis?.headline || text;
}

function paintResultFilters(hits) {
  const root = $("#result-filters");
  if (!root) return;
  const rows = hits || [];
  const counts = new Map();
  for (const hit of rows) {
    const id = hit.source || "other";
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (state.shortFilter !== "all" && !counts.has(state.shortFilter)) state.shortFilter = "all";
  const filters = [["all", "ทั้งหมด", rows.length], ...[...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([id, n]) => [id, sourceName(id), n])];
  root.hidden = rows.length === 0;
  root.innerHTML = filters
    .map(([id, label, n]) => {
      const on = state.shortFilter === id ? " on" : "";
      return `<button type="button" class="page-tab${on}" data-src-filter="${esc(id)}">${esc(label)} <em>${n}</em></button>`;
    })
    .join("");
}

async function loadLatestShortlist() {
  if (!isReady("shortlist")) {
    const box = $("#shortlist");
    if (box) box.innerHTML = waitHtml();
  }
  try {
    const data = await api("/api/scout/latest?origin=thai");
    state.shortlist = data.shortlist || [];
    if (!state.jobId && data.jobId) {
      state.jobId = data.jobId;
      await fillJob(data.jobId).catch(() => {});
    }
    if (data.shortlist?.length) {
      $("#scout-meta").textContent = `รอบล่าสุด · ${data.shortlist.length} คน${data.title ? ` · ${data.title}` : ""}`;
      if ($("#result-count")) $("#result-count").textContent = `${data.shortlist.length} คน`;
      if ($("#result-tab-count")) $("#result-tab-count").textContent = String(data.shortlist.length);
    }
  } catch {
    state.shortlist = state.shortlist || [];
  } finally {
    markReady("shortlist");
    paintShortlist(state.shortlist);
  }
}

function sourceName(id) {
  const all = [...(state.lanes?.live || []), ...(state.lanes?.hr_click || []), ...(state.lanes?.blocked || [])];
  return all.find((row) => row.id === id)?.label || id;
}

function usableSourceModes() {
  const modes = { ...(state.sourceModes || {}) };
  for (const id of Object.keys(SOURCE_ON)) {
    if (shopLocked(id)) modes[id] = "off";
  }
  return modes;
}

const SCOUT_PIPE = ["ตั้งคำค้น", "ดึงโปรไฟล์", "กรองคน", "ให้ AI คัด", "จัดอันดับ"];

function currentScoutJd() {
  return (($("#jd-text")?.value || "").trim() || ($("#jd-notes")?.value || "").trim());
}

function scoutRunFor(jobId) {
  if (!jobId) return null;
  return (state.scoutRuns || {})[jobId] || null;
}

function scoutBusyHere() {
  const run = scoutRunFor(state.jobId);
  if (!run || (run.status !== "queued" && run.status !== "running")) return false;
  const jd = currentScoutJd();
  if (run.jd && jd !== run.jd) return false;
  return true;
}

function syncScoutSearchBtn() {
  const btn = $("#jd-search");
  if (!btn) return;
  const busy = scoutBusyHere();
  btn.disabled = busy || !state.aiReady;
  btn.classList.toggle("is-wait", busy);
  state.scoutActive = busy;
}

function setAiReady(data) {
  const selected = (data?.providers || []).find((row) => row.id === data?.provider);
  state.aiReady = Boolean(selected?.configured);
  syncAiLocks();
}

function syncAiLocks() {
  const ready = Boolean(state.aiReady);
  for (const id of ["jd-draft", "job-draft", "screen-go", "pack-btn"]) {
    const btn = $(`#${id}`);
    if (!btn || btn.classList.contains("is-wait")) continue;
    btn.disabled = !ready;
  }
  syncScoutSearchBtn();
}

function paintScoutPipe(step) {
  const el = $("#scout-pipe");
  if (!el) return;
  const map = { query: 0, fetch: 1, filter: 2, rank: 3, save: 4 };
  let idx = step in map ? map[step] : -1;
  if (idx < 0 && scoutBusyHere()) idx = 0;
  const finished =
    !scoutBusyHere() && (step === "save" || (state.scoutLog || []).some((row) => row.state === "done"));
  el.innerHTML = SCOUT_PIPE.map((label, i) => {
    const cls = finished || i < idx ? "is-done" : i === idx ? "is-on" : "";
    const mark = i === idx || finished || i < idx ? "" : String(i + 1);
    return `<li class="${cls}"><span class="dot">${esc(mark)}</span><span class="label">${esc(label)}</span></li>`;
  }).join("");
}

function setScoutNext(text) {
  const el = $("#scout-next");
  if (el) el.textContent = text ? `ต่อไป · ${text}` : scoutBusyHere() ? "ต่อไป · ยังมีขั้นดึง กรอง และให้ AI คัด" : "";
}

async function runScout() {
  if (!state.aiReady) return;
  const modes = usableSourceModes();
  if (!Object.values(modes).some((mode) => mode && mode !== "off")) {
    if ($("#scout-meta")) $("#scout-meta").textContent = "เลือกอย่างน้อยหนึ่งแหล่งก่อนค้น";
    return;
  }
  const jd = currentScoutJd();
  if (!jd) {
    if ($("#scout-meta")) $("#scout-meta").textContent = "ใส่โน้ตงาน หรือสร้าง job description ก่อน";
    return;
  }
  state.scoutLog = [];
  state.scoutRunId = null;
  state.shortFilter = "all";
  paintScoutLog();
  const gen = $("#scout-gen-hint");
  if (gen) gen.textContent = "";
  if ($("#scout-progress")) $("#scout-progress").hidden = false;
  $("#scout-meta").textContent = "เข้าคิวแล้ว · ดูความคืบหน้าที่แท็บผล";
  $("#shortlist").innerHTML = waitHtml();
  if ($("#result-count")) $("#result-count").textContent = "กำลังค้น";
  if ($("#result-tab-count")) $("#result-tab-count").textContent = "…";
  paintScoutPipe("query");
  setScoutNext("ตั้งคำค้นจาก job description");
  openPageTab("scout", "results");
  const btn = $("#jd-search");
  btn?.classList.add("is-wait");
  if (btn) btn.disabled = true;
  try {
    const data = await api("/api/scout/search", {
      method: "POST",
      body: JSON.stringify({
        title: $("#jd-title").value,
        jd,
        jobId: state.jobId || jobIdForTitle($("#jd-title")?.value) || undefined,
        origin: "thai",
        modes,
      }),
    });
    state.jobId = data.jobId || state.jobId;
    state.scoutRunId = data.runId;
    state.scoutRuns = state.scoutRuns || {};
    state.scoutRuns[state.jobId] = {
      runId: data.runId,
      jobId: data.jobId,
      jd,
      jdHash: data.jdHash,
      status: data.status || "queued",
      log: data.log || [],
    };
    if (data.log?.length) {
      state.scoutLog = data.log;
    } else {
      pushScoutLog({
        state: "run",
        via: "queue",
        message: "เข้าคิวแล้ว · รอตัวดึงเริ่มงาน",
        next: "ตั้งคำค้นจาก job description",
      });
    }
    paintScoutLog();
    openPageTab("scout", "results");
  } catch (err) {
    $("#scout-meta").textContent = err.message || "ค้นไม่สำเร็จ";
    if ($("#result-count")) $("#result-count").textContent = "ค้นไม่สำเร็จ";
    markReady("shortlist");
    paintShortlist(state.shortlist || []);
  }
  syncScoutSearchBtn();
  await loadJobs().catch(() => {});
}

async function loadScoutStatus(jobId) {
  if (!jobId) {
    paintScoutPipe("");
    syncScoutSearchBtn();
    return;
  }
  try {
    const data = await api(`/api/scout/status?jobId=${encodeURIComponent(jobId)}`);
    if (!data.run) {
      syncScoutSearchBtn();
      return;
    }
    state.scoutRuns = state.scoutRuns || {};
    state.scoutRuns[jobId] = {
      runId: data.run.id,
      jobId,
      jdHash: data.run.jdHash,
      status: data.run.status,
      log: data.run.log || [],
      jd: scoutRunFor(jobId)?.jd || currentScoutJd(),
    };
    if (jobId !== state.jobId) {
      syncScoutSearchBtn();
      return;
    }
    state.scoutRunId = data.run.id;
    state.scoutLog = data.run.log || [];
    if (state.scoutLog.length && $("#scout-progress")) $("#scout-progress").hidden = false;
    paintScoutLog();
    paintScoutPipe(data.run.step);
    const last = state.scoutLog[state.scoutLog.length - 1];
    setScoutNext(last?.next || "");
    if (data.run.status === "queued" || data.run.status === "running") {
      openPageTab("scout", "results");
    }
    if (data.run.status === "done") {
      if (data.run.query && $("#scout-gen-hint")) $("#scout-gen-hint").textContent = `คำค้นที่โมเดลตั้ง: ${data.run.query}`;
      if (data.shortlist?.length) {
        state.shortlist = data.shortlist;
        markReady("shortlist");
        paintShortlist(data.shortlist);
        if ($("#result-count")) $("#result-count").textContent = `${data.shortlist.length} คน`;
        if ($("#result-tab-count")) $("#result-tab-count").textContent = String(data.shortlist.length);
        $("#scout-meta").textContent = `คำค้น: ${data.run.query || "—"} · ${data.shortlist.length} คน`;
      }
    } else if (data.run.status === "failed") {
      $("#scout-meta").textContent = data.run.error || "ค้นไม่สำเร็จ";
    } else if (data.run.status === "queued" || data.run.status === "running") {
      $("#shortlist").innerHTML = waitHtml();
      if (last?.message) $("#scout-meta").textContent = last.message;
    }
  } catch {
    /* keep local run state */
  }
  syncScoutSearchBtn();
}

async function finishScoutRun(jobId) {
  if (jobId && jobId === state.jobId) {
    await loadScoutStatus(jobId);
    openPageTab("scout", "results");
  }
  syncScoutSearchBtn();
}

function paintShortlist(hits) {
  const box = $("#shortlist");
  if (!box) return;
  if (scoutBusyHere()) {
    box.innerHTML = waitHtml();
    return;
  }
  if (!isReady("shortlist") && !(hits || []).length) {
    box.innerHTML = waitHtml();
    return;
  }
  const all = hits || [];
  paintResultFilters(all);
  const shown = state.shortFilter === "all" ? all : all.filter((hit) => hit.source === state.shortFilter);
  if ($("#result-count")) {
    $("#result-count").textContent =
      state.shortFilter === "all" || shown.length === all.length
        ? all.length
          ? `${all.length} คน`
          : "ยังไม่ได้ค้น"
        : `${shown.length} จาก ${all.length} คน · ${sourceName(state.shortFilter)}`;
  }
  box.innerHTML = shown
    .map((hit) => {
      const score = typeof hit.fitScore === "number" ? hit.fitScore : null;
      const pick = score === null || score >= 5;
      return `<label class="hit-card">
          <input type="checkbox" value="${hit.id}" ${pick ? "checked" : ""}>
          <div>
            <div class="hit-top">
              <strong>${esc(hit.displayName)}</strong>
              <span class="pill">${score ?? "–"} · ${esc(sourceName(hit.source))}</span>
            </div>
            ${hit.headline ? `<p class="muted hit-head">${esc(hit.headline)}</p>` : ""}
            ${hit.reason ? `<p class="hit-why">${esc(hit.reason)}</p>` : ""}
            <div class="hit-links">
              ${
                hit.profileUrl
                  ? `<a href="${esc(hit.profileUrl)}" target="_blank" rel="noopener">โปรไฟล์</a>`
                  : `<span class="muted">ไม่มีลิงก์โปรไฟล์</span>`
              }
              ${hit.portfolioUrl ? `<a href="${esc(hit.portfolioUrl)}" target="_blank" rel="noopener">พอร์ตส่วนตัว</a>` : ""}
            </div>
          </div>
        </label>`;
    })
    .join("") || `<p class="muted">${all.length ? "แหล่งนี้ไม่มีคนในรอบนี้" : "ยังไม่มีผลค้นหา — กดค้นหาด้านบน"}</p>`;
}

const SCOUT_STATE = {
  run: "ดึง",
  ok: "ได้",
  empty: "ว่าง",
  fail: "พลาด",
  skip: "ไม่ดึง",
  done: "พร้อม",
  rank: "คัด",
  link: "ลิงก์",
  wait: "รอ",
};

const SCOUT_VIA = {
  queue: "คิว",
  llm: "โมเดล",
  apify: "Apify",
  public: "API",
};

function paintScoutNow() {
  const el = $("#scout-now");
  if (!el) return;
  if (!scoutBusyHere()) {
    el.textContent = "";
    return;
  }
  const rows = state.scoutLog || [];
  const last = [...rows].reverse().find((row) => row.state === "run" || row.state === "rank") || rows[rows.length - 1];
  el.textContent = last?.message || "กำลังค้น…";
}

function paintScoutSources() {
  const el = $("#scout-sources");
  if (!el) return;
  const live = state.lanes?.live || [];
  const bySource = {};
  for (const row of state.scoutLog || []) {
    if (row.source) bySource[row.source] = row;
  }
  const ids = [...new Set([...live.map((card) => card.id), ...Object.keys(bySource)])];
  const liveOn = scoutBusyHere();
  const sum = $("#scout-sources-sum");
  const running = ids.find((id) => bySource[id]?.state === "run");
  const liCount = bySource.linkedin && typeof bySource.linkedin.count === "number" ? bySource.linkedin.count : null;
  if (sum) {
    if (liveOn && running) sum.textContent = `กำลังดึง ${sourceName(running)}`;
    else if (typeof liCount === "number") sum.textContent = `LinkedIn ${liCount} · ${ids.length} แหล่ง`;
    else if (ids.length) sum.textContent = `${ids.length} แหล่ง`;
    else sum.textContent = "ยังไม่เริ่ม";
  }
  if (!ids.length) {
    el.innerHTML = `<li class="is-skip">รอเริ่มดึงแหล่ง</li>`;
    return;
  }
  const html = ids
    .map((id) => {
      const card = live.find((row) => row.id === id);
      const row = bySource[id];
      const st = row?.state || (liveOn ? "wait" : "");
      if (!st) return "";
      const name = card?.label || sourceName(id);
      const via = SCOUT_VIA[row?.via] || (id === "linkedin" || id === "apify_web" ? SCOUT_VIA.apify : SCOUT_VIA.public);
      const spin = liveOn && st === "run" ? `<span class="spin" aria-hidden="true"></span>` : "";
      const count = typeof row?.count === "number" ? `<em>${row.count}</em>` : "";
      return `<li class="is-${esc(st)}">${spin}<span>${esc(name)}</span><em>${esc(via)}</em>${count}</li>`;
    })
    .join("");
  el.innerHTML = html || `<li class="is-skip">รอเริ่มดึงแหล่ง</li>`;
}

function paintScoutLog() {
  const box = $("#scout-log");
  if (!box) return;
  const rows = state.scoutLog || [];
  const progress = $("#scout-progress");
  if (progress) progress.hidden = false;
  if (!$("#scout-pipe")?.children.length) paintScoutPipe("");
  const lastLive = [...rows].reverse().find((row) => row.state === "run" || row.state === "rank");
  const liveOn = scoutBusyHere();
  box.innerHTML = rows
    .map((row) => {
      const live = liveOn && row === lastLive;
      const mark = SCOUT_STATE[row.state] || row.state;
      const spin = live ? `<span class="spin" aria-hidden="true"></span>` : "";
      const via = SCOUT_VIA[row.via] ? `<span class="via">${esc(SCOUT_VIA[row.via])}</span>` : "";
      return `<li class="${live ? "is-live" : ""}">${via}<span class="st ${esc(live ? "run" : row.state)}">${spin}${esc(mark)}</span><span>${esc(row.message)}</span></li>`;
    })
    .join("");
  box.scrollTop = box.scrollHeight;
  paintScoutNow();
  paintScoutSources();
}

function pushScoutLog(ev) {
  if (!ev?.message) return;
  state.scoutLog = state.scoutLog || [];
  const key = `${ev.source || ""}:${ev.state}:${ev.message}`;
  if (state.scoutLog.some((r) => `${r.source || ""}:${r.state}:${r.message}` === key)) return;
  state.scoutLog.push({
    source: ev.source,
    state: ev.state || "run",
    message: ev.message,
    count: ev.count,
    next: ev.next,
    via: ev.via,
  });
  if (state.scoutLog.length > 40) state.scoutLog = state.scoutLog.slice(-40);
  paintScoutLog();
  if (ev.next) setScoutNext(ev.next);
  const step = ev.step || (ev.state === "rank" ? "rank" : ev.state === "done" ? "save" : ev.state === "run" ? "fetch" : "");
  if (step) paintScoutPipe(step);
}

async function approveSelected() {
  const ids = [...document.querySelectorAll("#shortlist input:checked")].map((n) => n.value);
  if (!ids.length) return;
  await api("/api/scout/approve", { method: "POST", body: JSON.stringify({ ids }) });
  await loadBoard();
  $("#scout-meta").textContent = `ส่งเป็นผู้สมัครแล้ว ${ids.length} คน`;
  await showTab("board", { skipDirty: true });
}

async function approveAllHits() {
  document.querySelectorAll("#shortlist input[type=checkbox]").forEach((el) => {
    el.checked = true;
  });
  await approveSelected();
}

function contactGaps(c = {}) {
  if (Array.isArray(c.missing) && c.missing.length) return c.missing;
  const missing = [];
  const name = c.displayName || c.display_name || "";
  const email = c.email || "";
  if (!name || name === PLACEHOLDER_NAME) missing.push("name");
  if (!String(email).includes("@")) missing.push("email");
  return missing;
}

function maybeOpenGap(candidateId, candidate) {
  if (!candidateId || state.gapSeen.has(candidateId)) return;
  if (!contactGaps(candidate).length) return;
  state.gapSeen.add(candidateId);
  state.gapCandidateId = candidateId;
  const name = candidate?.displayName || candidate?.display_name || "";
  const nameEl = $("#gap-name");
  const emailEl = $("#gap-email");
  const phoneEl = $("#gap-phone");
  const msg = $("#gap-msg");
  if (nameEl) nameEl.value = !name || name === PLACEHOLDER_NAME ? "" : name;
  if (emailEl) emailEl.value = candidate?.email || "";
  if (phoneEl) phoneEl.value = candidate?.phone || "";
  const missing = contactGaps(candidate);
  if (msg) {
    msg.textContent =
      missing.includes("name") && missing.includes("email")
        ? "อ่านชื่อและอีเมลจากเรซูเม่ไม่ได้"
        : missing.includes("name")
          ? "อ่านชื่อจากเรซูเม่ไม่ได้"
          : "อ่านอีเมลจากเรซูเม่ไม่ได้";
  }
  $("#gap-modal")?.showModal();
  (missing.includes("name") ? nameEl : emailEl)?.focus();
}

function closeGap() {
  state.gapCandidateId = null;
  $("#gap-modal")?.close();
}

async function saveGap(event) {
  event.preventDefault();
  const id = state.gapCandidateId;
  const msg = $("#gap-msg");
  if (!id) {
    closeGap();
    return;
  }
  const displayName = ($("#gap-name")?.value || "").trim();
  const email = ($("#gap-email")?.value || "").trim();
  const phone = ($("#gap-phone")?.value || "").trim();
  if (!displayName) {
    if (msg) msg.textContent = "ใส่ชื่อผู้สมัคร";
    $("#gap-name")?.focus();
    return;
  }
  if (!email.includes("@")) {
    if (msg) msg.textContent = "ใส่อีเมล";
    $("#gap-email")?.focus();
    return;
  }
  try {
    await api(`/api/candidates/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName, email, phone }),
    });
    closeGap();
    await loadBoard();
  } catch (err) {
    if (msg) msg.textContent = err.message === "request_failed" ? "บันทึกไม่สำเร็จ" : err.message;
  }
}

function isPdfFile(file) {
  return Boolean(file) && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
}

function screenFileList() {
  return [...($("#screen-file")?.files || [])].filter(isPdfFile).slice(0, 10);
}

function paintScreenDrop() {
  const drop = $("#screen-drop") || document.querySelector(".file-drop");
  const hint = $("#screen-file-name");
  const title = $("#screen-file-title");
  const files = screenFileList();
  if (drop) drop.classList.toggle("has-file", files.length > 0);
  if (title) title.textContent = files.length ? "อัปไฟล์แล้ว" : "อัปโหลดเรซูเม่ PDF";
  if (hint) {
    if (!files.length) hint.textContent = "ลากไฟล์มาวาง หรือกดเพื่อเลือก — เลือกได้หลายไฟล์";
    else if (files.length === 1) hint.textContent = `${files[0].name} · กดเพื่อเปลี่ยนไฟล์`;
    else hint.textContent = `${files.length} ไฟล์ · ${files.map((f) => f.name).join(" · ")}`;
  }
}

function setScreenBusy(on) {
  const btn = $("#screen-go");
  const drop = $("#screen-drop");
  const input = $("#screen-file");
  const job = $("#screen-job");
  if (btn) {
    btn.classList.toggle("is-wait", on);
    btn.disabled = on || !state.aiReady;
  }
  if (input) input.disabled = on;
  if (job) job.disabled = on;
  if (drop) drop.style.pointerEvents = on ? "none" : "";
}

function bindScreenDrop() {
  const drop = $("#screen-drop") || document.querySelector(".file-drop");
  const input = $("#screen-file");
  if (!drop || !input) return;
  input.addEventListener("change", paintScreenDrop);
  ["dragenter", "dragover"].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
    });
  });
  drop.addEventListener("drop", (e) => {
    const picked = [...(e.dataTransfer?.files || [])].filter(isPdfFile).slice(0, 10);
    if (!picked.length) return;
    const dt = new DataTransfer();
    picked.forEach((file) => dt.items.add(file));
    input.files = dt.files;
    paintScreenDrop();
  });
  paintScreenDrop();
}

async function runScreen(event) {
  event.preventDefault();
  if (!state.aiReady) return;
  const msg = $("#screen-form-msg");
  if (msg) msg.textContent = "";
  if ($("#screen-go")?.disabled) return;
  const files = screenFileList();
  const jobId = $("#screen-job")?.value;
  if (!jobId) {
    if (msg) msg.textContent = "เลือกตำแหน่งก่อน";
    return;
  }
  if (!files.length) {
    if (msg) msg.textContent = "อัปโหลดเรซูเม่ PDF";
    return;
  }
  state.screenLog = [];
  state.screenAppId = null;
  state.screenAppIds = new Set();
  state.screenFiles = new Map();
  paintScreenLog();
  openPageTab("screen", "score");
  openScreenResultTab("trace");
  setScreenBusy(true);
  const many = files.length > 1;
  const queued = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tag = many ? `${i + 1}/${files.length} · ${file.name}` : file.name;
      const tempId = `up-${i}`;
      pushScreenLog({ state: "run", source: "upload", message: "กำลังอัปโหลด", appId: tempId, file: tag });
      try {
        const form = new FormData();
        form.set("jobId", jobId);
        form.set("file", file, file.name);
        const data = await api("/api/screen", { method: "POST", body: form });
        state.screenAppId = data.applicationId;
        state.screenAppIds.add(data.applicationId);
        state.screenFiles.set(data.applicationId, tag);
        if (data.candidateId) state.screenLast = { applicationId: data.applicationId, candidateId: data.candidateId };
        remapScreenLog(tempId, data.applicationId);
        pushScreenLog({ state: "ok", source: "upload", message: "อัปโหลดแล้ว", appId: data.applicationId, file: tag });
        pushScreenLog({ state: "ok", source: "save", message: "บันทึกผู้สมัครแล้ว · อยู่ในคัมบังขั้นคัดกรอง", appId: data.applicationId, file: tag });
        if (data.status === "queued") {
          pushScreenLog({
            state: "run",
            source: "queued",
            message: "เข้าคิวแล้ว · คัดเบื้องหลังได้ ไปหน้าอื่นได้",
            appId: data.applicationId,
            file: tag,
          });
          queued.push({ id: data.applicationId, candidate: data.candidate, candidateId: data.candidateId });
        } else {
          const detail = await api(`/api/screen/${data.applicationId}`);
          renderScore(detail.application);
          pushScreenLog({ state: "ok", source: "ready", message: "คัดกรองเสร็จแล้ว", appId: data.applicationId, file: tag });
          if (!many) maybeOpenGap(detail.application.candidate_id, detail.application);
        }
      } catch (err) {
        const text = err.message === "job_missing" ? "เลือกตำแหน่งก่อน" : screenErrorTh(err.message);
        pushScreenLog({ state: "fail", source: "post", message: text, appId: tempId, file: tag });
        if (msg && files.length === 1) msg.textContent = text;
      }
    }
    if (queued.length) {
      if (msg) msg.textContent = "คัดกรองเบื้องหลัง · ดูความคืบที่แท็บผล";
      queued.forEach((row) => waitScreen(row.id));
    }
    await loadBoard();
    markPanelClean("screen");
  } finally {
    setScreenBusy(false);
  }
}

function screenStepTh(step) {
  const map = {
    upload: "อัปโหลด PDF แล้ว",
    save: "บันทึกผู้สมัครแล้ว",
    queued: "ส่งเข้าคิวแล้ว",
    read_pdf: "กำลังอ่านข้อความจาก PDF",
    load_job: "อ่านตำแหน่งแล้ว",
    score: "กำลังให้โมเดลให้คะแนน",
    save_score: "กำลังบันทึกคะแนน",
    ready: "คัดกรองเสร็จแล้ว",
    fail: "คัดกรองไม่สำเร็จ",
  };
  return map[step] || step;
}

function screenErrorTh(code) {
  const base = String(code || "").split(":")[0];
  const map = {
    llm_upstream: "โมเดลให้คะแนนไม่ได้",
    llm_rate_limited: "โมเดลถูกเรียกถี่ไป",
    llm_not_configured: "ยังไม่ได้ตั้งค่าโมเดล",
    llm_bad_json: "โมเดลตอบมาไม่ครบ",
    unreadable_pdf: "อ่าน PDF ไม่ได้",
    empty_resume: "PDF ไม่มีข้อความให้คะแนน",
    resume_missing: "หาไฟล์เรซูเม่ในคลังไม่เจอ",
    job_missing: "หาตำแหน่งไม่เจอ",
    pdf_only: "รับเฉพาะไฟล์ PDF",
    payload_too_large: "ไฟล์ใหญ่เกิน",
  };
  const label = map[base] || "คัดกรองไม่สำเร็จ";
  return code && code !== base ? `${label} (${code})` : label;
}

function openScreenResultTab(id) {
  const bar = $("#screen-result-tabs");
  if (bar) showPageTab(bar, id);
}

function screenRetryable(text) {
  return /rate_limited|llm_upstream|ลองใหม่|ถี่ไป/.test(String(text || ""));
}

function remapScreenLog(fromId, toId) {
  for (const row of state.screenLog || []) {
    if (row.appId === fromId) row.appId = toId;
  }
}

function paintScreenLog() {
  const log = $("#screen-log");
  if (!log) return;
  const rows = state.screenLog || [];
  const empty = $("#screen-trace-empty");
  if (empty) empty.classList.toggle("is-off", rows.length > 0);
  log.innerHTML = rows
    .map((row) => {
      const live = row.state === "run" || row.state === "wait";
      const label =
        row.state === "fail" ? "พลาด" : row.state === "ok" ? "ได้" : row.state === "wait" ? "รอใหม่" : "ทำอยู่";
      const spin = live ? `<span class="spin" aria-hidden="true"></span>` : "";
      const file = row.file ? `<span class="file-tag">${esc(row.file)} · </span>` : "";
      return `<li class="${live ? "is-live" : ""}"><span class="st ${esc(row.state)}">${spin}${esc(label)}</span> <span>${file}${esc(row.message)}</span></li>`;
    })
    .join("");
  log.scrollTop = log.scrollHeight;
}

function pushScreenLog(ev) {
  if (!ev?.message) return;
  state.screenLog = state.screenLog || [];
  const appId = ev.appId || ev.applicationId || state.screenAppId || "";
  const source = ev.source || "";
  let next = ev.state || "run";
  if (next === "fail" && screenRetryable(ev.message)) next = "wait";
  const file = ev.file || state.screenFiles.get(appId) || "";
  if (next === "run" || next === "ok") {
    for (const row of state.screenLog) {
      if (row.appId === appId && row.state === "run" && row.source !== source) row.state = "ok";
      if (row.appId === appId && row.state === "wait") {
        row.state = next === "ok" ? "ok" : "wait";
        if (next === "ok") row.message = "โมเดลถี่ไป · คิวลองใหม่แล้วต่อได้";
      }
    }
  }
  const idx = state.screenLog.findIndex((row) => row.appId === appId && row.source === source);
  const row = { appId, source, state: next, message: ev.message, file };
  if (idx >= 0) state.screenLog[idx] = row;
  else state.screenLog.push(row);
  if (state.screenLog.length > 80) state.screenLog = state.screenLog.slice(-80);
  paintScreenLog();
}

function waitScreen(id) {
  const file = state.screenFiles.get(id) || "";
  return new Promise((resolve) => {
    state.screenWait.set(id, resolve);
    const poll = async () => {
      if (!state.screenWait.has(id)) return;
      try {
        const now = await api(`/api/screen/${id}`);
        const app = now.application;
        if (app.last_error && app.status !== "ready") {
          pushScreenLog({
            state: screenRetryable(app.last_error) ? "wait" : "fail",
            source: app.last_step || "score",
            message: `${screenErrorTh(app.last_error)} · คิวจะลองใหม่`,
            appId: id,
            file,
          });
        } else if (app.last_step) {
          pushScreenLog({
            state: app.last_step === "ready" ? "ok" : app.last_step === "fail" ? "fail" : "run",
            source: app.last_step,
            message: screenStepTh(app.last_step),
            appId: id,
            file,
          });
        }
        if (app.status === "ready") {
          state.screenWait.delete(id);
          renderScore(app);
          resolve();
          return;
        }
      } catch {
        /* keep polling */
      }
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 800);
  });
}

function connectLive() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/live`);
  ws.onopen = () => {
    state.liveDelay = 500;
  };
  ws.onmessage = (ev) => {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleLive(data);
  };
  ws.onclose = () => {
    clearTimeout(state.liveTimer);
    state.liveTimer = setTimeout(connectLive, state.liveDelay);
    state.liveDelay = Math.min(state.liveDelay * 2, 15000);
  };
}

async function handleLive(ev) {
  if (ev.type === "screen.ready" && ev.applicationId) {
    const wait = state.screenWait.get(ev.applicationId);
    const watching = state.screenAppIds?.has(ev.applicationId);
    if (wait || watching) {
      pushScreenLog({
        state: "ok",
        source: "ready",
        message: "คัดกรองเสร็จแล้ว",
        appId: ev.applicationId,
      });
    }
    if (wait) {
      state.screenWait.delete(ev.applicationId);
      const detail = await api(`/api/screen/${ev.applicationId}`);
      renderScore(detail.application);
      await loadBoard();
      wait();
      return;
    }
    if (document.querySelector("[data-panel=screen]:not([hidden])")) {
      const detail = await api(`/api/screen/${ev.applicationId}`);
      renderScore(detail.application);
      maybeOpenGap(detail.application.candidate_id, detail.application);
      openPageTab("screen", "score");
      openScreenResultTab("marks");
    }
    await loadBoard();
    renderHome();
    return;
  }
  if (ev.type === "screen.progress" && ev.applicationId) {
    if (!state.screenAppIds?.has(ev.applicationId) && ev.applicationId !== state.screenAppId) return;
    pushScreenLog({ ...ev, appId: ev.applicationId });
    return;
  }
  if (ev.type === "screen.failed" && ev.applicationId) {
    if (!state.screenAppIds?.has(ev.applicationId) && ev.applicationId !== state.screenAppId) return;
    pushScreenLog({
      state: screenRetryable(ev.message) ? "wait" : "fail",
      source: ev.source || "fail",
      message: ev.message || "คัดกรองไม่สำเร็จ · คิวจะลองใหม่",
      appId: ev.applicationId,
    });
    return;
  }
  if (ev.type === "scout.progress" || ev.type === "scout.ready" || ev.type === "scout.failed") {
    const jobId = ev.jobId || ev.candidateId;
    if (jobId) {
      state.scoutRuns = state.scoutRuns || {};
      const prev = state.scoutRuns[jobId] || {};
      state.scoutRuns[jobId] = {
        ...prev,
        runId: ev.runId || prev.runId,
        jobId,
        status: ev.type === "scout.ready" ? "done" : ev.type === "scout.failed" ? "failed" : "running",
      };
    }
    const watching = !jobId || jobId === state.jobId;
    if (watching && ev.type === "scout.progress") {
      if (ev.runId && !state.scoutRunId) state.scoutRunId = ev.runId;
      if (!ev.runId || !state.scoutRunId || ev.runId === state.scoutRunId) {
        pushScoutLog(ev);
        if (ev.message) $("#scout-meta").textContent = ev.message;
      }
    }
    if (watching && ev.type === "scout.ready") {
      await finishScoutRun(jobId || state.jobId);
      return;
    }
    if (watching && ev.type === "scout.failed") {
      $("#scout-meta").textContent = ev.message || "ค้นไม่สำเร็จ";
      if ($("#result-count")) $("#result-count").textContent = "ค้นไม่สำเร็จ";
    }
    syncScoutSearchBtn();
    return;
  }
  if (ev.type === "board.changed" || ev.type === "scout.changed") {
    await loadBoard();
    renderHome();
  }
  if (ev.type === "calendar.changed") {
    await loadInterviews();
    renderHome();
  }
}

function barPct(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, (n / 10) * 100));
}

function scoreMini(c) {
  if (c.skills_score == null) return "—";
  return `S <em>${num(c.skills_score)}</em> · E <em>${num(c.experience_score)}</em> · C <em>${num(c.culture_score)}</em>`;
}

function paintFunnel(stages, candidates) {
  const box = $("#funnel");
  if (!box) return;
  const cur = $("#filter-stage")?.value || "";
  const pipe = pipeStages(stages);
  const dropN = candidates.filter((c) => c.stage === "rejected").length;
  const btns = pipe.map((s) => {
    const n = candidates.filter((c) => c.stage === s).length;
    return `<button type="button" class="is-${s}${cur === s ? " on" : ""}" data-funnel="${s}"><b>${n}</b><span>${STAGE_TH[s] || s}</span></button>`;
  });
  btns.push(
    `<button type="button" class="is-drop${cur === "rejected" ? " on" : ""}" data-funnel="rejected"><b>${dropN}</b><span>ไม่ผ่าน</span></button>`,
  );
  box.innerHTML = btns.join("");
  box.onclick = (e) => {
    const s = e.target.closest("[data-funnel]")?.dataset.funnel;
    if (!s || !$("#filter-stage")) return;
    $("#filter-stage").value = $("#filter-stage").value === s ? "" : s;
    loadBoard();
  };
}

function setBoardView(view) {
  state.boardView = view;
  $("#view-board")?.classList.toggle("on", view === "board");
  $("#view-list")?.classList.toggle("on", view === "list");
  loadBoard();
}

function paintPager(el, info, onPage) {
  if (!el) return;
  const page = info.page || 1;
  const pageSize = info.pageSize || 20;
  const total = info.total || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  el.innerHTML = `<button type="button" class="btn ghost" data-p="prev"${page <= 1 ? " disabled" : ""}>ก่อนหน้า</button>
    <span class="muted">${from}–${to} จาก ${total}</span>
    <button type="button" class="btn ghost" data-p="next"${page >= pages ? " disabled" : ""}>ถัดไป</button>`;
  el.onclick = (e) => {
    const btn = e.target.closest("[data-p]");
    if (!btn || btn.disabled) return;
    const next = btn.dataset.p === "next" ? page + 1 : page - 1;
    if (next < 1 || next > pages) return;
    onPage(next);
  };
}

function setPeopleView(view) {
  state.peopleView = view;
  const list = $("#people-view-list");
  const grid = $("#people-view-grid");
  list?.classList.toggle("on", view === "list");
  grid?.classList.toggle("on", view === "grid");
  list?.setAttribute("aria-pressed", view === "list" ? "true" : "false");
  grid?.setAttribute("aria-pressed", view === "grid" ? "true" : "false");
  loadPeople();
}

let peopleSearchTimer = 0;
function onPeopleSearch() {
  state.peoplePage = 1;
  clearTimeout(peopleSearchTimer);
  peopleSearchTimer = setTimeout(() => loadPeople(), 160);
}

async function loadPeople() {
  if (!isReady("people")) paintPeople([]);
  try {
    const qs = new URLSearchParams();
    const q = $("#people-q")?.value || "";
    const stage = $("#people-stage")?.value;
    const source = $("#people-source")?.value;
    const jobId = $("#people-job")?.value;
    if (q) qs.set("q", q);
    if (stage) qs.set("stage", stage);
    if (source) qs.set("source", source);
    if (jobId) qs.set("jobId", jobId);
    qs.set("page", String(state.peoplePage || 1));
    qs.set("pageSize", "20");
    const data = await api(`/api/candidates?${qs}`);
    state.people = data.candidates || [];
    state.peopleTotal = data.total || 0;
    state.peoplePage = data.page || 1;
    state.peoplePageSize = data.pageSize || 20;
    if ($("#people-stage") && !$("#people-stage").dataset.ready) {
      $("#people-stage").innerHTML = stageOptions(data.stages);
      $("#people-stage").dataset.ready = "1";
    }
    const srcSel = $("#people-source");
    if (srcSel) {
      const cur = srcSel.value;
      const sources = [...new Set((data.candidates || []).map((c) => c.source).filter(Boolean))];
      if (cur && !sources.includes(cur)) sources.unshift(cur);
      srcSel.innerHTML =
        `<option value="">ทุกแหล่ง</option>` + sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
      srcSel.value = cur;
    }
  } finally {
    markReady("people");
    paintPeople(state.people || []);
    paintPager($("#people-pager"), { page: state.peoplePage || 1, pageSize: state.peoplePageSize || 20, total: state.peopleTotal || 0 }, (p) => {
      state.peoplePage = p;
      loadPeople();
    });
  }
}

function personDelBtn(c) {
  if (!can("candidates.write")) return "";
  return `<button type="button" class="job-x" data-person-del="${esc(c.id)}" aria-label="ลบ ${esc(c.display_name)}">ลบ</button>`;
}

function onPeopleGridClick(e) {
  const del = e.target.closest("[data-person-del]");
  if (del) {
    e.preventDefault();
    e.stopPropagation();
    deletePerson(del.dataset.personDel);
    return;
  }
  const hit = e.target.closest("[data-id]");
  if (hit?.dataset.id) openPerson(hit.dataset.id);
}

function onPeopleGridKey(e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (e.target.closest("[data-person-del]")) return;
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  e.preventDefault();
  openPerson(row.dataset.id);
}

function paintPeople(rows) {
  const box = $("#people-grid");
  if (!box) return;
  if (!isReady("people")) {
    box.className = "panel";
    box.innerHTML = waitHtml();
    return;
  }
  if (!rows.length) {
    box.className = "panel";
    box.innerHTML = `<p class="muted">ยังไม่มีผู้สมัครที่ตรงการค้น</p>`;
    return;
  }
  if (state.peopleView === "grid") {
    box.className = "people-cards";
    box.innerHTML = rows
      .map(
        (c) => `<div class="people-card-wrap">
          <button type="button" class="people-card" data-id="${esc(c.id)}">
            <strong>${esc(c.display_name)}</strong>
            ${stageChip(c.stage)}
            <div class="muted">${esc(c.job_title || "—")} · ${esc(c.source || "—")}</div>
            <div class="rail">${railDots(c)}</div>
            <div class="mini-score">${scoreMini(c)}</div>
          </button>
          ${personDelBtn(c)}
        </div>`,
      )
      .join("");
  } else {
    const canDel = can("candidates.write");
    box.className = "data-table-wrap";
    box.innerHTML = `<table class="list-table"><thead><tr><th>ชื่อ</th><th>ขั้น</th><th>ตำแหน่ง</th><th>แหล่ง</th><th>คะแนน</th>${canDel ? `<th class="col-act">ลบ</th>` : ""}</tr></thead><tbody>
      ${rows
        .map(
          (c) => `<tr data-clickable data-id="${esc(c.id)}" tabindex="0">
            <td><strong>${esc(c.display_name)}</strong><div class="muted">${esc(c.email || c.phone || "")}</div></td>
            <td>${stageChip(c.stage)}</td>
            <td>${esc(c.job_title || "—")}</td>
            <td>${esc(c.source || "—")}</td>
            <td>${scoreMini(c)}</td>
            ${canDel ? `<td class="col-act">${personDelBtn(c)}</td>` : ""}
          </tr>`,
        )
        .join("")}
    </tbody></table>`;
  }
}

function renderScore(app) {
  state.screenLast = {
    applicationId: app.id,
    candidateId: app.candidate_id,
    app,
  };
  const box = $("#screen-score") || $("#scorecard");
  if (!box) return;
  box.innerHTML = `
    <p class="eyebrow">ผลการคัดกรอง Resume</p>
    <h3>${esc(app.display_name)} · ${esc(app.job_title)}</h3>
    <p class="muted">ผู้สมัครอยู่ในคัมบังขั้นคัดกรองแล้ว — ขั้นถัดไปคือนัดสัมภาษณ์</p>
    <div class="score-row"><span>Skills</span><div class="bar"><i style="width:${barPct(app.skills_score)}%"></i></div><b>${num(app.skills_score)}</b></div>
    <p class="muted">${esc(app.skills_why || "")}</p>
    <div class="score-row"><span>Experience</span><div class="bar"><i style="width:${barPct(app.experience_score)}%"></i></div><b>${num(app.experience_score)}</b></div>
    <p class="muted">${esc(app.experience_why || "")}</p>
    <div class="score-row"><span>Culture</span><div class="bar"><i style="width:${barPct(app.culture_score)}%"></i></div><b>${num(app.culture_score)}</b></div>
    <p class="muted">${esc(app.culture_why || "")}</p>
    <p>${esc(app.summary || "")}</p>
    <p><strong>จุดแข็ง</strong> ${(app.strengths || []).map(esc).join(" · ") || "—"}</p>
    <p><strong>ธงแดง / ต้องถาม</strong> ${(app.flags || []).map(esc).join(" · ") || "—"}</p>
    <div class="row result-actions">
      <button class="btn" type="button" id="screen-to-board">เปิดในคัมบัง</button>
      <button class="btn ghost" type="button" id="screen-to-cal">นัดสัมภาษณ์</button>
      <button class="btn ghost" type="button" id="pack-btn" data-id="${esc(app.id)}">
        <span class="btn-label">สร้างชุดสัมภาษณ์ให้ทีม</span>
        <span class="btn-wait" aria-hidden="true"><span class="spin"></span>กำลังเขียน…</span>
      </button>
    </div>
  `;
  bindScreenNext(app);
  openPageTab("screen", "score");
  openScreenResultTab("marks");
}

function bindScreenNext(app) {
  $("#screen-to-board")?.addEventListener("click", () => goScreenedBoard(app.candidate_id));
  $("#screen-to-cal")?.addEventListener("click", () => goScreenedCal(app.candidate_id));
  const packBtn = $("#pack-btn");
  if (packBtn) {
    packBtn.disabled = !state.aiReady;
    packBtn.addEventListener("click", () => makeInterviewPack(app));
  }
}

async function goScreenedBoard(candidateId) {
  const id = candidateId || state.screenLast?.candidateId;
  await showTab("board", { skipDirty: true });
  if (id) await openPerson(id);
}

async function goScreenedCal(candidateId) {
  const id = candidateId || state.screenLast?.candidateId;
  await loadBoard().catch(() => {});
  await showTab("schedule", { skipDirty: true });
  const name = state.screenLast?.app?.display_name;
  if (id) ensureCandidateOption(id, name);
}

function paintPack(body, warn) {
  const box = $("#screen-pack");
  if (!box) return;
  const points = body.talkingPoints || [];
  const questions = body.questions || [];
  const risks = body.risks || [];
  box.innerHTML = `
    ${warn ? `<p class="muted">${esc(warn)}</p>` : ""}
    <p class="eyebrow">ชุดสัมภาษณ์ให้ทีม</p>
    <h3>${esc(body.title || "ชุดสัมภาษณ์")}</h3>
    ${points.length ? `<p><strong>ประเด็นคุย</strong> ${points.map(esc).join(" · ")}</p>` : ""}
    ${questions.length ? `<ol>${questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : `<p class="muted">ยังไม่มีคำถาม</p>`}
    ${risks.length ? `<p class="muted"><strong>ความเสี่ยง</strong> ${risks.map(esc).join(" · ")}</p>` : ""}
    <div class="row">
      <button class="btn" type="button" id="pack-to-cal">ไปนัดสัมภาษณ์</button>
      <button class="btn ghost" type="button" id="pack-to-board">เปิดในคัมบัง</button>
    </div>
  `;
  $("#pack-to-cal")?.addEventListener("click", () => goScreenedCal());
  $("#pack-to-board")?.addEventListener("click", () => goScreenedBoard());
}

async function makeInterviewPack(app) {
  const packBtn = $("#pack-btn");
  packBtn?.classList.add("is-wait");
  if (packBtn) packBtn.disabled = true;
  openScreenResultTab("pack");
  const box = $("#screen-pack");
  if (box) box.innerHTML = `<p class="muted"><span class="spin" aria-hidden="true"></span> กำลังเขียนชุดสัมภาษณ์ให้ทีม…</p>`;
  try {
    const pack = await api(`/api/screen/${app.id}/pack`, { method: "POST" });
    paintPack(pack.pack || pack);
  } catch (err) {
    paintPack(
      {
        title: `ชุดสัมภาษณ์ · ${app.display_name || ""}`.trim(),
        talkingPoints: app.strengths || [],
        questions: app.questions || [],
        risks: app.flags || [],
      },
      err.message === "llm_rate_limited" || screenRetryable(err.message)
        ? "โมเดลถี่ไปรอบนี้ — ใช้คำถามจากผลคะแนน"
        : `${screenErrorTh(err.message)} — ใช้คำถามจากผลคะแนน`,
    );
  } finally {
    packBtn?.classList.remove("is-wait");
    if (packBtn) packBtn.disabled = !state.aiReady;
  }
}

async function loadBoard() {
  const boardEl = $("#board");
  if (!isReady("board")) {
    if (boardEl) boardEl.innerHTML = waitHtml();
    if ($("#funnel")) $("#funnel").innerHTML = waitHtml();
  }
  try {
  const qs = new URLSearchParams();
  const stage = $("#filter-stage")?.value;
  const source = $("#filter-source")?.value;
  const jobId = $("#filter-job")?.value;
  if (stage) qs.set("stage", stage);
  if (source) qs.set("source", source);
  if (jobId) qs.set("jobId", jobId);
  qs.set("pageSize", "200");
  const data = await api(`/api/candidates${qs.toString() ? `?${qs}` : ""}`);
  state.stages = data.stages;
  state.candidates = data.candidates || [];
  state.peopleCount = state.candidates.length;
  if ($("#book-candidate")) {
    $("#book-candidate").innerHTML = state.candidates
      .map((c) => `<option value="${c.id}">${esc(c.display_name)}</option>`)
      .join("");
  }
  if ($("#filter-stage") && !$("#filter-stage").dataset.ready) {
    $("#filter-stage").innerHTML = stageOptions(data.stages);
    $("#filter-stage").dataset.ready = "1";
    $("#filter-stage").onchange = loadBoard;
    $("#filter-source").onchange = loadBoard;
    $("#filter-job").onchange = loadBoard;
  }
  const sources = [...new Set((data.candidates || []).map((c) => c.source).filter(Boolean))];
  if ($("#filter-source")) {
    const cur = $("#filter-source").value;
    $("#filter-source").innerHTML =
      `<option value="">ทุกแหล่ง</option>` + sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    $("#filter-source").value = cur;
  }
  markReady("board");
  paintFunnel(data.stages, data.candidates);
  const board = $("#board");
  const pipe = pipeStages(PATH);
  const looking = $("#filter-stage")?.value || "";
  const roster =
    looking === "rejected"
      ? data.candidates.filter((c) => c.stage === "rejected")
      : looking
        ? data.candidates.filter((c) => c.stage === looking)
        : data.candidates.filter((c) => c.stage !== "rejected");
  if (state.boardView === "list" || looking === "rejected") {
    board.className = "panel";
    board.innerHTML = `<table class="list-table"><thead><tr><th>ชื่อ</th><th>ขั้น</th><th>แหล่ง</th><th>ตำแหน่ง</th><th>AI</th></tr></thead><tbody>
      ${roster
        .map(
          (c) => `<tr data-clickable data-id="${c.id}" style="cursor:pointer">
            <td><strong>${esc(c.display_name)}</strong></td>
            <td>${stageChip(c.stage)}</td>
            <td>${esc(c.source || "—")}</td>
            <td>${esc(c.job_title || "—")}</td>
            <td>${scoreMini(c)}</td>
          </tr>`,
        )
        .join("") || `<tr><td colspan="5" class="muted">${looking === "rejected" ? "ยังไม่มีคนที่ไม่ผ่าน" : "ยังไม่มีผู้สมัครในตัวกรองนี้"}</td></tr>`}
    </tbody></table>`;
    board.querySelectorAll("[data-id]").forEach((row) => {
      row.addEventListener("click", () => openPerson(row.dataset.id));
    });
    return;
  }
  board.className = "board";
  board.innerHTML = pipe
    .map((stage) => {
      const rows = data.candidates.filter((c) => c.stage === stage);
      const cards = rows
        .map(
          (c) => `<article class="chip" draggable="true" data-id="${c.id}">
            <strong>${esc(c.display_name)}</strong>
            <span class="chip-src">${esc(c.source || "—")}</span>
            ${c.job_title ? `<div class="chip-job">${esc(c.job_title)}</div>` : ""}
            ${c.screen_status === "ready" ? `<div class="mini-score">${scoreMini(c)}</div>` : `<div class="muted">ยังไม่คัดกรอง Resume</div>`}
            <select class="stage-dd" data-id="${c.id}" aria-label="ย้ายขั้น">${pipe
              .concat("rejected")
              .map((s) => `<option value="${s}"${s === c.stage ? " selected" : ""}>${STAGE_TH[s] || s}</option>`)
              .join("")}</select>
            <div class="rail">${railDots(c)}</div>
          </article>`,
        )
        .join("");
      return `<div class="col" data-stage="${stage}"><div class="col-head"><h3>${STAGE_TH[stage] || stage}</h3><span class="cnt">${rows.length}</span></div>${
        cards || `<p class="col-empty">ยังไม่มีคนในขั้นนี้</p>`
      }</div>`;
    })
    .join("");

  board.querySelectorAll(".stage-dd").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", async () => {
      await api(`/api/candidates/${sel.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: sel.value }),
      });
      await loadBoard();
    });
  });
  board.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("dragstart", (e) => e.dataTransfer.setData("id", chip.dataset.id));
    chip.addEventListener("click", () => openPerson(chip.dataset.id));
    chip.addEventListener("pointermove", (e) => tiltChip(chip, e));
    chip.addEventListener("pointerleave", () => {
      chip.style.transform = "";
    });
  });
  board.querySelectorAll(".col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("over");
      const id = e.dataTransfer.getData("id");
      await api(`/api/candidates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: col.dataset.stage }),
      });
      await loadBoard();
    });
  });

  $("#book-candidate").innerHTML = data.candidates
    .map((c) => `<option value="${c.id}">${esc(c.display_name)}</option>`)
    .join("");
  } finally {
    markReady("board");
    const board = $("#board");
    if (board?.querySelector(".data-wait") && !board.querySelector(".col, table")) {
      const stages = pipeStages(state.stages);
      paintFunnel(stages, state.candidates || []);
      board.className = "board";
      board.innerHTML = stages
        .map(
          (stage) =>
            `<div class="col" data-stage="${stage}"><div class="col-head"><h3>${STAGE_TH[stage] || stage}</h3><span class="cnt">0</span></div><p class="col-empty">ยังไม่มีคนในขั้นนี้</p></div>`,
        )
        .join("");
    }
    if (typeof renderHome === "function") renderHome();
  }
}

async function savePerson(event) {
  event.preventDefault();
  if (!state.person) return;
  const msg = $("#edit-msg");
  if (msg) msg.textContent = "";
  try {
    await api(`/api/candidates/${state.person.candidate.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: $("#edit-name").value,
        email: $("#edit-email").value,
        phone: $("#edit-phone").value,
      }),
    });
    if (msg) msg.textContent = "บันทึกแล้ว";
    await loadBoard();
    await openPerson(state.person.candidate.id);
    markDrawerClean();
    markPanelClean("board");
  } catch (err) {
    if (msg) msg.textContent = err.message;
  }
}

async function deletePerson(id) {
  const personId = id || state.person?.candidate?.id;
  if (!personId) return;
  const known = [state.person?.candidate, ...(state.people || []), ...(state.candidates || [])].find((c) => c?.id === personId);
  const ok = await askModal({
    title: "ลบออกจากรายชื่อ?",
    body: known?.display_name ? `${known.display_name} จะออกจากท่อสมัคร` : "คนนี้จะออกจากท่อสมัคร",
    ok: "ลบออก",
    no: "ไม่ลบ",
    danger: true,
  });
  if (!ok) return;
  await api(`/api/candidates/${personId}`, { method: "DELETE" });
  if (state.person?.candidate?.id === personId) {
    markDrawerClean();
    await closeDrawer();
  }
  await loadBoard();
  await loadPeople();
}

async function addManual() {
  await api("/api/candidates", {
    method: "POST",
    body: JSON.stringify({
      displayName: $("#manual-name").value,
      source: $("#manual-source").value || "manual",
    }),
  });
  $("#manual-name").value = "";
  await loadBoard();
  markPanelClean("board");
}

async function loadScheduleMeta() {
  const data = await api("/api/schedule/status");
  state.calMode = data.mode || "share";
  state.calTeam = Boolean(data.team);
  state.calMe = Boolean(data.me);
  state.people = data.people || [];
  const connect = $("#google-connect");
  if (connect) connect.textContent = state.calTeam ? "เชื่อมปฏิทินทีมอีกครั้ง" : "เชื่อมปฏิทินทีม";
  const meBtn = $("#google-me");
  if (meBtn) meBtn.hidden = state.calMode === "share";
  const meStatus = $("#google-me-status");
  if (meStatus) meStatus.textContent = state.calMe ? "Gmail ของฉันเชื่อมแล้ว" : "ยังไม่เชื่อม Gmail ส่วนตัว";
  const email = $("#me-cal-email");
  if (email && !email.value) {
    const mine = state.people.find((p) => p.id === state.session?.userId);
    if (mine?.calendarEmail) email.value = mine.calendarEmail;
  }
  fillInterviewers();
  renderWho();
}

function fillInterviewers() {
  const sel = $("#book-interviewer");
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML =
    `<option value="">ไม่ระบุ</option>` +
    state.people
      .map((p) => `<option value="${esc(p.id)}">${esc(p.username)}</option>`)
      .join("");
  if (keep && state.people.some((p) => p.id === keep)) sel.value = keep;
  else if (state.session?.userId) sel.value = state.session.userId;
}

function renderWho() {
  const box = $("#cal-who");
  if (!box) return;
  const chips = [{ id: "all", username: "ทั้งทีม" }, ...state.people];
  box.innerHTML = chips
    .map(
      (p) =>
        `<button type="button" class="${state.calWho === p.id ? "on" : ""}" data-who="${esc(p.id)}">${esc(p.username)}</button>`,
    )
    .join("");
  box.onclick = (e) => {
    const id = e.target.closest("[data-who]")?.dataset.who;
    if (!id) return;
    state.calWho = id;
    renderWho();
    loadBusy().then(() => renderCalendar());
  };
}

function weekRange() {
  const start = new Date(state.week);
  const end = new Date(state.week);
  end.setDate(end.getDate() + 7);
  return { from: start.toISOString(), to: end.toISOString() };
}

function monthCells(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function visibleRange() {
  if (state.calView === "month") {
    const cells = monthCells(state.day);
    const end = new Date(cells[41]);
    end.setDate(end.getDate() + 1);
    return { from: cells[0].toISOString(), to: end.toISOString() };
  }
  return weekRange();
}

async function loadBusy() {
  const { from, to } = visibleRange();
  try {
    const data = await api(`/api/schedule/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&who=${encodeURIComponent(state.calWho)}`);
    state.busy = data.busy || [];
  } catch {
    state.busy = [];
  }
}

function slotBusy(t) {
  return state.busy.some((b) => {
    const start = Date.parse(b.start);
    const end = Date.parse(b.end);
    return !Number.isNaN(start) && !Number.isNaN(end) && t >= start && t < end;
  });
}

async function loadInterviews() {
  if (!isReady("interviews")) {
    const grid = $("#week-grid");
    if (grid && !grid.querySelector(".wg, .month-grid")) grid.innerHTML = waitHtml();
    renderUpcoming();
  }
  try {
    const data = await api("/api/interviews");
    state.interviews = data.interviews || [];
    await loadScheduleMeta();
    await loadBusy();
  } finally {
    markReady("interviews");
    renderCalendar();
    renderUpcoming();
    if (typeof renderHome === "function") renderHome();
  }
}

function shiftWeek(dir) {
  const next = new Date(state.week);
  next.setDate(next.getDate() + dir * 7);
  state.week = next;
  const keep = new Date(state.day);
  keep.setDate(keep.getDate() + dir * 7);
  state.day = startOfDay(keep);
  state.pick = null;
  loadBusy().then(() => renderCalendar());
}

function shiftCal(dir) {
  if (state.calView === "month") {
    const next = new Date(state.day.getFullYear(), state.day.getMonth() + dir, 1);
    state.day = startOfDay(next);
    state.week = startOfWeek(next);
    state.pick = null;
    loadBusy().then(() => renderCalendar());
    return;
  }
  shiftWeek(dir);
}

function setCalView(view) {
  state.calView = view === "month" ? "month" : "week";
  $("#cal-view-week")?.classList.toggle("on", state.calView === "week");
  $("#cal-view-month")?.classList.toggle("on", state.calView === "month");
  loadBusy().then(() => renderCalendar());
}

function dayMeetings(day) {
  const start = startOfDay(day).getTime();
  const end = start + 86400000;
  return state.interviews.filter((ev) => {
    const t = new Date(ev.starts_at).getTime();
    return t >= start && t < end;
  });
}

function weekendClass(d) {
  const day = d.getDay();
  if (day === 0) return " is-sun";
  if (day === 6) return " is-sat";
  return "";
}

function renderCalendar() {
  const grid = $("#week-grid");
  if (!grid) return;
  if (state.calView === "month") renderMonthGrid(grid);
  else renderWeekGrid(grid);
  renderMiniMonth();
  renderUpcoming();
}

function bindCalGrid(grid) {
  grid.onclick = (e) => {
    const meet = e.target.closest("[data-meet]");
    if (meet) {
      openMeetEdit(meet.dataset.meet);
      return;
    }
    const slot = e.target.closest("[data-slot]");
    if (!slot?.dataset.slot) return;
    state.pick = new Date(slot.dataset.slot);
    renderCalendar();
    openMeetCreate();
  };
}

function renderWeekGrid(grid) {
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(state.week);
    d.setDate(state.week.getDate() + i);
    return d;
  });
  if (startOfWeek(state.day).getTime() !== state.week.getTime()) {
    state.day = new Date(state.week);
  }
  $("#cal-range").textContent = `${fmtDay(days[0])} – ${fmtDay(days[6])}`;
  const hours = [...Array(10)].map((_, i) => 8 + i);
  const dow = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const pickStart = state.pick ? state.pick.getTime() : null;
  let html = `<div class="wg"><div></div>${days
    .map((d, i) => `<div class="d${weekendClass(d)}">${dow[i]}<b>${d.getDate()}</b></div>`)
    .join("")}`;
  for (const h of hours) {
    html += `<div class="h">${String(h).padStart(2, "0")}:00</div>`;
    for (const d of days) {
      const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
      const meetings = dayMeetings(d).map((ev) => {
        const start = new Date(ev.starts_at).getTime();
        const mins = Number(ev.minutes || 45);
        return { start, end: start + mins * 60_000, ev };
      });
      const t = slot.getTime();
      const hit = meetings.find((m) => t >= m.start && t < m.end);
      const on = pickStart === t ? " pick" : "";
      const week = weekendClass(d);
      if (hit) {
        html += `<button type="button" class="c busy${week}" data-meet="${esc(hit.ev.id)}" aria-label="นัด ${esc(hit.ev.display_name)}">${esc(hit.ev.display_name)}</button>`;
      } else if (slotBusy(t)) {
        html += `<button type="button" class="c ghost${week}" disabled>ไม่ว่าง</button>`;
      } else {
        html += `<button type="button" class="c${on}${week}" data-slot="${slot.toISOString()}" aria-label="สร้างนัด ${esc(hhmm(slot))}"></button>`;
      }
    }
  }
  html += "</div>";
  grid.innerHTML = html;
  bindCalGrid(grid);
}

function renderMonthGrid(grid) {
  const MONTH_LONG = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const dow = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const anchor = new Date(state.day);
  const cells = monthCells(anchor);
  const today = startOfDay(new Date()).getTime();
  const pickDay = state.pick ? startOfDay(state.pick).getTime() : startOfDay(state.day).getTime();
  $("#cal-range").textContent = `${MONTH_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;
  let html = `<div class="month-grid">${dow.map((n, i) => `<div class="d${i === 0 ? " is-sun" : i === 6 ? " is-sat" : ""}">${n}</div>`).join("")}`;
  for (const d of cells) {
    const dim = d.getMonth() !== anchor.getMonth() ? " dim" : "";
    const week = weekendClass(d);
    const ts = startOfDay(d).getTime();
    const todayCls = ts === today ? " is-today" : "";
    const pickCls = ts === pickDay ? " pick" : "";
    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0, 0, 0);
    const meets = dayMeetings(d)
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
      .map((ev) => `<button type="button" class="mhit" data-meet="${esc(ev.id)}">${esc(hhmm(new Date(ev.starts_at)))} ${esc(ev.display_name)}</button>`)
      .join("");
    html += `<div class="mday${week}${dim}${todayCls}${pickCls}" data-slot="${slot.toISOString()}"><b>${d.getDate()}</b>${meets}</div>`;
  }
  html += "</div>";
  grid.innerHTML = html;
  bindCalGrid(grid);
}

function renderMiniMonth() {
  const box = $("#mini-month");
  if (!box) return;
  const anchor = new Date(state.week);
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  const weekTs = state.week.getTime();
  box.innerHTML = `<div class="mh">${anchor.getFullYear()} / ${anchor.getMonth() + 1}</div>
    <div class="mgrid">${["อา","จ","อ","พ","ฤ","ศ","ส"].map((n) => `<span>${n}</span>`).join("")}
    ${cells
      .map((d) => {
        const dim = d.getMonth() !== anchor.getMonth() ? " dim" : "";
        const on =
          state.calView === "month"
            ? startOfDay(d).getTime() === startOfDay(state.day).getTime()
              ? " on"
              : ""
            : startOfWeek(d).getTime() === weekTs
              ? " on"
              : "";
        return `<button type="button" class="${on}${dim}" data-jump="${d.toISOString()}">${d.getDate()}</button>`;
      })
      .join("")}</div>`;
  box.onclick = (e) => {
    const raw = e.target.closest("[data-jump]")?.dataset.jump;
    if (!raw) return;
    const d = new Date(raw);
    state.week = startOfWeek(d);
    state.day = startOfDay(d);
    state.pick = null;
    loadBusy().then(() => renderCalendar());
  };
}

function setMeetMinutes(n) {
  const mins = Number(n) || 45;
  state.minutes = mins;
  const field = $("#meet-form [name=minutes]");
  if (field) field.value = String(mins);
  $("#dur-pills")?.querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.min) === mins));
}

function paintMeetWhen() {
  if (!state.pick) return;
  const end = new Date(state.pick.getTime() + state.minutes * 60_000);
  if ($("#meet-title")) $("#meet-title").textContent = `${longDay(state.pick)} · ${hhmm(state.pick)} – ${hhmm(end)}`;
  const field = $("#meet-form [name=startsAt]");
  if (field) field.value = toLocalInput(state.pick);
  const when = $("#book-when");
  if (when) when.value = toLocalInput(state.pick);
}

function bindMeetModal() {
  $("#meet-form")?.addEventListener("submit", bookInterview);
  $("#meet-dismiss")?.addEventListener("click", () => $("#meet-modal")?.close());
  $("#meet-info-cancel")?.addEventListener("click", () => {
    if ($("#meet-create")) $("#meet-create").hidden = true;
    if ($("#meet-info-confirm")) $("#meet-info-confirm").hidden = false;
  });
  $("#meet-info-keep")?.addEventListener("click", () => {
    if ($("#meet-info-confirm")) $("#meet-info-confirm").hidden = true;
    if ($("#meet-create")) $("#meet-create").hidden = false;
  });
  $("#meet-info-drop")?.addEventListener("click", dropMeet);
  $("#meet-modal")?.addEventListener("cancel", (e) => {
    if (!choiceOpen) return;
    e.preventDefault();
    closeChoice();
  });
  $("#meet-modal")?.addEventListener("close", () => {
    state.pick = null;
    state.meetId = null;
    closeChoice();
    if ($("#week-grid")) renderCalendar();
  });
}

function ensureCandidateOption(id, name) {
  const sel = $("#book-candidate");
  if (!sel || !id) return;
  if (![...sel.options].some((o) => o.value === id)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name || "ผู้สมัคร";
    sel.prepend(opt);
  }
  sel.value = id;
}

function paintMeetLink(url) {
  const box = $("#meet-link");
  const a = $("#meet-link-a");
  if (!box || !a) return;
  if (url) {
    a.href = url;
    box.hidden = false;
  } else {
    a.removeAttribute("href");
    box.hidden = true;
  }
}

function openMeetCreate() {
  const dlg = $("#meet-modal");
  if (!dlg || !state.pick) return;
  closeChoice();
  state.meetId = null;
  if ($("#meet-kind")) $("#meet-kind").textContent = "สร้างนัด";
  if ($("#meet-sub")) $("#meet-sub").textContent = "เลือกผู้สมัครแล้วกดยืนยันนัดนี้";
  if ($("#meet-save")) $("#meet-save").textContent = "ยืนยันนัดนี้";
  if ($("#meet-info-cancel")) $("#meet-info-cancel").hidden = true;
  setMeetMinutes(state.minutes || 45);
  paintMeetWhen();
  paintMeetLink("");
  if ($("#book-err")) $("#book-err").textContent = "";
  if ($("#meet-create")) $("#meet-create").hidden = false;
  if ($("#meet-info-confirm")) $("#meet-info-confirm").hidden = true;
  if (!dlg.open) dlg.showModal();
}

function openMeetEdit(id) {
  const ev = (state.interviews || []).find((row) => row.id === id);
  const dlg = $("#meet-modal");
  if (!ev || !dlg) return;
  closeChoice();
  state.meetId = id;
  state.pick = new Date(ev.starts_at);
  const mins = Number(ev.minutes || 45);
  if ($("#meet-kind")) $("#meet-kind").textContent = "แก้ไขนัด";
  if ($("#meet-sub")) $("#meet-sub").textContent = "แก้เวลา คนสัมภาษณ์ หรือความยาว แล้วบันทึก";
  if ($("#meet-save")) $("#meet-save").textContent = "บันทึกนัด";
  if ($("#meet-info-cancel")) $("#meet-info-cancel").hidden = false;
  ensureCandidateOption(ev.candidate_id, ev.display_name);
  fillInterviewers();
  const who = $("#book-interviewer");
  if (who) who.value = ev.interviewer_id || "";
  setMeetMinutes(mins);
  paintMeetWhen();
  paintMeetLink(ev.meet_url);
  if ($("#book-err")) $("#book-err").textContent = "";
  if ($("#meet-create")) $("#meet-create").hidden = false;
  if ($("#meet-info-confirm")) $("#meet-info-confirm").hidden = true;
  if (!dlg.open) dlg.showModal();
}

function openMeetInfo(id) {
  openMeetEdit(id);
}

async function dropMeet() {
  if (!state.meetId) return;
  const err = $("#book-err");
  if (err) err.textContent = "";
  try {
    await api(`/api/interviews/${state.meetId}`, { method: "DELETE" });
    $("#meet-modal")?.close();
    await Promise.all([loadInterviews(), loadBoard()]);
    renderHome();
  } catch (e) {
    if ($("#meet-create")) $("#meet-create").hidden = false;
    if ($("#meet-info-confirm")) $("#meet-info-confirm").hidden = true;
    if (err) err.textContent = e.message;
  }
}

function longDay(d) {
  const names = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
  return `${names[d.getDay()]} ${fmtDay(d)}`;
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderUpcoming() {
  const box = $("#upcoming");
  if (!box) return;
  const now = Date.now();
  const rows = state.interviews
    .slice()
    .filter((r) => new Date(r.starts_at).getTime() >= now - 60 * 60_000)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .slice(0, 6);
  box.innerHTML = !isReady("interviews")
    ? `<h3>คิวถัดไป</h3>${waitHtml()}`
    : rows.length
    ? `<h3>คิวถัดไป</h3>` +
      rows
        .map(
          (r) => `<button type="button" class="hit" data-clickable data-meet="${esc(r.id)}"><strong>${esc(r.display_name)}</strong><div class="muted">${esc(fmtWhen(r.starts_at))}</div></button>`,
        )
        .join("")
    : `<h3>คิวถัดไป</h3><p class="muted">ยังไม่มีนัดในคิว — กดช่องว่างบนตารางเพื่อสร้าง</p>`;
  box.onclick = (e) => {
    const id = e.target.closest("[data-meet]")?.dataset.meet;
    if (id) openMeetInfo(id);
  };
}

function fmtDay(d) {
  return `${d.getDate()} ${["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][d.getMonth()]}`;
}

function fmtWhen(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function toLocalInput(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

async function bookInterview(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const when = $("#book-when")?.value;
  const start = when ? new Date(when) : state.pick || new Date(String(form.get("startsAt") || ""));
  const err = $("#book-err");
  if (err) err.textContent = "";
  if (Number.isNaN(start.getTime())) {
    if (err) err.textContent = "เลือกเวลาบนตารางก่อน";
    return;
  }
  if (!$("#book-candidate")?.value) {
    if (err) err.textContent = "เลือกผู้สมัครก่อนยืนยันนัด";
    return;
  }
  const payload = {
    candidateId: $("#book-candidate").value,
    startsAt: start.toISOString(),
    minutes: Number(state.minutes || form.get("minutes") || 45),
    interviewerId: $("#book-interviewer")?.value || "",
  };
  try {
    if (state.meetId) {
      await api(`/api/interviews/${state.meetId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/interviews", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          interviewerId: payload.interviewerId || undefined,
        }),
      });
    }
    state.pick = null;
    state.meetId = null;
    $("#meet-modal")?.close();
    await Promise.all([loadInterviews(), loadBoard()]);
    renderHome();
    markPanelClean("schedule");
  } catch (err) {
    const text = err.message === "conflict" ? "ชนนัดที่มีอยู่แล้ว — เลือกเวลาอื่น" : err.message;
    if ($("#book-err")) $("#book-err").textContent = text;
  }
}

const PROMPT_TH = {
  "prompt.job_draft": { title: "สร้าง job description", hint: "เปลี่ยนบันทึกงานให้เป็น job description ก่อนค้นคน" },
  "prompt.scout_query": { title: "สร้างคำค้นจาก job description", hint: "สรุป job description เป็นคำค้นโปรไฟล์สาธารณะ" },
  "prompt.scout_rank": { title: "จัดอันดับ Candidate", hint: "ให้คะแนนความเข้ากับตำแหน่ง" },
  "prompt.screen": { title: "คัดกรอง Resume", hint: "อ่านเรซูเม่แล้วให้คะแนน Skills / Experience / Culture" },
  "prompt.interview_pack": { title: "ชุดคำถามสัมภาษณ์", hint: "สรุปประเด็นและคำถามให้ HR ก่อนนัด" },
};

async function loadPrompts() {
  const data = await api("/api/settings/prompts");
  state.prompts = data.prompts || {};
  const keys = Object.keys(PROMPT_TH).filter((k) => k in state.prompts);
  const extra = Object.keys(state.prompts).filter((k) => !PROMPT_TH[k]);
  const order = keys.concat(extra);
  const nav = $("#prompt-nav");
  if (nav) {
    nav.innerHTML = order
      .map((key) => {
        const meta = PROMPT_TH[key] || { title: key };
        return `<button type="button" class="set-pick-btn" data-prompt-key="${esc(key)}">${esc(meta.title)}</button>`;
      })
      .join("");
    nav.onclick = (e) => {
      const key = e.target.closest("[data-prompt-key]")?.dataset.promptKey;
      if (key) showPrompt(key);
    };
  }
  const area = $("#prompt-text");
  if (area && state.session?.limits?.promptMax) area.maxLength = state.session.limits.promptMax;
  showPrompt(state.promptKey && state.prompts[state.promptKey] != null ? state.promptKey : order[0]);
}

function showPrompt(key) {
  if (!key || !state.prompts || !(key in state.prompts)) return;
  const area = $("#prompt-text");
  if (area && state.promptKey && state.promptKey !== key) {
    state.prompts[state.promptKey] = area.value;
  }
  state.promptKey = key;
  const meta = PROMPT_TH[key] || { title: key, hint: "" };
  if ($("#prompt-hint")) $("#prompt-hint").textContent = meta.hint || "";
  if (area) area.value = state.prompts[key] || "";
  $("#prompt-nav")?.querySelectorAll("[data-prompt-key]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.promptKey === key);
  });
  setSettingsMsg("");
}

async function savePrompt() {
  const key = state.promptKey;
  const area = $("#prompt-text");
  if (!key || !area) return;
  setSettingsMsg("");
  try {
    const value = area.value;
    await api("/api/settings/prompts", { method: "PUT", body: JSON.stringify({ key, value }) });
    state.prompts[key] = value;
    markPanelClean("settings");
    setSettingsMsg("บันทึกแล้ว");
  } catch (err) {
    setSettingsMsg(err.message);
  }
}

async function loadTokens() {
  const who = $("#profile-who");
  if (who && state.session) who.textContent = `${state.session.username} · ${state.session.role}`;
  const rows = $("#token-rows");
  if (!isReady("tokens") && rows) rows.innerHTML = waitHtml("tr", 3);
  let tokens = [];
  try {
    const data = await api("/api/tokens");
    tokens = data.tokens || [];
    const url = $("#mcp-url");
    if (url && data.mcpUrl) url.textContent = data.mcpUrl.replace(/\/$/, "") + "/mcp";
  } finally {
    markReady("tokens");
    if (rows) {
      rows.innerHTML = tokens
        .map(
          (t) => `<tr>
            <td>${esc(t.name)}</td>
            <td class="muted">${esc(t.createdAt)}</td>
            <td><button class="btn ghost" data-revoke="${esc(t.id)}" type="button">เพิกถอน</button></td>
          </tr>`,
        )
        .join("") || `<tr><td colspan="3" class="muted">ยังไม่มี token</td></tr>`;
      rows.onclick = async (e) => {
        const id = e.target.dataset.revoke;
        if (!id) return;
        await api(`/api/tokens/${id}`, { method: "DELETE" });
        await loadTokens();
      };
    }
  }
}

async function copyMcpUrl() {
  const url = $("#mcp-url")?.textContent?.trim() ?? "";
  const msg = $("#copy-mcp-msg");
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    if (msg) msg.textContent = "คัดลอกแล้ว";
  } catch {
    if (msg) msg.textContent = url;
  }
}

async function mintToken() {
  const data = await api("/api/tokens", {
    method: "POST",
    body: JSON.stringify({ name: $("#token-name").value || "mcp" }),
  });
  $("#token-out").textContent = data.token;
  await loadTokens().catch(() => {});
}

async function saveMyCalendar() {
  const msg = $("#me-cal-msg");
  if (msg) msg.textContent = "";
  try {
    await api(`/api/users/${state.session.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ calendarEmail: $("#me-cal-email").value }),
    });
    if (msg) msg.textContent = "บันทึกเมลล์แล้ว";
    await loadScheduleMeta();
    markPanelClean("profile");
  } catch (err) {
    if (msg) msg.textContent = err.message;
  }
}

function sourceHasShopKey() {
  if ($("#shop-key-clear")?.classList.contains("on")) return false;
  return Boolean(state.hasShopKey) || Boolean($("#shop-key")?.value.trim());
}

function refreshSourceLocks() {
  const has = sourceHasShopKey();
  document.querySelectorAll("#src-groups [data-shop='1']").forEach((row) => {
    const wasLocked = row.dataset.locked === "1";
    const locked = !has;
    row.classList.toggle("is-locked", locked);
    row.dataset.locked = locked ? "1" : "0";
    const onVal = row.dataset.on || "shop";
    const onInput = row.querySelector(`input[value="${onVal}"]`);
    const offInput = row.querySelector('input[value="off"]');
    if (onInput) onInput.disabled = locked;
    const hint = row.querySelector(".set-meta .muted");
    if (hint) {
      hint.textContent = locked
        ? "ใส่คีย์ Apify ด้านบนก่อน จึงจะเปิดแหล่งนี้ได้"
        : row.dataset.hint || hint.textContent;
    }
    if (locked && offInput) offInput.checked = true;
    else if (!locked && wasLocked && onInput) onInput.checked = true;
  });
}

async function loadSourceSettings() {
  const box = $("#src-settings");
  if (!box) return;
  const data = await api("/api/settings/sources");
  state.hasShopKey = Boolean(data.hasShopKey);
  const root = $("#src-groups");
  if (root) {
    root.innerHTML = (data.groups || [])
      .map((group) => {
        const locked = Boolean(group.locked);
        const onVal = group.onMode || (group.allowed || []).find((mode) => mode !== "off") || "self";
        const on = !locked && group.mode !== "off";
        return `<div class="set-row${locked ? " is-locked" : ""}" data-group="${esc(group.id)}" data-on="${esc(onVal)}" data-shop="${group.needsKey ? "1" : "0"}" data-locked="${locked ? "1" : "0"}" data-hint="${esc(group.hint || "")}">
          <div class="set-meta">
            <strong>${esc(group.label)}</strong>
            <span class="muted">${esc(locked ? "ใส่คีย์ Apify ด้านบนก่อน จึงจะเปิดแหล่งนี้ได้" : group.hint)}</span>
          </div>
          <div class="seg" role="radiogroup" aria-label="${esc(group.label)}">
            <label class="seg-opt"><input type="radio" name="src-${esc(group.id)}" value="${esc(onVal)}"${on ? " checked" : ""}${locked ? " disabled" : ""}><span>เปิด</span></label>
            <label class="seg-opt"><input type="radio" name="src-${esc(group.id)}" value="off"${on ? "" : " checked"}><span>ปิด</span></label>
          </div>
        </div>`;
      })
      .join("");
  }
  const hint = $("#src-shop-hint");
  if (hint) {
    hint.textContent = data.shopSource === "stored"
      ? "เก็บเข้ารหัสในระบบ — เปิด LinkedIn และค้นเว็บได้"
      : data.hasShopKey
        ? "ใช้จาก env ของเซิร์ฟเวอร์ — เปิด LinkedIn และค้นเว็บได้"
        : "ยังไม่มีคีย์ — LinkedIn และค้นเว็บสาธารณะเปิดไม่ได้";
  }
  const shop = $("#shop-key");
  if (shop) shop.value = "";
  const clear = $("#shop-key-clear");
  if (clear) {
    clear.hidden = data.shopSource !== "stored";
    clear.classList.remove("on");
    clear.textContent = "ลบคีย์ที่เก็บ";
  }
}

function aiSourceLabel(source) {
  if (source === "stored") return "เก็บเข้ารหัสในระบบ";
  return "ยังไม่มีคีย์";
}

function paintAiSettings(data) {
  const root = $("#ai-providers");
  if (!root) return;
  root.innerHTML = (data.providers || [])
    .map((row) => {
      const on = row.id === data.provider;
      const clear =
        row.source === "stored"
          ? `<button class="btn ghost" type="button" data-ai-clear="${esc(row.id)}">ลบคีย์ที่เก็บ</button>`
          : "";
      return `<div class="set-row is-ai" data-ai="${esc(row.id)}">
        <label class="set-pick">
          <input type="radio" name="ai-provider" value="${esc(row.id)}"${on ? " checked" : ""}>
          <span>
            <strong>${esc(row.label)}</strong>
            <em class="muted">${esc(row.hint)} · ${esc(aiSourceLabel(row.source))}</em>
          </span>
        </label>
        <a class="key-doc" href="${esc(row.keyFrom)}" target="_blank" rel="noopener noreferrer">ขอคีย์<span aria-hidden="true">↗</span></a>
        <div class="set-keybar">
          <input type="password" data-ai-key="${esc(row.id)}" autocomplete="new-password" spellcheck="false" maxlength="512" placeholder="คีย์ใหม่เพื่อแทนที่ · เว้นว่างคงค่าเดิม" aria-label="คีย์ ${esc(row.label)}">
          ${clear}
        </div>
      </div>`;
    })
    .join("");
  root.onclick = (e) => {
    const btn = e.target.closest("[data-ai-clear]");
    if (!btn) return;
    btn.classList.toggle("on");
    btn.textContent = btn.classList.contains("on") ? "จะลบเมื่อบันทึก" : "ลบคีย์ที่เก็บ";
  };
  setAiReady(data);
}

async function loadAiSettings() {
  const box = $("#ai-settings");
  if (!box) return;
  const data = await api("/api/settings/ai");
  paintAiSettings(data);
}

async function saveAiSettings() {
  setSettingsMsg("");
  const provider = document.querySelector("[name=ai-provider]:checked")?.value;
  const keys = {};
  document.querySelectorAll("[data-ai-key]").forEach((el) => {
    const id = el.dataset.aiKey;
    const value = el.value.trim();
    if (id && value) keys[id] = value;
  });
  document.querySelectorAll("[data-ai-clear].on").forEach((el) => {
    const id = el.dataset.aiClear;
    if (id && !(id in keys)) keys[id] = "";
  });
  try {
    const data = await api("/api/settings/ai", {
      method: "PUT",
      body: JSON.stringify({ provider, keys }),
    });
    paintAiSettings(data);
    markPanelClean("settings");
    setSettingsMsg("บันทึกแล้ว · คีย์ไม่ออกจากเซิร์ฟเวอร์");
  } catch (err) {
    setSettingsMsg(err.message);
  }
}

async function saveSourceSettings() {
  setSettingsMsg("");
  const modes = {};
  document.querySelectorAll("#src-groups [data-group]").forEach((row) => {
    const id = row.dataset.group;
    if (!id) return;
    const picked = row.querySelector("input:checked:not(:disabled)")?.value
      || row.querySelector('input[value="off"]')?.value
      || "off";
    modes[id] = picked;
  });
  const body = { modes };
  const typed = $("#shop-key")?.value.trim();
  if (typed) body.shopKey = typed;
  else if ($("#shop-key-clear")?.classList.contains("on")) body.shopKey = "";
  try {
    const data = await api("/api/settings/sources", { method: "PUT", body: JSON.stringify(body) });
    setSettingsMsg("บันทึกแล้ว · คีย์ไม่ออกจากเซิร์ฟเวอร์");
    state.lanes = null;
    state.hasShopKey = Boolean(data.hasShopKey);
    await loadSourceSettings();
    markPanelClean("settings");
  } catch (err) {
    setSettingsMsg(err.message);
  }
}

async function loadCalendarSettings() {
  const box = $("#cal-settings");
  if (!box) return;
  const data = await api("/api/schedule/status");
  const mode = data.mode || "share";
  box.querySelectorAll("[name=cal-mode]").forEach((el) => {
    el.checked = el.value === mode;
  });
  const area = $("#cal-share-emails");
  if (area) area.value = data.shareEmails || "";
}

async function saveCalendarSettings() {
  setSettingsMsg("");
  const mode = document.querySelector("[name=cal-mode]:checked")?.value || "share";
  try {
    await api("/api/settings/calendar", {
      method: "PUT",
      body: JSON.stringify({ mode, shareEmails: $("#cal-share-emails")?.value || "" }),
    });
    setSettingsMsg("บันทึกแล้ว");
    await loadScheduleMeta();
    await loadBusy();
    renderCalendar();
    markPanelClean("settings");
  } catch (err) {
    setSettingsMsg(err.message);
  }
}

async function changeMyPassword() {
  const password = $("#me-password").value;
  const msg = $("#me-password-msg");
  msg.textContent = "";
  try {
    await api(`/api/users/${state.session.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    });
    $("#me-password").value = "";
    msg.textContent = "เปลี่ยนแล้ว";
    markPanelClean("profile");
  } catch (err) {
    msg.textContent = err.message;
  }
}

const ROLE_TH = { member: "สมาชิก", admin: "ผู้ดูแล" };

function userErrText(err) {
  const code = String(err?.message || "").split(":")[0];
  const map = {
    username_taken: "ชื่อนีมีในระบบแล้ว",
    last_admin: "ต้องเหลือผู้ดูแลอย่างน้อยหนึ่งคน",
    self: "ลบบัญชีที่ใช้อยู่ไม่ได้",
    invalid_body: "ตรวจชื่อ รหัสผ่าน (อย่างน้อย 10 ตัว) และสิทธิ์",
    not_found: "ไม่พบบัญชีนี้",
  };
  return map[code] || err.message || "ทำรายการไม่สำเร็จ";
}

function bindUserModal() {
  $("#user-form")?.addEventListener("submit", saveUserForm);
  $("#user-dismiss")?.addEventListener("click", () => $("#user-modal")?.close());
  $("#user-delete")?.addEventListener("click", deleteUserFromModal);
  $("#user-modal")?.addEventListener("cancel", (e) => {
    if (!choiceOpen) return;
    e.preventDefault();
    closeChoice();
  });
  $("#user-modal")?.addEventListener("close", () => {
    state.editUserId = null;
    closeChoice();
  });
}

function openUserCreate() {
  const dlg = $("#user-modal");
  if (!dlg) return;
  closeChoice();
  state.editUserId = null;
  if ($("#user-kind")) $("#user-kind").textContent = "เพิ่มผู้ใช้";
  if ($("#user-title")) $("#user-title").textContent = "บัญชีใหม่";
  if ($("#user-sub")) $("#user-sub").textContent = "ชื่อภาษาอังกฤษหรือตัวเลข · รหัสผ่านอย่างน้อย 10 ตัว";
  if ($("#user-create-fields")) $("#user-create-fields").hidden = false;
  if ($("#user-edit-fields")) $("#user-edit-fields").hidden = true;
  if ($("#user-disabled-row")) $("#user-disabled-row").hidden = true;
  if ($("#user-delete")) $("#user-delete").hidden = true;
  if ($("#user-save")) $("#user-save").textContent = "เพิ่มผู้ใช้";
  if ($("#user-name")) {
    $("#user-name").value = "";
    $("#user-name").required = true;
  }
  if ($("#user-pass")) {
    $("#user-pass").value = "";
    $("#user-pass").required = true;
  }
  if ($("#user-pass-new")) $("#user-pass-new").value = "";
  if ($("#user-role")) $("#user-role").value = "member";
  if ($("#user-disabled")) $("#user-disabled").checked = false;
  if ($("#user-err")) $("#user-err").textContent = "";
  if (!dlg.open) dlg.showModal();
  $("#user-name")?.focus();
}

function openUserEdit(id) {
  const user = (state.users || []).find((u) => u.id === id);
  const dlg = $("#user-modal");
  if (!user || !dlg) return;
  closeChoice();
  state.editUserId = id;
  const mine = id === state.session?.userId;
  if ($("#user-kind")) $("#user-kind").textContent = "แก้ไขผู้ใช้";
  if ($("#user-title")) $("#user-title").textContent = user.username;
  if ($("#user-sub")) {
    $("#user-sub").textContent = mine ? "นี่คือบัญชีที่ใช้อยู่ — ลบหรือปิดใช้ไม่ได้จากที่นี่" : "ปรับสิทธิ์ ปิดใช้ หรือตั้งรหัสผ่านใหม่";
  }
  if ($("#user-create-fields")) $("#user-create-fields").hidden = true;
  if ($("#user-edit-fields")) $("#user-edit-fields").hidden = false;
  if ($("#user-disabled-row")) $("#user-disabled-row").hidden = mine;
  if ($("#user-delete")) $("#user-delete").hidden = mine || !can("users.write");
  if ($("#user-save")) $("#user-save").textContent = "บันทึก";
  if ($("#user-name")) $("#user-name").required = false;
  if ($("#user-pass")) $("#user-pass").required = false;
  if ($("#user-pass-new")) $("#user-pass-new").value = "";
  if ($("#user-role")) $("#user-role").value = user.role === "admin" ? "admin" : "member";
  if ($("#user-disabled")) $("#user-disabled").checked = Boolean(user.disabled);
  if ($("#user-err")) $("#user-err").textContent = "";
  if (!dlg.open) dlg.showModal();
}

async function saveUserForm(event) {
  event.preventDefault();
  const err = $("#user-err");
  if (err) err.textContent = "";
  const role = $("#user-role")?.value || "member";
  try {
    if (!state.editUserId) {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: $("#user-name")?.value.trim(),
          password: $("#user-pass")?.value,
          role,
        }),
      });
    } else {
      const body = { role, disabled: Boolean($("#user-disabled")?.checked) };
      const nextPass = $("#user-pass-new")?.value || "";
      if (nextPass) body.password = nextPass;
      await api(`/api/users/${state.editUserId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    }
    $("#user-modal")?.close();
    await loadUsers();
    markPanelClean("users");
  } catch (e) {
    if (err) err.textContent = userErrText(e);
  }
}

async function deleteUserFromModal() {
  const id = state.editUserId;
  if (!id) return;
  const user = (state.users || []).find((u) => u.id === id);
  $("#user-modal")?.close();
  const ok = await askModal({
    title: "ลบบัญชีนี้?",
    body: user ? `ลบ “${user.username}” ออกจากระบบ` : "ลบผู้ใช้นี้ออกจากระบบ",
    ok: "ลบบัญชี",
    no: "ไม่ลบ",
    danger: true,
  });
  if (!ok) {
    openUserEdit(id);
    return;
  }
  try {
    await api(`/api/users/${id}`, { method: "DELETE" });
    await loadUsers();
  } catch (e) {
    openUserEdit(id);
    if ($("#user-err")) $("#user-err").textContent = userErrText(e);
  }
}

async function loadUsers() {
  const rows = $("#user-rows");
  if (!isReady("users") && rows) rows.innerHTML = waitHtml("tr", 4);
  try {
    const data = await api("/api/users");
    state.users = data.users || [];
  } finally {
    markReady("users");
    if (rows) {
      const write = can("users.write");
      rows.innerHTML = (state.users || [])
        .map((u) => {
          const mine = u.id === state.session?.userId ? `<span class="muted"> · คุณ</span>` : "";
          const edit = write
            ? `<button class="btn ghost" type="button" data-edit="${esc(u.id)}">แก้ไข</button>`
            : "";
          return `<tr data-edit="${esc(u.id)}" ${write ? "data-clickable" : ""}>
            <td><strong>${esc(u.username)}</strong>${mine}</td>
            <td>${esc(ROLE_TH[u.role] || u.role)}</td>
            <td>${u.disabled ? "ปิดใช้" : "เปิด"}</td>
            <td>${edit}</td>
          </tr>`;
        })
        .join("") || `<tr><td colspan="4" class="muted">ยังไม่มีผู้ใช้</td></tr>`;
      rows.onclick = (e) => {
        if (!write) return;
        const id = e.target.closest("[data-edit]")?.dataset.edit;
        if (id) openUserEdit(id);
      };
    }
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function num(value) {
  return value == null ? "–" : Number(value).toFixed(1);
}

const STAGE_TH = {
  applied: "ยื่น",
  screening: "คัด",
  prescreen: "คุยสั้น",
  interview: "สัมภาษณ์",
  offer: "ข้อเสนอ",
  hired: "รับ",
  rejected: "ไม่ผ่าน",
};

const KIND_TH = {
  entered: "เข้าเป็นผู้สมัคร",
  moved: "ย้ายขั้น",
  screened: "คัดกรอง Resume",
  booked: "จองนัด",
  rescheduled: "แก้นัด",
  cancelled: "ยกเลิกนัด",
};

const PATH = ["applied", "screening", "prescreen", "interview", "offer", "hired"];

function pipeStages(stages) {
  const list = stages && stages.length ? stages : PATH;
  return list.filter((s) => s !== "rejected");
}

function stageOptions(stages) {
  return (
    `<option value="">ทุกขั้น</option>` +
    pipeStages(stages)
      .map((s) => `<option value="${s}">${STAGE_TH[s] || s}</option>`)
      .join("") +
    `<option value="rejected">ไม่ผ่าน</option>`
  );
}

function stageChip(stage) {
  const kind = stage === "rejected" ? "drop" : stage;
  return `<span class="stage-chip is-${esc(kind)}">${esc(STAGE_TH[stage] || stage)}</span>`;
}

function railDots(c) {
  const idx = PATH.indexOf(c.stage);
  return PATH.map((s, i) => {
    let cls = "";
    if (c.stage === "rejected") cls = "dim";
    else if (s === c.stage) cls = "now";
    else if (idx > i) cls = "on";
    return `<i class="${cls}" title="${STAGE_TH[s]}"></i>`;
  }).join("");
}

async function openPerson(id) {
  const data = await api(`/api/candidates/${id}`);
  const dropped = data.candidate.stage === "rejected";
  const here = dropped ? -1 : Math.max(0, PATH.indexOf(data.candidate.stage));
  state.person = { ...data, path: PATH, cursor: Math.max(0, here), dir: 1 };
  openDrawer();
  renderStepper();
  markDrawerClean();
  markPanelClean("board");
}

function shiftStep(dir) {
  if (!state.person) return;
  const next = state.person.cursor + dir;
  if (next < 0 || next >= state.person.path.length) return;
  state.person.dir = dir;
  state.person.cursor = next;
  renderStepper();
}

function renderStepper() {
  const p = state.person;
  if (!p) return;
  const c = p.candidate;
  const path = p.path;
  const dropped = c.stage === "rejected";
  const here = dropped ? -1 : Math.max(0, path.indexOf(c.stage));
  const view = path[p.cursor];
  $("#drawer-name").textContent = c.display_name;
  $("#drawer-src").textContent = dropped
    ? `${c.source || "—"} · ไม่ผ่าน (ออกจากท่อ)`
    : `${c.source || "—"} · อยู่ที่ ${STAGE_TH[c.stage] || c.stage}`;
  const dropFlag = $("#drawer-drop");
  if (dropFlag) dropFlag.hidden = !dropped;
  if ($("#edit-name")) $("#edit-name").value = c.display_name || "";
  if ($("#edit-email")) $("#edit-email").value = c.email || "";
  if ($("#edit-phone")) $("#edit-phone").value = c.phone || "";
  $("#step-pos").textContent = `${p.cursor + 1} / ${path.length}`;
  $("#step-prev").disabled = p.cursor === 0;
  $("#step-next").disabled = p.cursor === path.length - 1;

  const n = Math.max(1, path.length - 1);
  const track = $("#person-track");
  if (track) {
    track.style.setProperty("--at", String((Math.max(0, p.cursor) / n) * 100));
    track.classList.toggle("is-drop", dropped);
  }
  $("#drawer-steps").innerHTML = path
    .map((s, i) => {
      const cls = [
        `is-${s}`,
        s === c.stage ? "now" : "",
        here > i ? "done" : "",
        i === p.cursor ? "view" : "",
        dropped ? "dim" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${cls}" data-i="${i}" data-stage="${s}">${STAGE_TH[s]}</button>`;
    })
    .join("");
  $("#drawer-steps").onclick = (e) => {
    const btn = e.target.closest("[data-i]");
    if (!btn) return;
    const i = Number(btn.dataset.i);
    state.person.dir = i < p.cursor ? -1 : 1;
    state.person.cursor = i;
    renderStepper();
  };

  const when = dropped ? "ออกจากท่อ" : p.cursor < here ? "ผ่านแล้ว" : p.cursor === here ? "อยู่ตรงนี้" : "ขั้นถัดไป";
  const events = (p.trail || []).filter((ev) => {
    if (ev.stage === view) return true;
    if (view === "screening" && ev.kind === "screened") return true;
    if (view === "interview" && (ev.kind === "booked" || ev.kind === "rescheduled" || ev.kind === "cancelled")) return true;
    if (view === "applied" && ev.kind === "entered") return true;
    return false;
  });
  const meets = (p.interviews || []).filter(() => view === "interview");
  const showScore = (view === "screening" || view === "prescreen" || view === "interview") && p.application;
  let extra = "";
  if (showScore) {
    const app = p.application;
    extra = `<div class="score-row"><span>Skills</span><div class="bar"><i style="width:${barPct(app.skills_score)}%"></i></div><b>${num(app.skills_score)}</b></div>
      <p class="muted">${esc(app.skills_why || "")}</p>
      <div class="score-row"><span>Experience</span><div class="bar"><i style="width:${barPct(app.experience_score)}%"></i></div><b>${num(app.experience_score)}</b></div>
      <p class="muted">${esc(app.experience_why || "")}</p>
      <div class="score-row"><span>Culture</span><div class="bar"><i style="width:${barPct(app.culture_score)}%"></i></div><b>${num(app.culture_score)}</b></div>
      <p class="muted">${esc(app.culture_why || "")}</p>
      <p>${esc(app.summary || "")}</p>`;
  }
  if (meets.length) {
    extra += meets
      .map((m) => `<p class="muted">นัด ${esc(fmtWhen(m.starts_at))}</p>`)
      .join("");
  }
  const hist = events.length
    ? `<ol class="trail">${events
        .map((ev) => {
          const label = KIND_TH[ev.kind] || ev.kind;
          return `<li><time>${esc(fmtWhen(ev.created_at))}</time>${esc(label)}${
            ev.detail ? ` · ${esc(ev.detail)}` : ""
          }</li>`;
        })
        .join("")}</ol>`
    : p.cursor < here
      ? `<p class="muted">ข้ามมาหรือยังไม่มีบันทึกในขั้นนี้</p>`
      : p.cursor > here
        ? `<p class="muted">ยังไม่ถึง — นี่คือสิ่งที่จะทำเมื่อคนนี้อยู่ขั้นนี้</p>`
        : `<p class="muted">ยังไม่มีเหตุการณ์ในขั้นนี้</p>`;

  let action = "";
  if (can("candidates.write") && (dropped || p.cursor > here)) {
    action = `<div class="row"><button class="btn" type="button" id="step-go">${dropped ? "นำกลับเข้าท่อที่ขั้นนี้" : "ขยับมาขั้นนี้"}</button></div>`;
  }
  if (can("candidates.write") && view === "interview") {
    action += `<div class="row"><button class="btn ghost" type="button" id="step-cal">ไปนัดสัมภาษณ์</button></div>`;
  }
  if (can("candidates.write") && here === p.cursor && !dropped && c.stage !== "hired") {
    action += `<div class="row"><button class="btn ghost" type="button" id="step-reject">ไม่ผ่าน</button></div>`;
  }

  const body = $("#step-body");
  body.classList.remove("swap", "swap-back");
  void body.offsetWidth;
  body.innerHTML = `
    <div class="step-tag">${when}</div>
    <h3>${STAGE_TH[view]}</h3>
    ${hist}
    ${extra}
    ${action}`;
  body.classList.add(p.dir < 0 ? "swap-back" : "swap");

  const go = $("#step-go");
  if (go) {
    go.onclick = async () => {
      await api(`/api/candidates/${c.id}`, { method: "PATCH", body: JSON.stringify({ stage: view }) });
      await loadBoard();
      await loadPeople();
      await openPerson(c.id);
      state.person.cursor = PATH.indexOf(view);
      renderStepper();
    };
  }
  const cal = $("#step-cal");
  if (cal) {
    cal.onclick = () => {
      closeDrawer();
      showTab("schedule");
      const sel = $("#book-candidate");
      if (sel) sel.value = c.id;
    };
  }
  const no = $("#step-reject");
  if (no) {
    no.onclick = async () => {
      await api(`/api/candidates/${c.id}`, { method: "PATCH", body: JSON.stringify({ stage: "rejected" }) });
      await loadBoard();
      await loadPeople();
      await openPerson(c.id);
    };
  }
}

boot().catch((err) => {
  console.error(err);
});
