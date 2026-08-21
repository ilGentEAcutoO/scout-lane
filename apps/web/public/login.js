const form = document.getElementById("login");
const msg = document.getElementById("msg");
const go = document.getElementById("login-go");
const params = new URLSearchParams(location.search);

if (params.get("e")) {
  if (msg) msg.textContent = "เข้าไม่ได้";
}

const next = params.get("next");
if (next && form && next.startsWith("/oauth/authorize")) {
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "เข้าสู่ระบบ Scout Lane เพื่ออนุญาตคอนเนกเตอร์ MCP";
  form.querySelector(".brand")?.after(hint);
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = "next";
  hidden.value = next;
  form.appendChild(hidden);
}

form?.addEventListener("submit", () => {
  if (go) {
    go.classList.add("is-wait");
    go.setAttribute("aria-busy", "true");
  }
  form?.classList.add("is-wait");
});
