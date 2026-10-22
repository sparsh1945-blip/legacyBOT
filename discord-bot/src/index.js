
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} from 'discord.js';

import { app } from './api.js';
import { players, links, coins } from './store.js';

const token = process.env.DISCORD_TOKEN;
const apiToken = process.env.API_TOKEN;
const port = Number(process.env.PORT || 8787);

if (!token || !apiToken) {
  throw new Error('Set DISCORD_TOKEN and API_TOKEN in your environment.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`SneakSMP API listening on ${port}`);
});

server.on('error', error => {
  console.error('API server failed:', error.message);
});

const apiBase = (
  process.env.API_BASE_URL || `http://127.0.0.1:${port}`
).replace(/\/+$/, '');

async function api(route, method = 'GET', body) {
  const response = await fetch(`${apiBase}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'Invalid API response' };
  }

  if (!response.ok) {
    throw new Error(data.error || `API request failed (${response.status})`);
  }

  return data;
}

// Permissions

function parseIds(name) {
  return (process.env[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function isOwner(i) {
  return parseIds('OWNER_IDS').includes(i.user.id) ||
    parseIds('OWNER_ROLE_IDS').some(id => i.member?.roles?.cache?.has(id));
}

function isDeveloper(i) {
  return parseIds('DEVELOPER_IDS').includes(i.user.id) ||
    parseIds('DEVELOPER_ROLE_IDS').some(id => i.member?.roles?.cache?.has(id));
}

function isAdmin(i) {
  return isOwner(i) ||
    isDeveloper(i) ||
    parseIds('ADMIN_ROLE_IDS').some(id => i.member?.roles?.cache?.has(id)) ||
    i.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function isModerator(i) {
  return isAdmin(i) ||
    parseIds('MOD_ROLE_IDS').some(id => i.member?.roles?.cache?.has(id));
}

async function deny(i, message = 'You do not have permission to use this command.') {
  return i.reply({ content: message, flags: MessageFlags.Ephemeral });
}

function getString(i, ...names) {
  for (const name of names) {
    const value = i.options.getString(name);
    if (value !== null) return value;
  }
  return null;
}

function getInteger(i, ...names) {
  for (const name of names) {
    const value = i.options.getInteger(name);
    if (value !== null) return value;
  }
  return null;
}

function findPlayer(name) {
  if (!name) return null;
  return Object.values(players.all()).find(
    player => player.username?.toLowerCase() === name.toLowerCase()
  ) || null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function linkedAccount(discordId) {
  return links.get(discordId);
}

async function replyError(i, error) {
  console.error(error);
  const message = `Something went wrong: ${error.message || 'Unknown error'}`;

  if (i.deferred || i.replied) {
    return i.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  return i.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
}

// Custom message storage

const customDir = path.resolve('data');
const customFile = path.join(customDir, 'custom-messages.json');

fs.mkdirSync(customDir, { recursive: true });

function loadCustomMessages() {
  try {
    const data = JSON.parse(fs.readFileSync(customFile, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

let customMessages = loadCustomMessages();
const customDrafts = new Map();
const customEditOrigins = new Map();

function saveCustomMessages() {
  const tempFile = `${customFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(customMessages, null, 2));
  fs.renameSync(tempFile, customFile);
}

function saveGuildAutoReplies(guildId, messages) {
  customMessages[guildId] = messages;
  saveCustomMessages();

  const draftPrefix = `${guildId}:`;
  for (const key of customDrafts.keys()) {
    if (key.startsWith(draftPrefix)) {
      customDrafts.delete(key);
      customEditOrigins.delete(key);
    }
  }
}

function normalizeTrigger(value) {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function validTrigger(trigger) {
  return Boolean(
    trigger &&
    trigger.length <= 100 &&
    /[\p{L}\p{N}]/u.test(trigger) &&
    !/[\p{Cc}\p{Cf}]/u.test(trigger)
  );
}

function normalizeHexColor(value, fallback = '22C7D6') {
  if (value == null) return fallback;

  const hex = value.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : null;
}

function autoResponderNotice(title, description, color = 0x22c7d6) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'LEGACY MC • AUTO-RESPONDER' })
    .setTimestamp();
}

