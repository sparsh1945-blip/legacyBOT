import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('data');
fs.mkdirSync(dir, { recursive: true });

function load(name, fallback) {
  const p = path.join(dir, name);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}
function save(name, data) {
  const p = path.join(dir, name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}
export const players = {
  all: () => load('players.json', {}),
  get: id => load('players.json', {})[id] ?? null,
  put: (id, value) => { const d = load('players.json', {}); d[id] = {...d[id], ...value}; save('players.json', d); return d[id]; }
};
export const links = {
  all: () => load('links.json', {}),
  get: id => load('links.json', {})[id] ?? null,
  set: (discordId, data) => { const d = load('links.json', {}); d[discordId] = data; save('links.json', d); },
  remove: discordId => { const d = load('links.json', {}); delete d[discordId]; save('links.json', d); },
  discordForUuid: uuid => Object.entries(load('links.json', {})).find(([,v]) => v.uuid === uuid)?.[0] ?? null
};
export const coins = {
  all: () => load('coins.json', {}),
  get: uuid => Number(load('coins.json', {})[uuid] ?? 0),
  adjust: (uuid, amount) => {
    const d = load('coins.json', {}); const next = Number(d[uuid] ?? 0) + amount;
    if (!Number.isFinite(next) || next < 0) throw new Error('Insufficient balance or invalid amount');
    d[uuid] = next; save('coins.json', d); return next;
  }
};
export const codes = {
  all: () => load('codes.json', {}),
  set: (hash, data) => { const d = load('codes.json', {}); d[hash] = data; save('codes.json', d); },
  consume: hash => { const d = load('codes.json', {}); const v = d[hash]; if (v) { delete d[hash]; save('codes.json', d); } return v ?? null; }
};
export const audit = (entry) => {
  const d = load('audit.json', []);
  d.push({...entry, at: new Date().toISOString()});
  save('audit.json', d.slice(-10000));
};
