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

app.listen(PORT, () => console.log(`Bridge proxy running on port ${PORT}`));
