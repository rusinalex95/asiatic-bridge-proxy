import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 8080;

// === НАСТРОЙКИ (у тебя они уже валидны) ===
const GOOGLE_BRIDGE_URL = "https://script.google.com/macros/s/AKfycbzgOoP-bDBDWGEvHLWDBaeItHiM1EUwX7dxpiQOlGiqyG3d2q6wyv35JbxoWMz4WMyDUw/exec";
const TOKEN = "asiaticbridge_artur";

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  next();
});

// Пинг
app.get("/health", (_, res) => res.json({ ok: true }));

// Эхо для быстрой диагностики
app.get("/debug", (req, res) => res.json({ query: req.query }));

// ГЛАВНЫЙ МАРШРУТ: проксируем alias в GAS
app.get("/api/pull", async (req, res) => {
  // Отправить текст файла на Gmail через GAS (push-канал)
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
    // GAS отправляет письмо самому владельцу скрипта — тебе
    return res.json({ ok: true, alias, status: "sent_to_gmail" });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

  try {
    const alias = (req.query.alias || req.query.a || "").toString().trim();
    if (!alias) return res.status(400).json({ error: "alias is required" });

    // Формируем запрос в твой GAS: передаём action, alias и token
    const url =
      `${GOOGLE_BRIDGE_URL}?action=fileText` +
      `&alias=${encodeURIComponent(alias)}` +
      `&token=${encodeURIComponent(TOKEN)}`;

    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));

    if (!r.ok || (!data.ok && !data.text && !data.data?.text)) {
      return res.status(502).json({ error: "bridge failed", status: r.status, source: data });
    }

    // Унифицируем ответ
    const name = data?.data?.name ?? data?.name ?? null;
    const text = data?.data?.text ?? data?.text ?? "";
    return res.json({ alias, name, text });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// === Новый маршрут для filetext ===
app.get("/api/filetext", async (req, res) => {
  try {
    const { alias, id } = req.query;
    if (!alias && !id) return res.status(400).json({ error: "alias or id is required" });

    const params = new URLSearchParams();
    params.set("action", "filetext");
    if (alias) params.set("alias", alias);
    if (id) params.set("id", id);
    params.set("token", TOKEN);

    const r = await fetch(`${GOOGLE_BRIDGE_URL}?${params.toString()}`);
    const j = await r.json();
    res.status(200).json(j);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "proxy_error", details: String(err) });
  }
});

app.listen(PORT, () => console.log(`Bridge proxy running on port ${PORT}`));
