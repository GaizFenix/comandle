// comandle in the browser: the same daily command as the terminal, with the
// state kept in this browser only. Everything is built with DOM calls and
// textContent; nothing is parsed as HTML.
import {
  ABSENT,
  CORRECT,
  MAX_TRIES,
  PRESENT,
  candidates,
  cluesVisible,
  daily,
  dayNumber,
  letterState,
  nextDayMs,
  recordStats,
  score,
  shareText,
} from "./logic.mjs";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const SVG_NS = "http://www.w3.org/2000/svg";
function icon(paths, viewBox = "0 0 20 20") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
const ICON_COPY = ["M5.5 5.5h7v7h-7z", "M10.5 3.5h-7v7"];
const ICON_LINK = ["M5 11 11 5", "M6 5h5v5"];
const ICON_BACK = ["M12.5 4.5 7 10l5.5 5.5"];
const ICON_BKSP = ["M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z", "m12 9.5 5 5M17 9.5l-5 5"];

// localStorage can be missing or blocked (private windows, previews): the
// game still works, it just doesn't remember.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not persisted */
    }
  },
};

const COLOUR = { [ABSENT]: "c-graphite is-absent", [PRESENT]: "c-lemon", [CORRECT]: "c-mint" };
const MARK_TEXT = { [ABSENT]: "no está", [PRESENT]: "está, en otra posición", [CORRECT]: "en su lugar" };
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890-"];
// Misses that unlock each clue: the same thresholds as cluesVisible.
const CLUE_AT = [2, 4, 5];
// Motion timings (ms), matched to style.css.
const STAGGER = 140;
const FLIP = 640;
const WAVE_STAGGER = 80;
const WAVE = 520;

const media = (q) => window.matchMedia(q).matches;
const reduced = () => media("(prefers-reduced-motion: reduce)");
const phone = () => media("(max-width: 599px)");
const stacked = () => media("(max-width: 1219px)");

let commands = [];
let allowed = new Set();
let words = [];
let game = null;
let busy = false;
let comp = null; // tab completion in progress: { base, list, idx }
let posMode = "fit";
let clueSel = -1;
let shownClues = 0;
let countdownTimer = 0;
let toastTimer = 0;

async function load() {
  const [cmds, list] = await Promise.all([
    fetch("commands.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
    fetch("allowed.txt").then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status)))),
  ]);
  commands = cmds;
  allowed = new Set(
    list
      .split("\n")
      .map((w) => w.trim())
      .filter((w) => w && !w.startsWith("#")),
  );
  for (const c of commands) allowed.add(c.id);
  words = [...allowed].sort();
}

const won = () => game.guesses.at(-1) === game.answer.id;
const over = () => won() || game.guesses.length >= MAX_TRIES;
const answerLen = () => Array.from(game.answer.id).length;
const misses = () => game.guesses.length - (won() ? 1 : 0);
const dayLabel = () => (game.practice ? "práctica" : `#${game.day}`);

function statsNow() {
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], ...store.get("comandle:stats", {}) };
}

// ------------------------------------------------------------------ rounds

function startDaily() {
  const day = dayNumber(Date.now());
  const answer = daily(commands, day);
  const saved = store.get("comandle:today", null);
  const guesses = saved && saved.day === day && Array.isArray(saved.guesses) ? saved.guesses : [];
  game = { answer, day, practice: false, guesses: [...guesses], current: "" };
  setupRound();
  if (over()) showEnd(false);
}

function startPractice() {
  const answer = commands[Math.floor(Math.random() * commands.length)];
  game = { answer, day: 0, practice: true, guesses: [], current: "" };
  setupRound();
  window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
}

function setupRound() {
  const len = answerLen();
  game.pool = words.filter((w) => Array.from(w).length === len);
  comp = null;
  clueSel = -1;
  shownClues = over() ? 0 : cluesVisible(game.guesses, game.answer.id);
  busy = false;
  clearInterval(countdownTimer);
  closeDrawer();
  $("end").hidden = true;
  $("end").replaceChildren();
  $("layout").classList.remove("over");
  $("game").style.setProperty("--len", String(len));
  buildBoard();
  render();
}

// ------------------------------------------------------------------ rendering

function render() {
  game.fit = candidates(game.pool, game.guesses, game.answer.id);
  $("day").textContent = dayLabel();
  paintMeta();
  paintOled();
  paintBoard();
  paintClues();
  paintInput();
  paintKeyboard();
}

// Everything that follows what is being typed.
function paintInput() {
  paintPrompt();
  paintBoard();
  paintSuggest();
  paintPosibles();
}

function paintPrompt() {
  const done = over();
  $("prompt-cmd").textContent = done ? "man" : "comandle";
  $("prompt-arg").textContent = done
    ? ` ${game.answer.id}`
    : `${game.practice ? " practica" : ""}${game.current ? ` ${game.current}` : " "}`;
}

