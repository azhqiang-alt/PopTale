/* The HTML around the 3D view: loading screen, shelf header, book card, reader bar, page
   dots, toasts, the word zoom and the settings dialog. Buttons report to onAction(name, payload). */

const $ = (id) => document.getElementById(id);

export class UI {
  constructor({ settings, onAction }) {
    this.settings = settings;
    this.onAction = onAction;
    const bind = (id, name, payload) => $(id).addEventListener("click", (e) => { e.stopPropagation(); onAction(name, payload); });
    bind("btn-open", "open");
    bind("btn-back-shelf", "back");
    bind("btn-home", "back");
    bind("btn-prev", "prev");
    bind("btn-next", "next");
    bind("btn-play", "read");
    bind("btn-sound", "mute");
    bind("btn-settings", "settings");
    bind("btn-restart", "restart");
    bind("btn-end-shelf", "back");
    const dialog = $("settings");
    for (const b of dialog.querySelectorAll("[data-mode]")) b.addEventListener("click", (e) => { e.preventDefault(); onAction("setting", { key: "mode", value: b.dataset.mode }); });
    for (const [id, key] of [["set-auto", "autoTurn"], ["set-large", "largeText"], ["set-music", "music"]]) {
      $(id).addEventListener("change", (e) => onAction("setting", { key, value: e.target.checked }));
    }
    dialog.addEventListener("close", () => onAction("settings-closed"));
    this.syncSettings();
  }

  syncSettings() {
    const s = this.settings;
    for (const b of document.querySelectorAll("#settings [data-mode]")) b.classList.toggle("on", b.dataset.mode === s.mode);
    $("set-auto").checked = s.autoTurn;
    $("set-large").checked = s.largeText;
    $("set-music").checked = s.music;
    $("text-panel").classList.toggle("large", s.largeText);
    $("btn-sound").classList.toggle("off", s.muted);
    $("btn-sound").setAttribute("aria-pressed", String(s.muted));
  }

  openSettings() { $("settings").showModal(); }

  setLoading(p, copy) {
    $("loading").querySelector(".bar i").style.width = `${Math.round(p * 100)}%`;
    if (copy) $("loading").querySelector(".loading-copy").textContent = copy;
  }

  hideLoading() {
    const el = $("loading");
    el.classList.add("gone");
    setTimeout(() => { el.hidden = true; }, 600);
  }

  setView(view) {
    document.body.dataset.view = view;
    $("shelf-ui").hidden = view !== "shelf";
    $("reader-bar").hidden = view !== "book";
    if (view !== "book") $("text-panel").hidden = true;
    if (view === "shelf") { $("book-card").hidden = true; this.hideTip(); }
  }

  showBookCard(meta) {
    $("book-title").textContent = meta.title;
    $("book-blurb").textContent = meta.blurb || "";
    $("btn-open").hidden = true;
    $("book-card").querySelector(".book-progress").hidden = false;
    this.setBookLoading(0, "正在把书拿下来…");
    $("book-card").hidden = false;
  }

  setBookLoading(p, copy) {
    $("book-card").querySelector(".bar i").style.width = `${Math.round(p * 100)}%`;
    if (copy) $("book-loading").textContent = copy;
  }

  bookReady(blurb) {
    if (blurb) $("book-blurb").textContent = blurb;
    $("book-card").querySelector(".book-progress").hidden = true;
    $("btn-open").hidden = false;
    $("btn-open").focus();
  }

  hideBookCard() { $("book-card").hidden = true; }

  setPages(total, current, read) {
    const dots = $("page-dots");
    if (dots.children.length !== total) {
      dots.replaceChildren(...Array.from({ length: total }, (_, i) => {
        const b = document.createElement("button");
        b.className = "dot";
        b.setAttribute("aria-label", i === total - 1 ? "最后一页" : `第 ${i + 1} 页`);
        b.addEventListener("click", (e) => { e.stopPropagation(); this.onAction("goto", i); });
        return b;
      }));
    }
    [...dots.children].forEach((d, i) => {
      d.classList.toggle("current", i === current);
      d.classList.toggle("read", read.includes(i));
    });
    $("btn-prev").disabled = current <= 0;
    $("btn-next").disabled = current >= total - 1;
  }

  setStars(n, total) {
    $("star-count").textContent = `${n}/${total}`;
  }

  popStar() {
    const el = $("star-count").parentElement;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }

  /** idle | playing | paused; hidden on the end page and in self-read mode. */
  setReading(state, { visible = true } = {}) {
    const b = $("btn-play");
    b.hidden = !visible;
    b.dataset.state = state;
    b.setAttribute("aria-label", state === "playing" ? "暂停" : "朗读");
  }

  toast(message, ms = 2600) {
    const el = $("toast");
    el.textContent = message;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  wordZoom(text) {
    const el = $("word-zoom");
    el.textContent = text;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => { el.hidden = true; }, 1300);
  }

  showTip(x, y, text) {
    const el = $("tip");
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.hidden = false;
  }

  hideTip() { $("tip").hidden = true; }

  showShelfLabel(text) {
    const el = $("shelf-label");
    el.textContent = text || "";
    el.hidden = !text;
  }
}
