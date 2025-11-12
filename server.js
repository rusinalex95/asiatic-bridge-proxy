// server.js — clean build

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import fetch from "node-fetch";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ===== ENV (c дефолтами для локала) =====
const GOOGLE_BRIDGE_URL = process.env.GAS_URL   || "https://script.google.com/macros/s/AKfycbzgOoP-bDBDWGEvHLWDBaeItHiM1EUwX7dxpiQOlGiqyG3d2q6wyv35JbxoWMz4WMyDUw/exec";
const TOKEN             = process.env.GAS_TOKEN || "asiaticbridge_artur";
const PROXY_KEY         = process.env.PROXY_KEY || "";

const app  = express();
const PORT = process.env.PORT || 8080;

// ===== registry.json loader =====
async function loadRegistry() {
  const p = path.join(__dirname, "registry.json");
  const raw = await fs.readFile(p, "utf-8");
  const cfg = JSON.parse(raw);

  // «умный» дефолт base: если в JSON не задан — вычислим в роуте
  if (!cfg.base) cfg.base = null;

  // валидация
  if (!Array.isArray(cfg.audiences)) throw new Error("registry: audiences[] required");
  cfg.audiences.forEach(a => {
    if (!a.alias) throw new Error("registry: audience.alias required");
  });
  return cfg;
}

// ===== безоп. лимит =====
app.use(rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

// ===== CORS =====
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-proxy-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ===== health/root =====
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
// ===== deep status (проверяет зависимость GAS, но НЕ влияет на /health) =====
app.get("/status", async (_req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `${GOOGLE_BRIDGE_URL}?action=ping&token=${encodeURIComponent(TOKEN)}`;
    const r   = await fetch(url, { signal: controller.signal });
    const txt = await r.text();

    clearTimeout(timer);
    return res
      .status(r.ok ? 200 : 502)
      .json({
        ok: r.ok,
        deps: { gas_ping: r.ok ? "up" : "down" },
        status: r.status,
        sample: txt.slice(0, 200)
      });
  } catch (e) {
    clearTimeout(timer);
    return res
      .status(502)
      .json({ ok: false, deps: { gas_ping: "down" }, error: String(e) });
  }
});
app.get("/",       (_req, res) => res.send("OK"));

// ===== мини-кэш на 120 сек =====
const cache  = new Map(); // key -> { ts, data }
const TTL_MS = 120_000;

function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > TTL_MS) { cache.delete(key); return null; }
  return v.data;
}
function setCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

app.post("/api/cache/flush", (req, res) => {
  const k = req.get("x-proxy-key") || req.query.key;
  if (!PROXY_KEY || k !== PROXY_KEY) return res.status(403).json({ error: "forbidden" });
  const size = cache.size;
  cache.clear();
  res.json({ ok: true, flushed: size });
});

// ===== эхо =====
app.get("/debug", (req, res) => res.json({ query: req.query }));