function paintMeta() {
  const meta = $("meta");
  meta.classList.remove("err");
  meta.replaceChildren(
    "categoría ",
    el("b", null, game.answer.category),
    el("span", "dot"),
    el("b", null, String(answerLen())),
    " letras",
    el("span", "dot"),
    "nivel ",
    el("b", null, game.answer.level),
  );
}

function paintOled() {
  const tries = over() ? game.guesses.length : game.guesses.length + 1;
  const oled = $("oled");
  oled.replaceChildren();
  for (const [label, value] of [
    ["ronda", dayLabel()],
    ["intento", `${tries}/${MAX_TRIES}`],
    ["fallos", String(misses())],
  ]) {
    const cell = el("div");
    cell.append(el("span", null, label), el("b", null, value));
    oled.append(cell);
  }
}

function fillCap(node, letter, mark) {
  node.replaceChildren();
  if (letter) node.append(el("span", "lg", letter));
  if (mark === PRESENT) node.append(el("i", "cue"));
  if (mark === CORRECT) node.append(el("i", "home"));
}

function capEl(tag, cls, letter, mark) {
  const node = el(tag, `cap ${cls}`);
  fillCap(node, letter, mark);
  return node;
}

function buildBoard() {
  const len = answerLen();
  const board = $("board");
  board.replaceChildren();
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = el("div", "row");
    row.setAttribute("role", "row");
    for (let i = 0; i < len; i++) {
      const cell = el("div", "cell");
      cell.setAttribute("role", "gridcell");
      row.append(cell);
    }
    board.append(row);
  }
}

// Repaints only the cells whose state changed, so animations run once.
function paintBoard(reveal = -1) {
  const id = game.answer.id;
  const done = over();
  const rows = $("board").children;
  for (let r = 0; r < MAX_TRIES; r++) {
    const guess = game.guesses[r];
    const marks = guess ? score(guess, id) : null;
    const typing = !guess && !done && r === game.guesses.length;
    const letters = guess ? Array.from(guess) : typing ? Array.from(game.current) : [];
    Array.from(rows[r].children).forEach((cell, i) => {
      const ch = letters[i];
      let sig = "empty";
      if (marks) sig = `m${marks[i]}${ch}`;
      else if (ch) sig = `t${ch}`;
      else if (typing && i === letters.length) sig = "active";
      if (cell.dataset.sig === sig) return;
      const was = cell.dataset.sig ?? "";
      cell.dataset.sig = sig;
      cell.style.removeProperty("--d");
      cell.style.removeProperty("--wd");
      if (marks) {
        cell.className = `cell cap ${COLOUR[marks[i]]}`;
        fillCap(cell, ch, marks[i]);
        const label = `${ch} · ${MARK_TEXT[marks[i]]}`;
        cell.setAttribute("aria-label", label);
        cell.title = label;
        if (r === reveal && !reduced()) {
          cell.style.setProperty("--d", `${i * STAGGER}ms`);
          cell.classList.add("rev");
        }
      } else if (ch) {
        cell.className = "cell cap c-slate";
        fillCap(cell, ch);
        cell.setAttribute("aria-label", ch);
        cell.removeAttribute("title");
        if (!was.startsWith("t") && !reduced()) cell.classList.add("seat");
      } else {
        cell.className = `cell sock${sig === "active" ? " active" : ""}`;
        cell.replaceChildren(el("i", "stem"));
        cell.setAttribute("aria-label", sig === "active" ? "vacío, acá va la próxima letra" : "vacío");
        cell.removeAttribute("title");
      }
    });
  }
}

function paintClues() {
  const ol = $("clues");
  const done = over();
  ol.closest("section").hidden = done;
  const shown = done ? 0 : cluesVisible(game.guesses, game.answer.id);
  if (shown > shownClues) clueSel = shown - 1; // a new clue: show it
  const fresh = shown > shownClues ? shown - 1 : -1;
  shownClues = shown;
  if (clueSel < 0) clueSel = Math.max(0, shown - 1);
  const miss = misses();
  ol.replaceChildren();
  game.answer.clues.slice(0, 3).forEach((text, i) => {
    const open = i < shown;
    const li = el("li", `clue ${open ? "open" : "locked"}${i === clueSel ? " sel" : ""}${i === fresh ? " fresh" : ""}`);
    const num = capEl("button", open ? "num c-artisan" : "num c-graphite is-absent", String(i + 1));
    num.type = "button";
    num.setAttribute("aria-label", open ? `Pista ${i + 1}` : `Pista ${i + 1}, bloqueada`);
    num.setAttribute("aria-pressed", String(i === clueSel));
    num.addEventListener("click", () => {
      clueSel = i;
      paintClues();
    });
    const body = el("div", "ctext");
    if (open) {
      body.append(el("p", null, text));
    } else {
      const line = el("div", "lockline");
      const pips = el("span", "pips");
      pips.setAttribute("aria-hidden", "true");
      for (let k = 0; k < CLUE_AT[i]; k++) pips.append(el("i", k < miss ? "on" : null));
      line.append(el("p", "lockmsg", `se destapa con ${CLUE_AT[i]} fallos`), pips);
      body.append(el("span", "redact"), line);
    }
    li.append(num, body);
    ol.append(li);
  });
  const sum = el("li", "clues-sum", `${miss} ${miss === 1 ? "fallo" : "fallos"}`);
  sum.setAttribute("aria-hidden", "true");
  ol.append(sum);
}

