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
  jobId: null,
  stages: [],
  session: null,
  interviews: [],
  scoutLog: [],
  origin: "thai",
  lanes: null,
  analysis: null,
  candidates: [],
  boardView: "board",
  busy: [],
  people: [],
  calMode: "share",
  calWho: "all",
  calTeam: false,
  calMe: false,
  week: startOfWeek(new Date()),
  day: startOfDay(new Date()),
  pick: null,
  minutes: 45,
  screenWait: new Map(),
  liveTimer: 0,
  liveDelay: 500,
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const TITLES = {
  home: ["ภาพรวม", "เลนวันนี้"],
  scout: ["AI", "ค้นคนจาก JD"],
  screen: ["AI", "คัดเรซูเม่"],
  board: ["ติดตาม", "Pipeline"],
  schedule: ["นัดหมาย", "ปฏิทิน"],
  users: ["ระบบ", "ผู้ใช้"],
  settings: ["ระบบ", "Settings"],
  profile: ["ระบบ", "โปรไฟล์"],
};

function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function can(perm) {
  return Boolean(state.session?.can?.[perm]);
}

function motionOk() {
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function bindFeel() {
  document.addEventListener("pointermove", (e) => {
    const mx = (e.clientX / innerWidth) * 100;
    const my = (e.clientY / innerHeight) * 100;
    document.documentElement.style.setProperty("--mx", `${mx}%`);
    document.documentElement.style.setProperty("--my", `${my}%`);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
  addEventListener("resize", placeNavPill);
  const veil = $("#drawer-veil");
  if (veil) veil.onclick = closeDrawer;
}

function placeNavPill() {
  const nav = document.querySelector(".side nav");
  const on = nav?.querySelector("button.on");
  const pill = $("#nav-pill");
  if (!nav || !on || !pill) return;
  const nr = nav.getBoundingClientRect();
  const br = on.getBoundingClientRect();
  pill.style.height = `${br.height}px`;
  pill.style.transform = `translateY(${br.top - nr.top}px)`;
}

function countTo(el, n) {
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

function closeDrawer() {
  const d = $("#person-drawer");
  const v = $("#drawer-veil");
  if (!d || d.hidden) return;
  d.classList.remove("is-open");
  if (v) v.classList.remove("is-open");
  const hide = () => {
    d.hidden = true;
    if (v) v.hidden = true;
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

async function boot() {
  const session = await api("/api/session");
  if (!session.authenticated) {
    location.href = "/";
    return;
  }
  state.session = session;
  applyLimits(session.limits || {});
  applyCaps();
  bindNav();
  bindFeel();
  $("#who").textContent = `${session.username} · ${session.role}`;
  const initial = String(session.username || "A").slice(0, 1).toUpperCase();
  const mark = $("#who-mark");
  const topAv = $("#top-avatar");
  if (mark) mark.textContent = initial;
  if (topAv) topAv.textContent = initial;
  $("#logout").onclick = async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    location.href = "/";
  };
  $("#jd-search").onclick = runScout;
  $("#origin-row")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-origin]");
    if (!btn) return;
    state.origin = btn.dataset.origin || "any";
    $("#origin-row").querySelectorAll("[data-origin]").forEach((el) => {
      el.classList.toggle("on", el === btn);
    });
    loadLatestShortlist().catch(() => {});
  });
  $("#approve").onclick = approveSelected;
  $("#screen-form").onsubmit = runScreen;
  $("#manual-add").onclick = addManual;
  $("#book-form").onsubmit = bookInterview;
  $("#mint-token").onclick = mintToken;
  $("#copy-mcp-url")?.addEventListener("click", copyMcpUrl);
  $("#me-password-save").onclick = changeMyPassword;
  $("#me-cal-save")?.addEventListener("click", saveMyCalendar);
  $("#cal-settings-save")?.addEventListener("click", saveCalendarSettings);
  $("#top-avatar")?.addEventListener("click", () => showTab("profile"));
  $("#who-mark")?.addEventListener("click", () => showTab("profile"));
  $("#user-add").onclick = addUser;
  $("#approve-all")?.addEventListener("click", approveAllHits);
  $("#view-board")?.addEventListener("click", () => setBoardView("board"));
  $("#view-list")?.addEventListener("click", () => setBoardView("list"));
  $("#person-edit")?.addEventListener("submit", savePerson);
  $("#person-del")?.addEventListener("click", deletePerson);
  $("#new-job-add").onclick = addJob;
  $("#cal-prev").onclick = () => shiftWeek(-1);
  $("#cal-next").onclick = () => shiftWeek(1);
  $("#cal-today").onclick = () => {
    const now = new Date();
    state.week = startOfWeek(now);
    state.day = startOfDay(now);
    loadBusy().then(() => renderCalendar());
  };
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.go);
  });
  $("#dur-pills").onclick = (e) => {
    const min = e.target.dataset.min;
    if (!min) return;
    state.minutes = Number(min);
    $("#book-form [name=minutes]").value = min;
    $("#dur-pills").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
    renderCalendar();
  };
  $("#drawer-close").onclick = closeDrawer;
  $("#step-prev").onclick = () => shiftStep(-1);
  $("#step-next").onclick = () => shiftStep(1);
  const loads = [loadJobs(), loadBoard(), loadInterviews()];
  if (can("settings.read")) loads.push(loadPrompts(), loadCalendarSettings());
  if (can("users.read")) loads.push(loadUsers());
  await Promise.all(loads);
  renderHome();
  placeNavPill();
  connectLive();
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab");
  if (tab) showTab(tab);
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
  const prompts = $("#admin-prompts");
  if (prompts) prompts.hidden = !can("settings.read");
  const calSet = $("#cal-settings");
  if (calSet) calSet.hidden = !can("settings.read");
}