// ===== диагностический прокси к GAS =====
app.get("/api/debug-bridge", async (req, res) => {
  try {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) params.set(k, String(v));
    if (!params.has("token")) params.set("token", TOKEN);

    const url = `${GOOGLE_BRIDGE_URL}?${params.toString()}`;
    const r   = await fetch(url);
    const ct  = r.headers.get("content-type") || "";
    const txt = await r.text();

    res.status(200).json({
      ok: true, bridge_url: url, status: r.status, contentType: ct,
      bodyPreview: txt.slice(0, 500)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===== PULL (по алиасу) =====
app.get("/api/pull", async (req, res) => {
  try {
    const alias = (req.query.alias || req.query.a || "").toString().trim();
    if (!alias) return res.status(400).json({ error: "alias is required" });

    const cacheKey = `pull:${alias}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const url =
      `${GOOGLE_BRIDGE_URL}?action=fileText` +
      `&alias=${encodeURIComponent(alias)}` +
      `&token=${encodeURIComponent(TOKEN)}`;

    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));

    if (!r.ok || (!data.ok && !data.text && !data.data?.text)) {
      return res.status(502).json({ error: "bridge failed", status: r.status, source: data });
    }

    const name = data?.data?.name ?? data?.name ?? null;
    const text = data?.data?.text ?? data?.text ?? "";
    const payload = { ok: true, alias, name, text };

    setCache(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ===== PUSHMAIL (на Gmail владельца GAS) =====
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
    res.json({ ok: true, alias, status: "sent_to_gmail" });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ===== FILETEXT (alias или id) =====
app.get("/api/filetext", async (req, res) => {
  try {
    const { alias, id } = req.query;
    if (!alias && !id) return res.status(400).json({ error: "alias or id is required" });

    const cacheKey = id ? `id:${id}` : `alias:${alias}`;
    const cached = getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const params = new URLSearchParams();
    params.set("action", "filetext");
    if (alias) params.set("alias", alias);
    if (id)    params.set("id", id);
    params.set("token", TOKEN);

    const r  = await fetch(`${GOOGLE_BRIDGE_URL}?${params.toString()}`, {
      headers: { "Accept": "application/json" }
    });
    const ct = r.headers.get("content-type") || "";

    if (!ct.includes("application/json")) {
      const html = await r.text();
      return res.status(502).json({
        error: "bridge_html", status: r.status, contentType: ct, bodyPreview: html.slice(0, 500)
      });
    }

    const j = await r.json();
    if (r.ok) setCache(cacheKey, j);
    res.status(r.ok ? 200 : 502).json(j);
  } catch (err) {
    res.status(500).json({ error: "proxy_error", details: String(err) });
  }
});

// ===== РЕЕСТР (registry.json) =====
app.get("/api/registry", async (req, res) => {
  try {
    const cfg  = await loadRegistry();
    const host  = req.get("x-forwarded-host") || req.get("host");
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const base  = cfg.base || `${proto}://${host}`;


    const filetext = (a) => `${base}/api/filetext?alias=${encodeURIComponent(a)}`;
    const pushmail = (a) => `${base}/api/pushmail?alias=${encodeURIComponent(a)}`;

    res.json({
      project: cfg.project || "Asiatic Bridge",
      base,
      endpoints: {
        filetext: `${base}/api/filetext?alias=`,
        pushmail: `${base}/api/pushmail?alias=`,
        debug:    `${base}/api/debug-bridge?`
      },
      audiences: cfg.audiences.map(a => ({
        alias: a.alias,
        name:  a.name || a.alias,
        pull_url: filetext(a.alias),
        push_url: pushmail(a.alias)
      }))
    });
  } catch (e) {
    res.status(500).json({ error: "registry_load_error", details: e.message });
  }
});

// ===== Служебка =====
app.get("/api/about", (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    env: {
      GAS_URL: !!process.env.GAS_URL,
      GAS_TOKEN: !!process.env.GAS_TOKEN,
      PROXY_KEY: !!process.env.PROXY_KEY
    },
    uptime_s: Math.round(process.uptime()),
    routes: ["/","/health","/status","/api/registry","/api/filetext","/api/pull","/api/pushmail","/api/debug-bridge","/api/cache/flush","/api/about"]
  });
});

app.get("/api/version", (_req, res) => {
  res.json({ build: "abp-2025-11-04" });
});

// === /api/bundle — пакетное извлечение нескольких ЦА ===
app.get("/api/bundle", async (req, res) => {
  try {
    let aliases = [];
    const raw = (req.query.aliases || req.query.a || "").toString().trim();

    if (!raw) {
      return res.status(400).json({ error: "aliases required, e.g. ?aliases=ца1,ца2 or ?aliases=all" });
    }

    if (raw.toLowerCase() === "all") {
      // берём список из registry.json
      const cfg = await loadRegistry();
      aliases = (cfg.audiences || []).map(a => a.alias).filter(Boolean);
      if (!aliases.length) {
        return res.status(404).json({ error: "registry has no audiences" });
      }
    } else {
      aliases = raw.split(",").map(a => a.trim()).filter(Boolean);
    }

    // убираем дубли, сохраняем порядок
    const seen = new Set();
    aliases = aliases.filter(a => !seen.has(a) && seen.add(a));

    const results = [];

    for (const alias of aliases) {
      const cacheKey = `bundle:${alias}`;
      const cached = getCache(cacheKey);
      if (cached) {
        results.push({ alias, cached: true, ...cached });
        continue;
      }

      const params = new URLSearchParams({
        action: "filetext",
        alias,
        token: TOKEN
      });

      const url = `${GOOGLE_BRIDGE_URL}?${params.toString()}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));

      if (!r.ok || (!j.ok && !j.text && !j.data?.text)) {
        results.push({
          alias,
          error: true,
          status: r.status,
          reason: j.error || "bridge failed"
        });
        continue;
      }

      const name = j?.data?.name ?? j?.name ?? alias;
      const text = j?.data?.text ?? j?.text ?? "";
      const item = { ok: true, alias, name, text };

      setCache(cacheKey, item);
      results.push(item);
    }

    res.json({
      ok: true,
      total: results.length,
      loaded: results.filter(x => x.ok).length,
      aliases,
      results
    });
  } catch (err) {
    res.status(500).json({ error: "bundle_error", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Bridge proxy running on port ${PORT}`);
});
