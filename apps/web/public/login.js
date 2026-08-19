const form = document.getElementById("login");
const msg = document.getElementById("msg");
const go = document.getElementById("login-go");
let busy = false;

function setWait(on) {
  busy = on;
  form.classList.toggle("is-wait", on);
  if (go) {
    go.classList.toggle("is-wait", on);
    go.disabled = on;
    go.setAttribute("aria-busy", on ? "true" : "false");
  }
  form.querySelectorAll("input").forEach((el) => {
    el.disabled = on;
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  msg.textContent = "";
  const data = new FormData(form);
  setWait(true);
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });
    if (!res.ok) {
      setWait(false);
      msg.textContent = "เข้าไม่ได้";
      return;
    }
    location.href = "/app/";
  } catch {
    setWait(false);
    msg.textContent = "เข้าไม่ได้";
  }
});