function applyLimits(L) {
  const set = (sel, max) => {
    const el = $(sel);
    if (el && max) el.maxLength = max;
  };
  set("#jd-title", L.jobTitleMax);
  set("#jd-text", L.jobDescMax);
  set("#new-job-title", L.jobTitleMax);
  set("#new-job-desc", L.jobDescMax);
  set('#screen-form [name=name]', L.candidateNameMax);
  set('#screen-form [name=email]', L.emailMax);
  set('#screen-form [name=text]', L.resumeTextMax);
  set("#manual-name", L.candidateNameMax);
  set("#manual-source", L.sourceMax);
  set("#token-name", L.tokenNameMax);
  set("#user-name", L.usernameMax);
  set("#user-pass", L.passwordMax);
  set("#me-password", L.passwordMax);
  const minutes = $('#book-form [name=minutes]');
  if (minutes && L.interviewMinutesMin) {
    minutes.min = L.interviewMinutesMin;
    minutes.max = L.interviewMinutesMax;
  }
}

function bindNav() {
  document.querySelectorAll("nav [data-tab]").forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
}

function showTab(tab) {
  const btn = document.querySelector(`nav [data-tab="${tab}"]`);
  if (!btn || btn.hidden) return;
  if (tab === "users" && !can("users.read")) return;
  document.querySelectorAll("nav [data-tab]").forEach((b) => b.classList.toggle("on", b === btn));
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
  if (tab === "home") renderHome();
  if (tab === "scout") loadSourceLanes().catch(() => {});
  if (tab === "screen") loadJobs().catch(() => {});
  if (tab === "board") loadBoard().catch(() => {});
  if (tab === "schedule") loadInterviews().catch(() => {});
  if (tab === "profile") Promise.all([loadTokens(), loadScheduleMeta()]).catch(() => {});
  if (tab === "settings" && can("settings.read")) loadCalendarSettings().catch(() => {});
}

function renderHome() {
  const people = document.querySelectorAll("#board .chip").length;
  countTo($("#stat-people"), state.peopleCount || people || 0);
  countTo($("#stat-meets"), (state.interviews || []).length);
  countTo($("#stat-jobs"), $("#screen-job")?.options.length || 0);
  const soon = (state.interviews || [])
    .slice()
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0];
  $("#home-next").innerHTML = soon
    ? `<strong>${esc(soon.display_name)}</strong><div class="muted">${esc(fmtWhen(soon.starts_at))}</div>`
    : "ยังไม่มีนัด";
}

async function loadJobs() {
  const data = await api("/api/jobs");
  const sel = $("#screen-job");
  sel.innerHTML = data.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("");
  const fj = $("#filter-job");
  if (fj) {
    const cur = fj.value;
    fj.innerHTML =
      `<option value="">ทุกตำแหน่ง</option>` +
      data.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("");
    fj.value = cur;
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
    alert(err.message);
  }
}

async function loadSourceLanes() {
  if (!state.lanes) {
    const data = await api("/api/scout/sources");
    state.lanes = data.lanes;
    state.analysis = data.analysis;
  }
  paintSourceMap(state.lanes, state.analysis);
  if (!state.shortlist.length) await loadLatestShortlist();
}

