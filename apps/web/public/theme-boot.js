(() => {
  const saved = localStorage.getItem("sl-theme");
  document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
})();
