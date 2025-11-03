import express from "express";
import fetch from "node-fetch";            // ок; в Node 18+ можно и глобальный fetch

const app = express();
const PORT = process.env.PORT || 8080;

// === НАСТРОЙКИ ===
const GOOGLE_BRIDGE_URL = "https://script.google.com/macros/s/AKfycbzgOoP-bDBDWGEvHLWDBaeItHiM1EUwX7dxpiQOlGiqyG3d2q6wyv35JbxoWMz4WMyDUw/exec";
const TOKEN = "asiaticbridge_artur";

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health/Root
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/", (_req, res) => res.send("OK"));

// Эхо
app.get("/debug", (req, res) => res.json({ query: req.query }));

// 1) Диагностический проксирующий маршрут
app.get("/api/debug-bridge", async (req, res) => {
  try {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) params.set(k, String(v));
    if (!params.has("token")) params.set("token", TOKEN);

    const url = `${GOOGLE_BRIDGE_URL}?${params.toString()}`;
    const r = await fetch(url);
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();

    return res.status(200).json({
      ok: true,
      bridge_url: url,
      status: r.status,
      contentType: ct,
      // покажем кусочек тела, чтобы увидеть, что там за HTML/ошибка
      bodyPreview: text.slice(0, 500)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// PULL: отдать текст по alias через GAS
app.get("/api/pull", async (req, res) => {
  try {
    const alias = (req.query.alias || req.query.a || "").toString().trim();
    if (!alias) return res.status(400).json({ error: "alias is required" });

    const url =
      `${GOOGLE_BRIDGE_URL}?action=fileText` +   // doGet() всё равно lowerCase → filetext
      `&alias=${encodeURIComponent(alias)}` +
      `&token=${encodeURIComponent(TOKEN)}`;

    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));

    if (!r.ok || (!data.ok && !data.text && !data.data?.text)) {
      return res.status(502).json({ error: "bridge failed", status: r.status, source: data });
    }

    const name = data?.data?.name ?? data?.name ?? null;
    const text = data?.data?.text ?? data?.text ?? "";
    return res.json({ ok: true, alias, name, text });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// PUSHMAIL: отправить содержимое документа себе на Gmail
app.get("/api/pushmail", async (req, res) => {
  try {
    const alias = (req.query.alias || req.query.a || "").toString().trim();
    if (!alias) return res.status(400).json({ error: "alias is required" });

    const url =
      `${GOOGLE_BRIDGE_URL}?action=pushtogmail` +
      `&alias=${encodeURIComponent(alias)}` +
      `&token=${encodeURIComponent(TOKEN)}`;

    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));

    if (!r.ok || !data?.ok) {
      return res.status(502).json({ error: "bridge failed", status: r.status, source: data });
    }
    return res.json({ ok: true, alias, status: "sent_to_gmail" });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// FILETEXT: универсальный прокси (alias или id)
app.get("/api/filetext", async (req, res) => {
  try {
    const { alias, id } = req.query;
    if (!alias && !id) return res.status(400).json({ error: "alias or id is required" });

    const params = new URLSearchParams();
    params.set("action", "filetext");
    if (alias) params.set("alias", alias);
    if (id) params.set("id", id);
    params.set("token", TOKEN);

    const r = await fetch(`${GOOGLE_BRIDGE_URL}?${params.toString()}`, {
      headers: { "Accept": "application/json" }
    });

    const ct = r.headers.get("content-type") || "";
    // Если пришёл не JSON — вернём диагностическую информацию, а не SyntaxError
    if (!ct.includes("application/json")) {
      const html = await r.text();
      return res.status(502).json({
        error: "bridge_html",
        status: r.status,
        contentType: ct,
        bodyPreview: html.slice(0, 500)
      });
    }

    const j = await r.json();
    return res.status(r.ok ? 200 : 502).json(j);
  } catch (err) {
    return res.status(500).json({ error: "proxy_error", details: String(err) });
  }
});

// Список твоих алиасов — поддерживаешь вручную тут, когда появятся новые
const ALIASES = [
  "ца1","ца2","ца3","ца4","ца5",
  "ца6","ца7","ца8","ца9","ца10","ца11","ца12"
];

app.get("/api/registry", (req, res) => {
  const base = "https://asiatic-bridge-proxy.onrender.com";
  const filetext = (a) => `${base}/api/filetext?alias=${encodeURIComponent(a)}`;
  const pushmail = (a) => `${base}/api/pushmail?alias=${encodeURIComponent(a)}`;

  // Можно хранить человекочитаемые названия (необязательно)
  const names = {
    "ца1": "Инвестор-прагматик",
    "ца2": "Лайфстайл-релокант",
    "ца3": "Luxury-эстет",
    "ца4": "Пенсионер-инвестор",
    "ца5": "Спекулятивный игрок",
    "ца6": "Семейный покупатель",
    "ца7": "Экспат с доходом",
    "ца8": "IT-кочевник",
    "ца9": "Микроинвестор",
    "ца10":"Криптоинвестор",
    "ца11":"Сентиментальный покупатель",
    "ца12":"Приоритет доп. ЦА"
  };

  res.json({
    project: "Asiatic Bridge",
    base,
    endpoints: {
      filetext: `${base}/api/filetext?alias=`,
      pushmail: `${base}/api/pushmail?alias=`,
      debug:    `${base}/api/debug-bridge?`
    },
    audiences: ALIASES.map(a => ({
      alias: a,
      name: names[a] || a,
      pull_url: filetext(a),
      push_url: pushmail(a)
    }))
  });
});
