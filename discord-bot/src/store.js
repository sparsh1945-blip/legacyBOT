
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve('data');

fs.mkdirSync(dir, {
  recursive: true,
  mode: 0o700
});

// --------------------------------------------------
// JSON STORAGE HELPERS
// --------------------------------------------------

function load(name, fallback) {
  const file = path.join(dir, name);

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }

    // Do not silently replace corrupt JSON with empty data.
    throw new Error(`Cannot read ${name}: ${error.message}`);
  }
}

function save(name, data) {
  const file = path.join(dir, name);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;

  try {
    fs.writeFileSync(
      temp,
      JSON.stringify(data, null, 2),
      { mode: 0o600, flag: 'wx' }
    );

    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Preserve the original error.
    }

    throw new Error(`Cannot save ${name}: ${error.message}`);
  }
}

function readObject(name) {
  const value = load(name, {});

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must contain a JSON object`);
  }

  return value;
}

function readArray(name) {
  const value = load(name, []);

  if (!Array.isArray(value)) {
    throw new Error(`${name} must contain a JSON array`);
  }

  return value;
}

// --------------------------------------------------
// PLAYER STORAGE
// --------------------------------------------------

export const players = {
  all() {
    return readObject('players.json');
  },

  get(uuid) {
    return this.all()[uuid] ?? null;
  },

  put(uuid, value) {
    const data = this.all();

    data[uuid] = {
      ...(data[uuid] || {}),
      ...value
    };

    save('players.json', data);

    return data[uuid];
  }
};

// --------------------------------------------------
// DISCORD <-> MINECRAFT LINKS
// --------------------------------------------------

export const links = {
  all() {
    return readObject('links.json');
  },

  get(discordId) {
    return this.all()[discordId] ?? null;
  },

  set(discordId, value) {
    const data = this.all();

    data[discordId] = value;

    save('links.json', data);

    return data[discordId];
  },

  remove(discordId) {
    const data = this.all();
    delete data[discordId];
    save('links.json', data);
  },

  discordForUuid(uuid) {
    const entry = Object.entries(this.all())
      .find(([, value]) => value.uuid === uuid);

    return entry?.[0] ?? null;
  }
};

// --------------------------------------------------
// COIN STORAGE
// --------------------------------------------------

export const coins = {
  all() {
    return readObject('coins.json');
  },

  get(uuid) {
    const balance = Number(this.all()[uuid] ?? 0);

    if (!Number.isFinite(balance) || balance < 0) {
      throw new Error(`Invalid coin balance for ${uuid}`);
    }

    return balance;
  },

  adjust(uuid, amount) {
    if (
      typeof uuid !== 'string' ||
      !Number.isSafeInteger(amount) ||
      amount === 0
    ) {
      throw new Error('Invalid UUID or coin amount');
    }

    const data = this.all();
    const current = Number(data[uuid] ?? 0);
    const next = current + amount;

    if (
      !Number.isSafeInteger(current) ||
      current < 0 ||
      !Number.isSafeInteger(next) ||
      next < 0
    ) {
      throw new Error('Insufficient balance or invalid amount');
    }

    data[uuid] = next;
    save('coins.json', data);

    return next;
  }
};

// --------------------------------------------------
// TEMPORARY ACCOUNT-LINK CODES
// --------------------------------------------------

export const codes = {
  all() {
    return readObject('codes.json');
  },

  set(hash, value) {
    const data = this.all();

    data[hash] = value;

    save('codes.json', data);
  },

  consume(hash) {
    const data = this.all();
    const value = data[hash];

    if (value) {
      delete data[hash];
      save('codes.json', data);
    }

    return value ?? null;
  }
};

// --------------------------------------------------
// AUDIT LOG
// --------------------------------------------------

export const audit = (entry) => {
  const data = readArray('audit.json');

  data.push({
    ...entry,
    at: new Date().toISOString()
  });

  save('audit.json', data.slice(-10000));
};

// --------------------------------------------------
// ANNOUNCEMENT QUEUE
// Discord adds; Minecraft plugin retrieves.
// --------------------------------------------------

export const announcements = {
  enqueue(entry) {
    if (
      !entry ||
      typeof entry.message !== 'string' ||
      !entry.message.trim() ||
      entry.message.length > 1000 ||
      typeof entry.actor !== 'string' ||
      !entry.actor.trim()
    ) {
      throw new Error('Invalid announcement');
    }

    const queue = readArray('announcements.json');

    const item = {
      id: crypto.randomUUID(),
      message: entry.message.trim(),
      actor: entry.actor.trim(),
      createdAt: new Date().toISOString()
    };

    queue.push(item);

    // Keep the newest 500 pending announcements.
    save('announcements.json', queue.slice(-500));

    return item;
  },

  consumeNext() {
    const queue = readArray('announcements.json');

    if (queue.length === 0) {
      return null;
    }

    const item = queue.shift();

    save('announcements.json', queue);

    return item;
  }
};