function setAutoReply(messages, trigger, item) {
  Object.defineProperty(messages, trigger, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: item
  });
}

function draftKey(i) {
  return `${i.guildId}:${i.user.id}`;
}

function getDraft(i) {
  const key = draftKey(i);

  if (!customDrafts.has(key)) {
    customDrafts.set(
      key,
      structuredClone(customMessages[i.guildId] || {})
    );
  }

  return customDrafts.get(key);
}

function customEmbed(item) {
  const hex = normalizeHexColor(item.color) || '22C7D6';
  const reply = item.reply || item.body || 'This auto-reply has no message yet.';

  return new EmbedBuilder()
    .setColor(parseInt(hex, 16))
    .setAuthor({ name: 'LEGACY MC • AUTO-REPLY' })
    .setTitle(item.title || '✨ Auto-Reply')
    .setDescription(reply)
    .addFields({ name: '🔑 Trigger', value: `\`${item.trigger || 'custom'}\``, inline: true })
    .setFooter({ text: 'LEGACY MC • Automatic response' })
    .setTimestamp();
}

function customPanel(messages) {
  const entries = Object.entries(messages);

  const description = entries.length
    ? entries.map(([key, item]) => `• **${key.slice(0, 80)}** — ${(item.reply || item.title || 'Embed reply').replace(/\s+/gu, ' ').slice(0, 40)}`).join('\n')
    : 'No auto-replies in this draft. Select Add Reply to create one.';

  return new EmbedBuilder()
    .setColor(0x22c7d6)
    .setAuthor({ name: 'LEGACY MC • SERVER TOOLS' })
    .setTitle('✨ Auto-Responder Studio')
    .setDescription(description)
    .setFooter({ text: 'Save changes to activate your word and phrase replies.' })
    .setTimestamp();
}

function customButtons(messages) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('legacy_custom_add')
        .setLabel('Add Reply')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('legacy_custom_edit')
        .setLabel('Edit Reply')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('legacy_custom_save')
        .setLabel('Save Changes')
        .setStyle(ButtonStyle.Success)
    )
  ];

  if (Object.keys(messages).length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('legacy_custom_delete')
          .setLabel('Delete Reply')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return rows;
}

function customSelect(messages, customId) {
  const entries = Object.entries(messages).slice(0, 25);

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Choose an auto-reply')
      .addOptions(entries.map(([key, item]) => ({
        label: key.slice(0, 100),
        description: (item.title || 'Auto-reply').slice(0, 100),
        value: key
      })))
  );
}

function customModal(customId, item = {}) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(item.trigger ? 'Edit Auto-Reply' : 'Add Auto-Reply');

  const trigger = new TextInputBuilder()
    .setCustomId('trigger')
    .setLabel('Trigger word or sentence')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true)
    .setValue(item.trigger || '');

  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Embed title')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(true)
    .setValue(item.title || 'Auto-Reply');

  const body = new TextInputBuilder()
    .setCustomId('body')
    .setLabel('Embed message')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(3500)
    .setRequired(true)
    .setValue(item.body || item.reply || 'Your automatic reply goes here.');

  const color = new TextInputBuilder()
    .setCustomId('color')
    .setLabel('HEX color without #, e.g. 22C7D6')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(6)
    .setRequired(true)
    .setValue(item.color || '22C7D6');

  modal.addComponents(
    new ActionRowBuilder().addComponents(trigger),
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(body),
    new ActionRowBuilder().addComponents(color)
  );

  return modal;
}

// Bot ready

