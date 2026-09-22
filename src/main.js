import "./style.css";
import * as THREE from "three";
import { Stage } from "./stage.js";
import { Shelf } from "./shelf.js";
import { Book3D, closedSize } from "./book3d.js";
import { Diorama } from "./diorama.js";
import { Narrator } from "./narrator.js";
import { SoundKit } from "./sound.js";
import { Reading } from "./reading.js";
import { UI } from "./ui.js";
import { Sparkles, clamp, updateTweens } from "./anim.js";
import { spokenWeight, tokenize } from "./tokens.js";
import { loadArt, pageTexture, placeholderCover } from "./textures.js";
import { loadProgress, loadSettings, saveProgress, saveSettings } from "./store.js";

/* The app: shelf -> picking (the book flies to the table while it loads) -> book (open,
   one spread per page). state.view is "loading" | "shelf" | "picking" | "book". */

const settings = loadSettings();
const progress = loadProgress();
const state = {
  view: "loading",
  item: null,       // the shelf item that was picked
  book: null,       // the loaded book: { id, story, base, art, pages, leftTex, rightTex }
  book3d: null,
  opened: false,
  page: -1,
  reading: "idle",  // idle | playing | paused
  busy: false,      // a turn, an open or a close is animating
  diorama: null,
  pick: 0,          // bumped when a pick is abandoned, so a late load knows to throw itself away
  timers: {},
};

let stage, shelf, sound, narrator, reading, ui, sparkles, audio;
const covers = {};

const PORTRAIT = matchMedia("(max-aspect-ratio: 1/1), (max-width: 760px)");

/* ---------- start ---------- */

async function init() {
  ui = new UI({ settings, onAction });
  stage = new Stage(document.getElementById("stage"));
  sparkles = new Sparkles(stage.scene);
  audio = new (window.AudioContext || window.webkitAudioContext)();
  sound = new SoundKit(audio);
  narrator = new Narrator(audio);
  applyMute();
  reading = new Reading(document.getElementById("text-panel"), { onWordTap, onLinkHover, onDone: () => earnStar(state.page) });

  ui.setLoading(0.1, "正在准备书架…");
  const library = (await (await fetch("books/index.json")).json()).books;
  let done = 0;
  await Promise.all(library.map(async (b) => {
    covers[b.id] = b.cover ? await loadArt(b.cover, { maxSize: 800 }).catch(() => placeholderCover(b.title, b.color)) : placeholderCover(b.title, b.color);
    ui.setLoading(0.1 + 0.85 * (++done / library.length));
  }));
  state.library = library;
  buildShelf();
  bindInput();
  state.view = "shelf";
  ui.setView("shelf");
  frame("shelf", 0);
  ui.hideLoading();
  requestAnimationFrame(loop);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // a resize event can be missed (hidden tab, rotation during load): follow the window size here too
  if (innerWidth !== stage.width || innerHeight !== stage.height) onResize();
  updateTweens(dt);
  shelf.update(dt, now / 1000);
  if (state.diorama) state.diorama.update(dt, now / 1000);
  sparkles.update(dt);
  narrator.update();
  stage.update(dt);
  stage.render();
  requestAnimationFrame(loop);
}

/* ---------- camera framing: keep the subject in the part of the screen the panels leave free ---------- */

function freeRect(view) {
  const W = innerWidth, H = innerHeight;
  const portrait = PORTRAIT.matches;
  if (view === "shelf") return { x: 0, y: 90, w: W, h: H - 150 };
  if (view === "closed") return portrait ? { x: 0, y: 0, w: W, h: H - 250 } : { x: 0, y: 0, w: W - Math.min(340, W * 0.86) - Math.max(24, W * 0.04), h: H };
  const bar = portrait ? 58 : 64;
  // measure the text panel when it is up (its height follows the page's text); else assume its size
  const panel = document.getElementById("text-panel");
  const r = panel && !panel.hidden ? panel.getBoundingClientRect() : null;
  if (portrait) return { x: 0, y: bar, w: W, h: Math.max(H * 0.36, (r ? r.top - 8 : H * 0.54)) - bar };
  const panelRight = r ? r.right + 12 : Math.max(20, W * 0.03) + Math.min(440, W * 0.36) + 12;
  return { x: panelRight, y: bar, w: W - panelRight, h: H - bar };
}

