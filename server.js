import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 8080;

// Настройки
const GOOGLE_BRIDGE_URL = "https://script.google.com/macros/s/AKfycbzgOoP-bDBDWGEvHLWDBaeItHiM1EUwX7dxpiQOlGiqyG3d2q6wyv35JbxoWMz4WMyDUw/exec";
const TOKEN = "asiaticbridge_artur";

// CORS — разрешаем ChatGPT
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  next();
});

// Универсальный endpoint
app.get("/api/pull", async (req, res) => {
  try {
    const alias = req.query.alias?.toLowerCase();
    if (!alias) return res.status(400).json({ error: "alias is required" });

    const url = `${GOOGLE_BRIDGE_URL}?action=fileText&alias=${encodeURIComponent(alias)}&token=${TOKEN}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data?.ok) {
      return res.status(500).json({ error: data?.error || "bridge failed", source: data });
    }

    res.json({
      alias,
      name: data.data?.name,
      text: data.data?.text || data.text
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Bridge proxy running on port ${PORT}`));