async function loadLatestShortlist() {
  try {
    const data = await api("/api/scout/latest?origin=thai");
    state.shortlist = data.shortlist || [];
    state.jobId = data.jobId || state.jobId;
    if (data.shortlist?.length) {
      $("#scout-meta").textContent = `รอบล่าสุด · ${data.shortlist.length} คนที่จ้างได้${data.title ? ` · ${data.title}` : ""}`;
    }
    paintShortlist(data.shortlist);
  } catch {
    paintShortlist([]);
  }
}

function paintSourceMap(lanes, analysis) {
  const note = $("#source-analysis");
  if (note && analysis) note.textContent = analysis.headline;
  const root = $("#source-lanes");
  if (!root || !lanes) return;
  const all = [...(lanes.live || []), ...(lanes.hr_click || []), ...(lanes.blocked || [])];
  const people = all.filter((card) => card.family === "people" && card.url);
  const cols = [
    ["live", "ดึงสด", "API สาธารณะ — คนขึ้น shortlist"],
    ["hr_click", "เปิดลิงก์ให้ HR", "ไม่มี API โปรไฟล์ที่เราใช้ได้"],
    ["blocked", "ไม่ดึง", "กำแพงล็อกอิน / ข้อตกลง / บอร์ดงาน"],
  ];
  const peopleRow = people.length
    ? `<div class="lane-col lane-people">
        <p class="eyebrow">ค้นคนให้ HR <b>${people.length}</b></p>
        <p class="muted">People Search ทางการ — กดเปิดเอง ไม่ดึงเข้าท่อ</p>
        <div class="src-links">${people.map(sourceChip).join("")}</div>
      </div>`
    : "";
  root.innerHTML =
    peopleRow +
    cols
      .map(([key, title, hint]) => {
        const items = lanes[key] || [];
        return `<div class="lane-col lane-${key}">
        <p class="eyebrow">${title} <b>${items.length}</b></p>
        <p class="muted">${hint}</p>
        <div class="src-links">${items.map(sourceChip).join("")}</div>
      </div>`;
      })
      .join("");
}

function sourceChip(card) {
  const count = typeof card.count === "number" ? `<em>${card.count}</em>` : "";
  const body = `${esc(card.label)}${count}`;
  if (card.url) {
    return `<a class="src-chip ${esc(card.lane)}" href="${esc(card.url)}" target="_blank" rel="noopener" title="${esc(card.why)}">${body}</a>`;
  }
  return `<span class="src-chip ${esc(card.lane)}" title="${esc(card.why)}">${body}</span>`;
}

function sourceName(id) {
  const all = [...(state.lanes?.live || []), ...(state.lanes?.hr_click || []), ...(state.lanes?.blocked || [])];
  return all.find((row) => row.id === id)?.label || id;
}

async function runScout() {
  state.scoutLog = [];
  paintScoutLog();
  $("#scout-meta").textContent = "ดึงแหล่งสาธารณะ — LinkedIn เป็นลิงก์ให้เปิด · ร้านขูดเฉพาะเว็บเปิด…";
  $("#shortlist").innerHTML = "";
  try {
    const data = await api("/api/scout/search", {
      method: "POST",
      body: JSON.stringify({
        title: $("#jd-title").value,
        jd: $("#jd-text").value,
        origin: "thai",
      }),
    });
    state.shortlist = data.shortlist;
    state.jobId = data.jobId;
    state.lanes = data.lanes;
    state.analysis = data.analysis;
    const via = data.rankedBy === "model" ? "AI ให้คะแนน" : "คะแนนจากกฎตำแหน่ง";
    const who = "คนไทย";
    $("#scout-meta").textContent = `หา${who} · คำค้น: ${data.query} · ${data.shortlist.length} คนที่จ้างได้ · ${via}`;
    paintSourceMap(data.lanes, data.analysis);
    paintShortlist(data.shortlist);
    $("#shortlist-panel")?.scrollIntoView({ block: "start", behavior: motionOk() ? "smooth" : "auto" });
  } catch (err) {
    $("#scout-meta").textContent = err.message || "scout_failed";
  }
  await loadJobs().catch(() => {});
}

