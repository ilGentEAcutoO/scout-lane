const THEME_KEY = "sl-theme";

const ICON_SUN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
const ICON_MOON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;

function readTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return "light";
}

function applyLook(_look, theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_KEY, nextTheme);
  paintPickers();
}

function swatches(kind) {
  const theme = document.documentElement.dataset.theme || "light";
  const themeBtns = ["light", "dark"]
    .map(
      (t) =>
        `<button type="button" class="swatch${t === theme ? " on" : ""}" data-theme-pick="${t}">${
          t === "dark" ? "มืด" : "สว่าง"
        }</button>`,
    )
    .join("");
  if (kind === "board") {
    return `<h3>พื้นหลัง</h3>
      <p class="muted">สว่างหรือมืด — โทนไลแลค</p>
      <div class="looks-row">${themeBtns}</div>`;
  }
  const next = theme === "dark" ? "light" : "dark";
  return `<button type="button" class="icon-btn" data-theme-pick="${next}" aria-label="${
    theme === "dark" ? "สลับเป็นสว่าง" : "สลับเป็นมืด"
  }">${theme === "dark" ? ICON_SUN : ICON_MOON}</button>`;
}

function paintPickers() {
  document.querySelectorAll("[data-looks]").forEach((box) => {
    const wasOpen = box.classList.contains("is-open");
    box.innerHTML = swatches(box.dataset.looks);
    box.classList.toggle("is-open", wasOpen);
  });
}

function bindTheme() {
  applyLook(null, document.documentElement.dataset.theme || readTheme());
  document.addEventListener("click", (e) => {
    const theme = e.target.closest("button[data-theme-pick]")?.dataset.themePick;
    if (theme) applyLook(null, theme);
  });
}

bindTheme();
