
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
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
  return i.reply({ content: message, ephemeral: true });
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
    return i.followUp({ content: message, ephemeral: true }).catch(() => {});
  }

  return i.reply({ content: message, ephemeral: true }).catch(() => {});
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

function saveCustomMessages() {
  const tempFile = `${customFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(customMessages, null, 2));
  fs.renameSync(tempFile, customFile);
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
  const hex = /^[0-9a-f]{6}$/i.test(item.color || '')
    ? item.color
    : '22C7D6';

  return new EmbedBuilder()
    .setColor(parseInt(hex, 16))
    .setTitle(item.title)
    .setDescription(item.body)
    .setFooter({ text: 'LEGACY MC • Server Information' })
    .setTimestamp();
}

function customPanel(messages) {
  const entries = Object.entries(messages);

  const description = entries.length
    ? entries.map(([key, item]) => `• **${key}** — ${item.title}`).join('\n')
    : 'No saved messages in this draft. Select Add Message to create one.';

  return new EmbedBuilder()
    .setColor(0x22c7d6)
    .setTitle('LEGACY MC | Custom Message Sender')
    .setDescription(description)
    .setFooter({ text: 'Save your changes to activate keyword replies.' });
}

function customButtons(messages) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('legacy_custom_add')
        .setLabel('Add Message')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('legacy_custom_edit')
        .setLabel('Edit Message')
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
          .setLabel('Delete Message')
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
      .setPlaceholder('Choose a message')
      .addOptions(entries.map(([key, item]) => ({
        label: key.slice(0, 100),
        description: (item.title || 'Custom message').slice(0, 100),
        value: key
      })))
  );
}

function customModal(customId, item = {}) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(item.trigger ? 'Edit Custom Message' : 'Add Custom Message');

  const trigger = new TextInputBuilder()
    .setCustomId('trigger')
    .setLabel('Keyword, e.g. ip')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(32)
    .setRequired(true)
    .setValue(item.trigger || '');

  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Embed title')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(true)
    .setValue(item.title || 'LEGACY MC Server Information');

  const body = new TextInputBuilder()
    .setCustomId('body')
    .setLabel('Embed message')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(3500)
    .setRequired(true)
    .setValue(item.body || 'Java Edition: paid3.skilloraclouds.com:20004\nBedrock Edition: paid3.skilloraclouds.com\nPort: 20004');

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
    if (command === 'custommsgsender') {
      if (!isAdmin(i)) return deny(i);
      if (!i.guildId) return deny(i, 'Use this command inside a server.');

      const messages = getDraft(i);
      return i.reply({
        embeds: [customPanel(messages)],
        components: customButtons(messages),
        ephemeral: true
      });
    }

    if (command === 'custommsg') {
      if (!isAdmin(i)) return deny(i);

      const channel = i.options.getChannel('channel');
      const title = i.options.getString('title');
      const message = i.options.getString('message');
      const color = i.options.getString('color') || '#5865F2';

      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        return i.reply({ content: 'Invalid color. Example: #5865F2', ephemeral: true });
      }

      if (!channel || channel.type !== ChannelType.GuildText) {
        return i.reply({ content: 'Select a server text channel.', ephemeral: true });
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

      return i.reply({ content: `Custom embed sent to ${channel}.`, ephemeral: true });
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
          { name: 'Custom embeds', value: '`/custommsg` · `/custommsgsender`' }
        );

      return i.reply({ embeds: [embed], ephemeral: true });
    }

    if (command === 'announce') {
      if (!isAdmin(i)) return deny(i);

      const message = getString(i, 'message');
      if (!message?.trim() || message.length > 1000) {
        return i.reply({ content: 'Announcement must be 1–1000 characters.', ephemeral: true });
      }

      await i.deferReply({ ephemeral: true });

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
        return i.reply({ content: 'Enter the six-digit code from Minecraft `/discordlink`.', ephemeral: true });
      }

      const result = await api('/v1/links/verify', 'POST', {
        code,
        discordId: i.user.id
      });

      return i.reply({
        content: `Your Minecraft account **${result.link.username}** is now linked.`,
        ephemeral: true
      });
    }

    if (command === 'mineunlink') {
      const account = linkedAccount(i.user.id);

      if (!account) {
        return i.reply({ content: 'You do not have a linked Minecraft account.', ephemeral: true });
      }

      await api(`/v1/links/${i.user.id}`, 'DELETE');
      return i.reply({ content: 'Your Minecraft account has been unlinked.', ephemeral: true });
    }

    if (command === 'mineaccount') {
      const account = linkedAccount(i.user.id);

      if (!account) {
        return i.reply({ content: 'No account linked. Use `/minelink`.', ephemeral: true });
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
        ephemeral: true
      });
    }

    if (command === 'mineleaderboard') {
      const type = getString(i, 'type') || 'kills';
      if (!['kills', 'deaths', 'money', 'playtime', 'coins'].includes(type)) {
        return i.reply({ content: 'Invalid leaderboard type.', ephemeral: true });
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
          ephemeral: true
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
        return i.reply({ content: 'Link your Minecraft account first using `/minelink`.', ephemeral: true });
      }

      return i.reply({
        content: `**${account.username}** has **${formatNumber(coins.get(account.uuid))} coins**.`,
        ephemeral: true
      });
    }

    if (['addcoin', 'takecoin', 'givecoins', 'takecoins'].includes(command)) {
      if (!isAdmin(i)) return deny(i);

      const playerName = getString(i, 'player', 'username');
      const amount = getInteger(i, 'amount');
      const reason = getString(i, 'reason');

      if (!playerName || !amount || amount < 1 || !reason?.trim()) {
        return i.reply({ content: 'Provide a player, positive amount and reason.', ephemeral: true });
      }

      const player = findPlayer(playerName);
      if (!player) {
        return i.reply({ content: `Could not find Minecraft player **${playerName}**.`, ephemeral: true });
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
        ephemeral: true
      });
    }

    if (['minekick', 'mineban', 'minetempban', 'mineunban'].includes(command)) {
      if (!isModerator(i)) return deny(i);

      const player = getString(i, 'player', 'username');
      const reason = getString(i, 'reason') || 'No reason provided';
      const hours = getInteger(i, 'hours');

      if (!player) {
        return i.reply({ content: 'Provide a Minecraft player name.', ephemeral: true });
      }

      if (command === 'minetempban' && (!hours || hours < 1)) {
        return i.reply({ content: 'Provide a positive ban duration.', ephemeral: true });
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
        ephemeral: true
      });
    }

    if (command === 'minestatus') {
      const serverInfo = players.get('__server__');

      if (!serverInfo?.heartbeat) {
        return i.reply({ content: 'Waiting for a Minecraft plugin heartbeat.', ephemeral: true });
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
      ephemeral: true
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
    return i.reply({ content: 'Use this inside a server.', ephemeral: true }).catch(() => {});
  }

  if (!isAdmin(i)) {
    return i.reply({ content: 'Only administrators can manage custom messages.', ephemeral: true }).catch(() => {});
  }

  try {
    const messages = getDraft(i);
    const key = draftKey(i);

    if (i.isButton()) {
      if (i.customId === 'legacy_custom_add') {
        return i.showModal(customModal('legacy_custom_modal_add'));
      }

      if (i.customId === 'legacy_custom_edit' || i.customId === 'legacy_custom_delete') {
        if (!Object.keys(messages).length) {
          return i.reply({ content: 'There are no messages to select yet.', ephemeral: true });
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
          return i.reply({ content: 'That draft entry no longer exists.', ephemeral: true });
        }

        return i.showModal(
          customModal(`legacy_custom_modal_edit:${encodeURIComponent(selected)}`, {
            ...item,
            trigger: selected
          })
        );
      }

      if (i.customId === 'legacy_custom_pick_delete') {
        if (!messages[selected]) {
          return i.reply({ content: 'That draft entry no longer exists.', ephemeral: true });
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
      const trigger = i.fields.getTextInputValue('trigger').trim().toLowerCase();
      const title = i.fields.getTextInputValue('title').trim();
      const body = i.fields.getTextInputValue('body').trim();
      const color = i.fields.getTextInputValue('color').trim().replace(/^#/, '');

      if (!/^[a-z0-9_-]{1,32}$/.test(trigger)) {
        return i.reply({
          content: 'Keyword must be 1–32 characters and contain only letters, numbers, underscores or hyphens.',
          ephemeral: true
        });
      }

      if (!title || !body || !/^[0-9a-f]{6}$/i.test(color)) {
        return i.reply({
          content: 'Enter a title, message and valid six-digit HEX color.',
          ephemeral: true
        });
      }

      let oldTrigger = null;

      if (i.customId.startsWith('legacy_custom_modal_edit:')) {
        oldTrigger = decodeURIComponent(i.customId.slice('legacy_custom_modal_edit:'.length));
      }

      if (messages[trigger] && trigger !== oldTrigger) {
        return i.reply({
          content: `The keyword **${trigger}** already exists. Choose a different keyword.`,
          ephemeral: true
        });
      }

      if (oldTrigger && oldTrigger !== trigger) {
        delete messages[oldTrigger];
      }

      messages[trigger] = { trigger, title, body, color: color.toUpperCase() };

      return i.reply({
        content: `Draft updated for keyword **${trigger}**. Run \`/custommsgsender\` again and click **Save Changes** to activate it.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Custom message interaction failed:', error);

    const payload = {
      content: 'Could not process that action. Try opening `/custommsgsender` again.',
      ephemeral: true
    };

    if (i.deferred || i.replied) {
      return i.followUp(payload).catch(() => {});
    }

    return i.reply(payload).catch(() => {});
  }
});

// Respond only when a message exactly matches a saved keyword.

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const trigger = message.content.trim().toLowerCase();
  if (!trigger || trigger.length > 32) return;

  const item = customMessages[message.guild.id]?.[trigger];
  if (!item) return;

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