// What the guesses so far say about each position and letter.
function knowledge() {
  const id = game.answer.id;
  const fixed = [];
  for (const g of game.guesses) {
    score(g, id).forEach((m, i) => {
      if (m === CORRECT) fixed[i] = Array.from(g)[i];
    });
  }
  return { fixed, state: letterState(game.guesses, id) };
}

function chip(word, known) {
  const b = el("button", "pchip");
  b.type = "button";
  b.tabIndex = -1;
  b.setAttribute("aria-label", word);
  Array.from(word).forEach((ch, i) => {
    let cls = null;
    if (known.fixed[i] === ch) cls = "k";
    else if (known.state.get(ch) === ABSENT) cls = "x";
    else if (known.state.has(ch)) cls = "p";
    b.append(cls ? el("i", cls, ch) : ch);
  });
  b.addEventListener("click", () => pick(word));
  return b;
}

const posibles = (n) => `${n} ${n === 1 ? "posible" : "posibles"}`;

function paintPosibles() {
  const len = answerLen();
  const pool = posMode === "fit" ? game.fit : game.pool;
  const prefix = game.current;
  const list = prefix ? pool.filter((w) => w.startsWith(prefix)) : pool;
  let count = posMode === "fit" ? posibles(pool.length) : `${pool.length} de ${len} letras`;
  if (prefix) count += ` · ${list.length} con «${prefix}»`;
  $("pos-count").textContent = count;
  $("pos-fit").setAttribute("aria-pressed", String(posMode === "fit"));
  $("pos-all").setAttribute("aria-pressed", String(posMode === "all"));
  $("pos-all").textContent = `todos los de ${len} letras`;
  $("pos-open-n").textContent = posibles(game.fit.length);
  $("pos-open").hidden = over();
  const box = $("pos-list");
  box.replaceChildren();
  if (!list.length) {
    box.append(
      el(
        "p",
        "pos-empty",
        posMode === "fit" ? `Ningún posible empieza con «${prefix}».` : `Ninguna palabra de ${len} letras empieza con «${prefix}».`,
      ),
    );
    return;
  }
  const known = knowledge();
  const frag = document.createDocumentFragment();
  for (const w of list) frag.append(chip(w, known));
  box.append(frag);
}

function paintSuggest() {
  const box = $("sug-list");
  box.replaceChildren();
  if (over() || busy) return;
  const max = phone() ? 3 : 6;
  const base = comp ? comp.base : game.current;
  const items = comp ? comp.list : base ? game.fit.filter((w) => w.startsWith(base)) : [];
  if (!items.length) {
    const hint = base ? `ningún posible empieza con «${base}»` : phone() ? "" : "escribí y apretá tab para completar";
    if (hint) box.append(el("span", "sug-hint", hint));
    return;
  }
  const start = comp ? Math.max(0, Math.min(comp.idx - max + 1, items.length - max)) : 0;
  for (const w of items.slice(start, start + max)) {
    const b = el("button", `sug${comp && comp.list[comp.idx] === w ? " sel" : ""}`);
    b.type = "button";
    b.tabIndex = -1;
    b.append(el("b", null, base), w.slice(base.length));
    b.setAttribute("aria-label", `Completar ${w}`);
    b.addEventListener("click", () => pick(w));
    box.append(b);
  }
  if (items.length > max) box.append(el("span", "sug-hint", `+${items.length - max}`));
}

function keyButton(key, label, cls, aria) {
  const b = el("button", `cap key ${cls}`);
  b.type = "button";
  b.tabIndex = -1;
  b.dataset.key = key;
  if (label) b.append(el("span", "lg", label));
  if (aria) {
    b.setAttribute("aria-label", aria);
    b.title = aria;
  }
  return b;
}

