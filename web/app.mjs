// comandle in the browser: the same daily command as the terminal, with the
// state kept in this browser only. Everything is built with DOM calls and
// textContent; nothing is parsed as HTML.
import {
  ABSENT,
  CORRECT,
  MAX_TRIES,
  PRESENT,
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

const MARK_CLASS = { [ABSENT]: "absent", [PRESENT]: "present", [CORRECT]: "correct" };
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890-"];

let commands = [];
let allowed = new Set();
let game = null;
let countdownTimer = 0;
let toastTimer = 0;

async function load() {
  const [cmds, words] = await Promise.all([
    fetch("commands.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
    fetch("allowed.txt").then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status)))),
  ]);
  commands = cmds;
  allowed = new Set(
    words
      .split("\n")
      .map((w) => w.trim())
      .filter((w) => w && !w.startsWith("#")),
  );
  for (const c of commands) allowed.add(c.id);
}

const won = () => game.guesses.at(-1) === game.answer.id;
const over = () => won() || game.guesses.length >= MAX_TRIES;

function startDaily() {
  const day = dayNumber(Date.now());
  const answer = daily(commands, day);
  const saved = store.get("comandle:today", null);
  const guesses = saved && saved.day === day && Array.isArray(saved.guesses) ? saved.guesses : [];
  game = { answer, day, practice: false, guesses: [...guesses], current: "" };
  render();
  if (over()) showEnd();
}

function startPractice() {
  const answer = commands[Math.floor(Math.random() * commands.length)];
  game = { answer, day: 0, practice: true, guesses: [], current: "" };
  $("end").hidden = true;
  $("keyboard").hidden = false;
  clearInterval(countdownTimer);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function tileSize(len) {
  const room = Math.min(520, window.innerWidth - 32);
  return Math.max(30, Math.min(56, Math.floor((room - (len - 1) * 6) / len)));
}

function render() {
  const id = game.answer.id;
  const len = Array.from(id).length;
  $("day").textContent = game.practice ? "práctica" : `#${game.day}`;

  const meta = $("meta");
  meta.replaceChildren(
    "categoría: ",
    el("b", null, game.answer.category),
    " · ",
    el("i", null, String(len)),
    " letras",
  );

  const board = $("board");
  board.style.setProperty("--tile", `${tileSize(len)}px`);
  board.replaceChildren();
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = el("div", "row");
    row.setAttribute("role", "row");
    const guess = game.guesses[r];
    const marks = guess ? score(guess, id) : null;
    const letters = guess ? Array.from(guess) : r === game.guesses.length ? Array.from(game.current) : [];
    for (let i = 0; i < len; i++) {
      const tile = el("div", "tile", letters[i] ?? "");
      tile.setAttribute("role", "gridcell");
      if (marks) {
        tile.classList.add(MARK_CLASS[marks[i]]);
        tile.setAttribute("aria-label", `${letters[i]}: ${["no está", "en otra posición", "en su lugar"][marks[i]]}`);
      } else if (letters[i]) {
        tile.classList.add("filled");
      }
      row.append(tile);
    }
    board.append(row);
  }

  const clues = $("clues");
  clues.replaceChildren();
  const shown = over() ? 0 : cluesVisible(game.guesses, id);
  for (let i = 0; i < shown; i++) {
    const li = el("li");
    li.append(el("b", null, `pista ${i + 1}: `), game.answer.clues[i]);
    clues.append(li);
  }

  renderKeyboard();
}

function renderKeyboard() {
  const state = letterState(game.guesses, game.answer.id);
  const kb = $("keyboard");
  kb.replaceChildren();
  KEY_ROWS.forEach((keys, r) => {
    const row = el("div", "krow");
    if (r === 2) row.append(keyButton("enter", "Enviar", "wide"));
    for (const k of keys) {
      const btn = keyButton(k, k);
      if (state.has(k)) btn.classList.add(MARK_CLASS[state.get(k)]);
      row.append(btn);
    }
    if (r === 2) row.append(keyButton("backspace", "⌫", "wide", "Borrar"));
    kb.append(row);
  });
}

function keyButton(key, label, extra, aria) {
  const btn = el("button", `key ${extra ?? ""}`.trim(), label);
  btn.type = "button";
  btn.dataset.key = key;
  if (aria) btn.setAttribute("aria-label", aria);
  return btn;
}

function toast(message) {
  const t = $("toast");
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.textContent = ""), 2600);
}

function shakeCurrentRow() {
  const row = $("board").children[game.guesses.length];
  if (!row) return;
  row.classList.remove("shake");
  void row.offsetWidth;
  row.classList.add("shake");
}

function press(key) {
  if (!game || over()) return;
  const len = Array.from(game.answer.id).length;
  if (key === "enter") return submit(len);
  if (key === "backspace") {
    game.current = Array.from(game.current).slice(0, -1).join("");
  } else if (/^[a-z0-9-]$/.test(key) && Array.from(game.current).length < len) {
    game.current += key;
  } else {
    return;
  }
  render();
}