function frame(view, duration = 1.2) {
  state.camera = view;
  const name = view === "open" && PORTRAIT.matches ? "openNarrow" : view;
  return stage.frame(name, { free: freeRect(view), duration });
}

/* ---------- shelf and picking ---------- */

async function selectBook(item) {
  if (state.view !== "shelf") return;
  if (item.book.status !== "ready") {
    shelf.wobble(item);
    sound.pop(0.7);
    ui.toast(`《${item.book.title}》还在画，敬请期待`);
    return;
  }
  const pick = ++state.pick;
  state.view = "picking";
  state.item = item;
  shelf.setHover(null);
  ui.showShelfLabel(null);
  ui.setView("picking");
  ui.showBookCard(item.book);
  sound.whoosh(true);
  narrator.playClip(`books/${item.id}/voice/title.mp3`);
  const size = closedSize(8);
  const landing = { position: new THREE.Vector3(size.w / 2, size.h / 2, 0), rotation: new THREE.Euler(0, 0, 0), scale: 1 };
  frame("closed", 1.3);
  const [, loaded] = await Promise.all([
    shelf.flyTo(item, landing, 1.3),
    loadBook(item.book, (p, copy) => ui.setBookLoading(p, copy)).catch((error) => { console.error(error); return null; }),
  ]);
  if (pick !== state.pick) { if (loaded) disposeBook(loaded); return; }
  if (!loaded) {
    ui.toast("这本书暂时打不开，请稍后再试");
    backToShelf();
    return;
  }
  state.book = loaded.book;
  state.book3d = loaded.book3d;
  stage.scene.add(state.book3d.group);
  item.mesh.visible = false;
  ui.bookReady(loaded.book.story.blurb);
}

async function loadBook(meta, onProgress) {
  const base = `books/${meta.id}`;
  onProgress(0.05, "正在翻找这本书…");
  const story = await (await fetch(`${base}/story.json`)).json();
  const entries = Object.entries(story.art || {}).filter(([, a]) => a.kind !== "cover");
  const art = {};
  let n = 0;
  await Promise.all(entries.map(async ([id, a]) => {
    art[id] = await loadArt(`${base}/${a.file}`, { outline: a.outline || 0 });
    onProgress(0.1 + 0.7 * (++n / entries.length), "正在画插图…");
  }));
  const pages = [
    ...story.pages.map((p) => ({ ...p, tokens: tokenize(p.text) })),
    { ...story.end, isEnd: true, tokens: tokenize(story.end.text) },
  ];
  const color = story.colors?.cloth;
  const leftTex = pages.map((p, i) => pageTexture({ side: "left", number: i * 2 + 1 }));
  const rightTex = pages.map((p, i) => pageTexture({ side: "right", number: i * 2 + 2 }));
  onProgress(0.85, "正在准备声音…");
  narrator.setBook(base, pages.map((p) => p.tokens));
  await narrator.prepare(0);
  const book3d = new Book3D({ coverTexture: covers[meta.id], sheets: pages.length, clothColor: color, endpaper: story.colors?.endpaper });
  onProgress(1, "准备好了");
  return { book: { id: meta.id, story, base, art, pages, leftTex, rightTex }, book3d };
}

function disposeBook({ book, book3d }) {
  book3d.dispose();
  for (const tex of [...Object.values(book.art), ...book.leftTex, ...book.rightTex]) tex.dispose();
}

async function openBook() {
  if (state.view !== "picking" || !state.book3d || state.busy) return;
  const { book, book3d } = state;
  const saved = progress[book.id];
  const first = saved && !saved.finished ? clamp(saved.page || 0, 0, book.pages.length - 1) : 0;
  state.busy = true;
  state.opened = true;
  ui.hideBookCard();
  sound.click();
  sound.whoosh(true);
  sound.startAmbience();
  book3d.turned = first;
  book3d.setPages(book.leftTex[first], book.rightTex[first]);
  state.view = "book";
  ui.setView("book");
  frame("open", 1.4);
  await book3d.open();
  state.busy = false;
  showPage(first);
}

