
import express from 'express';
import crypto from 'node:crypto';

import {
  players,
  links,
  coins,
  codes,
  audit,
  announcements
} from './store.js';

export const app = express();

app.use(express.json({ limit: '32kb' }));

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

app.use((req, res, next) => {
  if (req.path === '/health') {
    return next();
  }

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  const supplied = match ? match[1] : '';
  const expected = process.env.API_TOKEN || '';

  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);

  if (
    !expected ||
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
});

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const cleanName = value =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_]{1,16}$/.test(value);

const validUuid = value =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const validDiscordId = value =>
  typeof value === 'string' &&
  /^\d{17,20}$/.test(value);

const validReason = value =>
  typeof value === 'string' &&
  value.trim().length >= 2 &&
  value.length <= 300;

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sneaksmp-api'
  });
});

// --------------------------------------------------
// ANNOUNCEMENTS
// Discord bot adds announcements to the queue.
// Minecraft plugin retrieves the next announcement.
// --------------------------------------------------

app.post('/v1/announcements', (req, res) => {
  const { message, actor } = req.body || {};

  if (
    typeof message !== 'string' ||
    !message.trim() ||
    message.length > 1000 ||
    typeof actor !== 'string' ||
    !actor.trim()
  ) {
    return res.status(400).json({
      error: 'invalid announcement'
    });
  }

  const item = announcements.enqueue({
    message: message.trim(),
    actor: actor.trim()
  });

  audit({
    type: 'announcement',
    id: item.id,
    actor: actor.trim(),
    message: item.message,
    createdAt: item.createdAt
  });

  return res.status(201).json({
    ok: true,
    id: item.id
  });
});

app.get('/v1/announcements/next', (_req, res) => {
  const item = announcements.consumeNext();

  if (!item) {
    return res.json({
      announcement: null
    });
  }

  return res.json({
    announcement: {
      id: item.id,
      messageB64: Buffer
        .from(item.message, 'utf8')
        .toString('base64')
    }
  });
});

// --------------------------------------------------
// MINECRAFT / DISCORD ACCOUNT LINKING
// --------------------------------------------------