function submit(len) {
  const guess = game.current;
  if (Array.from(guess).length !== len) {
    toast(`Tiene que tener ${len} letras.`);
    return shakeCurrentRow();
  }
  if (game.guesses.includes(guess)) {
    toast("Ya lo probaste.");
    return shakeCurrentRow();
  }
  if (!allowed.has(guess)) {
    toast(`«${guess}» no está en la lista de comandos que acepta el juego.`);
    return shakeCurrentRow();
  }
  game.guesses.push(guess);
  game.current = "";
  if (!game.practice) store.set("comandle:today", { day: game.day, guesses: game.guesses });
  render();
  if (over()) {
    if (!game.practice) {
      store.set("comandle:stats", recordStats(store.get("comandle:stats", {}), game.day, won(), game.guesses.length));
    }
    showEnd();
  }
}

function showEnd() {
  const c = game.answer;
  const end = $("end");
  end.replaceChildren();

  end.append(
    won()
      ? el("h2", "won", `¡Bien! Lo sacaste en ${game.guesses.length}/${MAX_TRIES}.`)
      : el("h2", "lost", `Esta vez no. Era ${c.id}.`),
  );

  const title = el("div", "card-title");
  title.append(el("span", "id", c.id), el("span", "tags", `${c.category} · ${c.level}`));
  end.append(title, el("p", "summary", c.summary), el("p", null, c.explanation));

  const examples = el("div", "examples");
  examples.append(el("b", null, "Ejemplos"));
  for (const ex of c.examples) {
    const box = el("div", "example");
    box.append(el("pre", null, ex.cmd), el("div", "desc", ex.desc));
    examples.append(box);
  }
  end.append(examples);

  const sec = el("p", "security");
  sec.append(el("b", null, "Seguridad: "), c.security);
  end.append(sec);

  if (c.lab) {
    const lab = el("p");
    const a = el("a", null, "Practicalo en Open Security Labs");
    a.href = c.lab;
    a.rel = "noopener";
    lab.append(a);
    end.append(lab);
  }

  const share = shareText(game.day, game.guesses, c.id, game.practice);
  const actions = el("div", "actions");
  const copy = el("button", "primary", "Copiar resultado");
  copy.type = "button";
  copy.addEventListener("click", () => copyText(share, copy));
  const again = el("button", "secondary", game.practice ? "Otra práctica" : "Practicar con uno al azar");
  again.type = "button";
  again.addEventListener("click", startPractice);
  actions.append(copy, again);
  end.append(actions);

  if (!game.practice) {
    const countdown = el("p", "countdown");
    end.append(countdown);
    const tick = () => {
      const left = nextDayMs(Date.now()) - Date.now();
      if (left <= 0) return location.reload();
      const h = Math.floor(left / 3_600_000);
      const m = Math.floor((left % 3_600_000) / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      countdown.textContent = `El próximo comandle sale en ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.`;
    };
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 1000);
  }

  const install = el("p", "install");
  install.append("En la terminal: ", el("code", null, "go install github.com/ValentinTorassa/comandle@latest"));
  end.append(install);

  end.hidden = false;
  $("keyboard").hidden = true;
  end.scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyText(text, button) {
  const done = () => {
    button.textContent = "Copiado";
    setTimeout(() => (button.textContent = "Copiar resultado"), 1800);
  };
  const fallback = () => {
    // Show it so it can be copied by hand.
    let pre = button.parentElement.nextElementSibling;
    if (!pre || pre.tagName !== "PRE") {
      pre = el("pre", null, text);
      button.parentElement.after(pre);
    }
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast("Seleccioné el resultado: copialo con Ctrl+C.");
  };
  try {
    navigator.clipboard.writeText(text).then(done, fallback);
  } catch {
    fallback();
  }
}

function renderStats() {
  const s = { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], ...store.get("comandle:stats", {}) };
  const pct = s.played ? Math.round((s.wins * 100) / s.played) : 0;
  const nums = $("stats-numbers");
  nums.replaceChildren();
  for (const [value, label] of [[s.played, "jugados"], [`${pct}%`, "ganados"], [s.streak, "racha"], [s.maxStreak, "mejor racha"]]) {
    const cell = el("div");
    cell.append(el("b", null, String(value)), el("span", null, label));
    nums.append(cell);
  }
  const dist = $("stats-dist");
  dist.replaceChildren();
  const top = Math.max(1, ...s.dist);
  s.dist.forEach((n, i) => {
    const bar = el("div", "bar");
    const fill = el("i", null, String(n));
    fill.style.width = `${8 + (n * 92) / top}%`;
    bar.append(el("span", null, String(i + 1)), fill);
    dist.append(bar);
  });
}

function wire() {
  $("keyboard").addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (key) press(key);
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    const key = e.key === "Enter" ? "enter" : e.key === "Backspace" ? "backspace" : e.key.toLowerCase();
    if (key === "enter" || key === "backspace" || /^[a-z0-9-]$/.test(key)) {
      e.preventDefault();
      press(key);
    }
  });
  $("open-help").addEventListener("click", () => $("help").showModal());
  $("open-stats").addEventListener("click", () => {
    renderStats();
    $("stats").showModal();
  });
  window.addEventListener("resize", () => game && render());
}

async function main() {
  wire();
  try {
    await load();
  } catch {
    $("meta").textContent = "No pude cargar los comandos. Recargá la página.";
    return;
  }
  startDaily();
  if (!store.get("comandle:seen", false)) {
    store.set("comandle:seen", true);
    $("help").showModal();
  }
}

main();
