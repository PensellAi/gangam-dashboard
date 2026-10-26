// gangam-push — Cloudflare Worker that sends Web Push notifications to the Gangam dashboard.
// Needs one KV namespace bound as KV. No secrets to paste: the VAPID key pair is generated
// on first use and kept in KV.
//
//   GET  /                      -> { ok, publicKey }
//   POST { action:"subscribe",   idToken, sub }      admin device opts in
//   POST { action:"unsubscribe", idToken, endpoint }
//   POST { action:"test",        idToken }           test push to every admin device
//   POST { action:"order",       id }                called by the shop after an order

const PROJECT_ID = "gangam-c5a81";
const API_KEY = "AIzaSyAvCXSgbY7WH9eSEUTbaATNxeDjx8ekcYM"; // public web key (same as the site)
const ADMINS = ["ahmedassemads@gmail.com", "shepamohamed@gmail.com"];
const ALLOWED_ORIGINS = ["https://pensellai.github.io"];
const DASHBOARD_URL = "https://pensellai.github.io/gangam-dashboard/";
const PAYMENT = { cod: "الدفع عند الاستلام", vodafone: "فودافون كاش", instapay: "إنستاباي" };

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

function cors(origin) {
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", ...cors(origin) } });

/* ---------- VAPID keys, created once ---------- */
async function vapidKeys(env) {
  const saved = await env.KV.get("vapid", "json");
  if (saved) return saved;
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = { privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey), publicKey: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)) };
  await env.KV.put("vapid", JSON.stringify(keys));
  return keys;
}
async function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: DASHBOARD_URL })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims));
  return "vapid t=" + header + "." + claims + "." + b64u(sig) + ", k=" + keys.publicKey;
}

/* ---------- RFC 8291 payload encryption (aes128gcm) ---------- */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}
async function encryptPayload(sub, plaintext) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(enc.encode(plaintext), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}
async function sendPush(sub, payload, keys) {
  const body = await encryptPayload(sub, JSON.stringify(payload));
  return fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidHeader(sub.endpoint, keys), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
    body,
  });
}
async function pushAll(env, payload) {
  const keys = await vapidKeys(env);
  const list = await env.KV.list({ prefix: "sub:" });
  let sent = 0, removed = 0;
  await Promise.all(list.keys.map(async (k) => {
    const rec = await env.KV.get(k.name, "json");
    if (!rec) return;
    try {
      const r = await sendPush(rec.sub, payload, keys);
      if (r.status === 404 || r.status === 410) { await env.KV.delete(k.name); removed++; }
      else if (r.ok) sent++;
    } catch (e) {}
  }));
  return { sent, removed, devices: list.keys.length };
}

/* ---------- Firebase ID token check (admins only) ---------- */
let jwkCache = { at: 0, keys: [] };
async function googleKeys() {
  if (Date.now() - jwkCache.at < 3600e3 && jwkCache.keys.length) return jwkCache.keys;
  const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  jwkCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwkCache.keys;
}
async function verifyAdmin(idToken) {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(unb64u(parts[0]))); claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1]))); } catch (e) { return null; }
  if (head.alg !== "RS256") return null;
  const jwk = (await googleKeys()).find((k) => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64u(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || claims.aud !== PROJECT_ID || claims.iss !== "https://securetoken.google.com/" + PROJECT_ID) return null;
  if (!(claims.exp > now) || !(claims.iat <= now + 300) || !claims.sub) return null;
  const email = String(claims.email || "").toLowerCase();
  if (!claims.email_verified || !ADMINS.includes(email)) return null;
  return email;
}
async function subKey(endpoint) {
  return "sub:" + b64u(await crypto.subtle.digest("SHA-256", enc.encode(endpoint))).slice(0, 32);
}