app.post('/v1/links/create', (req, res) => {
  const { uuid, username } = req.body || {};

  if (!validUuid(uuid) || !cleanName(username)) {
    return res.status(400).json({
      error: 'invalid player'
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));

  const hash = crypto
    .createHash('sha256')
    .update(code)
    .digest('hex');

  codes.set(hash, {
    uuid,
    username,
    expires: Date.now() + 300000
  });

  players.put(uuid, {
    ...(players.get(uuid) || {}),
    uuid,
    username,
    lastSeen: Date.now()
  });

  return res.json({
    code,
    expiresIn: 300
  });
});

app.post('/v1/links/verify', (req, res) => {
  const { code, discordId } = req.body || {};

  if (
    typeof code !== 'string' ||
    !/^\d{6}$/.test(code) ||
    !validDiscordId(discordId)
  ) {
    return res.status(400).json({
      error: 'invalid input'
    });
  }

  const hash = crypto
    .createHash('sha256')
    .update(code)
    .digest('hex');

  const challenge = codes.consume(hash);

  if (!challenge || challenge.expires < Date.now()) {
    return res.status(400).json({
      error: 'code expired or invalid'
    });
  }

  const existingDiscordId = links.discordForUuid(challenge.uuid);

  if (existingDiscordId && existingDiscordId !== discordId) {
    return res.status(409).json({
      error: 'Minecraft account already linked'
    });
  }

  links.set(discordId, {
    uuid: challenge.uuid,
    username: challenge.username,
    linkedAt: Date.now()
  });

  audit({
    type: 'link',
    discordId,
    uuid: challenge.uuid
  });

  return res.json({
    ok: true,
    link: links.get(discordId)
  });
});

app.get('/v1/links/:discordId', (req, res) => {
  if (!validDiscordId(req.params.discordId)) {
    return res.status(400).json({
      error: 'invalid Discord ID'
    });
  }

  return res.json({
    link: links.get(req.params.discordId)
  });
});

app.delete('/v1/links/:discordId', (req, res) => {
  const { discordId } = req.params;

  if (!validDiscordId(discordId)) {
    return res.status(400).json({
      error: 'invalid Discord ID'
    });
  }

  links.remove(discordId);

  audit({
    type: 'unlink',
    discordId
  });

  return res.json({ ok: true });
});

// --------------------------------------------------
// PLAYER DATA
// --------------------------------------------------

app.post('/v1/players/upsert', (req, res) => {
  const { uuid, username } = req.body || {};

  if (!validUuid(uuid) || !cleanName(username)) {
    return res.status(400).json({
      error: 'invalid player'
    });
  }

  players.put(uuid, {
    ...(players.get(uuid) || {}),
    uuid,
    username,
    lastSeen: Date.now()
  });

  return res.json({ ok: true });
});

app.post('/v1/players/stats', (req, res) => {
  const {
    uuid,
    username,
    kills,
    deaths,
    playtimeTicks,
    money
  } = req.body || {};

  if (!validUuid(uuid) || !cleanName(username)) {
    return res.status(400).json({
      error: 'invalid player'
    });
  }

  const validStats = [kills, deaths, playtimeTicks].every(
    value => Number.isFinite(value) && value >= 0
  );

  if (!validStats) {
    return res.status(400).json({
      error: 'invalid stats'
    });
  }

  players.put(uuid, {
    ...(players.get(uuid) || {}),
    uuid,
    username,
    kills,
    deaths,
    playtimeTicks,
    money:
      Number.isFinite(money) && money >= 0
        ? money
        : null,
    lastSeen: Date.now()
  });

  return res.json({ ok: true });
});

app.post('/v1/stats/kill', (req, res) => {
  const { uuid, username } = req.body || {};

  if (!validUuid(uuid) || !cleanName(username)) {
    return res.status(400).json({
      error: 'invalid player'
    });
  }

  const player = players.get(uuid) || {
    uuid,
    username,
    kills: 0,
    deaths: 0,
    playtimeTicks: 0
  };

  players.put(uuid, {
    ...player,
    uuid,
    username,
    kills: (player.kills || 0) + 1,
    lastSeen: Date.now()
  });

  return res.json({ ok: true });
});

app.post('/v1/stats/death', (req, res) => {
  const { uuid, username } = req.body || {};

  if (!validUuid(uuid) || !cleanName(username)) {
    return res.status(400).json({
      error: 'invalid player'
    });
  }

  const player = players.get(uuid) || {
    uuid,
    username,
    kills: 0,
    deaths: 0,
    playtimeTicks: 0
  };

  players.put(uuid, {
    ...player,
    uuid,
    username,
    deaths: (player.deaths || 0) + 1,
    lastSeen: Date.now()
  });

  return res.json({ ok: true });
});

app.get('/v1/players/:uuid/stats', (req, res) => {
  const { uuid } = req.params;

  if (!validUuid(uuid)) {
    return res.status(400).json({
      error: 'invalid UUID'
    });
  }

  const player = players.get(uuid);

  if (!player) {
    return res.status(404).json({
      error: 'not found'
    });
  }

  return res.json(player);
});

// --------------------------------------------------
// SERVER HEARTBEAT
// --------------------------------------------------

app.post('/v1/server/heartbeat', (req, res) => {
  players.put('__server__', {
    ...(req.body || {}),
    heartbeat: Date.now()
  });

  return res.json({ ok: true });
});

// --------------------------------------------------
// LEADERBOARDS
// Supported: kills, deaths, money, playtime, coins
// --------------------------------------------------

app.get('/v1/leaderboards/:type', (req, res) => {
  const { type } = req.params;

  const allowed = [
    'kills',
    'deaths',
    'money',
    'playtime',
    'coins'
  ];

  if (!allowed.includes(type)) {
    return res.status(400).json({
      error: 'invalid type'
    });
  }

  const allPlayers = Object.values(players.all())
    .filter(player => player.uuid && player.uuid !== '__server__');

  const rows = allPlayers
    .map(player => ({
      ...player,
      coins: coins.get(player.uuid)
    }))
    .filter(player => {
      const value = type === 'playtime'
        ? player.playtimeTicks
        : player[type];

      return Number.isFinite(value);
    })
    .sort((a, b) => {
      const aValue = type === 'playtime'
        ? a.playtimeTicks
        : a[type];

      const bValue = type === 'playtime'
        ? b.playtimeTicks
        : b[type];

      return (Number(bValue) || 0) - (Number(aValue) || 0);
    });

  return res.json({
    type,
    rows: rows.slice(0, 10)
  });
});

// --------------------------------------------------
// COINS / ECONOMY
// --------------------------------------------------

app.post('/v1/coins/adjust', (req, res) => {
  const { uuid, amount, actor, reason } = req.body || {};

  if (
    !validUuid(uuid) ||
    !Number.isSafeInteger(amount) ||
    amount === 0 ||
    typeof actor !== 'string' ||
    !actor.trim() ||
    !validReason(reason)
  ) {
    return res.status(400).json({
      error: 'invalid input'
    });
  }

  try {
    const balance = coins.adjust(uuid, amount);

    audit({
      type: 'coin-adjust',
      uuid,
      amount,
      actor: actor.trim(),
      reason: reason.trim(),
      balance
    });

    return res.json({
      ok: true,
      balance
    });
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'coin adjustment failed'
    });
  }
});

app.get('/v1/coins/:uuid', (req, res) => {
  const { uuid } = req.params;

  if (!validUuid(uuid)) {
    return res.status(400).json({
      error: 'invalid UUID'
    });
  }

  return res.json({
    uuid,
    balance: coins.get(uuid)
  });
});

// --------------------------------------------------
// MODERATION REQUESTS
// NOTE: This records requests only. It does not
// execute Minecraft kick/ban commands.
// --------------------------------------------------

app.post('/v1/moderation', (req, res) => {
  const {
    type,
    player,
    reason,
    hours,
    actor
  } = req.body || {};

  if (
    !['kick', 'ban', 'tempban', 'unban'].includes(type) ||
    !cleanName(player) ||
    !validReason(reason) ||
    typeof actor !== 'string' ||
    !actor.trim() ||
    (type === 'tempban' &&
      (!Number.isFinite(hours) || hours <= 0))
  ) {
    return res.status(400).json({
      error: 'invalid request'
    });
  }

  const id = crypto.randomUUID();

  audit({
    type: 'moderation-request',
    id,
    action: type,
    player,
    reason: reason.trim(),
    hours: type === 'tempban' ? hours : null,
    actor: actor.trim(),
    status: 'queued'
  });

  return res.status(202).json({
    id,
    status: 'queued',
    warning: 'This endpoint records the request only; a verified Minecraft command worker is required to execute it.'
  });
});