function buildKeyboard() {
  const kb = $("keyboard");
  kb.replaceChildren();
  KEY_ROWS.forEach((keys, r) => {
    const row = el("div", `kr kr${r + 1}`);
    if (r === 2) row.append(keyButton("enter", "enviar", "c-artisan enter", "Enviar"));
    for (const k of keys) row.append(keyButton(k, k, "c-slate"));
    if (r === 2) {
      const b = keyButton("backspace", null, "c-mod bksp", "Borrar");
      b.append(icon(ICON_BKSP, "0 0 24 24"));
      row.append(b);
    }
    kb.append(row);
  });
}

function paintKeyboard() {
  const state = letterState(game.guesses, game.answer.id);
  const done = over();
  for (const b of $("keyboard").querySelectorAll("button")) {
    b.disabled = done;
    const k = b.dataset.key;
    if (k.length !== 1) continue;
    const m = state.get(k);
    const sig = m == null ? "" : String(m);
    if (b.dataset.sig !== sig) {
      b.dataset.sig = sig;
      b.className = `cap key ${m == null ? "c-slate" : COLOUR[m]}`;
      fillCap(b, k, m);
    }
    const label = m == null ? k : `${k} · ${MARK_TEXT[m]}`;
    b.setAttribute("aria-label", label);
    if (m == null) b.removeAttribute("title");
    else b.title = label;
  }
}

function paintTmux() {
  const s = statsNow();
  const pct = s.played ? Math.round((s.wins * 100) / s.played) : 0;
  const t = $("tmux-stats");
  const sep = () => el("span", "sep", "·");
  t.replaceChildren(
    "racha ",
    el("b", s.streak > 0 ? "hot" : null, String(s.streak)),
    sep(),
    "mejor racha ",
    el("b", null, String(s.maxStreak)),
    sep(),
    "ganados ",
    el("b", "g", `${pct}%`),
  );
}

// ------------------------------------------------------------------ input

function toast(message) {
  const t = $("toast");
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.textContent = ""), 2600);
}

function wobble() {
  const row = $("board").children[game.guesses.length];
  if (!row) return;
  sound.play("reject");
  row.classList.remove("wobble");
  void row.offsetWidth;
  row.classList.add("wobble");
}

function flashKey(key) {
  const b = $("keyboard").querySelector(`[data-key="${key}"]`);
  if (!b || b.disabled) return;
  b.classList.add("down");
  setTimeout(() => b.classList.remove("down"), 110);
}

function playing() {
  return game && !over() && !busy;
}

function press(key) {
  if (!playing()) return;
  const len = answerLen();
  if (key === "enter") return submit(len);
  if (key === "backspace") {
    if (!game.current) return;
    game.current = Array.from(game.current).slice(0, -1).join("");
  } else if (/^[a-z0-9-]$/.test(key) && Array.from(game.current).length < len) {
    game.current += key;
  } else {
    return;
  }
  comp = null;
  sound.play(key === "backspace" ? "back" : "key");
  paintInput();
}

function pick(word) {
  if (!playing()) return;
  game.current = word;
  comp = null;
  sound.play("tab");
  paintInput();
  closeDrawer();
}

// Shell-style completion: tab (or the arrows) cycles through the
// candidates that start with what was typed, writing each one in the row.
function canComplete() {
  return playing() && (comp || game.current);
}

function complete(step) {
  if (!comp) {
    const base = game.current;
    const list = game.fit.filter((w) => w.startsWith(base));
    if (!list.length) {
      wobble();
      return;
    }
    comp = { base, list, idx: step > 0 ? 0 : list.length - 1 };
  } else {
    comp.idx = (comp.idx + step + comp.list.length) % comp.list.length;
  }
  game.current = comp.list[comp.idx];
  sound.play("tab");
  paintPrompt();
  paintBoard();
  paintSuggest();
  paintPosibles();
}

function submit(len) {
  const guess = game.current;
  if (Array.from(guess).length !== len) {
    toast(`Tiene que tener ${len} letras.`);
    return wobble();
  }
  if (game.guesses.includes(guess)) {
    toast("Ya lo probaste.");
    return wobble();
  }
  if (!allowed.has(guess)) {
    toast(`«${guess}» no está en la lista de comandos que acepta el juego.`);
    return wobble();
  }
  game.guesses.push(guess);
  game.current = "";
  comp = null;
  if (!game.practice) store.set("comandle:today", { day: game.day, guesses: game.guesses });
  busy = true;
  sound.play("enter");
  const row = game.guesses.length - 1;
  paintBoard(row);
  paintPrompt();
  paintSuggest();
  paintPosibles();
  const quick = reduced();
  if (!quick) for (let i = 0; i < len; i++) setTimeout(() => sound.play("flip"), i * STAGGER + FLIP / 2);
  setTimeout(
    () => {
      busy = false;
      render();
      if (over()) finish();
    },
    quick ? 0 : (len - 1) * STAGGER + FLIP,
  );
}