function paintShortlist(hits) {
  $("#shortlist").innerHTML = (hits || [])
    .map((hit) => {
      const score = typeof hit.fitScore === "number" ? hit.fitScore : null;
      const pick = score === null || score >= 5;
      return `<label class="hit">
          <input type="checkbox" value="${hit.id}" ${pick ? "checked" : ""}>
          <strong>${esc(hit.displayName)}</strong>
          <span class="pill">${score ?? "–"} · ${esc(sourceName(hit.source))}</span>
          <div class="muted">${esc(hit.headline || "")}</div>
          <div>${esc(hit.reason || "")}</div>
          ${
            hit.profileUrl
              ? `<a href="${esc(hit.profileUrl)}" target="_blank" rel="noopener">โปรไฟล์</a>`
              : `<span class="muted">ไม่มีลิงก์โปรไฟล์ — ไม่ส่งเข้าท่อ</span>`
          }
          ${hit.portfolioUrl ? `<a href="${esc(hit.portfolioUrl)}" target="_blank" rel="noopener">พอร์ตส่วนตัว</a>` : ""}
        </label>`;
    })
    .join("") || `<p class="muted">ยังไม่มีโปรไฟล์คนจากแหล่งสด</p>`;
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
};

function paintScoutLog() {
  const box = $("#scout-log");
  if (!box) return;
  box.innerHTML = (state.scoutLog || [])
    .map((row) => {
      const mark = SCOUT_STATE[row.state] || row.state;
      return `<li><span class="st ${esc(row.state)}">${esc(mark)}</span><span>${esc(row.message)}</span></li>`;
    })
    .join("");
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
  });
  if (state.scoutLog.length > 40) state.scoutLog = state.scoutLog.slice(-40);
  paintScoutLog();
}

async function approveSelected() {
  const ids = [...document.querySelectorAll("#shortlist input:checked")].map((n) => n.value);
  if (!ids.length) return;
  await api("/api/scout/approve", { method: "POST", body: JSON.stringify({ ids }) });
  await loadBoard();
  $("#scout-meta").textContent = `ส่งเข้าท่อแล้ว ${ids.length} คน`;
  showTab("board");
}

async function approveAllHits() {
  document.querySelectorAll("#shortlist input[type=checkbox]").forEach((el) => {
    el.checked = true;
  });
  await approveSelected();
}

async function runScreen(event) {
  event.preventDefault();
  const box = $("#scorecard");
  box.innerHTML = "<p class='muted'>กำลังให้ GLM อ่านเรซูเม่…</p>";
  const form = new FormData(event.target);
  const data = await api("/api/screen", { method: "POST", body: form });
  if (data.status === "queued") {
    box.innerHTML = "<p>คิวอยู่บน Cloudflare Queue แล้ว รอสัญญาณสด…</p>";
    const pending = waitScreen(data.applicationId);
    const now = await api(`/api/screen/${data.applicationId}`);
    if (now.application.status === "ready") {
      state.screenWait.delete(data.applicationId);
      renderScore(now.application);
      await loadBoard();
      return;
    }
    await pending;
    return;
  }
  const detail = await api(`/api/screen/${data.applicationId}`);
  renderScore(detail.application);
  await loadBoard();
}