client.once('clientReady', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

// Slash commands

client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand()) return;

  const command = i.commandName;

  try {
    if (command === 'autoresponder') {
      if (!isAdmin(i)) return deny(i);
      if (!i.guildId) return deny(i, 'Use this command inside a server.');

      const action = i.options.getSubcommand(false);
      if (!action) {
        return i.reply({
          embeds: [autoResponderNotice(
            '✨ Choose an Auto-Responder Action',
            'Available options: **add**, **edit**, **delete**, **list**, **help**, and **panel**.\n\nStart with `/autoresponder add` to create a colorful reply.'
          )],
          flags: MessageFlags.Ephemeral
        });
      }
      const guildMessages = customMessages[i.guildId] || {};

      if (action === 'panel') {
        const messages = getDraft(i);
        return i.reply({
          embeds: [customPanel(messages)],
          components: customButtons(messages),
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'add') {
        const trigger = normalizeTrigger(i.options.getString('trigger'));
        const reply = i.options.getString('reply').trim();
        const title = i.options.getString('title')?.trim() || '✨ Auto-Reply';
        const color = normalizeHexColor(i.options.getString('color'));

        if (!validTrigger(trigger) || !reply) {
          return i.reply({
            embeds: [autoResponderNotice(
              '⚠️ Check Your Auto-Reply',
              'Enter a trigger word or phrase (up to 100 characters) and a non-empty reply.',
              0xe74c3c
            )],
            flags: MessageFlags.Ephemeral
          });
        }

        if (!color) {
          return i.reply({
            embeds: [autoResponderNotice('🎨 Invalid HEX Color', 'Use six HEX digits, such as `#22C7D6`.', 0xe74c3c)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (Object.hasOwn(guildMessages, trigger)) {
          return i.reply({
            embeds: [autoResponderNotice('⚠️ Trigger Already Exists', `**${trigger}** is already configured. Use `/autoresponder edit` to change it.`, 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (Object.keys(guildMessages).length >= 25) {
          return i.reply({
            embeds: [autoResponderNotice('📚 Auto-Reply Limit Reached', 'This server can have up to **25** auto-replies.', 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        setAutoReply(guildMessages, trigger, { trigger, reply, title, color });
        saveGuildAutoReplies(i.guildId, guildMessages);

        return i.reply({
          embeds: [autoResponderNotice(
            '✅ Auto-Reply Added',
            `**Trigger:** \`${trigger}\`\n**Reply:** ${reply.slice(0, 500)}\n**Appearance:** ${title} · \`#${color}\`\n\nIt is active now.`,
            parseInt(color, 16)
          )],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'edit') {
        const currentTrigger = normalizeTrigger(i.options.getString('trigger'));
        const trigger = normalizeTrigger(i.options.getString('new-trigger') || currentTrigger);
        const reply = i.options.getString('reply').trim();
        const existing = Object.hasOwn(guildMessages, currentTrigger)
          ? guildMessages[currentTrigger]
          : null;

        if (!existing) {
          return i.reply({ content: `No auto-reply was found for **${currentTrigger}**.`, flags: MessageFlags.Ephemeral });
        }

        if (!validTrigger(trigger) || !reply) {
          return i.reply({
            embeds: [autoResponderNotice('⚠️ Check Your Auto-Reply', 'Enter a valid trigger word or phrase and a non-empty reply.', 0xe74c3c)],
            flags: MessageFlags.Ephemeral
          });
        }

        const title = i.options.getString('title')?.trim() || existing.title || '✨ Auto-Reply';
        const color = normalizeHexColor(i.options.getString('color'), existing.color || '22C7D6');

        if (!color) {
          return i.reply({
            embeds: [autoResponderNotice('🎨 Invalid HEX Color', 'Use six HEX digits, such as `#22C7D6`.', 0xe74c3c)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (trigger !== currentTrigger && Object.hasOwn(guildMessages, trigger)) {
          return i.reply({
            embeds: [autoResponderNotice('⚠️ Trigger Already Exists', `**${trigger}** is already configured.`, 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        delete guildMessages[currentTrigger];
        setAutoReply(guildMessages, trigger, { trigger, reply, title, color });
        saveGuildAutoReplies(i.guildId, guildMessages);

        return i.reply({
          embeds: [autoResponderNotice('✏️ Auto-Reply Updated', `**Trigger:** \`${trigger}\`\n**Reply:** ${reply.slice(0, 500)}\n**Appearance:** ${title} · \`#${color}\``, parseInt(color, 16))],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'delete') {
        const trigger = normalizeTrigger(i.options.getString('trigger'));

        if (!Object.hasOwn(guildMessages, trigger)) {
          return i.reply({
            embeds: [autoResponderNotice('🔎 Auto-Reply Not Found', `No auto-reply was found for **${trigger}**.`, 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        delete guildMessages[trigger];
        saveGuildAutoReplies(i.guildId, guildMessages);
        return i.reply({
          embeds: [autoResponderNotice('🗑️ Auto-Reply Deleted', `The trigger **${trigger}** has been removed.`, 0xe74c3c)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'list') {
        const entries = Object.entries(guildMessages);
        const embed = autoResponderNotice(
          '💬 Auto-Reply Library',
          entries.length
            ? `**${entries.length}/25** replies are active. They trigger when a whole word or phrase appears.`
            : 'No auto-replies are configured yet. Use `/autoresponder add` to create one.'
        );

        for (const [trigger, item] of entries) {
          const reply = (item.reply || item.body || 'No reply text').replace(/\s+/gu, ' ');
          embed.addFields({
            name: `🔑 ${trigger}`.slice(0, 256),
            value: `✨ ${(item.title || 'Auto-Reply').slice(0, 28)}\n💬 ${reply.slice(0, 40)}${reply.length > 40 ? '…' : ''}\n🎨 \`#${normalizeHexColor(item.color) || '22C7D6'}\``,
            inline: true
          });
        }

        return i.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'help') {
        const embed = new EmbedBuilder()
          .setColor(0x8e44ad)
          .setAuthor({ name: 'LEGACY MC • COMMAND GUIDE' })
          .setTitle('✨ Auto-Responder Help')
          .setDescription('Build colorful automatic replies for words or phrases your community uses.')
          .addFields(
            {
              name: '➕ Add a reply',
              value: '`/autoresponder add`\n**Required:** `trigger`, `reply`\n**Optional:** `title`, `color`'
            },
            {
              name: '✏️ Edit a reply',
              value: '`/autoresponder edit`\n**Required:** existing `trigger`, new `reply`\n**Optional:** `new-trigger`, `title`, `color`'
            },
            {
              name: '🧰 More options',
              value: '`/autoresponder delete` removes a trigger.\n`/autoresponder list` shows saved replies.\n`/autoresponder panel` opens the embed editor.'
            },
            {
              name: '🎨 Example',
              value: '`trigger: server ip`\n`reply: Java: play.example.net`\n`title: Join our server`\n`color: #22C7D6`'
            },
            {
              name: '💡 Trigger matching',
              value: 'Triggers ignore letter case and match as complete words or phrases. A trigger `ip` matches “what is the IP?” but not “ship”.'
            }
          )
          .setFooter({ text: 'Up to 25 auto-replies per server • Replies activate immediately' })
          .setTimestamp();

        return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }

    if (command === 'custommsg') {
      if (!isAdmin(i)) return deny(i);

      const channel = i.options.getChannel('channel');
      const title = i.options.getString('title');
      const message = i.options.getString('message');
      const color = i.options.getString('color') || '#5865F2';

      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        return i.reply({ content: 'Invalid color. Example: #5865F2', flags: MessageFlags.Ephemeral });
      }

      if (!channel || channel.type !== ChannelType.GuildText) {
        return i.reply({ content: 'Select a server text channel.', flags: MessageFlags.Ephemeral });
      }

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(parseInt(color.slice(1), 16))
            .setTitle(title.trim())
            .setDescription(message.trim())
            .setFooter({ text: 'LegacyMC' })
            .setTimestamp()
        ]
      });

      return i.reply({ content: `Custom embed sent to ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('LegacyMC Commands')
        .setDescription('Commands for the LegacyMC Minecraft community.')
        .addFields(
          { name: 'Account linking', value: '`/minelink` · `/mineunlink` · `/mineaccount`' },
          { name: 'Stats and economy', value: '`/minestats` · `/mineleaderboard` · `/minebalance`' },
          { name: 'Staff', value: '`/announce` · `/addcoin` · `/takecoin` · `/givecoins` · `/takecoins`' },
          { name: 'Moderation', value: '`/minekick` · `/mineban` · `/minetempban` · `/mineunban` · `/minestatus`' },
          { name: 'Custom embeds and auto-replies', value: '`/custommsg` · `/autoresponder help` · `/autoresponder add` · `/autoresponder edit` · `/autoresponder delete` · `/autoresponder list` · `/autoresponder panel`' }
        );

      return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (command === 'announce') {
      if (!isAdmin(i)) return deny(i);

      const message = getString(i, 'message');
      if (!message?.trim() || message.length > 1000) {
        return i.reply({ content: 'Announcement must be 1–1000 characters.', flags: MessageFlags.Ephemeral });
      }

      await i.deferReply({ flags: MessageFlags.Ephemeral });

      const result = await api('/v1/announcements', 'POST', {
        message: message.trim(),
        actor: i.user.id
      });

      const channel = i.options.getChannel('channel');

      if (channel?.type === ChannelType.GuildText) {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle('📢 LegacyMC Announcement')
              .setDescription(message.trim())
              .setFooter({ text: 'LegacyMC • Official Announcement' })
              .setTimestamp()
          ]
        });
      }

      return i.editReply(`Announcement queued for Minecraft. ID: \`${result.id}\``);
    }

    if (command === 'minelink') {
      const code = getString(i, 'code');

      if (!code || !/^\d{6}$/.test(code)) {
        return i.reply({ content: 'Enter the six-digit code from Minecraft `/discordlink`.', flags: MessageFlags.Ephemeral });
      }

      const result = await api('/v1/links/verify', 'POST', {
        code,
        discordId: i.user.id
      });

      return i.reply({
        content: `Your Minecraft account **${result.link.username}** is now linked.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === 'mineunlink') {
      const account = linkedAccount(i.user.id);

      if (!account) {
        return i.reply({ content: 'You do not have a linked Minecraft account.', flags: MessageFlags.Ephemeral });
      }

      await api(`/v1/links/${i.user.id}`, 'DELETE');
      return i.reply({ content: 'Your Minecraft account has been unlinked.', flags: MessageFlags.Ephemeral });
    }

    if (command === 'mineaccount') {
      const account = linkedAccount(i.user.id);

      if (!account) {
        return i.reply({ content: 'No account linked. Use `/minelink`.', flags: MessageFlags.Ephemeral });
      }

      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('Linked Minecraft Account')
            .addFields(
              { name: 'Username', value: account.username || 'Unknown', inline: true },
              { name: 'UUID', value: account.uuid || 'Unknown', inline: true }
            )
        ],
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === 'mineleaderboard') {
      const type = getString(i, 'type') || 'kills';
      if (!['kills', 'deaths', 'money', 'playtime', 'coins'].includes(type)) {
        return i.reply({ content: 'Invalid leaderboard type.', flags: MessageFlags.Ephemeral });
      }

      const result = await api(`/v1/leaderboards/${encodeURIComponent(type)}`);
      const rows = result.rows || [];

      const description = rows.length
        ? rows.map((p, index) => {
            const value = type === 'playtime'
              ? `${formatNumber(Math.floor((p.playtimeTicks || 0) / 20))} seconds`
              : formatNumber(p[type]);
            return `**${index + 1}. ${p.username || 'Unknown'}** — ${value}`;
          }).join('\n')
        : 'No player stats are available yet.';

      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`LegacyMC ${type} leaderboard`)
            .setDescription(description)
        ]
      });
    }

    if (command === 'minestats') {
      const name = getString(i, 'player', 'username');
      let player = name ? findPlayer(name) : null;

      if (!player) {
        const account = linkedAccount(i.user.id);
        player = account ? players.get(account.uuid) : null;
      }

      if (!player) {
        return i.reply({
          content: 'Player stats were not found. They may need to join the server first.',
          flags: MessageFlags.Ephemeral
        });
      }

      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`${player.username || 'Player'} — Stats`)
            .addFields(
              { name: 'Kills', value: formatNumber(player.kills), inline: true },
              { name: 'Deaths', value: formatNumber(player.deaths), inline: true },
              { name: 'Playtime', value: `${formatNumber(Math.floor((player.playtimeTicks || 0) / 20))} seconds`, inline: true },
              { name: 'Money', value: player.money == null ? 'Not available' : formatNumber(player.money), inline: true },
              { name: 'Coins', value: formatNumber(coins.get(player.uuid)), inline: true }
            )
        ]
      });
    }

    if (command === 'minebalance') {
      const account = linkedAccount(i.user.id);

      if (!account) {
        return i.reply({ content: 'Link your Minecraft account first using `/minelink`.', flags: MessageFlags.Ephemeral });
      }

      return i.reply({
        content: `**${account.username}** has **${formatNumber(coins.get(account.uuid))} coins**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (['addcoin', 'takecoin', 'givecoins', 'takecoins'].includes(command)) {
      if (!isAdmin(i)) return deny(i);

      const playerName = getString(i, 'player', 'username');
      const amount = getInteger(i, 'amount');
      const reason = getString(i, 'reason');

      if (!playerName || !amount || amount < 1 || !reason?.trim()) {
        return i.reply({ content: 'Provide a player, positive amount and reason.', flags: MessageFlags.Ephemeral });
      }

      const player = findPlayer(playerName);
      if (!player) {
        return i.reply({ content: `Could not find Minecraft player **${playerName}**.`, flags: MessageFlags.Ephemeral });
      }

      const subtract = ['takecoin', 'takecoins'].includes(command);
      const result = await api('/v1/coins/adjust', 'POST', {
        uuid: player.uuid,
        amount: subtract ? -amount : amount,
        actor: i.user.id,
        reason: reason.trim()
      });

      return i.reply({
        content: `Updated **${player.username}** by ${subtract ? '-' : '+'}${formatNumber(amount)} coins. New balance: **${formatNumber(result.balance)}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (['minekick', 'mineban', 'minetempban', 'mineunban'].includes(command)) {
      if (!isModerator(i)) return deny(i);

      const player = getString(i, 'player', 'username');
      const reason = getString(i, 'reason') || 'No reason provided';
      const hours = getInteger(i, 'hours');

      if (!player) {
        return i.reply({ content: 'Provide a Minecraft player name.', flags: MessageFlags.Ephemeral });
      }

      if (command === 'minetempban' && (!hours || hours < 1)) {
        return i.reply({ content: 'Provide a positive ban duration.', flags: MessageFlags.Ephemeral });
      }

      const typeMap = {
        minekick: 'kick',
        mineban: 'ban',
        minetempban: 'tempban',
        mineunban: 'unban'
      };

      const result = await api('/v1/moderation', 'POST', {
        type: typeMap[command],
        player,
        reason,
        hours,
        actor: i.user.id
      });

      return i.reply({
        content: `Moderation request recorded for **${player}** (ID: \`${result.id}\`). This request is not executed in Minecraft yet.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === 'minestatus') {
      const serverInfo = players.get('__server__');

      if (!serverInfo?.heartbeat) {
        return i.reply({ content: 'Waiting for a Minecraft plugin heartbeat.', flags: MessageFlags.Ephemeral });
      }

      const ageSeconds = Math.floor((Date.now() - serverInfo.heartbeat) / 1000);
      const online = ageSeconds <= 120;

      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(online ? 0x2ecc71 : 0xe74c3c)
            .setTitle('LegacyMC Server Status')
            .setDescription(online ? '🟢 Server heartbeat is active' : '🔴 Server heartbeat is stale')
            .addFields({ name: 'Last heartbeat', value: `${ageSeconds} seconds ago`, inline: true })
        ]
      });
    }

    return i.reply({
      content: 'This command is not handled by the current bot code.',
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    await replyError(i, error);
  }
});

// Custom message buttons, select menus and modals

client.on('interactionCreate', async i => {
  if (!i.isButton() && !i.isStringSelectMenu() && !i.isModalSubmit()) return;
  if (!i.customId.startsWith('legacy_custom_')) return;

  if (!i.guildId) {
    return i.reply({ content: 'Use this inside a server.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (!isAdmin(i)) {
    return i.reply({ content: 'Only administrators can manage custom messages.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  try {
    const messages = getDraft(i);
    const key = draftKey(i);

    if (i.isButton()) {
      if (i.customId === 'legacy_custom_add') {
        customEditOrigins.delete(key);
        return i.showModal(customModal('legacy_custom_modal_add'));
      }

      if (i.customId === 'legacy_custom_edit' || i.customId === 'legacy_custom_delete') {
        if (!Object.keys(messages).length) {
          return i.reply({ content: 'There are no messages to select yet.', flags: MessageFlags.Ephemeral });
        }

        const deleting = i.customId === 'legacy_custom_delete';
        return i.update({
          embeds: [customPanel(messages)],
          components: [
            customSelect(messages, deleting ? 'legacy_custom_pick_delete' : 'legacy_custom_pick_edit'),
            ...customButtons(messages)
          ]
        });
      }

      if (i.customId === 'legacy_custom_save') {
        customMessages[i.guildId] = structuredClone(messages);
        saveCustomMessages();
        customDrafts.delete(key);

        return i.update({
          embeds: [customPanel(customMessages[i.guildId])],
          components: customButtons(customMessages[i.guildId])
        });
      }
    }

    if (i.isStringSelectMenu()) {
      const selected = i.values[0];

      if (i.customId === 'legacy_custom_pick_edit') {
        const item = messages[selected];
        if (!item) {
          return i.reply({ content: 'That draft entry no longer exists.', flags: MessageFlags.Ephemeral });
        }

        customEditOrigins.set(key, selected);
        return i.showModal(
          customModal('legacy_custom_modal_edit', {
            ...item,
            trigger: selected
          })
        );
      }

      if (i.customId === 'legacy_custom_pick_delete') {
        if (!messages[selected]) {
          return i.reply({ content: 'That draft entry no longer exists.', flags: MessageFlags.Ephemeral });
        }

        delete messages[selected];

        return i.update({
          content: `Removed **${selected}** from this draft. Click Save Changes to apply it.`,
          embeds: [customPanel(messages)],
          components: customButtons(messages)
        });
      }
    }

    if (i.isModalSubmit()) {
      const trigger = normalizeTrigger(i.fields.getTextInputValue('trigger'));
      const title = i.fields.getTextInputValue('title').trim();
      const body = i.fields.getTextInputValue('body').trim();
      const color = i.fields.getTextInputValue('color').trim().replace(/^#/, '');

      if (!validTrigger(trigger)) {
        return i.reply({
          content: 'Enter a trigger word or sentence up to 100 characters. It must include a letter or number.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!title || !body || !/^[0-9a-f]{6}$/i.test(color)) {
        return i.reply({
          content: 'Enter a title, message and valid six-digit HEX color.',
          flags: MessageFlags.Ephemeral
        });
      }

      let oldTrigger = null;

      if (i.customId === 'legacy_custom_modal_edit') {
        oldTrigger = customEditOrigins.get(key) || null;
        customEditOrigins.delete(key);
      }

      if (Object.hasOwn(messages, trigger) && trigger !== oldTrigger) {
        return i.reply({
          content: `The trigger **${trigger}** already exists. Choose a different one.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (!oldTrigger && Object.keys(messages).length >= 25) {
        return i.reply({
          content: 'This server has reached the 25 auto-reply limit.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (oldTrigger && oldTrigger !== trigger) {
        delete messages[oldTrigger];
      }

      setAutoReply(messages, trigger, { trigger, title, body, color: color.toUpperCase() });

      return i.reply({
        content: `Draft updated for **${trigger}**. Click **Save Changes** in the autoresponder panel to activate it.`,
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    console.error('Custom message interaction failed:', error);

    const payload = {
      content: 'Could not process that action. Try `/autoresponder panel` again.',
      flags: MessageFlags.Ephemeral
    };

    if (i.deferred || i.replied) {
      return i.followUp(payload).catch(() => {});
    }

    return i.reply(payload).catch(() => {});
  }
});

function triggerMatches(content, trigger) {
  const escaped = trigger
    .split(/\s+/u)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
    'iu'
  );

  return pattern.test(content);
}

// Reply when a complete trigger word or phrase appears in a message.

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const matches = Object.entries(customMessages[message.guild.id] || {})
    .sort(([left], [right]) => right.length - left.length)
    .find(([trigger]) => triggerMatches(message.content, trigger));

  if (!matches) return;
  const [, item] = matches;

  try {
    await message.channel.send({ embeds: [customEmbed(item)] });
  } catch (error) {
    console.error('Could not send keyword response:', error.message);
  }
});

// Start the Discord bot.

client.login(token).catch(error => {
  console.error('Discord login failed:', error);
  server.close();
  process.exitCode = 1;
});
