// PopupBay Studio local server
// Serves index.html from this folder and forwards design-chat requests to the AI provider you configure (free or paid).
// Requires Node.js 18 or newer (uses built-in fetch). No npm packages needed.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

// Optional .env file support (ANTHROPIC_API_KEY=..., PORT=..., ANTHROPIC_MODEL=...)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    const v = m && m[2].replace(/^["']|["']$/g, '').trim();
    if (m && v && !/PASTE_/i.test(v)) process.env[m[1]] = v;   // the .env file wins over Windows variables
  }
}

const PORT = Number(process.env.PORT) || 6440;                 // hosting platforms set PORT for you
const HOST = process.env.HOST || '0.0.0.0';                    // reachable locally and when deployed
// ---- AI provider (any ONE of these works; the free options need no payment) ----
//   Free:  GEMINI_API_KEY (Google AI Studio free tier) · GROQ_API_KEY (free tier) · OPENROUTER_API_KEY (":free" models) · LLM_PROVIDER=ollama (runs on your own PC)
//   Paid:  ANTHROPIC_API_KEY (Claude) · OPENAI_API_KEY
// Override anything with LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL.
const env = n => (process.env[n] || (n === 'GEMINI_API_KEY' ? process.env.GOOGLE_API_KEY : '') || '').trim();
const PRESETS = {
  anthropic:  { kind:'anthropic', key:'ANTHROPIC_API_KEY',  model: env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5' },
  gemini:     { kind:'openai', key:'GEMINI_API_KEY',     base:'https://generativelanguage.googleapis.com/v1beta/openai', model:'gemini-2.5-flash' },
  groq:       { kind:'openai', key:'GROQ_API_KEY',       base:'https://api.groq.com/openai/v1',  model:'llama-3.3-70b-versatile' },
  openrouter: { kind:'openai', key:'OPENROUTER_API_KEY', base:'https://openrouter.ai/api/v1',    model:'meta-llama/llama-3.3-70b-instruct:free' },
  openai:     { kind:'openai', key:'OPENAI_API_KEY',     base:'https://api.openai.com/v1',       model:'gpt-4o-mini' },
  ollama:     { kind:'openai', key:null,                 base:'http://localhost:11434/v1',       model:'llama3.1', keyless:true },
};
// Providers are tried in this order (free ones first). If one fails (bad key, no credit, quota) the next one answers.
// Set LLM_PROVIDER to use exactly one provider.
const mkProv = (name, first) => {
  const pre = PRESETS[name] || (name === 'custom' ? { kind:'openai', key:null, base:'', model:'' } : null); if (!pre) return null;
  const key = (first && env('LLM_API_KEY')) || (pre.key ? env(pre.key) : '') || (pre.keyless ? 'none' : '');
  const prov = { name, kind: pre.kind, key, model: (first && env('LLM_MODEL')) || pre.model || '', base: ((first && env('LLM_BASE_URL')) || pre.base || '').replace(/\/+$/, '') };
  return prov.key && prov.model && (prov.kind === 'anthropic' || prov.base) ? prov : null;
};
const ORDER = ['gemini', 'groq', 'openrouter', 'anthropic', 'openai'];
const explicit = env('LLM_PROVIDER').toLowerCase();
const CHAIN = explicit ? [mkProv(explicit, true)].filter(Boolean)
  : [...ORDER.filter(n => env(PRESETS[n].key)).map((n, i) => mkProv(n, i === 0)), ...(env('LLM_BASE_URL') && env('LLM_API_KEY') && !ORDER.some(n => env(PRESETS[n].key)) ? [mkProv('custom', true)] : [])].filter(Boolean);
const PROVIDER = CHAIN[0] ? CHAIN[0].name : '', MODEL = CHAIN[0] ? CHAIN[0].model : '';
const AI_ON = CHAIN.length > 0;
const ROOT = __dirname;
// Only these files are ever sent to the browser (never .env or server.js).
const ALLOWED = new Set(['index.html', 'Brief_Templates_1.xlsx', 'Brief_Templates_2.xlsx', 'Reception_Counter__Product_Counters.pdf', 'Expo_Prestige_Notes.docx']);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// The page sends user/assistant turns; the first user turn holds the instructions.
// Merge consecutive turns with the same role, as the Messages API requires alternation.
function normalise(messages) {
  const out = [];
  for (const m of messages || []) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').trim();
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// Chat protection for a live site: the API key stays on the server, and each visitor is limited so nobody can run up your bill.
const CHAT_LIMIT = Number(process.env.CHAT_LIMIT_PER_MIN) || 30;
const hits = new Map();
function limited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < 60000)) hits.delete(k);
  return arr.length > CHAT_LIMIT;
}
const SYSTEM = 'You control a 3D exhibition booth configurator. Always answer with a single JSON object exactly as the instructions describe, and nothing else.';
async function callOne(prov, messages) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 90000);
    try {
      let r, data, text;
      if (prov.kind === 'anthropic') {
        r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': prov.key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: prov.model, max_tokens: 2500, system: SYSTEM, messages }),
        });
        data = await r.json().catch(() => ({}));
        text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      } else {
        r = await fetch(prov.base + '/chat/completions', {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + prov.key },
          body: JSON.stringify({ model: prov.model, max_tokens: 2500, temperature: 0.4, messages: [{ role: 'system', content: SYSTEM }, ...messages] }),
        });
        data = await r.json().catch(() => ({}));
        text = data?.choices?.[0]?.message?.content || '';
      }
      if (r.ok && text) return { status: 200, text, provider: prov.name, model: prov.model };
      const msg = (Array.isArray(data) ? data[0]?.error?.message : data?.error?.message) || (r.ok ? 'The AI sent an empty answer' : `${prov.name} API error ${r.status}`);
      last = { status: r.ok ? 502 : r.status, error: `${prov.name}: ${msg}` };
      if (![429, 500, 502, 503, 529].includes(r.status) && !r.ok) return last;      // real errors (bad key, no credit) are not retried here
    } catch (e) {
      last = { status: 502, error: `${prov.name}: ` + (e.name === 'AbortError' ? 'The AI took too long to answer' : e.message) };
    } finally { clearTimeout(timer); }
    await new Promise(r => setTimeout(r, 700));
  }
  return last;
}
async function callLLM(messages) {
  let last;
  for (const prov of CHAIN) { const out = await callOne(prov, messages); if (out.status === 200) return out; last = out; console.log(`  AI provider "${prov.name}" failed: ${out.error}${CHAIN.length > 1 ? ' - trying the next one' : ''}`); }
  return last || { status: 503, error: 'No AI provider is set up on the server' };
}