function waitScreen(id) {
  return new Promise((resolve) => {
    state.screenWait.set(id, resolve);
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
    }
    await loadBoard();
    renderHome();
    return;
  }
  if (ev.type === "screen.failed" && ev.applicationId) {
    const wait = state.screenWait.get(ev.applicationId);
    if (wait) {
      state.screenWait.delete(ev.applicationId);
      $("#scorecard").innerHTML = "<p>คัดเรซูเม่ไม่สำเร็จ จะลองใหม่อัตโนมัติจากคิว</p>";
      wait();
    }
    return;
  }
  if (ev.type === "scout.progress") {
    pushScoutLog(ev);
    if (ev.message) $("#scout-meta").textContent = ev.message;
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
  box.innerHTML = stages
    .map((s) => {
      const n = candidates.filter((c) => c.stage === s).length;
      return `<button type="button" class="${cur === s ? "on" : ""}" data-funnel="${s}"><b>${n}</b><span>${STAGE_TH[s] || s}</span></button>`;
    })
    .join("");
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

function renderScore(app) {
  $("#scorecard").innerHTML = `
    <p class="eyebrow">AI Resume Screener</p>
    <h3>${esc(app.display_name)} · ${esc(app.job_title)}</h3>
    <div class="score-row"><span>Skills</span><div class="bar"><i style="width:${barPct(app.skills_score)}%"></i></div><b>${num(app.skills_score)}</b></div>
    <p class="muted">${esc(app.skills_why || "")}</p>
    <div class="score-row"><span>Experience</span><div class="bar"><i style="width:${barPct(app.experience_score)}%"></i></div><b>${num(app.experience_score)}</b></div>
    <p class="muted">${esc(app.experience_why || "")}</p>
    <div class="score-row"><span>Culture</span><div class="bar"><i style="width:${barPct(app.culture_score)}%"></i></div><b>${num(app.culture_score)}</b></div>
    <p class="muted">${esc(app.culture_why || "")}</p>
    <p>${esc(app.summary || "")}</p>
    <button class="btn" type="button" id="pack-btn" data-id="${esc(app.id)}">ชุดสัมภาษณ์ให้ทีม</button>
    <p><strong>จุดแข็ง</strong> ${(app.strengths || []).map(esc).join(" · ")}</p>
    <p><strong>ธงแดง / ต้องถาม</strong> ${(app.flags || []).map(esc).join(" · ")}</p>
    <ol>${(app.questions || []).map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
  `;
  const packBtn = $("#pack-btn");
  if (packBtn) {
    packBtn.onclick = async () => {
      const pack = await api(`/api/screen/${packBtn.dataset.id}/pack`, { method: "POST" });
      const body = pack.pack || pack;
      $("#scorecard").insertAdjacentHTML(
        "beforeend",
        `<div class="panel"><strong>${esc(body.title || "ชุดสัมภาษณ์")}</strong>
         <p>${(body.talkingPoints || []).map(esc).join(" · ")}</p>
         <ol>${(body.questions || []).map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
         <p class="muted">${(body.risks || []).map(esc).join(" · ")}</p></div>`,
      );
    };
  }
}

async function loadBoard() {
  const qs = new URLSearchParams();
  const stage = $("#filter-stage")?.value;
  const source = $("#filter-source")?.value;
  const jobId = $("#filter-job")?.value;
  if (stage) qs.set("stage", stage);
  if (source) qs.set("source", source);
  if (jobId) qs.set("jobId", jobId);
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
    $("#filter-stage").innerHTML =
      `<option value="">ทุกสเตจ</option>` + data.stages.map((s) => `<option value="${s}">${STAGE_TH[s] || s}</option>`).join("");
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
  paintFunnel(data.stages, data.candidates);
  const board = $("#board");
  if (state.boardView === "list") {
    board.className = "panel";
    board.innerHTML = `<table class="list-table"><thead><tr><th>ชื่อ</th><th>ขั้น</th><th>แหล่ง</th><th>ตำแหน่ง</th><th>AI</th></tr></thead><tbody>
      ${data.candidates
        .map(
          (c) => `<tr data-clickable data-id="${c.id}" style="cursor:pointer">
            <td><strong>${esc(c.display_name)}</strong></td>
            <td>${esc(STAGE_TH[c.stage] || c.stage)}</td>
            <td>${esc(c.source || "—")}</td>
            <td>${esc(c.job_title || "—")}</td>
            <td>${scoreMini(c)}</td>
          </tr>`,
        )
        .join("") || `<tr><td colspan="5" class="muted">ยังไม่มีผู้สมัครในตัวกรองนี้</td></tr>`}
    </tbody></table>`;
    board.querySelectorAll("[data-id]").forEach((row) => {
      row.addEventListener("click", () => openPerson(row.dataset.id));
    });
    return;
  }
  board.className = "board";
  board.innerHTML = data.stages
    .map((stage) => {
      const rows = data.candidates.filter((c) => c.stage === stage);
      const cards = rows
        .map(
          (c) => `<article class="chip" draggable="true" data-id="${c.id}">
            <strong>${esc(c.display_name)}</strong>
            <div class="muted">${esc(c.source || "—")}${c.job_title ? ` · ${esc(c.job_title)}` : ""}</div>
            ${c.screen_status === "ready" ? `<div class="mini-score">${scoreMini(c)}</div>` : `<div class="muted">ยังไม่คัดเรซูเม่</div>`}
            <select class="stage-dd" data-id="${c.id}">${data.stages
              .map((s) => `<option value="${s}"${s === c.stage ? " selected" : ""}>${STAGE_TH[s] || s}</option>`)
              .join("")}</select>
            <div class="rail">${railDots(c)}</div>
          </article>`,
        )
        .join("");
      return `<div class="col" data-stage="${stage}"><h3>${STAGE_TH[stage] || stage}<span class="cnt">${rows.length}</span></h3>${
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
  } catch (err) {
    if (msg) msg.textContent = err.message;
  }
}

async function deletePerson() {
  if (!state.person || !confirm("ลบคนนี้ออกจากท่อ?")) return;
  await api(`/api/candidates/${state.person.candidate.id}`, { method: "DELETE" });
  closeDrawer();
  await loadBoard();
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
  end.setDate(end.getDate() + 5);
  return { from: start.toISOString(), to: end.toISOString() };
}

async function loadBusy() {
  const { from, to } = weekRange();
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
  const data = await api("/api/interviews");
  state.interviews = data.interviews || [];
  await loadScheduleMeta();
  await loadBusy();
  renderCalendar();
  renderUpcoming();
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

function dayMeetings(day) {
  const start = startOfDay(day).getTime();
  const end = start + 86400000;
  return state.interviews.filter((ev) => {
    const t = new Date(ev.starts_at).getTime();
    return t >= start && t < end;
  });
}

function renderCalendar() {
  const grid = $("#week-grid");
  if (!grid) return;
  const days = [...Array(5)].map((_, i) => {
    const d = new Date(state.week);
    d.setDate(state.week.getDate() + i);
    return d;
  });
  if (startOfWeek(state.day).getTime() !== state.week.getTime()) {
    state.day = new Date(state.week);
  }
  $("#cal-range").textContent = `${fmtDay(days[0])} – ${fmtDay(days[4])}`;
  const hours = [...Array(10)].map((_, i) => 8 + i);
  const dow = ["จ", "อ", "พ", "พฤ", "ศ"];
  const pickStart = state.pick ? state.pick.getTime() : null;
  let html = `<div class="wg"><div></div>${days
    .map((d, i) => `<div class="d">${dow[i]}<b>${d.getDate()}</b></div>`)
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
      if (hit) {
        html += `<button type="button" class="c busy" data-cancel="${esc(hit.ev.id)}">${esc(hit.ev.display_name)}</button>`;
      } else if (slotBusy(t)) {
        html += `<button type="button" class="c ghost" disabled>ไม่ว่าง</button>`;
      } else {
        html += `<button type="button" class="c${on}" data-slot="${slot.toISOString()}"></button>`;
      }
    }
  }
  html += "</div>";
  grid.innerHTML = html;
  grid.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.cancel) {
      if (!confirm("ยกเลิกนัดนี้?")) return;
      await api(`/api/interviews/${btn.dataset.cancel}`, { method: "DELETE" });
      await Promise.all([loadInterviews(), loadBoard()]);
      return;
    }
    if (!btn.dataset.slot) return;
    state.pick = new Date(btn.dataset.slot);
    const field = $("#book-form [name=startsAt]");
    if (field) field.value = toLocalInput(state.pick);
    renderCalendar();
  };
  renderMiniMonth();
  showPick();
  renderUpcoming();
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
    <div class="mgrid">${["จ","อ","พ","พฤ","ศ","ส","อา"].map((n) => `<span>${n}</span>`).join("")}
    ${cells
      .map((d) => {
        const dim = d.getMonth() !== anchor.getMonth() ? " dim" : "";
        const on = startOfWeek(d).getTime() === weekTs ? " on" : "";
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
    renderCalendar();
  };
}

function showPick() {
  const empty = $("#pick-empty");
  const card = $("#pick-card");
  if (!empty || !card) return;
  if (!state.pick) {
    empty.hidden = false;
    card.hidden = true;
    return;
  }
  empty.hidden = true;
  card.hidden = false;
  const end = new Date(state.pick.getTime() + state.minutes * 60_000);
  $("#pick-when").innerHTML = `${longDay(state.pick)}<br>${hhmm(state.pick)} – ${hhmm(end)}`;
  const field = $("#book-form [name=startsAt]");
  if (field) field.value = toLocalInput(state.pick);
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
  const rows = state.interviews
    .slice()
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .slice(0, 5);
  box.innerHTML = rows.length
    ? `<h3 style="margin-top:18px">คิวถัดไป</h3>` +
      rows
        .map(
          (r) => `<div class="hit"><strong>${esc(r.display_name)}</strong><div class="muted">${esc(fmtWhen(r.starts_at))}</div></div>`,
        )
        .join("")
    : "";
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
  const start = state.pick || new Date(String(form.get("startsAt") || ""));
  const err = $("#book-err");
  if (err) err.textContent = "";
  if (Number.isNaN(start.getTime())) {
    if (err) err.textContent = "เลือกเวลาทางซ้ายก่อน";
    return;
  }
  try {
    await api("/api/interviews", {
      method: "POST",
      body: JSON.stringify({
        candidateId: $("#book-candidate").value,
        startsAt: start.toISOString(),
        minutes: Number(state.minutes || form.get("minutes") || 45),
        interviewerId: $("#book-interviewer")?.value || undefined,
      }),
    });
    state.pick = null;
    await Promise.all([loadInterviews(), loadBoard()]);
    renderHome();
  } catch (err) {
    const text = err.message === "conflict" ? "ชนนัดที่มีอยู่แล้ว — เลือกเวลาอื่น" : err.message;
    if ($("#book-err")) $("#book-err").textContent = text;
  }
}

async function loadPrompts() {
  const data = await api("/api/settings/prompts");
  $("#prompt-list").innerHTML = Object.entries(data.prompts)
    .map(
      ([key, value]) => `<div class="panel">
        <label>${esc(key)}</label>
        <textarea data-prompt="${esc(key)}" maxlength="${state.session.limits.promptMax}">${esc(value)}</textarea>
        <div class="row"><button class="btn ghost" data-save="${esc(key)}">บันทึก</button></div>
      </div>`,
    )
    .join("");
  $("#prompt-list").onclick = async (e) => {
    const key = e.target.dataset.save;
    if (!key) return;
    const value = document.querySelector(`[data-prompt="${key}"]`).value;
    await api("/api/settings/prompts", { method: "PUT", body: JSON.stringify({ key, value }) });
  };
}

async function loadTokens() {
  const who = $("#profile-who");
  if (who && state.session) who.textContent = `${state.session.username} · ${state.session.role}`;
  const data = await api("/api/tokens");
  const url = $("#mcp-url");
  if (url && data.mcpUrl) url.textContent = data.mcpUrl.replace(/\/$/, "") + "/mcp";
  const rows = $("#token-rows");
  if (!rows) return;
  rows.innerHTML = (data.tokens || [])
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
  } catch (err) {
    if (msg) msg.textContent = err.message;
  }
}

async function loadCalendarSettings() {
  const box = $("#cal-settings");
  if (!box || box.hidden) return;
  const data = await api("/api/schedule/status");
  const mode = data.mode || "share";
  box.querySelectorAll("[name=cal-mode]").forEach((el) => {
    el.checked = el.value === mode;
  });
  const area = $("#cal-share-emails");
  if (area) area.value = data.shareEmails || "";
}

async function saveCalendarSettings() {
  const msg = $("#cal-settings-msg");
  if (msg) msg.textContent = "";
  const mode = document.querySelector("[name=cal-mode]:checked")?.value || "share";
  try {
    await api("/api/settings/calendar", {
      method: "PUT",
      body: JSON.stringify({ mode, shareEmails: $("#cal-share-emails")?.value || "" }),
    });
    if (msg) msg.textContent = "บันทึกแล้ว";
    await loadScheduleMeta();
    await loadBusy();
    renderCalendar();
  } catch (err) {
    if (msg) msg.textContent = err.message;
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
  } catch (err) {
    msg.textContent = err.message;
  }
}

async function loadUsers() {
  const data = await api("/api/users");
  $("#user-rows").innerHTML = data.users
    .map(
      (u) => `<tr>
        <td>${esc(u.username)}</td>
        <td>${esc(u.role)}</td>
        <td>${u.disabled ? "ปิด" : "เปิด"}</td>
        <td>
          <button class="btn ghost" data-role="${esc(u.id)}" data-next="${u.role === "admin" ? "member" : "admin"}">เป็น ${u.role === "admin" ? "member" : "admin"}</button>
          <button class="btn ghost" data-disable="${esc(u.id)}" data-on="${u.disabled ? "0" : "1"}">${u.disabled ? "เปิดใช้" : "ปิดใช้"}</button>
          <button class="btn ghost" data-del="${esc(u.id)}">ลบ</button>
        </td>
      </tr>`,
    )
    .join("");
  $("#user-rows").onclick = async (e) => {
    const t = e.target;
    try {
      if (t.dataset.role) {
        await api(`/api/users/${t.dataset.role}`, {
          method: "PATCH",
          body: JSON.stringify({ role: t.dataset.next }),
        });
      } else if (t.dataset.disable) {
        await api(`/api/users/${t.dataset.disable}`, {
          method: "PATCH",
          body: JSON.stringify({ disabled: t.dataset.on === "1" }),
        });
      } else if (t.dataset.del) {
        await api(`/api/users/${t.dataset.del}`, { method: "DELETE" });
      } else return;
      $("#user-msg").textContent = "";
      await loadUsers();
    } catch (err) {
      $("#user-msg").textContent = err.message;
    }
  };
}

async function addUser() {
  const msg = $("#user-msg");
  msg.textContent = "";
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: $("#user-name").value,
        password: $("#user-pass").value,
        role: $("#user-role").value,
      }),
    });
    $("#user-name").value = "";
    $("#user-pass").value = "";
    await loadUsers();
  } catch (err) {
    msg.textContent = err.message;
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
  entered: "เข้าเลน",
  moved: "ย้ายขั้น",
  screened: "คัดเรซูเม่",
  booked: "จองนัด",
  cancelled: "ยกเลิกนัด",
};