async function backToShelf() {
  if (state.view === "shelf" || (state.busy && state.view === "book")) return;
  state.pick++;
  state.busy = true;
  stopReading();
  reading.hide();
  ui.hideTip();
  ui.hideBookCard();
  clearTimeout(state.timers.hint);
  const { item } = state;
  if (state.diorama) { await state.diorama.popOut(); state.diorama.dispose(); state.diorama = null; }
  if (state.opened) {
    ui.setView("picking");
    sound.stopAmbience();
    await Promise.all([state.book3d.close(), frame("closed", 1.0)]);
  }
  if (state.book) disposeBook({ book: state.book, book3d: state.book3d });
  Object.assign(state, { book: null, book3d: null, opened: false, page: -1, item: null, view: "shelf" });
  ui.setView("shelf");
  sound.whoosh(false);
  frame("shelf", 1.2);
  if (item) await shelf.flyHome(item, 1.1);
  state.busy = false;
  onResize(); // the screen may have turned while the book was open
}

/* ---------- pages ---------- */

async function goTo(index, { autoRead = true } = {}) {
  if (!state.opened || state.busy) return;
  const { book, book3d } = state;
  index = clamp(index, 0, book.pages.length - 1);
  if (index === state.page) return;
  state.busy = true;
  stopReading();
  reading.clearActive();
  ui.hideTip();
  stage.clearCloseUp();
  const from = state.page;
  if (state.diorama) { await state.diorama.popOut(); state.diorama.dispose(); state.diorama = null; }
  sound.pageTurn();
  if (index > from) await book3d.turn(1, { front: book.rightTex[from], back: book.leftTex[index], reveal: book.rightTex[index], land: book.leftTex[index] });
  else await book3d.turn(-1, { front: book.rightTex[index], back: book.leftTex[from], reveal: book.leftTex[index], land: book.rightTex[index] });
  book3d.turned = index; // a jump turns one leaf; the blocks still show the right thickness
  book3d.layout();
  state.busy = false;
  showPage(index, { autoRead });
}

function showPage(index, { autoRead = true } = {}) {
  const { book } = state;
  const page = book.pages[index];
  const storyPages = book.pages.length - 1;
  state.page = index;
  const diorama = new Diorama({ spec: page.scene, art: book.art, sound, sparkles });
  state.book3d.rightAnchor.add(diorama.group);
  state.diorama = diorama;
  diorama.popIn();
  sound.pop(0.8);
  reading.show({
    eyebrow: page.isEnd ? "最后一页" : `第 ${index + 1} 页 · 共 ${storyPages} 页`,
    heading: page.heading,
    hint: page.isEnd ? page.prompt : page.hint,
    tokens: page.tokens,
    isEnd: !!page.isEnd,
  });
  const p = bookProgress();
  p.page = index;
  saveProgress(progress);
  updateBar();
  setReading("idle");
  frame("open", 0.5);
  narrator.prepare(Math.min(index + 1, book.pages.length - 1));

  clearTimeout(state.timers.hint);
  state.timers.hint = setTimeout(() => { if (state.page === index && state.reading === "idle") reading.nudgeHint(); }, 8000);
  if (settings.mode === "self" && !page.isEnd && !p.read.includes(index)) {
    reading.offerDone(Math.max(4000, page.tokens.reduce((s, t) => s + spokenWeight(t.text), 0) * 380));
  }
  if (page.isEnd && p.finished) sound.sparkle();
  if (autoRead && settings.mode === "listen") {
    clearTimeout(state.timers.autoRead);
    state.timers.autoRead = setTimeout(() => {
      if (state.page === index && state.reading === "idle" && !dialogOpen()) startReading();
    }, 900);
  }
}

function bookProgress() {
  const id = state.book.id;
  progress[id] ||= { page: 0, read: [], finished: false };
  return progress[id];
}

function updateBar() {
  const p = bookProgress();
  const storyPages = state.book.pages.length - 1;
  ui.setPages(state.book.pages.length, state.page, p.read);
  ui.setStars(p.read.length, storyPages);
}

/** A page read to its last word (heard, or "I read it" in self-read mode) earns its star. */
function earnStar(index) {
  const page = state.book?.pages[index];
  if (!page || page.isEnd) return;
  const p = bookProgress();
  if (p.read.includes(index)) return;
  p.read.push(index);
  const storyPages = state.book.pages.length - 1;
  if (p.read.length >= storyPages) p.finished = true;
  saveProgress(progress);
  sound.sparkle();
  ui.popStar();
  updateBar();
  if (p.finished) ui.toast("太棒了！整本书都读完啦 ★", 3200);
}

