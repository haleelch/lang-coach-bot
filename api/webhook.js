const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DB_URL = "https://digital-locker-7c539-default-rtdb.asia-southeast1.firebasedatabase.app";
const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const SECRET_PIN = "6391";
const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 min idle -> locks itself

const WELCOME = "<b>Welcome Haleel</b>";

const MAIN_MENU = {
  inline_keyboard: [
    [
      { text: "📄 Certificates", callback_data: "menu_certs" },
      { text: "📚 Kitab Library", callback_data: "menu_library" },
    ],
    [
      { text: "📝 Secret Notes", callback_data: "menu_notes" },
      { text: "💰 Money Tracker", callback_data: "menu_money" },
    ],
  ],
};

const BACK = { inline_keyboard: [[{ text: "⬅️ Menu", callback_data: "menu_home" }]] };

const SECTIONS = {
  certs: {
    title: "📄 Certificates",
    help: "📎 Send a file/photo to add (name as caption, or I'll ask).\n🔢 Tap a number to open · or type a name to search.",
  },
  library: {
    title: "📚 Kitab Library",
    help: "📎 Send a PDF to add (book name as caption, or I'll ask).\n🔢 Tap a number to open · or type a name to search.",
  },
  notes: {
    title: "📝 Secret Notes & IDs",
    help: "✍️ Type any text to add a note, then I'll ask for a title.\n🔢 Tap a number to open and edit.",
  },
  money: {
    title: "💰 Money Tracker",
    help: "✍️ Type <code>Name give 500</code> or <code>Name get 500</code> to add.\n🔢 Tap a number to open.",
  },
};

const NODE = { certs: "certificates", library: "library", notes: "notes", money: "debts" };
const PAGE_SIZE = 6;

// ---------- helpers ----------

const today = () => new Date().toLocaleDateString("en-IN");
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(method, body) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) console.error(method, "failed:", j.description);
    return j;
  } catch (e) {
    console.error(method, e);
    return {};
  }
}

const del = (chatId, id) => (id ? tg("deleteMessage", { chat_id: chatId, message_id: id }) : null);

async function send(chatId, text, extra = {}) {
  const r = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
  return r.result && r.result.message_id;
}

async function sendFile(chatId, fileId, type, caption) {
  const endpoint = type === "photo" ? "sendPhoto" : "sendDocument";
  const r = await tg(endpoint, { chat_id: chatId, caption, parse_mode: "HTML", [type]: fileId });
  if (!r.ok) await send(chatId, `⚠️ Telegram could not send this file: ${esc(r.description || "unknown error")}`);
  return r.result && r.result.message_id;
}

// Edit the single "panel" message in place (so chat stays clean). Sends a new one if needed.
async function showPanel(chatId, s, text, markup) {
  if (s.menuId) {
    const r = await tg("editMessageText", {
      chat_id: chatId,
      message_id: s.menuId,
      text,
      parse_mode: "HTML",
      reply_markup: markup,
    });
    if (r.ok || (r.description || "").includes("not modified")) return;
  }
  s.menuId = await send(chatId, text, { reply_markup: markup });
}

// Delete everything the bot/user left in chat during the session
async function wipe(chatId, s) {
  const ids = [...(s.trash || [])];
  if (s.menuId) ids.push(s.menuId);
  await Promise.all(ids.map((id) => del(chatId, id)));
}

// Session state lives in Firebase (Vercel memory resets between requests)
async function getSession(chatId) {
  try {
    const r = await fetch(`${DB_URL}/sessions/${chatId}.json`);
    const j = await r.json();
    if (!r.ok || (j && j.error)) {
      console.error("getSession failed:", j);
      return {};
    }
    return j || {};
  } catch (e) {
    console.error("getSession error:", e);
    return {};
  }
}