async function handleChat(req, res) {
  if (limited(req)) return sendJSON(res, 429, { error: 'Too many chat requests. Please wait a minute.' });
  if (!AI_ON) return sendJSON(res, 503, { error: 'No AI provider is set up on the server' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'Bad JSON' }); }
  const messages = normalise(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return sendJSON(res, 400, { error: 'Conversation must end with a user message' });
  const out = await callLLM(messages);
  if (out.status !== 200) return sendJSON(res, out.status, { error: out.error });
  sendJSON(res, 200, { text: out.text, provider: out.provider, model: out.model });
}

/* ---------------- RAG: retrieve Expo knowledge + similar past designs (BM25, no packages needed) ---------------- */
// Knowledge = text files in ./knowledge (Expo Prestige notes, product sheet, design rules). Past designs = JSON files in ./data/designs
// (the app's "Save as reference design" button writes there). Set DATA_DIR to keep them on a persistent disk when hosted.
const KNOW_DIR = path.join(__dirname, 'knowledge');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DESIGN_DIR = path.join(DATA_DIR, 'designs');
try { fs.mkdirSync(DESIGN_DIR, { recursive: true }); } catch {}
if (DATA_DIR !== path.join(__dirname, 'data')) {   // first run on a fresh data disk: copy the bundled sample designs
  try { const seedDir = path.join(__dirname, 'data', 'designs'); for (const f of fs.existsSync(seedDir) ? fs.readdirSync(seedDir) : []) if (!fs.existsSync(path.join(DESIGN_DIR, f))) fs.copyFileSync(path.join(seedDir, f), path.join(DESIGN_DIR, f)); } catch {}
}
const STOP = new Set('a an the and or of to in on at for with is are be it this that as by from we you your our'.split(' '));
const tok = t => String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).map(w => w.replace(/(ing|es|s)$/, ''));
function bm25(docs, query, k1 = 1.4, b = 0.75) {            // docs: [{tokens}] -> scores array
  const N = docs.length || 1, avg = docs.reduce((a, d) => a + d.tokens.length, 0) / N || 1, df = new Map();
  for (const d of docs) for (const w of new Set(d.tokens)) df.set(w, (df.get(w) || 0) + 1);
  const q = [...new Set(tok(query))];
  return docs.map(d => { const tf = new Map(); for (const w of d.tokens) tf.set(w, (tf.get(w) || 0) + 1); let sc = 0;
    for (const w of q) { const f = tf.get(w); if (!f) continue; const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5)); sc += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * d.tokens.length / avg)); }
    return sc; });
}
function loadKnowledge() {
  const chunks = [];
  try { for (const f of fs.readdirSync(KNOW_DIR)) { if (!/\.(txt|md)$/i.test(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8'); let cur = '';
    const flush = () => { if (cur.trim().length > 40) chunks.push({ src: f.replace(/\.(txt|md)$/i, '').replace(/_/g, ' '), text: cur.trim() }); cur = ''; };
    for (const para of text.split(/\n\s*\n/)) { if ((cur + '\n' + para).length > 700) flush(); cur += (cur ? '\n' : '') + para.trim(); } flush(); } } catch {}
  return chunks.map(c => ({ ...c, tokens: tok(c.src + ' ' + c.text) }));
}
const designText = r => { const d = r.design || {}; return [r.title, r.industry, r.notes, d.client, d.show, d.wallStyle, d.lighting, d.tagline, d.flooring, `${d.width}x${d.depth}`, `${d.openSides} open sides`, d.store ? 'store room' : '', d.reception ? 'reception' : '', d.tvs ? 'tv' : '', d.showcases ? 'showcase' : '', ...(d.custom || []).map(c => c.name)].filter(Boolean).join(' '); };
function loadDesigns() {
  const out = [];
  try { for (const f of fs.readdirSync(DESIGN_DIR)) { if (!f.endsWith('.json')) continue; try { const r = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8')); if (r && r.design) out.push({ ...r, id: r.id || f.replace(/\.json$/, '') }); } catch {} } } catch {}
  return out;
}
function retrieve(brief, usePast) {
  const b = brief || {};
  const q = [b.client, b.show, b.industry, b.website, b.notes, b.city, `${b.width}x${b.depth}`, `${b.openSides} open sides`, ...(b.needs || [])].filter(Boolean).join(' ');
  // 1) Expo rules: always retrieved (query = the brief + generic design words so the layout rules come through)
  const know = loadKnowledge(), ks = bm25(know, q + ' layout connector light store reception podium design style'),
    rules = know.map((c, i) => ({ ...c, score: ks[i] })).sort((a, b2) => b2.score - a.score).slice(0, 5).filter(c => c.score > 0).map(c => ({ src: c.src, text: c.text }));
  // 2) similar past designs (optional)
  let designs = [], total = 0;
  if (usePast) {
    const all = loadDesigns(); total = all.length;
    if (all.length) {
      const docs = all.map(r => ({ tokens: tok(designText(r)) })), sc = bm25(docs, q), mx = Math.max(...sc, 1e-9);
      const area = (b.width || 0) * (b.depth || 0);
      const sameClientOf = d0 => b.client && d0.client && tok(b.client).some(w => tok(d0.client).includes(w) && w.length > 3);
      designs = all.map((r, i) => ({ r, i })).filter(({ r }) => !(r.source === 'sample' && sameClientOf(r.design))).map(({ r, i }) => { const d = r.design, a = (d.width || 0) * (d.depth || 0);
        const sizeSim = area && a ? Math.min(area, a) / Math.max(area, a) : 0.5, sidesSim = d.openSides === b.openSides ? 1 : 0;
        const sameClient = r.source !== 'sample' && sameClientOf(d) ? 0.6 : 0;   // a design you saved for this same client ranks higher; the bundled samples never match themselves
        return { id: r.id, title: r.title, source: r.source || 'saved', industry: r.industry || '', score: +(sc[i] / mx + 0.6 * sizeSim + 0.3 * sidesSim + sameClient).toFixed(3), design: d }; })
        .sort((x, y) => y.score - x.score).slice(0, 3);
    }
  }
  return { rules, designs, counts: { knowledgeChunks: know.length, pastDesigns: total } };
}
async function handleRetrieve(req, res) {
  if (limited(req)) return sendJSON(res, 429, { error: 'Too many requests. Please wait a minute.' });
  let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'Bad JSON' }); }
  sendJSON(res, 200, retrieve(body.brief, body.usePast !== false));
}
function handleDesigns(req, res, url) {
  if (req.method === 'GET') {
    const all = loadDesigns().map(r => ({ id: r.id, title: r.title, source: r.source || 'saved', savedAt: r.savedAt, size: `${r.design.width}x${r.design.depth}` }));
    return sendJSON(res, 200, { designs: all });
  }
  if (limited(req)) return sendJSON(res, 429, { error: 'Too many requests. Please wait a minute.' });
  if (req.method === 'DELETE') {
    const id = String(url.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, ''); if (!id) return sendJSON(res, 400, { error: 'No id' });
    try { fs.unlinkSync(path.join(DESIGN_DIR, id + '.json')); return sendJSON(res, 200, { ok: true }); } catch { return sendJSON(res, 404, { error: 'Not found' }); }
  }
  if (req.method === 'POST') return readBody(req).then(raw => {
    let b; try { b = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: 'Bad JSON' }); }
    const d = b && b.design; if (!d || typeof d !== 'object' || !(d.width > 0) || !(d.depth > 0)) return sendJSON(res, 400, { error: 'That is not a stand design' });
    if (loadDesigns().length >= 500) return sendJSON(res, 413, { error: 'Too many saved designs (500). Delete some first.' });
    const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const rec = { id, title: String(b.title || d.client || 'Design').slice(0, 80), source: 'saved', industry: String(b.industry || '').slice(0, 80), notes: String(b.notes || '').slice(0, 300), savedAt: new Date().toISOString(), design: JSON.parse(JSON.stringify(d).slice(0, 60000)) };
    fs.writeFileSync(path.join(DESIGN_DIR, id + '.json'), JSON.stringify(rec, null, 1));
    sendJSON(res, 200, { ok: true, id, total: loadDesigns().length });
  }).catch(e => sendJSON(res, 500, { error: e.message }));
  sendJSON(res, 405, { error: 'Method not allowed' });
}