const PATH = ["applied", "screening", "prescreen", "interview", "offer", "hired"];

const STEP_HELP = {
  applied: "เพิ่งเข้าเลน จากค้นคนหรือเพิ่มมือ ยังไม่ได้อ่านเรซูเม่",
  screening: "อ่านเรซูเม่ให้คะแนน Skills / Experience / Culture",
  prescreen: "คุยสั้นก่อนนัดยาว — คัดคำถามและธงแดง",
  interview: "จองบนปฏิทิน ชนนัดไม่ได้",
  offer: "ยื่นข้อเสนอ รอตอบ",
  hired: "รับเข้าทำงาน เส้นทางจบฝั่งดี",
  rejected: "จบเส้นทางฝั่งไม่ผ่าน",
};

function railDots(c) {
  const order = ["applied", "screening", "prescreen", "interview", "offer", "hired"];
  const idx = order.indexOf(c.stage);
  return order
    .map((s, i) => {
      const cls = c.stage === "rejected" && i === 0 ? "bad" : s === c.stage ? "now" : idx > i ? "on" : "";
      return `<i class="${cls}" title="${STAGE_TH[s]}"></i>`;
    })
    .join("");
}

async function openPerson(id) {
  const data = await api(`/api/candidates/${id}`);
  const path = data.candidate.stage === "rejected" ? PATH.concat("rejected") : PATH;
  const here = Math.max(0, path.indexOf(data.candidate.stage));
  state.person = { ...data, path, cursor: here, dir: 1 };
  openDrawer();
  renderStepper();
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
  const here = Math.max(0, path.indexOf(c.stage));
  const view = path[p.cursor];
  $("#drawer-name").textContent = c.display_name;
  $("#drawer-src").textContent = `${c.source || "—"} · อยู่ที่ ${STAGE_TH[c.stage] || c.stage}`;
  if ($("#edit-name")) $("#edit-name").value = c.display_name || "";
  if ($("#edit-email")) $("#edit-email").value = c.email || "";
  if ($("#edit-phone")) $("#edit-phone").value = c.phone || "";
  $("#step-pos").textContent = `${p.cursor + 1} / ${path.length}`;
  $("#step-prev").disabled = p.cursor === 0;
  $("#step-next").disabled = p.cursor === path.length - 1;

  const n = Math.max(1, path.length - 1);
  const track = $("#person-track");
  if (track) track.style.setProperty("--at", String((p.cursor / n) * 100));
  $("#drawer-steps").innerHTML = path
    .map((s, i) => {
      const cls = [
        s === "rejected" ? "bad" : "",
        s === c.stage ? "now" : "",
        here > i && s !== "rejected" ? "done" : "",
        i === p.cursor ? "view" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${cls}" data-i="${i}">${STAGE_TH[s]}</button>`;
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

  const when = p.cursor < here ? "ผ่านแล้ว" : p.cursor === here ? "อยู่ตรงนี้" : "ขั้นถัดไป";
  const events = (p.trail || []).filter((ev) => {
    if (ev.stage === view) return true;
    if (view === "screening" && ev.kind === "screened") return true;
    if (view === "interview" && (ev.kind === "booked" || ev.kind === "cancelled")) return true;
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
  if (can("candidates.write") && p.cursor > here && view !== "rejected") {
    action = `<div class="row"><button class="btn" type="button" id="step-go">ขยับมาขั้นนี้</button></div>`;
  }
  if (can("candidates.write") && view === "interview") {
    action += `<div class="row"><button class="btn ghost" type="button" id="step-cal">เปิดปฏิทินจองนัด</button></div>`;
  }
  if (can("candidates.write") && here === p.cursor && c.stage !== "rejected" && c.stage !== "hired") {
    action += `<div class="row"><button class="btn ghost" type="button" id="step-reject">ไม่ผ่าน</button></div>`;
  }

  const body = $("#step-body");
  body.classList.remove("swap", "swap-back");
  void body.offsetWidth;
  body.innerHTML = `
    <div class="step-tag">${when}</div>
    <h3>${STAGE_TH[view]}</h3>
    <p>${STEP_HELP[view] || ""}</p>
    ${hist}
    ${extra}
    ${action}`;
  body.classList.add(p.dir < 0 ? "swap-back" : "swap");

  const go = $("#step-go");
  if (go) {
    go.onclick = async () => {
      await api(`/api/candidates/${c.id}`, { method: "PATCH", body: JSON.stringify({ stage: view }) });
      await loadBoard();
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
      await openPerson(c.id);
    };
  }
}

boot().catch(() => {
  location.href = "/";
});