// A round just ended in this session (restored rounds go straight to showEnd).
function finish() {
  if (!game.practice) {
    store.set("comandle:stats", recordStats(store.get("comandle:stats", {}), game.day, won(), game.guesses.length));
    const history = store.get("comandle:history", []);
    if (Array.isArray(history) && !history.some((h) => h.day === game.day)) {
      history.push({ day: game.day, won: won(), tries: game.guesses.length });
      store.set("comandle:history", history.slice(-30));
    }
  }
  paintTmux();
  if (!won() || reduced()) return showEnd(true);
  const len = answerLen();
  const cells = $("board").children[game.guesses.length - 1].children;
  Array.from(cells).forEach((cell, i) => {
    cell.style.setProperty("--wd", `${i * WAVE_STAGGER}ms`);
    cell.classList.add("wave");
  });
  burst();
  sound.play("win");
  busy = true;
  setTimeout(() => {
    busy = false;
    showEnd(true);
  }, (len - 1) * WAVE_STAGGER + WAVE * 2);
}

// ------------------------------------------------------------------ end card

function codeLine(cmd, id) {
  const code = el("code");
  code.append(el("span", "p", "$ "));
  for (const [, tok, space] of cmd.matchAll(/("[^"]*"|'[^']*'|\S+)(\s*)/g)) {
    const cls = tok === id ? "c" : tok.startsWith("-") ? "f" : /^["']/.test(tok) ? "s" : null;
    code.append(cls ? el("span", cls, tok) : tok);
    if (space) code.append(space);
  }
  return code;
}

function writeClipboard(text) {
  try {
    return navigator.clipboard.writeText(text);
  } catch {
    return Promise.reject(new Error("no clipboard"));
  }
}

function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function copyButton(cmd, codeNode) {
  const b = el("button", "copy");
  b.type = "button";
  b.title = "Copiar";
  b.setAttribute("aria-label", `Copiar ${cmd}`);
  const label = el("span");
  b.append(icon(ICON_COPY, "0 0 16 16"), label);
  let timer = 0;
  b.addEventListener("click", () => {
    writeClipboard(cmd).then(
      () => {
        sound.play("key");
        b.classList.add("done");
        label.textContent = "Copiado";
        clearTimeout(timer);
        timer = setTimeout(() => {
          b.classList.remove("done");
          label.textContent = "";
        }, 1600);
      },
      () => {
        selectText(codeNode);
        toast("Seleccioné el comando: copialo con Ctrl+C.");
      },
    );
  });
  return b;
}

function specRow(dl, term, content, cls) {
  const row = el("div", cls);
  const dd = el("dd");
  dd.append(...(Array.isArray(content) ? content : [content]));
  row.append(el("dt", null, term), dd);
  dl.append(row);
  return dd;
}

// The command explained as a man page laid out like a spec sheet.
function buildMan(c, n) {
  const box = el("div", "man");
  const head = el("div", "man-head");
  head.setAttribute("aria-hidden", "true");
  const ref = `${c.id.toUpperCase()}(1)`;
  head.append(el("span", null, ref), el("span", null, "Manual de comandle"), el("span", null, ref));

  const title = el("h2", "man-title");
  const tags = el("span", "tags");
  tags.append("· ", el("b", null, c.category), ` · ${c.level}${n ? ` · #${n}` : ""}`);
  title.append(el("span", "id", c.id), tags);

  const dl = el("dl", "spec");
  specRow(dl, "NOMBRE", [el("b", null, c.id), ` — ${c.summary}`]).className = "lead";
  specRow(dl, "DESCRIPCIÓN", c.explanation);
  const ex = el("ol", "ex");
  for (const e of c.examples) {
    const li = el("li");
    const line = el("div", "code");
    const code = codeLine(e.cmd, c.id);
    line.append(code, copyButton(e.cmd, code));
    li.append(line, el("p", null, e.desc));
    ex.append(li);
  }
  specRow(dl, "EJEMPLOS", ex);
  specRow(dl, "SEGURIDAD", el("div", "hazard", c.security), "warn");
  if (c.lab) {
    const a = el("a", "lab", "Practicalo en Open Security Labs");
    a.href = c.lab;
    a.rel = "noopener";
    a.append(icon(ICON_LINK, "0 0 16 16"));
    specRow(dl, "VER TAMBIÉN", a);
  }
  box.append(head, title, dl);
  return box;
}

function showEnd(animate) {
  const swap = () => buildEnd(animate);
  if (animate && !reduced() && !stacked() && document.startViewTransition) document.startViewTransition(swap);
  else swap();
}

function buildEnd(animate) {
  const c = game.answer;
  const len = answerLen();
  const end = $("end");
  end.replaceChildren();
  end.style.setProperty("--len", String(len));
  const win = won();

  const hero = el("div", `hero ${win ? "won" : "lost"}`);
  const head = el("div", "won-wrap");
  const result = el("p", "result");
  if (win) result.append(el("span", null, "¡Bien!"), " Lo sacaste en ", el("b", null, `${game.guesses.length}/${MAX_TRIES}`), ".");
  else result.append(el("span", null, "Esta vez no."), " Era ", el("b", null, c.id), ".");
  head.append(el("span", "tag", dayLabel()), result);
  const tray = el("div", "hero-tray");
  tray.setAttribute("aria-hidden", "true");
  Array.from(c.id).forEach((ch, i) => {
    const cap = capEl("span", win ? "c-mint" : "c-paper", ch, win ? CORRECT : null);
    if (animate && !reduced()) {
      if (win) {
        cap.style.setProperty("--wd", `${300 + i * WAVE_STAGGER}ms`);
        cap.classList.add("wave");
      } else {
        cap.style.setProperty("--d", `${350 + i * 260}ms`);
        cap.classList.add("rev");
      }
    }
    tray.append(cap);
  });
  hero.append(head, tray);

  const band = el("div", "share-band");
  const mini = el("div", "mini");
  mini.setAttribute("role", "img");
  mini.setAttribute("aria-label", `Tu resultado: ${win ? game.guesses.length : "X"}/${MAX_TRIES}`);
  for (const g of game.guesses) {
    for (const m of score(g, c.id)) mini.append(capEl("span", COLOUR[m], null, m));
  }
  const share = shareText(game.day, game.guesses, c.id, game.practice);
  const actions = el("div", "actions");
  const copy = el("button", "cap c-artisan btn");
  copy.type = "button";
  const copyLabel = el("span", null, "Copiar resultado");
  copy.append(copyLabel);
  copy.addEventListener("click", () => copyShare(share, copyLabel, band));
  const again = el("button", "cap c-slate btn");
  again.type = "button";
  again.append(el("span", null, game.practice ? "Otra práctica" : "Practicar con uno al azar"));
  again.addEventListener("click", startPractice);
  actions.append(copy, again);
  band.append(mini, actions);

  if (!game.practice) {
    const count = el("p", "count");
    const time = el("time");
    count.append("El próximo comandle sale en ", time, ".");
    band.append(count);
    const tick = () => {
      const left = nextDayMs(Date.now()) - Date.now();
      if (left <= 0) return location.reload();
      const h = Math.floor(left / 3_600_000);
      const m = Math.floor((left % 3_600_000) / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      time.textContent = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 1000);
  }

  const install = el("div", "install");
  const code = el("code");
  code.append(el("span", "p", "$ "), "go install github.com/ValentinTorassa/comandle@latest");
  install.append(el("span", null, "En la terminal"), code);

  end.append(hero, band, buildMan(c), install);
  end.hidden = false;
  $("layout").classList.add("over");
  closeDrawer();
  render();
  if (stacked()) end.scrollIntoView({ behavior: reduced() || !animate ? "auto" : "smooth", block: "start" });
}

function copyShare(text, label, band) {
  writeClipboard(text).then(
    () => {
      sound.play("key");
      label.textContent = "Copiado";
      setTimeout(() => (label.textContent = "Copiar resultado"), 1800);
    },
    () => {
      // Show it so it can be copied by hand.
      let pre = band.querySelector(".share-text");
      if (!pre) {
        pre = el("pre", "share-text", text);
        band.append(pre);
      }
      selectText(pre);
      toast("Seleccioné el resultado: copialo con Ctrl+C.");
    },
  );
}

// ------------------------------------------------------------------ win burst

// A short shower of tiny keycaps over the board.
function burst() {
  if (reduced()) return;
  const canvas = el("canvas", "burst");
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.remove();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const r = $("board").getBoundingClientRect();
  const colours = [
    ["#50fa7b", "#1c9443"],
    ["#f1fa8c", "#959c42"],
    ["#ff79c6", "#8a3f78"],
    ["#bd93f9", "#5d3f96"],
    ["#8be9fd", "#3f8597"],
  ];
  const parts = Array.from({ length: phone() ? 26 : 44 }, () => ({
    x: r.left + r.width * (0.2 + Math.random() * 0.6),
    y: r.top + r.height * 0.3,
    vx: (Math.random() - 0.5) * 9,
    vy: -6 - Math.random() * 8,
    s: 7 + Math.random() * 8,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.3,
    c: colours[Math.floor(Math.random() * colours.length)],
  }));
  const rect = (x, y, w, h, rad) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  };
  const t0 = performance.now();
  const D = 1300;
  const frame = (t) => {
    const k = (t - t0) / D;
    ctx.clearRect(0, 0, W, H);
    if (k >= 1) return canvas.remove();
    ctx.globalAlpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
    for (const p of parts) {
      p.vy += 0.38;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c[1];
      rect(-p.s / 2, -p.s / 2 + p.s * 0.2, p.s, p.s, p.s * 0.22);
      ctx.fillStyle = p.c[0];
      rect(-p.s / 2 + 1, -p.s / 2, p.s - 2, p.s * 0.8, p.s * 0.2);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ sound

// Optional key sounds, synthesised (no files): a short "thock" per key and a
// lighter click per flip. Off by default; the choice is remembered.
const sound = {
  on: store.get("comandle:sound", false) === true,
  ctx: null,
  noise: null,
  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    const n = Math.floor(this.ctx.sampleRate * 0.06);
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return this.ctx;
  },
  thock(at, { f0, f1, body, decay, click, band }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(body, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + decay + 0.02);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = band;
    bp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(click, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(bp).connect(ng).connect(ctx.destination);
    src.start(t);
  },
  play(kind) {
    if (!this.on || !this.init()) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const jitter = 1 + (Math.random() - 0.5) * 0.1;
    const K = {
      key: { f0: 170 * jitter, f1: 95, body: 0.2, decay: 0.09, click: 0.12, band: 2600 * jitter },
      back: { f0: 140, f1: 85, body: 0.16, decay: 0.08, click: 0.09, band: 2200 },
      tab: { f0: 220, f1: 140, body: 0.1, decay: 0.06, click: 0.08, band: 3400 },
      enter: { f0: 125, f1: 68, body: 0.28, decay: 0.15, click: 0.14, band: 1800 },
      flip: { f0: 260 * jitter, f1: 170, body: 0.09, decay: 0.07, click: 0.1, band: 3800 },
      reject: { f0: 105, f1: 60, body: 0.18, decay: 0.08, click: 0.06, band: 1400 },
    };
    if (kind === "reject") {
      this.thock(0, K.reject);
      this.thock(0.08, K.reject);
    } else if (kind === "win") {
      [0, 0.09, 0.18, 0.27].forEach((at, i) => this.thock(at, { ...K.flip, f0: 260 + i * 70, f1: 200 + i * 60 }));
    } else if (K[kind]) {
      this.thock(0, K[kind]);
    }
  },
  toggle() {
    this.on = !this.on;
    store.set("comandle:sound", this.on);
    paintSound();
    if (this.on) this.play("key");
  },
};

function paintSound() {
  const b = $("toggle-sound");
  b.setAttribute("aria-pressed", String(sound.on));
  b.title = sound.on ? "Sonido de teclas: activado" : "Sonido de teclas: apagado";
}

// ------------------------------------------------------------------ drawer (phones)

const drawerOpen = () => $("posibles").classList.contains("open");

function openDrawer() {
  if (!game || over()) return;
  $("posibles").classList.add("open");
  $("scrim").hidden = false;
  $("pos-open").setAttribute("aria-expanded", "true");
  $("pos-close").focus({ preventScroll: true });
}

function closeDrawer() {
  if (!drawerOpen()) return;
  $("posibles").classList.remove("open");
  $("scrim").hidden = true;
  $("pos-open").setAttribute("aria-expanded", "false");
}

// ------------------------------------------------------------------ dialogs

function buildTutorial() {
  const row = $("tut-row");
  const sample = [
    ["e", CORRECT],
    ["c", PRESENT],
    ["h", ABSENT],
    ["o", ABSENT],
  ];
  sample.forEach(([ch, m], i) => {
    const cap = capEl("span", COLOUR[m], ch, m);
    cap.style.setProperty("--d", `${i * 160}ms`);
    row.append(cap);
  });
}

function openHelp() {
  closeDrawer();
  if (!$("help").open) $("help").showModal();
}

function renderStats() {
  const s = statsNow();
  const pct = s.played ? Math.round((s.wins * 100) / s.played) : 0;
  const nums = $("stats-numbers");
  nums.replaceChildren();
  for (const [value, label, hot] of [
    [s.played, "jugados"],
    [`${pct}%`, "ganados"],
    [s.streak, "racha", s.streak > 0],
    [s.maxStreak, "mejor racha"],
  ]) {
    const cell = el("div", hot ? "hot" : null);
    cell.append(el("b", null, String(value)), el("span", null, label));
    nums.append(cell);
  }

  const hist = $("stats-history");
  hist.replaceChildren();
  const last = store.get("comandle:history", []);
  const recent = Array.isArray(last) ? last.slice(-10) : [];
  if (!recent.length) hist.append(el("span", "empty", "Acá vas a ver tus últimas rondas del día."));
  for (const h of recent) {
    const cap = h.won ? capEl("span", "c-mint", String(h.tries), CORRECT) : capEl("span", "c-graphite is-absent", "x");
    const label = `#${h.day}: ${h.won ? `${h.tries}/${MAX_TRIES}` : `X/${MAX_TRIES}`}`;
    cap.title = label;
    cap.setAttribute("role", "img");
    cap.setAttribute("aria-label", label);
    hist.append(cap);
  }

  const dist = $("stats-dist");
  dist.replaceChildren();
  const top = Math.max(1, ...s.dist);
  const today = game && !game.practice && over() && won() ? game.guesses.length - 1 : -1;
  const fills = [];
  s.dist.forEach((n, i) => {
    const bar = el("div", "bar");
    const fill = el("i", i === today ? "lit" : null, String(n));
    bar.append(el("span", null, String(i + 1)), fill);
    dist.append(bar);
    fills.push([fill, `${8 + (n * 92) / top}%`]);
  });
  const grow = () => fills.forEach(([f, w]) => (f.style.width = w));
  if (reduced()) grow();
  else requestAnimationFrame(() => requestAnimationFrame(grow));
}

function renderArchive(n) {
  const body = $("archive-body");
  body.replaceChildren();
  if (!commands.length) {
    body.append(el("p", "arch-note", "No pude cargar los comandos. Recargá la página."));
    return;
  }
  if (n) {
    const back = el("button", "back");
    back.type = "button";
    back.append(icon(ICON_BACK), "Volver a la lista");
    back.addEventListener("click", () => renderArchive());
    body.append(back, buildMan(daily(commands, n), n));
    back.focus({ preventScroll: true });
    $("archive").scrollTop = 0;
    return;
  }
  const today = dayNumber(Date.now());
  if (today <= 1) {
    body.append(el("p", "arch-note", "Todavía no hay comandos anteriores: el #1 salió hoy."));
    return;
  }
  body.append(el("p", "arch-note", "Los comandos de los días que ya pasaron, del más nuevo al más viejo."));
  const list = el("ul", "arch-list");
  for (let d = today - 1; d >= 1; d--) {
    const c = daily(commands, d);
    const li = el("li");
    const card = el("button", "arch-card");
    card.type = "button";
    card.append(el("span", "n", `#${d}`), el("span", "id", c.id), el("span", "tags", `${c.category} · ${c.level}`));
    card.addEventListener("click", () => renderArchive(d));
    li.append(card);
    list.append(li);
  }
  body.append(list);
}

// ------------------------------------------------------------------ wiring

function wire() {
  // A mouse click on the header or game controls should not take focus away
  // from typing (tab completes while the page has focus). Keyboard users
  // still reach every button with tab from the address bar or a dialog.
  document.addEventListener("mousedown", (e) => {
    if (e.target instanceof Element && e.target.closest(".top button, .game button")) e.preventDefault();
  });
  $("keyboard").addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (key) press(key);
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (e.key === "Escape" && drawerOpen()) return closeDrawer();
    if (e.key === "?") {
      e.preventDefault();
      return openHelp();
    }
    if (!game) return;
    const onControl = e.target instanceof Element && e.target.closest("button, a") && !e.target.closest("#keyboard");
    const step =
      e.key === "Tab" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      if (!onControl && !drawerOpen() && canComplete()) {
        e.preventDefault();
        complete(step);
      }
      return;
    }
    const key = e.key === "Enter" ? "enter" : e.key === "Backspace" ? "backspace" : e.key.length === 1 ? e.key.toLowerCase() : "";
    if (!(key === "enter" || key === "backspace" || /^[a-z0-9-]$/.test(key))) return;
    if (!playing()) return; // let a focused button handle Enter after the round
    e.preventDefault();
    flashKey(key);
    press(key);
  });
  $("open-help").addEventListener("click", openHelp);
  $("open-stats").addEventListener("click", () => {
    closeDrawer();
    renderStats();
    $("stats").showModal();
  });
  $("open-archive").addEventListener("click", () => {
    closeDrawer();
    renderArchive();
    $("archive").showModal();
  });
  $("toggle-sound").addEventListener("click", () => sound.toggle());
  $("pos-fit").addEventListener("click", () => {
    posMode = "fit";
    if (game) paintPosibles();
  });
  $("pos-all").addEventListener("click", () => {
    posMode = "all";
    if (game) paintPosibles();
  });
  $("pos-open").addEventListener("click", openDrawer);
  $("pos-close").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  window.addEventListener("resize", () => {
    if (!phone()) closeDrawer();
    if (game && !over()) paintSuggest();
  });
}

async function main() {
  buildKeyboard();
  buildTutorial();
  paintSound();
  paintTmux();
  wire();
  try {
    await load();
  } catch {
    const meta = $("meta");
    meta.textContent = "No pude cargar los comandos. Recargá la página.";
    meta.classList.add("err");
    $("game").classList.add("failed");
    return;
  }
  startDaily();
  if (!store.get("comandle:seen", false)) {
    store.set("comandle:seen", true);
    openHelp();
  }
}

main();