/* ---------------- Brand scan: logo + colours from the client website ---------------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// The scanner is reachable from the internet when this server is hosted, so it must never be pointed at private or internal addresses.
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const v = ip.toLowerCase(); if (v.startsWith('::ffff:')) return isPrivateIP(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}
async function assertPublic(u) {
  const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw new Error('only http and https sites can be scanned');
  const host = x.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { if (isPrivateIP(host)) throw new Error('that address is not public'); return; }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('that address is not public');
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIP(a.address))) throw new Error('that address is not public');
}
async function grab(url, { max = 2e6, accept = '*/*', timeout = 12000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    let r, cur = url;
    for (let hop = 0; hop < 5; hop++) {
      await assertPublic(cur);
      r = await fetch(cur, { headers: { 'user-agent': UA, accept, 'accept-language': 'en-IN,en;q=0.9' }, redirect: 'manual', signal: ctl.signal });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = new URL(r.headers.get('location'), cur).href; continue; }
      break;
    }
    if (r.status >= 300 && r.status < 400) throw new Error('too many redirects');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf: buf.length > max ? buf.subarray(0, max) : buf, type: (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), url: cur };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
  } finally { clearTimeout(t); }
}
const absUrl = (u, base) => { try { return new URL(String(u).replace(/&amp;/g, '&').trim(), base).href; } catch { return null; } };
function attrs(tag) {
  const o = {};
  tag.replace(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (m, k, _, a, b, c) => { o[k.toLowerCase()] = a ?? b ?? c; return m; });
  return o;
}
function metaContent(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const a = attrs(m[0]); if ((a.property || a.name || '').toLowerCase() === key) return a.content || null; }
  return null;
}
function parseColor(s) {
  s = String(s).trim().toLowerCase(); let m;
  if ((m = s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})\b/))) { let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  if ((m = s.match(/^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})(?:[,\s/]+([\d.]+)(%?))?/))) {
    if (m[4] !== undefined && (m[5] ? +m[4] < 50 : +m[4] < 0.5)) return null;
    return [+m[1], +m[2], +m[3]];
  }
  return null;
}
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l]; const d = mx - mn; return [0, l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn), l];
}
const toHexStr = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
// Default colours of Bootstrap, social icons etc. are common on every site, so they count for less.
const COMMON = new Set(['#007bff', '#0d6efd', '#6c757d', '#28a745', '#198754', '#dc3545', '#ffc107', '#17a2b8', '#0dcaf0', '#343a40', '#6610f2', '#6f42c1', '#e83e8c', '#d63384', '#fd7e14', '#20c997', '#1877f2', '#1da1f2', '#25d366', '#ff0000', '#0000ff', '#00ff00', '#3b5998', '#e4405f', '#0a66c2', '#c13584', '#ff0033', '#4285f4', '#34a853', '#fbbc05', '#ea4335']);
function addColor(bag, rgb, w) {
  const [, s, l] = hsl(rgb); if (s < 0.2 || l < 0.1 || l > 0.92) return;
  const hx = toHexStr(rgb); bag.set(hx, (bag.get(hx) || 0) + (COMMON.has(hx) ? w * 0.2 : w));
}
function collectColors(text, weight, bag) {
  for (const m of text.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]{5,40}\)/gi)) { const rgb = parseColor(m[0]); if (rgb) addColor(bag, rgb, weight); }
  for (const m of text.matchAll(/--[\w-]*(?:primary|brand|main|accent|theme)[\w-]*\s*:\s*([^;}\n]+)/gi)) { const rgb = parseColor(m[1]); if (rgb) addColor(bag, rgb, 40); }
}
function rankColors(bag) {
  const list = [...bag.entries()].sort((a, b) => b[1] - a[1]); const out = [];
  for (const [hx, sc] of list) {
    const rgb = parseColor(hx);
    const near = out.find(o => Math.hypot(...o.rgb.map((v, i) => v - rgb[i])) < 34);
    if (near) near.score += sc; else out.push({ hex: hx, rgb, score: sc });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6).map(o => o.hex);
}
function fixSvg(svg) {
  let s = svg;
  if (!/xmlns=/.test(s.slice(0, 400))) s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const open = s.match(/<svg\b[^>]*>/i)[0]; const a = attrs(open);
  if ((!a.width || /%/.test(a.width) || !a.height || /%/.test(a.height)) && a.viewbox) {
    const v = a.viewbox.split(/[\s,]+/).map(Number);
    if (v.length === 4 && v[2] > 0 && v[3] > 0) {
      const sc = 600 / v[2];
      const cleaned = open.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      s = s.replace(open, cleaned.replace(/<svg\b/i, `<svg width="${Math.round(v[2] * sc)}" height="${Math.round(v[3] * sc)}"`));
    }
  }
  return s;
}
function findLogoCandidates(html, base) {
  const cands = []; const headerEnd = Math.max(html.search(/<\/header>/i), html.length * 0.3);
  const srcOf = a => a.src || a['data-src'] || a['data-lazy-src'] || a['data-original'] || ((a.srcset || a['data-srcset'] || '').split(',').pop() || '').trim().split(/\s+/)[0];
  const BAD = /footer|partner|client|award|payment|app-?store|google-?play|badge|certif|social|whatsapp|facebook|instagram|linkedin|youtube|twitter|flag|banner|slider|hero/;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]); const src = srcOf(a); if (!src || /^data:image\/(gif|svg\+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4)/.test(src)) continue;
    const hay = [src, a.alt, a.class, a.id, a.title].join(' ').toLowerCase();
    if (!/logo/.test(hay)) continue;
    let score = 100 + (/\.svg/.test(src) ? 20 : 0) + (m.index < headerEnd ? 25 : 0);
    if (BAD.test(hay)) score -= 70; if (/white|light|inverse|negative|mobile/.test(hay)) score -= 15;
    const u = absUrl(src, base); if (u) cands.push({ score, url: u, kind: 'logo image' });
  }
  for (const m of html.matchAll(/<(a|div|span|figure|h1|p|header|picture)\b[^>]*(?:class|id)\s*=\s*["'][^"']*logo[^"']*["'][^>]*>/gi)) {
    const seg = html.slice(m.index, m.index + 8000);
    const im = seg.match(/<img\b[^>]*>/i), sv = seg.match(/<svg\b[\s\S]*?<\/svg>/i);
    const early = m.index < headerEnd ? 25 : 0, bad = BAD.test(m[0].toLowerCase()) ? -70 : 0;
    if (sv && (!im || sv.index < im.index)) cands.push({ score: 105 + early + bad, svg: sv[0], kind: 'inline logo' });
    else if (im) { const a = attrs(im[0]); const src = srcOf(a); const u = src && absUrl(src, base); if (u) cands.push({ score: 95 + early + bad + (/\.svg/.test(src) ? 20 : 0), url: u, kind: 'logo image' }); }
  }
  for (const m of html.matchAll(/<svg\b[^>]*logo[^>]*>[\s\S]*?<\/svg>/gi)) cands.push({ score: 100 + (m.index < headerEnd ? 25 : 0), svg: m[0], kind: 'inline logo' });
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]); const rel = (a.rel || '').toLowerCase(); if (!/icon/.test(rel) || !a.href) continue;
    const size = parseInt((a.sizes || '').split('x')[0], 10) || 0;
    const u = absUrl(a.href, base); if (u) cands.push({ score: (/apple-touch/.test(rel) ? 40 : 20) + (/\.svg/.test(a.href) ? 15 : 0) + Math.min(20, size / 10), url: u, kind: 'site icon' });
  }
  const og = metaContent(html, 'og:image'); if (og) { const u = absUrl(og, base); if (u) cands.push({ score: 5, url: u, kind: 'share image' }); }
  cands.push({ score: 1, url: absUrl('/favicon.ico', base), kind: 'site icon' });
  const seen = new Set();
  return cands.filter(c => {
    if (c.svg && /<use\b/i.test(c.svg) && !/<(path|rect|circle|polygon|text|image)\b/i.test(c.svg)) return false; // sprite reference, can't stand alone
    const k = c.url || c.svg.slice(0, 300); if (seen.has(k)) return false; seen.add(k); return true;
  }).sort((a, b) => b.score - a.score);
}
async function handleBrand(req, res, url) {
  let target = String(url.searchParams.get('url') || '').trim();
  if (!target) return sendJSON(res, 400, { ok: false, error: 'No website given' });
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
  let page;
  try { page = await grab(target, { accept: 'text/html,application/xhtml+xml' }); }
  catch (e) {
    try { page = await grab(target.replace(/^https:/i, 'http:'), { accept: 'text/html' }); }
    catch { return sendJSON(res, 502, { ok: false, error: e.message }); }
  }
  const html = page.buf.toString('utf8'); const base = page.url;
  const bag = new Map();
  const theme = metaContent(html, 'theme-color') || metaContent(html, 'msapplication-tilecolor');
  if (theme) { const rgb = parseColor(theme); if (rgb) addColor(bag, rgb, 60); }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) collectColors(m[1], 1, bag);
  for (const m of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) collectColors(m[1], 2, bag);
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => /stylesheet/i.test(a.rel || '') && a.href).map(a => absUrl(a.href, base)).filter(Boolean).slice(0, 5);
  await Promise.all(sheets.map(async s => { try { const r = await grab(s, { max: 1.2e6, timeout: 8000, accept: 'text/css' }); collectColors(r.buf.toString('utf8'), 1, bag); } catch {} }));

  let logo = null, logoSource = null;
  for (const c of findLogoCandidates(html, base).slice(0, 6)) {
    try {
      if (c.svg) {
        const svg = fixSvg(c.svg); collectColors(svg, 80, bag);
        logo = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'); logoSource = c.kind; break;
      }
      const r = await grab(c.url, { max: 3e6, timeout: 9000, accept: 'image/*' });
      if (r.buf.length < 120) continue;
      let type = r.type;
      const head = r.buf.subarray(0, 300).toString('utf8');
      if (/<svg\b/i.test(head) || /\.svg(\?|$)/i.test(c.url)) {
        const svg = fixSvg(r.buf.toString('utf8')); if (!/<svg\b/i.test(svg)) continue;
        collectColors(svg, 80, bag);
        logo = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      } else {
        if (!/^image\//.test(type)) type = /\.ico(\?|$)/i.test(c.url) ? 'image/x-icon' : /\.png/i.test(c.url) ? 'image/png' : /\.webp/i.test(c.url) ? 'image/webp' : 'image/jpeg';
        if (/html|text/.test(type)) continue;
        logo = `data:${type};base64,` + r.buf.toString('base64');
      }
      logoSource = c.kind; break;
    } catch {}
  }
  const name = metaContent(html, 'og:site_name') || (html.match(/<title[^>]*>([^<]{1,120})<\/title>/i) || [])[1] || null;
  sendJSON(res, 200, { ok: true, site: base, name: name && name.trim(), logo, logoSource, colors: rankColors(bag), themeColor: theme || null });
}

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';   // set to your site, e.g. https://booth.yourcompany.com, to accept calls only from it
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {   // lets a page hosted elsewhere (your live site) use this server for scanning, chat and saved designs
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }
  if (url.pathname === '/api/health') return sendJSON(res, 200, { ai: AI_ON, provider: AI_ON ? PROVIDER : null, model: AI_ON ? MODEL : null, brandScan: true, build: 'popupbay-4', chain: CHAIN.map(c => c.name) });
  if (url.pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);
  if (url.pathname === '/api/retrieve' && req.method === 'POST') return handleRetrieve(req, res);
  if (url.pathname === '/api/designs') return handleDesigns(req, res, url);
  if (url.pathname === '/api/brand') return handleBrand(req, res, url).catch(e => sendJSON(res, 500, { ok: false, error: e.message }));

  let name = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (!ALLOWED.has(name)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(ROOT, name);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

let tries = 0, port = PORT;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && !process.env.PORT && tries < 10) {
    console.log(`  Port ${port} is busy (PopupBay Studio may already be running in another window). Trying ${port + 1}...`);
    tries++; port++; server.listen(port, HOST);
  } else { throw e; }
});
server.on('listening', () => {
  console.log(`\n  PopupBay Studio is running:  http://localhost:${port}\n`);
  console.log('  Keys found: ' + (ORDER.filter(n => env(PRESETS[n].key)).join(', ') || 'none') + '  (build popupbay-4)');
  console.log(AI_ON
    ? `  AI chat: ON  (${CHAIN.map((c, i) => `${i ? 'fallback ' : ''}${c.name} ${c.model}`).join(' > ')})`
    : '  AI chat: OFF (free offline mode). To let the chat design anything, add a FREE key, e.g. GEMINI_API_KEY or GROQ_API_KEY, to .env (see README).');
  console.log('  Press Ctrl+C to stop.\n');
});
server.listen(port, HOST);