// returns true when Firebase accepted the write
async function putSession(chatId, s) {
  try {
    const r = await fetch(`${DB_URL}/sessions/${chatId}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    if (!r.ok) {
      console.error("putSession failed:", r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("putSession error:", e);
    return false;
  }
}

async function dbPost(path, data) {
  await fetch(`${DB_URL}/${path}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function dbGet(path) {
  const r = await fetch(`${DB_URL}/${path}.json`);
  return r.json();
}

async function dbPatch(path, data) {
  await fetch(`${DB_URL}/${path}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function dbDelete(path) {
  await fetch(`${DB_URL}/${path}.json`, { method: "DELETE" });
}

const fmt = (n) => Number(n || 0).toLocaleString("en-IN");
const moneyLine = (it) => (it.type ? `${it.person} ${it.type} ₹${fmt(it.amount)}` : it.person || "Record");

function itemTitle(key, it) {
  if (key === "money") return moneyLine(it) + (it.settled ? " ✅" : "");
  return it.title || "Untitled";
}

// "Name give 500" / "Name get ₹1,000"
function parseMoney(text) {
  const m = text.match(/^(.+?)\s+(give|get)\s*₹?\s*([\d,]+(?:\.\d+)?)\s*$/i);
  if (!m) return null;
  return { person: m[1].trim(), type: m[2].toLowerCase(), amount: Number(m[3].replace(/,/g, "")) };
}

function moneyTotals(items) {
  let give = 0;
  let get = 0;
  const people = {}; // pending only; give = +, get = -
  items.forEach((it) => {
    if (!it.type || it.settled) return;
    const amt = Number(it.amount) || 0;
    const name = String(it.person || "").trim();
    const k = name.toLowerCase();
    if (!people[k]) people[k] = { name, net: 0 };
    if (it.type === "give") {
      give += amt;
      people[k].net += amt;
    } else {
      get += amt;
      people[k].net -= amt;
    }
  });

  const net = give - get;
  let out = `🔴 Total to give: ₹${fmt(give)}\n🟢 Total to get: ₹${fmt(get)}\n`;
  out += net === 0 ? "⚖️ Net: ₹0\n" : net > 0 ? `⚖️ Net: you give ₹${fmt(net)}\n` : `⚖️ Net: you get ₹${fmt(-net)}\n`;

  const rows = Object.values(people).filter((p) => p.net !== 0);
  if (rows.length) {
    out += "\n<b>By person</b>\n";
    rows.forEach((p) => {
      out += `• ${esc(p.name)} — ${p.net > 0 ? "give" : "get"} ₹${fmt(Math.abs(p.net))}\n`;
    });
  }
  return out;
}

function listKeyboard(key, slice, page, pages) {
  const rows = [];
  for (let i = 0; i < slice.length; i += 3) {
    rows.push(
      slice.slice(i, i + 3).map((it, j) => ({
        text: String(i + j + 1),
        callback_data: `o:${key}:${it.id}:${page}`,
      }))
    );
  }
  if (pages > 1) {
    rows.push([
      { text: "⬅️", callback_data: `p:${key}:${Math.max(0, page - 1)}` },
      { text: `${page + 1}/${pages}`, callback_data: `p:${key}:${page}` },
      { text: "➡️", callback_data: `p:${key}:${Math.min(pages - 1, page + 1)}` },
    ]);
  }
  rows.push([{ text: "⬅️ Menu", callback_data: "menu_home" }]);
  return { inline_keyboard: rows };
}

// Section page: cards (title, preview, date) newest first, 6 per page
async function showList(chatId, s, key, page = 0, flash = "") {
  const data = (await dbGet(NODE[key])) || {};
  const items = Object.entries(data)
    .map(([id, v]) => ({ ...v, id }))
    .reverse();
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const sec = SECTIONS[key];

  let text = flash ? `${flash}\n\n` : "";
  text += `<b>${sec.title}</b> · ${items.length}${pages > 1 ? ` · page ${page + 1}/${pages}` : ""}\n`;
  if (key === "money") text += moneyTotals(items);
  text += "\n";
  if (!slice.length) text += "<i>Nothing saved yet.</i>\n\n";
  slice.forEach((it, i) => {
    text += `<b>${i + 1}. ${esc(itemTitle(key, it))}</b>\n`;
    if (key === "notes" && it.content) text += `${esc(String(it.content).replace(/\s+/g, " ").slice(0, 60))}\n`;
    text += `📅 ${esc(it.date || "")}\n\n`;
  });
  text += sec.help;
  await showPanel(chatId, s, text, listKeyboard(key, slice, page, pages));
}

// Single item page with actions
async function showItem(chatId, s, key, id, page) {
  const it = await dbGet(`${NODE[key]}/${id}`);
  if (!it) return showList(chatId, s, key, page, "⚠️ Not found");

  let text;
  const rows = [];
  if (key === "notes") {
    text = `<b>${esc(it.title || "Untitled")}</b>${it.content ? "\n\n" + esc(String(it.content).slice(0, 3500)) : ""}\n\n📅 ${esc(it.date || "")}`;
    rows.push([
      { text: "✏️ Title", callback_data: `e:${key}:${id}:${page}:title` },
      { text: "✏️ Content", callback_data: `e:${key}:${id}:${page}:content` },
    ]);
    rows.push([{ text: "🗑 Delete", callback_data: `d:${key}:${id}:${page}` }]);
  } else if (key === "money") {
    text = `<b>${esc(moneyLine(it))}</b>\n${it.settled ? "✅ Settled" : "⏳ Pending"}\n\n📅 ${esc(it.date || "")}`;
    rows.push([
      { text: it.settled ? "↩️ Reopen" : "✅ Mark settled", callback_data: `s:${key}:${id}:${page}` },
      { text: "✏️ Edit", callback_data: `e:${key}:${id}:${page}:all` },
    ]);
    rows.push([{ text: "🗑 Delete", callback_data: `d:${key}:${id}:${page}` }]);
  } else {
    text = `<b>${esc(it.title || "Untitled")}</b>\n\n📅 ${esc(it.date || "")}`;
    rows.push([
      { text: "📤 Send file", callback_data: `f:${key}:${id}:${page}` },
      { text: "✏️ Rename", callback_data: `e:${key}:${id}:${page}:title` },
    ]);
    rows.push([{ text: "🗑 Delete", callback_data: `d:${key}:${id}:${page}` }]);
  }
  rows.push([{ text: "⬅️ Back", callback_data: `p:${key}:${page}` }]);
  await showPanel(chatId, s, text, { inline_keyboard: rows });
}

async function storeFile(chatId, s, p, title) {
  await dbPost(p.category, { title, fileId: p.fileId, fileType: p.fileType, date: today() });
  const key = p.category === "library" ? "library" : "certs";
  s.mode = key;
  await showList(chatId, s, key, 0, `✅ Saved: <b>${esc(title)}</b>`);
}

// ---------- main logic ----------

async function handleUpdate(update, chatId, s) {
  const now = Date.now();
  const cb = update.callback_query;
  const msg = update.message;
  const unlocked = s.unlocked && now - (s.last || 0) < AUTO_LOCK_MS;

  // ===== LOCKED =====
  if (!unlocked) {
    if (cb) {
      const lockId = await send(chatId, "🔒 <b>Locked.</b> Send your PIN to continue:");
      s.trash = [...(s.trash || []), ...(lockId ? [lockId] : [])];
      s.unlocked = false;
      return s;
    }
    if (!msg) return s;
    // Whatever was typed (PIN or wrong PIN) is removed from chat immediately
    await Promise.all([del(chatId, msg.message_id), wipe(chatId, s)]); // old session leftovers disappear too

    const text = (msg.text || "").trim();
    if (text === SECRET_PIN) {
      const n = { unlocked: true, last: now, trash: [] };
      await showPanel(chatId, n, WELCOME, MAIN_MENU);
      return n;
    }
    const id = await send(chatId, "🔒 <b>Access Locked!</b>\nSend your 4-digit PIN to continue:");
    return { unlocked: false, trash: id ? [id] : [] };
  }

  // ===== UNLOCKED =====
  s.last = now;
  s.trash = s.trash || [];

  // --- menu buttons ---
  if (cb) {
    s.menuId = cb.message.message_id;
    const d = cb.data;
    const [op, key, a, b, c] = d.split(":");
    s.pending = null;
    if (op !== "e") s.editing = null;

    if (d === "menu_home") {
      s.mode = null;
      await showPanel(chatId, s, WELCOME, MAIN_MENU);
    } else if (d.startsWith("menu_")) {
      const k = d.slice(5);
      if (SECTIONS[k]) {
        s.mode = k;
        await showList(chatId, s, k, 0);
      }
    } else if (SECTIONS[key]) {
      s.mode = key;
      const page = Number(op === "p" ? a : b) || 0;

      if (op === "p") {
        await showList(chatId, s, key, page);
      } else if (op === "o") {
        await showItem(chatId, s, key, a, page);
      } else if (op === "e") {
        s.editing = { key, id: a, page, field: c };
        const what =
          c === "content"
            ? "new <b>content</b>"
            : c === "all"
              ? "corrected entry, e.g. <code>Name give 500</code>"
              : "new <b>title</b>";
        await showPanel(chatId, s, `✏️ Send the ${what}:`, {
          inline_keyboard: [[{ text: "Cancel", callback_data: `o:${key}:${a}:${page}` }]],
        });
      } else if (op === "d") {
        const it = await dbGet(`${NODE[key]}/${a}`);
        if (it) {
          await showPanel(chatId, s, `🗑 Delete <b>${esc(itemTitle(key, it))}</b>?\nThis cannot be undone.`, {
            inline_keyboard: [
              [
                { text: "🗑 Yes, delete", callback_data: `y:${key}:${a}:${page}` },
                { text: "Cancel", callback_data: `o:${key}:${a}:${page}` },
              ],
            ],
          });
        } else {
          await showList(chatId, s, key, page);
        }
      } else if (op === "y") {
        await dbDelete(`${NODE[key]}/${a}`);
        await showList(chatId, s, key, page, "🗑 Deleted");
      } else if (op === "s") {
        const it = await dbGet(`${NODE[key]}/${a}`);
        if (it) await dbPatch(`${NODE[key]}/${a}`, { settled: !it.settled });
        await showItem(chatId, s, key, a, page);
      } else if (op === "f") {
        const it = await dbGet(`${NODE[key]}/${a}`);
        if (it && it.fileId) {
          const mid = await sendFile(chatId, it.fileId, it.fileType, `📄 <b>${esc(it.title || "")}</b>`);
          if (mid) s.trash.push(mid);
        }
      }
    }
    return s;
  }

  if (!msg) return s;
  const text = (msg.text || "").trim();
  const lower = text.toLowerCase();

  // --- /lock ---
  if (lower === "/lock") {
    await del(chatId, msg.message_id);
    await wipe(chatId, s);
    const id = await send(chatId, "🔒 <b>Bot locked successfully!</b>");
    return { unlocked: false, trash: id ? [id] : [] };
  }

  // --- /start or menu: fresh clean menu ---
  if (text === "/start" || lower === "menu") {
    await del(chatId, msg.message_id);
    await wipe(chatId, s);
    const n = { unlocked: true, last: now, trash: [] };
    await showPanel(chatId, n, WELCOME, MAIN_MENU);
    return n;
  }

  // --- file / photo upload ---
  if (msg.document || msg.photo) {
    const fileType = msg.document ? "document" : "photo";
    const fileId = msg.document ? msg.document.file_id : msg.photo[msg.photo.length - 1].file_id;
    const caption = (msg.caption || "").trim();

    let category = s.mode === "library" ? "library" : "certificates";
    let title = caption;
    if (/^(kitab:|book:)/i.test(caption)) {
      category = "library";
      title = caption.replace(/^(kitab:|book:)/i, "").trim();
    }

    await del(chatId, msg.message_id); // upload disappears from chat

    if (!title) {
      s.pending = { fileId, fileType, category };
      await showPanel(chatId, s, "📎 File received.\n\n✏️ Now type a <b>name</b> for it:", BACK);
      return s;
    }
    await storeFile(chatId, s, { fileId, fileType, category }, title);
    return s;
  }

  if (!text) return s;

  // --- name for a file that was sent without caption ---
  if (s.pending) {
    await del(chatId, msg.message_id);
    const p = s.pending;
    s.pending = null;
    if (p.kind === "note") {
      const title = text.slice(0, 80);
      await dbPost("notes", { title, content: p.content, date: today() });
      s.mode = "notes";
      await showList(chatId, s, "notes", 0, `✅ Saved: <b>${esc(title)}</b>`);
      return s;
    }
    await storeFile(chatId, s, p, text);
    return s;
  }

  // --- edit an existing note ---
  if (s.editing) {
    await del(chatId, msg.message_id);
    const ed = s.editing;
    const k = ed.key || "notes";
    s.editing = null;
    if (ed.field === "all") {
      const rec = parseMoney(text);
      if (!rec) {
        s.editing = ed;
        await showPanel(chatId, s, "⚠️ Format: <code>Name give 500</code> or <code>Name get 500</code>\n\nTry again:", {
          inline_keyboard: [[{ text: "Cancel", callback_data: `o:${k}:${ed.id}:${ed.page}` }]],
        });
        return s;
      }
      await dbPatch(`${NODE[k]}/${ed.id}`, rec);
    } else {
      await dbPatch(`${NODE[k]}/${ed.id}`, { [ed.field]: ed.field === "title" ? text.slice(0, 80) : text });
    }
    await showItem(chatId, s, k, ed.id, ed.page);
    return s;
  }

  // --- add note (any text) ---
  if (s.mode === "notes" || lower.startsWith("note:")) {
    await del(chatId, msg.message_id);
    s.mode = "notes";
    const body = text.replace(/^note:/i, "").trim();
    if (!body) {
      await showList(chatId, s, "notes", 0, "⚠️ Type some text to save.");
      return s;
    }
    s.pending = { kind: "note", content: body };
    await showPanel(chatId, s, "✏️ Now type a <b>title</b> for this note:", {
      inline_keyboard: [[{ text: "Cancel", callback_data: "menu_notes" }]],
    });
    return s;
  }

  // --- add money record: "Name give 500" / "Name get 500" ---
  if (s.mode === "money" || lower.startsWith("debt:")) {
    await del(chatId, msg.message_id);
    s.mode = "money";
    const rec = parseMoney(text.replace(/^debt:/i, "").trim());
    if (!rec) {
      await showList(chatId, s, "money", 0, "⚠️ Format: <code>Name give 500</code> or <code>Name get 500</code>");
      return s;
    }
    await dbPost("debts", { ...rec, settled: false, date: today() });
    await showList(chatId, s, "money", 0, `✅ Saved: <b>${esc(moneyLine(rec))}</b>`);
    return s;
  }

  // --- search / ask (certificates, library, or no section selected) ---
  s.trash.push(msg.message_id); // query + answer get wiped on lock / next unlock

  const [certs, books, notes, debts, reminders] = await Promise.all(
    ["certificates", "library", "notes", "debts", "reminders"].map(async (k) => {
      const r = await fetch(`${DB_URL}/${k}.json`);
      return Object.values((await r.json()) || {});
    })
  );
  const allFiles = [...certs, ...books];

  // Direct match inside notes (title + content): show the full text, no AI summary
  const q = text.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const fileHit = allFiles.some((f) => (f.title || "").toLowerCase().includes(q));
  const noteHits = fileHit
    ? []
    : notes.filter((n) => {
        const hay = `${n.title || ""} ${n.content || ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
  if (noteHits.length) {
    const shown = noteHits
      .slice(0, 5)
      .map((n) => {
        const c = String(n.content || "");
        return `📝 <b>${esc(n.title || "Untitled")}</b>${c ? "\n" + esc(c.slice(0, 600)) + (c.length > 600 ? "…" : "") : ""}`;
      })
      .join("\n\n");
    const more = noteHits.length > 5 ? `\n\n…and ${noteHits.length - 5} more. Type more words to narrow down.` : "";
    const hitId = await send(chatId, shown + more);
    if (hitId) s.trash.push(hitId);
    s.trash = s.trash.slice(-100);
    return s;
  }

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const prompt = `
  You are Haleel's personal assistant & digital locker bot working entirely inside Telegram chat.
  Here is Haleel's saved data from Firebase:
  - Saved Files (Certificates & Kitabs): ${JSON.stringify(allFiles.map((f) => f.title))}
  - Secret Notes & IDs: ${JSON.stringify(notes)}
  - Money / Debts: ${JSON.stringify(debts)}
  - Reminders: ${JSON.stringify(reminders)}

  User message: "${text}"

  STRICT RULES:
  1. If the user is asking for a saved certificate, document, or kitab/book from the "Saved Files" list, reply ONLY with: SEND_FILE:<exact_title_from_list>
  2. If the user is asking about a saved note, ID, password, money/debt calculation, or reminder, answ