/* ---------- order ping, checked against Firestore ---------- */
async function readPing(id) {
  const url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/orderPings/" + encodeURIComponent(id) + "?key=" + API_KEY;
  const r = await fetch(url);
  if (!r.ok) return null;
  const f = (await r.json()).fields || {};
  const num = (v) => v ? Number(v.integerValue ?? v.doubleValue ?? 0) : 0;
  return { total: num(f.total), count: num(f.count), payment: f.payment ? f.payment.stringValue : "", createdAt: f.createdAt ? Date.parse(f.createdAt.timestampValue) : 0 };
}
/* ---------- low-stock alerts ---------- */
const fsBase = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/";
const fsNum = (v) => v ? Number(v.integerValue ?? v.doubleValue ?? 0) : 0;
async function readCatalog() {
  const r = await fetch(fsBase + "catalog/main?key=" + API_KEY);
  if (!r.ok) return { names: {}, threshold: 5 };
  const f = (await r.json()).fields || {};
  const names = {};
  ((f.products && f.products.arrayValue && f.products.arrayValue.values) || []).forEach((v) => {
    const p = (v.mapValue && v.mapValue.fields) || {};
    const id = p.id && p.id.stringValue; if (!id) return;
    const en = p.name ? p.name.stringValue : "", ar = p.nameAr ? p.nameAr.stringValue : "";
    names[id] = ar && en ? en + " (" + ar + ")" : (en || ar || id);
  });
  const st = (f.settings && f.settings.mapValue && f.settings.mapValue.fields) || {};
  const t = st.lowStockAlert ? fsNum(st.lowStockAlert) : 5;
  return { names, threshold: t };
}
/* products this order brought down to the alert level; each level is announced once */
async function lowStockAfter(env, orderId) {
  const r = await fetch(fsBase + "stock?pageSize=300&key=" + API_KEY);
  if (!r.ok) return [];
  const docs = (await r.json()).documents || [];
  const touched = docs.map((d) => ({ id: d.name.split("/").pop(), qty: fsNum(d.fields && d.fields.qty), last: d.fields && d.fields.lastOrder ? d.fields.lastOrder.stringValue : "" }))
    .filter((x) => x.last === orderId);
  if (!touched.length) return [];
  const cat = await readCatalog();
  if (!(cat.threshold > 0)) return [];
  const alerts = [];
  for (const x of touched) {
    const key = "low:" + x.id;
    if (x.qty > cat.threshold) { await env.KV.delete(key); continue; }
    const prev = await env.KV.get(key);
    if (prev !== null && Number(prev) <= x.qty) continue;
    await env.KV.put(key, String(x.qty), { expirationTtl: 60 * 86400 });
    alerts.push({ id: x.id, qty: x.qty, name: cat.names[x.id] || x.id });
  }
  return alerts;
}
function lowStockText(a) {
  if (a.qty <= 0) return "تنبيه - " + a.name + " خلصت من المخزون";
  return "تنبيه - باقي " + a.qty + (a.qty === 1 ? " قطعة" : a.qty <= 10 ? " قطع" : " قطعة") + " بس من " + a.name;
}

function money(n) { return (Math.round(n * 100) / 100).toLocaleString("en-US") + " ج.م"; }

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method === "GET") return json({ ok: true, publicKey: (await vapidKeys(env)).publicKey }, 200, origin);
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405, origin);

    let body;
    try { body = await request.json(); } catch (e) { return json({ ok: false, error: "bad_json" }, 400, origin); }

    if (body.action === "order") {
      const id = String(body.id || "");
      if (!/^GG-[A-Z0-9]{6,12}$/.test(id)) return json({ ok: false, error: "bad_id" }, 400, origin);
      if (await env.KV.get("done:" + id)) return json({ ok: true, duplicate: true }, 200, origin);
      const ping = await readPing(id);
      if (!ping || Date.now() - ping.createdAt > 15 * 60e3) return json({ ok: false, error: "unknown_order" }, 404, origin);
      await env.KV.put("done:" + id, "1", { expirationTtl: 7 * 86400 });
      const res = await pushAll(env, {
        title: "طلب جديد " + id,
        body: "الإجمالي " + money(ping.total) + " · " + (PAYMENT[ping.payment] || ping.payment) + (ping.count ? " · " + ping.count + " قطعة" : ""),
        tag: id, url: DASHBOARD_URL + "#" + id,
      });
      let low = [];
      try { low = await lowStockAfter(env, id); } catch (e) {}
      for (const a of low) await pushAll(env, { title: a.qty <= 0 ? "المخزون خلص" : "المخزون قرب يخلص", body: lowStockText(a), tag: "stock-" + a.id, url: DASHBOARD_URL });
      return json({ ok: true, ...res, lowStock: low.length }, 200, origin);
    }

    const email = await verifyAdmin(body.idToken);
    if (!email) return json({ ok: false, error: "unauthorized" }, 401, origin);

    if (body.action === "subscribe") {
      const sub = body.sub || {};
      if (!/^https:\/\//.test(sub.endpoint || "") || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ ok: false, error: "bad_sub" }, 400, origin);
      await env.KV.put(await subKey(sub.endpoint), JSON.stringify({ email, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, at: Date.now() }));
      return json({ ok: true }, 200, origin);
    }
    if (body.action === "unsubscribe") {
      if (body.endpoint) await env.KV.delete(await subKey(body.endpoint));
      return json({ ok: true }, 200, origin);
    }
    if (body.action === "test") {
      const res = await pushAll(env, { title: "Gangam", body: "الإشعارات شغالة. هيوصلك إشعار زي ده مع كل طلب جديد.", tag: "test", url: DASHBOARD_URL });
      return json({ ok: true, ...res }, 200, origin);
    }
    return json({ ok: false, error: "unknown_action" }, 400, origin);
  },
};