/* ---------- narration ---------- */

function setReading(s) {
  state.reading = s;
  const page = state.book?.pages[state.page];
  ui.setReading(s, { visible: !!page && !page.isEnd });
}

async function startReading() {
  if (!state.opened || state.page < 0 || state.busy) return;
  const index = state.page;
  const page = state.book.pages[index];
  clearTimeout(state.timers.autoTurn);
  setReading("playing");
  sound.duck(true);
  await narrator.play(index, {
    onWord: (i) => {
      reading.setActive(i);
      const token = page.tokens[i];
      if (token?.link && state.diorama) {
        state.diorama.act(token.link, token.action || "bounce", { silent: true });
        storyCloseUp(token.link);
      }
    },
    onEnd: (complete) => {
      if (state.page !== index) return;
      reading.clearActive();
      setReading("idle");
      sound.duck(false);
      if (complete) earnStar(index);
      if (complete && settings.autoTurn && settings.mode === "listen" && !page.isEnd) {
        state.timers.autoTurn = setTimeout(() => { if (state.page === index && state.reading === "idle") goTo(index + 1); }, 2600);
      }
    },
  });
}

function stopReading() {
  clearTimeout(state.timers.autoTurn);
  clearTimeout(state.timers.autoRead);
  clearTimeout(state.timers.resume);
  narrator.stop();
  sound.duck(false);
  if (state.book) setReading("idle");
}

function toggleReading() {
  const page = state.book?.pages[state.page];
  if (!page || page.isEnd) return;
  if (state.reading === "playing") { narrator.pause(); setReading("paused"); sound.duck(false); }
  else if (state.reading === "paused") { narrator.resume(); setReading("playing"); sound.duck(true); }
  else startReading();
}

/* ---------- the camera follows the story ---------- */

/** While the narrator reads, drift in on the picture of each linked word, like a cut in a film. */
function storyCloseUp(name) {
  const now = performance.now();
  if (now - (state.lastCloseUp || 0) < 1400) return;
  if (closeUp(name, { hold: 3, wide: 1.3 })) state.lastCloseUp = now;
}

function closeUp(name, options) {
  const item = state.diorama?.objects[name];
  if (!item) return false;
  const { card } = item;
  stage.closeUp(card.center(), { radius: Math.max(card.width, card.height) / 2, ...options });
  return true;
}

/* ---------- touching words and things ---------- */

function onWordTap(i, token) {
  if (!state.opened) return;
  // the narrator steps aside for the tapped word and carries on shortly after
  if (state.reading === "playing") {
    narrator.pause();
    setReading("paused");
    clearTimeout(state.timers.resume);
    const page = state.page;
    state.timers.resume = setTimeout(() => {
      if (state.reading === "paused" && state.page === page) { narrator.resume(); setReading("playing"); }
    }, 1600);
  }
  narrator.speakWord(state.page, i);
  ui.wordZoom(token.word || token.text);
  if (token.link && state.diorama) state.diorama.act(token.link, token.action);
  else sound.chime(i, 0.1);
}

function onLinkHover(name, on) {
  const item = state.diorama?.objects[name];
  state.diorama?.setHover(on ? item : null);
  if (on && item) {
    const p = screenPosition(item.card.center());
    ui.showTip(p.x, p.y - 30, item.label);
  } else ui.hideTip();
}

function screenPosition(v) {
  const p = v.clone().project(stage.camera);
  return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
}

