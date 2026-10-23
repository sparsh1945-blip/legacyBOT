
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

function getGuildAutoReplies(guildId, replyType) {
  return Object.fromEntries(
    Object.entries(customMessages[guildId] || {})
      .filter(([, item]) => (item.replyType || 'embed') === replyType)
  );
}

function saveGuildAutoReplies(guildId, messages, replyType) {
  const current = customMessages[guildId] || {};
  const merged = Object.fromEntries(
    Object.entries(current)
      .filter(([, item]) => (item.replyType || 'embed') !== replyType)
  );

  for (const [trigger, item] of Object.entries(messages)) {
    setAutoReply(merged, trigger, { ...item, replyType });
  }

  customMessages[guildId] = merged;
  saveCustomMessages();

  const draftPrefix = `${guildId}:`;
  for (const key of customDrafts.keys()) {
    if (key.startsWith(draftPrefix) && key.endsWith(`:${replyType}`)) {
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

const AUTO_REPLY_MATCH_MODES = new Set(['contains', 'exact', 'starts_with', 'ends_with']);
function matchModeLabel(mode) {
  return ({
    contains: 'Contains phrase',
    exact: 'Exact message',
    starts_with: 'Starts with',
    ends_with: 'Ends with'
  })[mode] || 'Contains phrase';
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

function draftKey(i, replyType = 'embed') {
  return `${i.guildId}:${i.user.id}:${replyType}`;
}

function getDraft(i, replyType = 'embed') {
  const key = draftKey(i, replyType);

  if (!customDrafts.has(key)) {
    customDrafts.set(
      key,
      structuredClone(getGuildAutoReplies(i.guildId, replyType))
    );
  }

  return customDrafts.get(key);
}

function customEmbed(item) {
  const hex = normalizeHexColor(item.color) || '22C7D6';
  const reply = item.reply || item.body || 'This auto-reply has no message yet.';
  const title = (item.title || '').trim();
  const isLegacyTitle = /^LEGACY MC\s*[•·-]\s*AUTO-REPLY$/iu.test(title);

  const embed = new EmbedBuilder()
    .setColor(parseInt(hex, 16))
    .setDescription(reply);

  if (title && !isLegacyTitle) embed.setTitle(title);
  return embed;
}

function autoReplyPayload(item) {
  const reply = item.reply || item.body || 'This auto-reply has no message yet.';

  if (item.replyType === 'text') {
    return { content: reply, allowedMentions: { parse: [] } };
  }

  return { embeds: [customEmbed(item)] };
}

function customPanel(messages, replyType) {
  const entries = Object.entries(messages);

  const description = entries.length
    ? entries.map(([key, item]) => `• **${key.slice(0, 80)}** — ${(item.reply || item.body || item.title || 'Reply').replace(/\s+/gu, ' ').slice(0, 40)}`).join('\n')
    : 'No auto-replies in this draft. Select Add Reply to create one.';

  return new EmbedBuilder()
    .setColor(0x22c7d6)
    .setTitle(replyType === 'text' ? 'Auto-Responder · Normal Replies' : 'Auto-Responder · Embedded Replies')
    .setDescription(description)
    .setFooter({ text: 'Save changes to activate your word and phrase replies.' })
    .setTimestamp();
}

function customButtons(messages, replyType) {
  const id = action => `legacy_custom_${replyType}_${action}`;
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(id('add'))
        .setLabel('Add Reply')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(id('edit'))
        .setLabel('Edit Reply')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(id('save'))
        .setLabel('Save Changes')
        .setStyle(ButtonStyle.Success)
    )
  ];

  if (Object.keys(messages).length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(id('delete'))
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

function customModal(customId, item = {}, replyType = 'embed') {
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

  const body = new TextInputBuilder()
    .setCustomId('body')
    .setLabel(replyType === 'text' ? 'Normal message' : 'Embed reply text')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(replyType === 'text' ? 2000 : 3500)
    .setRequired(true)
    .setValue(item.body || item.reply || 'Your automatic reply goes here.');

  modal.addComponents(new ActionRowBuilder().addComponents(trigger));

  if (replyType === 'embed') {
    const title = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Embed title')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(false);
    if (item.title) title.setValue(item.title);

    const color = new TextInputBuilder()
      .setCustomId('color')
      .setLabel('HEX color without #, e.g. 22C7D6')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(6)
      .setRequired(true)
      .setValue(item.color || '22C7D6');

    modal.addComponents(new ActionRowBuilder().addComponents(title));
    modal.addComponents(new ActionRowBuilder().addComponents(body));
    modal.addComponents(new ActionRowBuilder().addComponents(color));
  } else {
    modal.addComponents(new ActionRowBuilder().addComponents(body));
  }

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
    if (command === 'autoresponder' || command === 'autoresponderembed') {
      if (!isAdmin(i)) return deny(i);
      if (!i.guildId) return deny(i, 'Use this command inside a server.');

      const replyType = command === 'autoresponderembed' ? 'embed' : 'text';
      const commandRoot = `/${command}`;
      const action = i.options.getSubcommand(false);
      if (!action) {
        return i.reply({
          embeds: [autoResponderNotice(
            replyType === 'text' ? 'Auto-Responder · Normal Replies' : 'Auto-Responder · Embedded Replies',
            `Choose an action below: **Add** opens a form, **Manage** lets you edit or remove replies, and **List** shows what is configured. You can also use \`${commandRoot} add\` and the other subcommands from Discord’s command picker.`
          )],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`legacy_custom_${replyType}_start_add`)
                .setLabel('Add reply')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`legacy_custom_${replyType}_open_manager`)
                .setLabel('Manage replies')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`legacy_custom_${replyType}_show_list`)
                .setLabel('List replies')
                .setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
      const guildMessages = getGuildAutoReplies(i.guildId, replyType);

      if (action === 'panel') {
        const messages = getDraft(i, replyType);
        return i.reply({
          embeds: [customPanel(messages, replyType)],
          components: customButtons(messages, replyType),
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'add') {
        const trigger = normalizeTrigger(i.options.getString('trigger'));
        const reply = i.options.getString('reply').trim();
        const matchMode = i.options.getString('matchmode') || 'contains';
        const title = replyType === 'embed'
          ? i.options.getString('title')?.trim() || null
          : null;
        const color = replyType === 'embed'
          ? normalizeHexColor(i.options.getString('color'))
          : null;

        if (!validTrigger(trigger) || !reply || !AUTO_REPLY_MATCH_MODES.has(matchMode)) {
          return i.reply({
            embeds: [autoResponderNotice(
              '⚠️ Check Your Auto-Reply',
              'Enter a trigger word or phrase, a non-empty reply, and a supported match mode.',
              0xe74c3c
            )],
            flags: MessageFlags.Ephemeral
          });
        }

        if (replyType === 'embed' && !color) {
          return i.reply({
            embeds: [autoResponderNotice('🎨 Invalid HEX Color', 'Use six HEX digits, such as `#22C7D6`.', 0xe74c3c)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (Object.hasOwn(customMessages[i.guildId] || {}, trigger)) {
          return i.reply({
            embeds: [autoResponderNotice('⚠️ Trigger Already Exists', `**${trigger}** is already configured. Use the matching autoresponder command to edit it.`, 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (Object.keys(customMessages[i.guildId] || {}).length >= 25) {
          return i.reply({
            embeds: [autoResponderNotice('📚 Auto-Reply Limit Reached', 'This server can have up to **25** auto-replies.', 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        setAutoReply(guildMessages, trigger, { trigger, reply, title, color, matchMode, replyType });
        saveGuildAutoReplies(i.guildId, guildMessages, replyType);

        return i.reply({
          embeds: [autoResponderNotice(
            '✅ Auto-Reply Added',
            `**Trigger:** \`${trigger}\`\n**Match mode:** ${matchModeLabel(matchMode)}\n**Reply:** ${reply.slice(0, 500)}${replyType === 'embed' ? `\n**Appearance:** ${title} · \`#${color}\`` : ''}\n\nIt is active now.`,
            color ? parseInt(color, 16) : 0x22c7d6
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

        const title = replyType === 'embed'
          ? i.options.getString('title')?.trim() || existing.title || null
          : existing.title;
        const color = replyType === 'embed'
          ? normalizeHexColor(i.options.getString('color'), existing.color || '22C7D6')
          : existing.color;

        if (replyType === 'embed' && !color) {
          return i.reply({
            embeds: [autoResponderNotice('⚠️ Invalid Embed Color', 'Use a six-digit HEX color such as `#22C7D6`.', 0xe74c3c)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (trigger !== currentTrigger && Object.hasOwn(customMessages[i.guildId] || {}, trigger)) {
          return i.reply({
            embeds: [autoResponderNotice('⚠️ Trigger Already Exists', `**${trigger}** is already configured.`, 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        delete guildMessages[currentTrigger];
        setAutoReply(guildMessages, trigger, {
          ...existing,
          trigger,
          reply,
          body: reply,
          title,
          color,
          replyType,
          matchMode: existing.matchMode || 'contains'
        });
        saveGuildAutoReplies(i.guildId, guildMessages, replyType);

        return i.reply({
          embeds: [autoResponderNotice('✏️ Auto-Reply Updated', `**Trigger:** \`${trigger}\`\n**Reply:** ${reply.slice(0, 500)}${replyType === 'embed' ? `\n**Appearance:** ${title} · \`#${color}\`` : ''}`, color ? parseInt(color, 16) : 0x22c7d6)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'editreply') {
        const trigger = normalizeTrigger(i.options.getString('trigger'));
        const reply = i.options.getString('reply').trim();
        const existing = Object.hasOwn(guildMessages, trigger)
          ? guildMessages[trigger]
          : null;

        if (!existing) {
          return i.reply({ content: `No auto-reply was found for **${trigger}**.`, flags: MessageFlags.Ephemeral });
        }

        if (!reply) {
          return i.reply({ content: 'Enter a non-empty reply.', flags: MessageFlags.Ephemeral });
        }

        setAutoReply(guildMessages, trigger, { ...existing, trigger, reply, body: reply, replyType });
        saveGuildAutoReplies(i.guildId, guildMessages, replyType);

        return i.reply({
          embeds: [autoResponderNotice(
            '✏️ Auto-Reply Updated',
            `**Trigger:** \`${trigger}\`\n**Reply:** ${reply.slice(0, 1000)}`,
            existing.color ? parseInt(normalizeHexColor(existing.color) || '22C7D6', 16) : 0x22c7d6
          )],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'editmatchmode') {
        const trigger = normalizeTrigger(i.options.getString('trigger'));
        const matchMode = i.options.getString('mode');
        const existing = Object.hasOwn(guildMessages, trigger)
          ? guildMessages[trigger]
          : null;

        if (!existing) {
          return i.reply({ content: `No auto-reply was found for **${trigger}**.`, flags: MessageFlags.Ephemeral });
        }

        if (!AUTO_REPLY_MATCH_MODES.has(matchMode)) {
          return i.reply({ content: 'Choose a supported match mode.', flags: MessageFlags.Ephemeral });
        }

        setAutoReply(guildMessages, trigger, { ...existing, trigger, matchMode });
        saveGuildAutoReplies(i.guildId, guildMessages, replyType);

        return i.reply({
          embeds: [autoResponderNotice(
            '🎯 Match Mode Updated',
            `**Trigger:** \`${trigger}\`\n**Match mode:** ${matchModeLabel(matchMode)}\n\nThis setting is active now.`,
            parseInt(normalizeHexColor(existing.color) || '22C7D6', 16)
          )],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'delete' || action === 'remove') {
        const trigger = normalizeTrigger(i.options.getString('trigger'));

        if (!Object.hasOwn(guildMessages, trigger)) {
          return i.reply({
            embeds: [autoResponderNotice('🔎 Auto-Reply Not Found', `No auto-reply was found for **${trigger}**.`, 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        delete guildMessages[trigger];
        saveGuildAutoReplies(i.guildId, guildMessages, replyType);
        return i.reply({
          embeds: [autoResponderNotice('🗑️ Auto-Reply Deleted', `The trigger **${trigger}** has been removed.`, 0xe74c3c)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'show' || action === 'showraw') {
        const trigger = normalizeTrigger(i.options.getString('trigger'));
        const item = Object.hasOwn(guildMessages, trigger)
          ? guildMessages[trigger]
          : null;

        if (!item) {
          return i.reply({
            embeds: [autoResponderNotice('🔎 Auto-Reply Not Found', `No auto-reply was found for **${trigger}**.`, 0xf39c12)],
            flags: MessageFlags.Ephemeral
          });
        }

        const reply = item.reply || item.body || 'This auto-reply has no message yet.';
        if (action === 'showraw') {
          return i.reply({ content: reply.slice(0, 2000), flags: MessageFlags.Ephemeral });
        }

        return i.reply({
          ...autoReplyPayload(item),
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'list') {
        const entries = Object.entries(guildMessages);
        const embed = autoResponderNotice(
          replyType === 'text' ? 'Normal Auto-Reply Library' : 'Embedded Auto-Reply Library',
          entries.length
            ? `**${entries.length}/25** replies are active. Each reply uses its selected match mode.`
            : `No auto-replies are configured yet. Use \`${commandRoot} add\` to create one.`
        );

        for (const [trigger, item] of entries) {
          const reply = (item.reply || item.body || 'No reply text').replace(/\s+/gu, ' ');
          embed.addFields({
            name: `🔑 ${trigger}`.slice(0, 256),
            value: `🎯 ${matchModeLabel(item.matchMode || 'contains')}\n💬 ${reply.slice(0, 40)}${reply.length > 40 ? '…' : ''}${replyType === 'embed' ? `\n🎨 \`#${normalizeHexColor(item.color) || '22C7D6'}\`` : ''}`,
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
          .setDescription(replyType === 'text'
            ? 'Build normal text replies for words or phrases your community uses.'
            : 'Build embedded replies with a custom title and message.')
          .addFields(
            {
              name: '➕ Add a reply',
              value: `\`${commandRoot} add\`\n**Required:** \`trigger\`, \`reply\`\n**Optional:** \`matchmode\`${replyType === 'embed' ? ', `title`, `color`' : ''}`
            },
            {
              name: '✏️ Edit a reply',
              value: `\`${commandRoot} editreply\` changes the reply. \`${commandRoot} edit\` can also rename the trigger.${replyType === 'embed' ? ' It can also change the title and color.' : ''}`
            },
            {
              name: '🧰 More options',
              value: `\`${commandRoot} editmatchmode\` changes matching.\n\`${commandRoot} remove\` deletes a trigger.\n\`${commandRoot} show\` and \`showraw\` inspect a reply.\n\`${commandRoot} list\` lists replies; \`panel\` opens the editor.`
            },
            {
              name: replyType === 'embed' ? '🎨 Example' : '💬 Example',
              value: `\`trigger: server ip\`\n\`reply: Java: play.example.net\`${replyType === 'embed' ? '\n`title: Join our server`\n`color: #22C7D6`' : ''}`
            },
            {
              name: '💡 Trigger matching',
              value: '`contains` (default) matches a complete word or phrase; `exact` requires the whole message; `starts_with` and `ends_with` require the trigger at that edge. Matching ignores letter case.'
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
          { name: 'Custom embeds and auto-replies', value: '`/custommsg` · `/autoresponder add/edit/list/remove` for normal replies · `/autoresponderembed add/edit/list/remove` for embedded replies · use each command’s `show`, `showraw`, `editreply`, `editmatchmode`, `help`, and `panel` subcommands as needed.' }
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

function parseCustomAction(customId) {
  const match = customId.match(/^legacy_custom_(?:(embed|text)_)?(.+)$/);
  return { replyType: match?.[1] || 'embed', action: match?.[2] || '' };
}

function customActionId(replyType, action) {
  return `legacy_custom_${replyType}_${action}`;
}

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
    const { replyType, action } = parseCustomAction(i.customId);
    const messages = getDraft(i, replyType);
    const key = draftKey(i, replyType);

    if (i.isButton()) {
      if (action === 'start_add') {
        customEditOrigins.delete(key);
        return i.showModal(customModal(customActionId(replyType, 'modal_quick_add'), {}, replyType));
      }

      if (action === 'open_manager') {
        return i.update({
          content: null,
          embeds: [customPanel(messages, replyType)],
          components: customButtons(messages, replyType)
        });
      }

      if (action === 'show_list') {
        const saved = getGuildAutoReplies(i.guildId, replyType);
        return i.update({
          content: null,
          embeds: [customPanel(saved, replyType)],
          components: []
        });
      }

      if (action === 'add') {
        customEditOrigins.delete(key);
        return i.showModal(customModal(customActionId(replyType, 'modal_add'), {}, replyType));
      }

      if (action === 'edit' || action === 'delete') {
        if (!Object.keys(messages).length) {
          return i.reply({ content: 'There are no messages to select yet.', flags: MessageFlags.Ephemeral });
        }

        const deleting = action === 'delete';
        return i.update({
          embeds: [customPanel(messages, replyType)],
          components: [
            customSelect(messages, customActionId(replyType, deleting ? 'pick_delete' : 'pick_edit')),
            ...customButtons(messages, replyType)
          ]
        });
      }

      if (action === 'save') {
        saveGuildAutoReplies(i.guildId, messages, replyType);
        const saved = getGuildAutoReplies(i.guildId, replyType);

        return i.update({
          embeds: [customPanel(saved, replyType)],
          components: customButtons(saved, replyType)
        });
      }
    }

    if (i.isStringSelectMenu()) {
      const selected = i.values[0];

      if (action === 'pick_edit') {
        const item = messages[selected];
        if (!item) {
          return i.reply({ content: 'That draft entry no longer exists.', flags: MessageFlags.Ephemeral });
        }

        customEditOrigins.set(key, selected);
        return i.showModal(
          customModal(customActionId(replyType, 'modal_edit'), {
            ...item,
            trigger: selected
          }, replyType)
        );
      }

      if (action === 'pick_delete') {
        if (!messages[selected]) {
          return i.reply({ content: 'That draft entry no longer exists.', flags: MessageFlags.Ephemeral });
        }

        delete messages[selected];

        return i.update({
          content: `Removed **${selected}** from this draft. Click Save Changes to apply it.`,
          embeds: [customPanel(messages, replyType)],
          components: customButtons(messages, replyType)
        });
      }
    }

    if (i.isModalSubmit()) {
      const isQuickAdd = action === 'modal_quick_add';
      const isEdit = action === 'modal_edit';
      const modalMessages = isQuickAdd
        ? structuredClone(getGuildAutoReplies(i.guildId, replyType))
        : messages;
      const trigger = normalizeTrigger(i.fields.getTextInputValue('trigger'));
      const body = i.fields.getTextInputValue('body').trim();
      const title = replyType === 'embed' ? i.fields.getTextInputValue('title').trim() || null : null;
      const color = replyType === 'embed'
        ? i.fields.getTextInputValue('color').trim().replace(/^#/, '')
        : null;

      if (!validTrigger(trigger)) {
        return i.reply({
          content: 'Enter a trigger word or sentence up to 100 characters. It must include a letter or number.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!body || (replyType === 'embed' && !/^[0-9a-f]{6}$/i.test(color))) {
        return i.reply({
          content: replyType === 'embed'
            ? 'Enter reply text and a valid six-digit HEX color. The title is optional.'
            : 'Enter a non-empty normal message up to 2,000 characters.',
          flags: MessageFlags.Ephemeral
        });
      }

      let oldTrigger = null;

      if (isEdit) {
        oldTrigger = customEditOrigins.get(key) || null;
        customEditOrigins.delete(key);
      }

      const matchMode = oldTrigger
        ? modalMessages[oldTrigger]?.matchMode || 'contains'
        : 'contains';

      if (Object.hasOwn(customMessages[i.guildId] || {}, trigger) && trigger !== oldTrigger) {
        return i.reply({
          content: `The trigger **${trigger}** already exists. Choose a different one.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (!oldTrigger && Object.keys(customMessages[i.guildId] || {}).length >= 25) {
        return i.reply({
          content: 'This server has reached the 25 auto-reply limit.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (oldTrigger && oldTrigger !== trigger) {
        delete modalMessages[oldTrigger];
      }

      setAutoReply(modalMessages, trigger, {
        trigger,
        title,
        body,
        color: color?.toUpperCase() || null,
        replyType,
        matchMode
      });

      if (isQuickAdd) {
        saveGuildAutoReplies(i.guildId, modalMessages, replyType);
        return i.reply({
          content: `Added **${trigger}** and activated its auto-reply.`,
          flags: MessageFlags.Ephemeral
        });
      }

      return i.reply({
        content: `Draft updated for **${trigger}**. Click **Save Changes** in the autoresponder panel to activate it.`,
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    console.error('Custom message interaction failed:', error);

    const payload = {
      content: 'Could not process that action. Reopen the matching autoresponder panel and try again.',
      flags: MessageFlags.Ephemeral
    };

    if (i.deferred || i.replied) {
      return i.followUp(payload).catch(() => {});
    }

    return i.reply(payload).catch(() => {});
  }
});

function triggerMatches(content, trigger, matchMode = 'contains') {
  const normalizedTrigger = normalizeTrigger(trigger);

  if (matchMode === 'exact') {
    return content.trim().replace(/\s+/gu, ' ').toLowerCase() === normalizedTrigger;
  }

  const escaped = trigger
    .split(/\s+/u)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');

  if (matchMode === 'starts_with') {
    return new RegExp(`^${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(content.trimStart());
  }

  if (matchMode === 'ends_with') {
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}$`, 'iu').test(content.trimEnd());
  }

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
    .find(([trigger, item]) => triggerMatches(message.content, trigger, item.matchMode || 'contains'));

  if (!matches) return;
  const [, item] = matches;

  try {
    await message.channel.send(autoReplyPayload(item));
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