function bindInput() {
  const canvas = stage.canvas;
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    stage.setPointer((e.clientX / stage.width) * 2 - 1, -(e.clientY / stage.height) * 2 + 1);
    let pointer = false;
    if (state.view === "shelf") {
      const item = shelf.pick(stage.raycaster(e.clientX, e.clientY));
      shelf.setHover(item);
      ui.showShelfLabel(item ? item.book.title + (item.book.status === "ready" ? "" : " · 敬请期待") : null);
      pointer = !!item;
    } else if (state.view === "book" && state.diorama && !state.busy) {
      const item = state.diorama.pick(stage.raycaster(e.clientX, e.clientY));
      state.diorama.setHover(item);
      if (item && item.name !== "sky") { ui.showTip(e.clientX, e.clientY - 18, item.label); pointer = true; } else ui.hideTip();
    } else if (state.view === "picking" && state.book3d) {
      pointer = stage.raycaster(e.clientX, e.clientY).intersectObject(state.book3d.group, true).length > 0;
    }
    document.body.classList.toggle("pointer", pointer);
  });
  canvas.addEventListener("click", (e) => {
    const ray = stage.raycaster(e.clientX, e.clientY);
    if (state.view === "shelf") {
      const item = shelf.pick(ray);
      if (item) selectBook(item);
    } else if (state.view === "picking" && state.book3d) {
      if (ray.intersectObject(state.book3d.group, true).length) openBook();
    } else if (state.view === "book" && state.diorama && !state.busy) {
      const item = state.diorama.pick(ray);
      if (item) { state.diorama.tap(item); if (item.name !== "sky") closeUp(item.name, { hold: 2.4 }); }
    }
  });
  // browsers keep audio silent until the first touch or key
  const unlock = () => {
    audio.resume().then(() => { if (settings.music) sound.startMusic(); });
    removeEventListener("pointerdown", unlock);
    removeEventListener("keydown", unlock);
  };
  addEventListener("pointerdown", unlock);
  addEventListener("keydown", unlock);
  addEventListener("keydown", onKey);
  addEventListener("resize", onResize);
}

function onResize() {
  if (state.view === "shelf") buildShelf();
  stage.resize();
  if (state.camera) frame(state.camera, 0);
}

/** Five books to a ledge on wide screens, two on phones; rebuilt when that changes. */
function buildShelf() {
  const columns = PORTRAIT.matches ? 2 : 5;
  if (shelf && shelf.columns === columns) return;
  if (shelf) shelf.dispose();
  shelf = new Shelf({ books: state.library, covers, columns });
  stage.scene.add(shelf.group);
  stage.setView("shelf", shelf.view);
}

function onKey(e) {
  if (dialogOpen()) return;
  if (e.key === "Escape") { backToShelf(); return; }
  if (e.key === "m" || e.key === "M") { toggleMute(); return; }
  if (state.view === "picking" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openBook(); return; }
  if (state.view !== "book") return;
  switch (e.key) {
    case "ArrowRight": case "PageDown": goTo(state.page + 1); break;
    case "ArrowLeft": case "PageUp": goTo(state.page - 1); break;
    case " ": e.preventDefault(); toggleReading(); break;
    case "Home": goTo(0); break;
  }
}

const dialogOpen = () => !!document.querySelector("dialog[open]");

/* ---------- buttons and settings ---------- */

function onAction(name, payload) {
  switch (name) {
    case "open": openBook(); break;
    case "back": backToShelf(); break;
    case "prev": sound.click(); goTo(state.page - 1); break;
    case "next": sound.click(); goTo(state.page + 1); break;
    case "goto": sound.click(); goTo(payload); break;
    case "read": sound.click(); toggleReading(); break;
    case "restart": sound.click(); goTo(0); break;
    case "mute": toggleMute(); break;
    case "settings":
      if (state.reading === "playing") toggleReading();
      ui.openSettings();
      break;
    case "settings-closed": break;
    case "setting": applySetting(payload.key, payload.value); break;
  }
}

function applySetting(key, value) {
  settings[key] = value;
  saveSettings(settings);
  ui.syncSettings();
  if (key === "music") { if (value) sound.startMusic(); else sound.stopMusic(); }
  if (key === "mode" && state.opened) {
    const page = state.book.pages[state.page];
    if (value === "self" && !page.isEnd && !bookProgress().read.includes(state.page)) reading.offerDone(1500);
    else reading.hideDone();
  }
}

function toggleMute() {
  settings.muted = !settings.muted;
  saveSettings(settings);
  applyMute();
  ui.syncSettings();
}

function applyMute() {
  sound.setMuted(settings.muted);
  narrator.setVolume(settings.muted ? 0 : 1);
}

init().catch((error) => {
  console.error(error);
  ui?.setLoading(0, "加载失败，请刷新重试");
});
