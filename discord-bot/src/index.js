
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
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
const communityFile = path.join(customDir, 'community-settings.json');

fs.mkdirSync(customDir, { recursive: true });

function loadCustomMessages() {
  try {
    const data = JSON.parse(fs.readFileSync(customFile, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function loadCommunitySettings() {
  try {
    const data = JSON.parse(fs.readFileSync(communityFile, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

let communitySettings = loadCommunitySettings();

function saveCommunitySettings() {
  const tempFile = `${communityFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(communitySettings, null, 2));
  fs.renameSync(tempFile, communityFile);
}

function getGuildCommunity(guildId) {
  if (!communitySettings[guildId] || typeof communitySettings[guildId] !== 'object') {
    communitySettings[guildId] = {};
  }

  const settings = communitySettings[guildId];
  if (!settings.invites || typeof settings.invites !== 'object') {
    settings.invites = { logChannelId: null, totals: {}, invitees: {}, unattributedJoins: 0 };
  }
  settings.invites.totals ||= {};
  settings.invites.invitees ||= {};
  settings.invites.unattributedJoins ||= 0;
  return settings;
}

function getInviteCounts(guildId, inviterId) {
  const totals = getGuildCommunity(guildId).invites.totals[inviterId] || {};
  const joins = Number(totals.joins || 0);
  const leaves = Number(totals.leaves || 0);
  return { joins, leaves, active: Math.max(0, joins - leaves) };
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

const inviteSnapshots = new Map();
const inviteQueues = new Map();
const pendingInviteUses = new Map();

function claimPendingInvite(guildId) {
  const cutoff = Date.now() - 30_000;
  const pending = (pendingInviteUses.get(guildId) || [])
    .filter(item => item.detectedAt >= cutoff);
  const attribution = pending.shift() || null;

  if (pending.length) pendingInviteUses.set(guildId, pending);
  else pendingInviteUses.delete(guildId);

  return attribution;
}

async function readInviteSnapshot(guild) {
  const invites = await guild.invites.fetch({ cache: false });
  const inviteList = [...invites.values()];
  const inviteDetails = new Map(inviteList.map(invite => [invite.code, invite]));
  const uses = new Map(
    inviteList.map(invite => [invite.code, Number(invite.uses || 0)])
  );

  let vanityUses = null;
  if (guild.features.includes('VANITY_URL')) {
    try {
      vanityUses = Number((await guild.fetchVanityData()).uses || 0);
    } catch {
      // Vanity URL tracking is optional; regular invite attribution still works.
    }
  }

  return {
    uses,
    inviteDetails,
    vanityUses,
    metadataAvailable: inviteList.every(invite => typeof invite.uses === 'number')
  };
}

async function cacheGuildInvites(guild) {
  try {
    const snapshot = await readInviteSnapshot(guild);
    inviteSnapshots.set(guild.id, snapshot);
    if (!snapshot.metadataAvailable) {
      console.warn(`Invite usage metadata is unavailable in ${guild.name}; grant the bot Manage Server to enable attribution.`);
    }
  } catch (error) {
    console.warn(`Invite tracking is unavailable in ${guild.name}: ${error.message}`);
  }
}

async function identifyUsedInvite(guild) {
  const previous = inviteSnapshots.get(guild.id);
  let current;

  try {
    current = await readInviteSnapshot(guild);
  } catch (error) {
    console.warn(`Could not read invites in ${guild.name}: ${error.message}`);
    return claimPendingInvite(guild.id) || { inviterId: null, code: null, source: 'unknown' };
  }

  inviteSnapshots.set(guild.id, current);
  if (!current.metadataAvailable || (previous && !previous.metadataAvailable)) {
    return claimPendingInvite(guild.id) || { inviterId: null, code: null, source: 'unknown' };
  }

  if (previous) {
    const cutoff = Date.now() - 30_000;
    const pending = (pendingInviteUses.get(guild.id) || [])
      .filter(item => item.detectedAt >= cutoff);

    for (const [code, uses] of current.uses) {
      const increase = Math.max(0, uses - (previous.uses.get(code) || 0));
      const invite = current.inviteDetails.get(code);
      for (let index = 0; index < increase; index += 1) {
        pending.push({
          inviterId: invite?.inviter?.id || null,
          code,
          source: 'invite',
          detectedAt: Date.now()
        });
      }
    }

    const vanityIncrease = current.vanityUses !== null && previous.vanityUses !== null
      ? Math.max(0, current.vanityUses - previous.vanityUses)
      : 0;
    for (let index = 0; index < vanityIncrease; index += 1) {
      pending.push({
        inviterId: null,
        code: guild.vanityURLCode || null,
        source: 'vanity',
        detectedAt: Date.now()
      });
    }

    if (pending.length) pendingInviteUses.set(guild.id, pending);
    else pendingInviteUses.delete(guild.id);
  }

  return claimPendingInvite(guild.id) || { inviterId: null, code: null, source: 'unknown' };
}

function queueInviteTask(guildId, task) {
  const previous = inviteQueues.get(guildId) || Promise.resolve();
  const queued = previous.catch(() => {}).then(task);
  inviteQueues.set(guildId, queued);
  queued.finally(() => {
    if (inviteQueues.get(guildId) === queued) inviteQueues.delete(guildId);
  }).catch(() => {});
  return queued;
}

function inviteDisplay(guildId, inviterId) {
  if (!inviterId) return { joins: 0, leaves: 0, active: 0 };
  return getInviteCounts(guildId, inviterId);
}

function renderMemberTemplate(template, member, settings, inviterId) {
  const counts = inviteDisplay(member.guild.id, inviterId);
  const inviter = inviterId ? `<@${inviterId}>` : 'Unknown';
  const values = {
    username: member.user.username,
    user: member.user.username,
    displayname: member.displayName,
    mention: `<@${member.id}>`,
    server: member.guild.name,
    guild: member.guild.name,
    member_count: String(member.guild.memberCount),
    member_number: String(member.guild.memberCount),
    join_date: (member.joinedAt || new Date()).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: '2-digit'
    }),
    inviter,
    invites: String(counts.joins),
    active_invites: String(counts.active),
    emoji: settings.emoji || '',
    avatar: member.displayAvatarURL({ size: 1024 })
  };

  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template || ''
  );
}

function drawCoverImage(context, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
}

function fitCanvasText(context, text, maxWidth, startSize, minSize = 24) {
  let size = startSize;
  while (size > minSize) {
    context.font = `700 ${size}px Arial, sans-serif`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

async function buildMemberCard(member, settings, inviterId, kind) {
  const width = 1200;
  const height = 650;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const radius = 68;

  context.beginPath();
  context.roundRect(0, 0, width, height, radius);
  context.clip();
  const fallback = context.createLinearGradient(0, 0, width, height);
  fallback.addColorStop(0, '#222b3d');
  fallback.addColorStop(1, '#101116');
  context.fillStyle = fallback;
  context.fillRect(0, 0, width, height);

  if (settings.imageUrl) {
    try {
      const background = await loadImage(settings.imageUrl);
      drawCoverImage(context, background, width, height);
    } catch (error) {
      console.warn('Could not load member card background:', error.message);
    }
  }

  const shade = context.createLinearGradient(0, 0, width, 0);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.56)');
  shade.addColorStop(0.46, 'rgba(0, 0, 0, 0.48)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.63)');
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const defaultHeading = kind === 'welcome' ? 'WELCOME' : 'GOODBYE';
  const heading = renderMemberTemplate(settings.title || defaultHeading, member, settings, inviterId)
    .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, '').trim() || defaultHeading;
  const headingSize = fitCanvasText(context, heading, 610, 43, 25);
  context.font = `500 ${headingSize}px Arial, sans-serif`;
  context.fillStyle = '#ffffff';
  context.fillText(heading, 445, 226, 610);
  context.fillStyle = '#ffffff';
  context.fillRect(445, 261, Math.min(context.measureText(heading).width, 330), 4);

  const displayName = member.displayName || member.user.username;
  const nameSize = fitCanvasText(context, displayName, 690, 76, 32);
  context.font = `700 ${nameSize}px Arial, sans-serif`;
  context.fillStyle = '#ffffff';
  context.fillText(displayName, 445, 350, 690);

  const subline = `${member.guild.name}  •  Member #${member.guild.memberCount}`;
  context.font = '400 30px Arial, sans-serif';
  context.fillStyle = '#f0f0f0';
  context.fillText(subline, 445, 426, 690);

  const avatarSize = 288;
  const avatarX = 112;
  const avatarY = 228;
  context.save();
  context.beginPath();
  context.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  context.clip();
  try {
    const avatar = await loadImage(member.displayAvatarURL({ extension: 'png', size: 512 }));
    context.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
  } catch (error) {
    console.warn('Could not load member card avatar:', error.message);
    context.fillStyle = '#374151';
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = '700 112px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText(displayName.slice(0, 1).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
  }
  context.restore();

  context.beginPath();
  context.roundRect(5, 5, width - 10, height - 10, radius - 5);
  context.lineWidth = 9;
  context.strokeStyle = '#f4f4f5';
  context.stroke();
  return canvas.toBuffer('image/png');
}

async function sendMemberEmbed(member, kind, inviterId = null, { force = false } = {}) {
  const settings = getGuildCommunity(member.guild.id)[kind];
  if (!settings?.channelId || !settings.message || (!force && settings.enabled === false)) return false;

  const channel = member.guild.channels.cache.get(settings.channelId) ||
    await member.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;

  const links = Array.isArray(settings.links)
    ? settings.links.filter(link => typeof link?.label === 'string' && typeof link?.url === 'string')
    : [];
  const content = renderMemberTemplate(settings.message, member, settings, inviterId).slice(0, 2000);
  const payload = {
    embeds: [],
    allowedMentions: { users: [member.id], parse: [] },
    ...(content || settings.pingMember ? {
      content: [settings.pingMember ? `<@${member.id}>` : '', content || ''].filter(Boolean).join('\n').slice(0, 2000)
    } : {}),
    ...(links.length
      ? {
          components: [new ActionRowBuilder().addComponents(
            links.slice(0, 5).map(link =>
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(link.label.slice(0, 80))
                .setURL(link.url)
            )
          )]
        }
      : {})
  };
  const card = await buildMemberCard(member, settings, inviterId, kind);
  const cardName = `${kind}-card.png`;
  payload.embeds = [new EmbedBuilder()
    .setColor(parseInt(normalizeHexColor(settings.color) || '22C7D6', 16))
    .setImage(`attachment://${cardName}`)];
  payload.files = [new AttachmentBuilder(card, { name: cardName })];
  const sent = await channel.send(payload);
  const deleteAfterSeconds = Number(settings.deleteAfterSeconds || 0);
  if (deleteAfterSeconds > 0) {
    const timer = setTimeout(() => sent.delete().catch(() => {}), deleteAfterSeconds * 1000);
    timer.unref?.();
  }
  return true;
}

async function sendInviteLog(member, attribution, inviterId) {
  const channelId = getGuildCommunity(member.guild.id).invites.logChannelId;
  if (!channelId) return;

  const channel = member.guild.channels.cache.get(channelId) ||
    await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return;

  const counts = inviteDisplay(member.guild.id, inviterId);
  const source = attribution.source === 'vanity'
    ? 'the vanity URL'
    : attribution.code
      ? `invite \`${attribution.code}\``
      : 'an unknown invite';
  const inviter = inviterId ? `<@${inviterId}>` : 'Unknown';

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x22c7d6)
      .setTitle('📨 Member joined')
      .setDescription(`${member} joined using ${source}. Invited by ${inviter} · ${counts.joins} total, ${counts.active} active invites.`)
      .setThumbnail(member.displayAvatarURL({ size: 256 }))],
    allowedMentions: { users: [member.id, ...(inviterId ? [inviterId] : [])], parse: [] }
  });
}

async function processMemberJoin(member) {
  const attribution = await identifyUsedInvite(member.guild);
  const invites = getGuildCommunity(member.guild.id).invites;
  const inviterId = attribution.inviterId;

  if (inviterId) {
    const totals = invites.totals[inviterId] ||= { joins: 0, leaves: 0 };
    totals.joins = Number(totals.joins || 0) + 1;
  } else {
    invites.unattributedJoins = Number(invites.unattributedJoins || 0) + 1;
  }

  invites.invitees[member.id] = {
    inviterId,
    code: attribution.code,
    source: attribution.source,
    joinedAt: Date.now()
  };
  saveCommunitySettings();

  try {
    await sendMemberEmbed(member, 'welcome', inviterId);
  } catch (error) {
    console.error(`Could not send welcome embed in ${member.guild.name}:`, error.message);
  }
  try {
    await sendInviteLog(member, attribution, inviterId);
  } catch (error) {
    console.error(`Could not send invite log in ${member.guild.name}:`, error.message);
  }
}

async function processMemberLeave(member) {
  const invites = getGuildCommunity(member.guild.id).invites;
  const tracked = invites.invitees[member.id];
  const inviterId = tracked?.inviterId || null;

  if (tracked) {
    if (inviterId) {
      const totals = invites.totals[inviterId] ||= { joins: 0, leaves: 0 };
      totals.leaves = Number(totals.leaves || 0) + 1;
    }
    delete invites.invitees[member.id];
    saveCommunitySettings();
  }

  try {
    await sendMemberEmbed(member, 'leave', inviterId);
  } catch (error) {
    console.error(`Could not send leave message in ${member.guild.name}:`, error.message);
  }
}

async function configureMemberEmbed(interaction, kind) {
  if (!isAdmin(interaction)) return deny(interaction);
  if (!interaction.guildId) return deny(interaction, 'Use this command inside a server.');

  const channel = interaction.options.getChannel('channel');
  const message = interaction.options.getString('message').trim();
  const title = interaction.options.getString('title')?.trim() || '';
  const imageUrl = interaction.options.getString('image_url')?.trim() || '';
  const colorInput = interaction.options.getString('color');
  const color = colorInput ? normalizeHexColor(colorInput) : '22C7D6';
  const emoji = interaction.options.getString('emoji')?.trim() || '';

  if (!message) return interaction.reply({ content: 'Enter an embed message.', flags: MessageFlags.Ephemeral });
  if (!color) return interaction.reply({ content: 'Use a six-digit HEX color, such as `#22C7D6`.', flags: MessageFlags.Ephemeral });

  if (imageUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return interaction.reply({ content: 'Enter a valid direct image URL or Discord upload link.', flags: MessageFlags.Ephemeral });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return interaction.reply({ content: 'Image URLs must start with `http://` or `https://`.', flags: MessageFlags.Ephemeral });
    }
  }

  const settings = getGuildCommunity(interaction.guildId);
  settings[kind] = {
    ...(settings[kind] || {}),
    channelId: channel.id,
    title,
    message,
    imageUrl,
    color,
    emoji,
    enabled: true
  };
  saveCommunitySettings();

  return interaction.reply({
    content: `${kind === 'welcome' ? 'Welcome' : 'Leave'} card saved for <#${channel.id}>. Use placeholders such as \`{username}\`, \`{mention}\`, \`{member_count}\`, \`{join_date}\`, \`{inviter}\`, \`{invites}\`, and \`{emoji}\`.`,
    flags: MessageFlags.Ephemeral
  });
}

function memberPanelCustomId(kind, action) {
  return `legacy_member_${kind}_${action}`;
}

function memberPanelEmbed(guildId, kind) {
  const settings = getGuildCommunity(guildId)[kind] || {};
  const enabled = settings.enabled !== false;
  const configured = Boolean(settings.channelId && settings.message);
  const links = Array.isArray(settings.links) ? settings.links : [];
  const title = kind === 'welcome' ? 'Welcome Setup' : 'Leave Setup';
  const message = settings.message
    ? `${settings.message.replace(/\s+/gu, ' ').slice(0, 220)}${settings.message.length > 220 ? '…' : ''}`
    : 'No message set yet';

  return new EmbedBuilder()
    .setColor(parseInt(normalizeHexColor(settings.color) || '22C7D6', 16))
    .setTitle(`✨ ${title}`)
    .setDescription('Use the controls below to configure and preview this message. Changes save immediately.')
    .addFields(
      {
        name: 'Basic Setup',
        value: `**Channel:** ${settings.channelId ? `<#${settings.channelId}>` : 'Not set'}\n**Status:** ${configured ? (enabled ? 'Enabled' : 'Disabled') : 'Needs a channel and message'}`
      },
      {
        name: 'Customization',
        value: `**Title:** ${(settings.title || '(none)').slice(0, 160)}\n**Message:** ${message}\n**Background:** ${settings.imageUrl ? 'Set' : 'Not set'}`
      },
      {
        name: 'Extra',
        value: `**Links:** ${links.length}\n**Accent color:** #${normalizeHexColor(settings.color) || '22C7D6'}`
      },
      {
        name: 'Advanced Settings',
        value: `**Ping member:** ${settings.pingMember ? 'On' : 'Off'}\n**Delete after:** ${Number(settings.deleteAfterSeconds || 0) || 'Never'} seconds`
      }
    )
    .setFooter({ text: 'Staff setup • Changes are saved immediately' });
}

function memberPanelComponents(kind, settings = {}) {
  const button = (action, label, style = ButtonStyle.Secondary, emoji) => {
    const item = new ButtonBuilder()
      .setCustomId(memberPanelCustomId(kind, action))
      .setLabel(label)
      .setStyle(style);
    if (emoji) item.setEmoji(emoji);
    return item;
  };

  const isEnabled = Boolean(settings.channelId && settings.message && settings.enabled !== false);

  return [
    new ActionRowBuilder().addComponents(
      button('set_channel', 'Set Channel', ButtonStyle.Success, '📢'),
      button('toggle', isEnabled ? 'Disable' : 'Enable', isEnabled ? ButtonStyle.Danger : ButtonStyle.Success, isEnabled ? '🔄' : '✅'),
      button('test', `Test ${kind === 'welcome' ? 'Welcome' : 'Leave'}`, ButtonStyle.Secondary, '🧪'),
      button('view_config', 'View Config', ButtonStyle.Secondary, '👁️')
    ),
    new ActionRowBuilder().addComponents(
      button('edit_message', 'Edit Message', ButtonStyle.Primary, '✏️'),
      button('background', 'Background', ButtonStyle.Primary, '🖼️'),
      button('placeholders', 'View Placeholders', ButtonStyle.Secondary, '📋'),
      button('reset', 'Reset All', ButtonStyle.Danger, '🔄')
    ),
    new ActionRowBuilder().addComponents(
      button('add_link', 'Add Link', ButtonStyle.Success, '➕'),
      button('remove_link', 'Remove Link', ButtonStyle.Danger, '➖'),
      button('view_links', 'View Links', ButtonStyle.Secondary, '🔗'),
      button('accent_color', 'Accent Color', ButtonStyle.Primary, '🎨')
    ),
    new ActionRowBuilder().addComponents(
      button('ping_delete', 'Ping & Delete', ButtonStyle.Primary, '📌')
    )
  ];
}

function memberPanelModal(kind, action, settings = {}) {
  const modal = new ModalBuilder()
    .setCustomId(memberPanelCustomId(kind, `modal_${action}`));
  const input = (customId, label, style, value, maxLength, required = true, placeholder) => {
    const field = new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(style)
      .setMaxLength(maxLength)
      .setRequired(required);
    if (value) field.setValue(value.slice(0, maxLength));
    if (placeholder) field.setPlaceholder(placeholder);
    return field;
  };

  if (action === 'edit_message') {
    modal.setTitle(`Edit ${kind} message`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(input('title', 'Card heading (optional)', TextInputStyle.Short, settings.title || '', 256, false)),
      new ActionRowBuilder().addComponents(input('message', 'Text above the card', TextInputStyle.Paragraph, settings.message || (kind === 'welcome' ? 'Welcome {mention} to {server}! {emoji}' : 'Goodbye {username}!'), 4000)),
      new ActionRowBuilder().addComponents(input('emoji', 'Emoji placeholder (optional)', TextInputStyle.Short, settings.emoji || '', 100, false, 'Custom animated emoji markup works'))
    );
  } else if (action === 'background') {
    modal.setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} background image`);
    modal.addComponents(new ActionRowBuilder().addComponents(
      input('image_url', 'Direct image URL or Discord upload link', TextInputStyle.Short, settings.imageUrl || '', 2000, false, 'Leave blank to remove the image')
    ));
  } else if (action === 'add_link') {
    modal.setTitle(`Add a ${kind} link button`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(input('label', 'Button label', TextInputStyle.Short, '', 80)),
      new ActionRowBuilder().addComponents(input('url', 'Link URL (HTTP or HTTPS)', TextInputStyle.Short, '', 512))
    );
  } else if (action === 'accent_color') {
    modal.setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} accent color`);
    modal.addComponents(new ActionRowBuilder().addComponents(
      input('color', 'Six-digit HEX color', TextInputStyle.Short, `#${normalizeHexColor(settings.color) || '22C7D6'}`, 7, true, 'Example: #22C7D6')
    ));
  } else if (action === 'ping_delete') {
    modal.setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} advanced settings`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(input('ping', 'Ping the joining/leaving member? yes/no', TextInputStyle.Short, settings.pingMember ? 'yes' : 'no', 3, true)),
      new ActionRowBuilder().addComponents(input('delete_after', 'Delete message after seconds (0 = never)', TextInputStyle.Short, String(settings.deleteAfterSeconds || 0), 5, true))
    );
  }

  return modal;
}

function memberPanelConfigEmbed(guildId, kind) {
  const settings = getGuildCommunity(guildId)[kind] || {};
  const message = settings.message || '(not set)';
  const links = Array.isArray(settings.links) ? settings.links : [];
  return new EmbedBuilder()
    .setColor(parseInt(normalizeHexColor(settings.color) || '22C7D6', 16))
    .setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} Configuration`)
    .addFields(
      { name: 'Channel', value: settings.channelId ? `<#${settings.channelId}>` : 'Not set' },
      { name: 'Status', value: settings.enabled === false ? 'Disabled' : (settings.channelId && settings.message ? 'Enabled' : 'Not configured'), inline: true },
      { name: 'Title', value: (settings.title || '(none)').slice(0, 1024) },
      { name: 'Message', value: message.length > 1000 ? `${message.slice(0, 997)}...` : message },
      { name: 'Image URL', value: (settings.imageUrl || '(none)').slice(0, 1024) },
      { name: 'Links', value: String(links.length), inline: true },
      { name: 'Ping member', value: settings.pingMember ? 'On' : 'Off', inline: true },
      { name: 'Delete after', value: `${Number(settings.deleteAfterSeconds || 0) || 'Never'} seconds`, inline: true }
    );
}

// Bot ready

client.once('clientReady', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  await Promise.allSettled(
    [...client.guilds.cache.values()].map(guild => cacheGuildInvites(guild))
  );
});

client.on('guildCreate', guild => {
  cacheGuildInvites(guild);
});

client.on('inviteCreate', invite => {
  const snapshot = inviteSnapshots.get(invite.guild?.id);
  if (!snapshot || !invite.code) return;
  snapshot.uses.set(invite.code, Number(invite.uses || 0));
  snapshot.inviteDetails.set(invite.code, invite);
});

client.on('inviteDelete', invite => {
  const snapshot = inviteSnapshots.get(invite.guild?.id);
  if (!snapshot || !invite.code) return;
  snapshot.uses.delete(invite.code);
  snapshot.inviteDetails.delete(invite.code);
});

client.on('guildMemberAdd', member => {
  queueInviteTask(member.guild.id, () => processMemberJoin(member))
    .catch(error => console.error(`Could not process member join in ${member.guild.name}:`, error.message));
});

client.on('guildMemberRemove', member => {
  queueInviteTask(member.guild.id, () => processMemberLeave(member))
    .catch(error => console.error(`Could not process member leave in ${member.guild.name}:`, error.message));
});

// Slash commands

client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand()) return;

  const command = i.commandName;

  try {
    if (command === 'autoresponder') {
      const action = i.options.getSubcommand(false);
      const group = i.options.getSubcommandGroup(false);
      const replyType = group === 'embed' ? 'embed' : 'text';
      const commandRoot = group ? '/autoresponder embed' : '/autoresponder';

      if (action !== 'help' && !isAdmin(i)) return deny(i);
      if (action !== 'help' && !i.guildId) return deny(i, 'Use this command inside a server.');

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
          .setDescription(group === 'embed'
            ? 'Build embedded replies with a custom title and message.'
            : 'Build normal text replies with `/autoresponder`. For embedded replies, use `/autoresponder embed`. This help command is public; the management commands are staff-only.')
          .addFields(
            {
              name: '➕ Add a reply',
              value: group === 'embed'
                ? `\`${commandRoot} add\`\n**Required:** \`trigger\`, \`reply\`\n**Optional:** \`matchmode\`, \`title\`, \`color\``
                : '`/autoresponder add` adds a normal text reply.\n`/autoresponder embed add` adds an embedded reply with optional title and color.'
            },
            {
              name: '✏️ Edit a reply',
              value: group === 'embed'
                ? `\`${commandRoot} editreply\` changes the reply. \`${commandRoot} edit\` can also rename the trigger and change the title or color.`
                : '`/autoresponder editreply` changes a normal reply. Use `/autoresponder embed editreply` for an embedded reply.'
            },
            {
              name: '🧰 More options',
              value: `\`${commandRoot} editmatchmode\` changes matching.\n\`${commandRoot} remove\` deletes a trigger.\n\`${commandRoot} show\` and \`showraw\` inspect a reply.\n\`${commandRoot} list\` lists replies; \`panel\` opens the editor.`
            },
            {
              name: group === 'embed' ? '🎨 Example' : '💬 Examples',
              value: `\`trigger: server ip\`\n\`reply: Java: play.example.net\`${group === 'embed' ? '\n`title: Join our server`\n`color: #22C7D6`' : '\nFor an embed, use `/autoresponder embed add` and optionally set a title and color.'}`
            },
            {
              name: '💡 Trigger matching',
              value: '`contains` (default) matches a complete word or phrase; `exact` requires the whole message; `starts_with` and `ends_with` require the trigger at that edge. Matching ignores letter case.'
            },
            {
              name: '🔒 Permissions',
              value: 'Anyone can view this help. Only staff can add, edit, show, list, or remove autoresponders.'
            }
          )
          .setFooter({ text: 'Up to 25 auto-replies per server • Replies activate immediately' })
          .setTimestamp();

        return i.reply({ embeds: [embed] });
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

    if (command === 'welcome' || command === 'leave') {
      if (!isAdmin(i)) return deny(i);
      if (!i.guildId) return deny(i, 'Use this command inside a server.');

      const kind = command;
      const action = i.options.getSubcommand();

      if (action === 'panel') {
        const settings = getGuildCommunity(i.guildId)[kind] || {};
        return i.reply({
          embeds: [memberPanelEmbed(i.guildId, kind)],
          components: memberPanelComponents(kind, settings),
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'set') return configureMemberEmbed(i, kind);

      const settings = getGuildCommunity(i.guildId);
      const current = settings[kind];

      if (action === 'disable') {
        settings[kind] ||= {};
        settings[kind].enabled = false;
        saveCommunitySettings();
        return i.reply({
          content: `${kind === 'welcome' ? 'Welcome' : 'Leave'} messages are disabled.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'show') {
        if (!current?.message) {
          return i.reply({ content: `No ${kind} embed is configured. Use /${kind} set to create one.`, flags: MessageFlags.Ephemeral });
        }

        const savedMessage = current.message.length > 1000
          ? `${current.message.slice(0, 997)}...`
          : current.message;
        return i.reply({
          embeds: [new EmbedBuilder()
            .setColor(parseInt(normalizeHexColor(current.color) || '22C7D6', 16))
            .setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} embed settings`)
            .setDescription(`**Channel:** <#${current.channelId}>`)
            .addFields(
              { name: 'Title', value: (current.title || '(none)').slice(0, 1024) },
              { name: 'Message', value: savedMessage || '(empty)' },
              ...(current.imageUrl ? [{ name: 'Image URL', value: current.imageUrl.slice(0, 1024) }] : []),
              ...(current.emoji ? [{ name: 'Emoji', value: current.emoji.slice(0, 1024) }] : [])
            )],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'test') {
        if (!current?.message) {
          return i.reply({ content: `Set up the ${kind} embed first with /${kind} set.`, flags: MessageFlags.Ephemeral });
        }

        const member = await i.guild.members.fetch(i.user.id);
        const sent = await sendMemberEmbed(member, kind, null, { force: true });
        return i.reply({
          content: sent ? `Preview sent to <#${current.channelId}>.` : 'I could not send the preview. Check that the configured channel still exists and that I can send embeds there.',
          flags: MessageFlags.Ephemeral
        });
      }
    }

    if (command === 'setup') {
      if (!isAdmin(i)) return deny(i);
      if (!i.guildId) return deny(i, 'Use this command inside a server.');

      const settings = getGuildCommunity(i.guildId).welcome || {};
      return i.reply({
        embeds: [memberPanelEmbed(i.guildId, 'welcome')],
        components: memberPanelComponents('welcome', settings),
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === 'invites') {
      if (!i.guildId) return deny(i, 'Use this command inside a server.');

      const action = i.options.getSubcommand();
      const invites = getGuildCommunity(i.guildId).invites;

      if (action === 'check') {
        const user = i.options.getUser('user') || i.user;
        const counts = getInviteCounts(i.guildId, user.id);
        return i.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x22c7d6)
            .setTitle(`Invite stats · ${user.username}`)
            .setDescription(`**Total joins:** ${counts.joins}\n**Still in server:** ${counts.active}\n**Left:** ${counts.leaves}`)
            .setThumbnail(user.displayAvatarURL({ size: 256 }))]
        });
      }

      if (action === 'leaderboard') {
        const rows = Object.entries(invites.totals)
          .map(([userId, totals]) => ({ userId, ...getInviteCounts(i.guildId, userId) }))
          .filter(row => row.joins > 0)
          .sort((left, right) => right.active - left.active || right.joins - left.joins)
          .slice(0, 10);

        return i.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x22c7d6)
            .setTitle('🏆 Invite Leaderboard')
            .setDescription(rows.length
              ? rows.map((row, index) => `**${index + 1}.** <@${row.userId}> — **${row.active}** active (${row.joins} joined, ${row.leaves} left)`).join('\n')
              : 'No invite joins have been tracked yet.')],
          allowedMentions: { parse: [] }
        });
      }

      if (action === 'logchannel') {
        if (!isAdmin(i)) return deny(i);
        const channel = i.options.getChannel('channel');
        invites.logChannelId = channel.id;
        saveCommunitySettings();
        return i.reply({ content: `Invite join logs will be sent to ${channel}.`, flags: MessageFlags.Ephemeral });
      }
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
          { name: 'Community', value: '`/invites check` · `/invites leaderboard` · `/setup` · `/welcome panel` · `/leave panel` (welcome/leave setup is staff-only)' },
          { name: 'Moderation', value: '`/minekick` · `/mineban` · `/minetempban` · `/mineunban` · `/minestatus`' },
          { name: 'Custom embeds and auto-replies', value: '`/custommsg` · `/autoresponder add/edit/list/remove` for normal replies · `/autoresponder embed add/edit/list/remove` for embedded replies · use each set’s `show`, `showraw`, `editreply`, `editmatchmode`, `help`, and `panel` subcommands as needed.' }
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

client.on('interactionCreate', async i => {
  if (!i.isButton() && !i.isChannelSelectMenu() && !i.isStringSelectMenu() && !i.isModalSubmit()) return;
  if (!i.customId.startsWith('legacy_member_')) return;

  if (!i.guildId) {
    return i.reply({ content: 'Use this inside a server.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (!isAdmin(i)) {
    return i.reply({ content: 'Only staff can manage welcome and leave messages.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  try {
    const match = i.customId.match(/^legacy_member_(welcome|leave)_(.+)$/);
    if (!match) return;
    const [, kind, action] = match;
    const guildSettings = getGuildCommunity(i.guildId);
    const settings = guildSettings[kind] ||= {};
    const updatePanel = () => i.update({
      content: null,
      embeds: [memberPanelEmbed(i.guildId, kind)],
      components: memberPanelComponents(kind, settings)
    });

    if (i.isButton()) {
      if (action === 'set_channel') {
        const picker = new ChannelSelectMenuBuilder()
          .setCustomId(memberPanelCustomId(kind, 'select_channel'))
          .setPlaceholder('Choose a text channel')
          .setChannelTypes(ChannelType.GuildText);
        return i.update({
          content: 'Choose where the message should be sent.',
          embeds: [],
          components: [
            new ActionRowBuilder().addComponents(picker),
            new ActionRowBuilder().addComponents(new ButtonBuilder()
              .setCustomId(memberPanelCustomId(kind, 'back_panel'))
              .setLabel('Back to Setup')
              .setStyle(ButtonStyle.Secondary))
          ]
        });
      }

      if (action === 'back_panel' || action === 'cancel_reset') return updatePanel();

      if (action === 'toggle') {
        if (!settings.channelId || !settings.message) {
          return i.reply({ content: `Set a channel and message before enabling ${kind} messages.`, flags: MessageFlags.Ephemeral });
        }
        settings.enabled = settings.enabled === false;
        saveCommunitySettings();
        return updatePanel();
      }

      if (action === 'test') {
        const member = await i.guild.members.fetch(i.user.id);
        const sent = await sendMemberEmbed(member, kind, null, { force: true });
        return i.reply({
          content: sent ? `Preview sent to <#${settings.channelId}>.` : `Set a channel and message in the ${kind} panel first.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'view_config') {
        return i.reply({ embeds: [memberPanelConfigEmbed(i.guildId, kind)], flags: MessageFlags.Ephemeral });
      }

      if (action === 'placeholders') {
        return i.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x22c7d6)
            .setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} Placeholders`)
            .setDescription('Use these in the card heading or text above the card. Discord custom emoji markup, including animated emojis, can be typed in the text.')
            .addFields(
              { name: 'Member', value: '`{username}` · `{displayname}` · `{mention}` · `{avatar}`' },
              { name: 'Server', value: '`{server}` · `{guild}` · `{member_count}` · `{member_number}` · `{join_date}`' },
              { name: 'Invites', value: '`{inviter}` · `{invites}` · `{active_invites}`' },
              { name: 'Custom emoji', value: 'Set the Emoji option in Edit Message, then use `{emoji}`.' }
            )],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'edit_message' || action === 'background' || action === 'add_link' || action === 'accent_color' || action === 'ping_delete') {
        return i.showModal(memberPanelModal(kind, action, settings));
      }

      if (action === 'view_links') {
        const memberLinks = Array.isArray(settings.links) ? settings.links : [];
        return i.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x22c7d6)
            .setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} Links`)
            .setDescription(memberLinks.length
              ? memberLinks.map((link, index) => `**${index + 1}. [${link.label}](${link.url})**`).join('\n')
              : 'No link buttons have been added yet.')],
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === 'remove_link') {
        const memberLinks = Array.isArray(settings.links) ? settings.links : [];
        if (!memberLinks.length) {
          return i.reply({ content: 'There are no link buttons to remove.', flags: MessageFlags.Ephemeral });
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId(memberPanelCustomId(kind, 'select_remove_link'))
          .setPlaceholder('Choose a link to remove')
          .addOptions(memberLinks.slice(0, 25).map((link, index) => ({
            label: (link.label || `Link ${index + 1}`).slice(0, 100),
            description: (link.url || '').slice(0, 100) || 'Link button',
            value: String(index)
          })));
        return i.update({
          content: 'Choose the link button to remove.',
          embeds: [],
          components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(new ButtonBuilder()
              .setCustomId(memberPanelCustomId(kind, 'back_panel'))
              .setLabel('Back to Setup')
              .setStyle(ButtonStyle.Secondary))
          ]
        });
      }

      if (action === 'reset') {
        return i.update({
          content: `Reset all ${kind} settings, including the channel, message, image, and links?`,
          embeds: [],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(memberPanelCustomId(kind, 'confirm_reset'))
              .setLabel('Confirm Reset')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(memberPanelCustomId(kind, 'cancel_reset'))
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
          )]
        });
      }

      if (action === 'confirm_reset') {
        delete guildSettings[kind];
        saveCommunitySettings();
        return i.update({
          content: 'All settings have been reset.',
          embeds: [memberPanelEmbed(i.guildId, kind)],
          components: memberPanelComponents(kind, {})
        });
      }
    }

    if (i.isChannelSelectMenu() && action === 'select_channel') {
      settings.channelId = i.values[0];
      settings.enabled ??= true;
      saveCommunitySettings();
      return i.update({
        content: null,
        embeds: [memberPanelEmbed(i.guildId, kind)],
        components: memberPanelComponents(kind, settings)
      });
    }

    if (i.isStringSelectMenu() && action === 'select_remove_link') {
      const index = Number(i.values[0]);
      const memberLinks = Array.isArray(settings.links) ? settings.links : [];
      if (!Number.isInteger(index) || index < 0 || index >= memberLinks.length) {
        return i.reply({ content: 'That link no longer exists.', flags: MessageFlags.Ephemeral });
      }
      const [removed] = memberLinks.splice(index, 1);
      settings.links = memberLinks;
      saveCommunitySettings();
      return i.update({
        content: `Removed the **${removed.label}** link button.`,
        embeds: [memberPanelEmbed(i.guildId, kind)],
        components: memberPanelComponents(kind, settings)
      });
    }

    if (i.isModalSubmit()) {
      if (action === 'modal_edit_message') {
        const message = i.fields.getTextInputValue('message').trim();
        if (!message) return i.reply({ content: 'The text above the card cannot be empty.', flags: MessageFlags.Ephemeral });
        settings.title = i.fields.getTextInputValue('title').trim();
        settings.message = message;
        settings.emoji = i.fields.getTextInputValue('emoji').trim();
      } else if (action === 'modal_background') {
        const imageUrl = i.fields.getTextInputValue('image_url').trim();
        if (imageUrl) {
          let parsedUrl;
          try {
            parsedUrl = new URL(imageUrl);
          } catch {
            return i.reply({ content: 'Enter a valid image URL.', flags: MessageFlags.Ephemeral });
          }
          if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return i.reply({ content: 'Image URLs must start with http:// or https://.', flags: MessageFlags.Ephemeral });
          }
        }
        settings.imageUrl = imageUrl;
      } else if (action === 'modal_add_link') {
        const label = i.fields.getTextInputValue('label').trim();
        const url = i.fields.getTextInputValue('url').trim();
        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch {
          return i.reply({ content: 'Enter a valid HTTP or HTTPS link URL.', flags: MessageFlags.Ephemeral });
        }
        if (!label || !['http:', 'https:'].includes(parsedUrl.protocol)) {
          return i.reply({ content: 'Add a button label and an HTTP or HTTPS link.', flags: MessageFlags.Ephemeral });
        }
        settings.links ||= [];
        if (settings.links.length >= 5) {
          return i.reply({ content: 'This message already has five link buttons, the Discord limit.', flags: MessageFlags.Ephemeral });
        }
        settings.links.push({ label, url });
      } else if (action === 'modal_accent_color') {
        const color = normalizeHexColor(i.fields.getTextInputValue('color'));
        if (!color) return i.reply({ content: 'Use a six-digit HEX color such as #22C7D6.', flags: MessageFlags.Ephemeral });
        settings.color = color;
      } else if (action === 'modal_ping_delete') {
        const ping = i.fields.getTextInputValue('ping').trim().toLowerCase();
        const deleteAfter = Number(i.fields.getTextInputValue('delete_after').trim());
        if (!['yes', 'no'].includes(ping)) {
          return i.reply({ content: 'Enter yes or no for member pings.', flags: MessageFlags.Ephemeral });
        }
        if (!Number.isInteger(deleteAfter) || deleteAfter < 0 || deleteAfter > 86400) {
          return i.reply({ content: 'Delete delay must be a whole number from 0 to 86400 seconds.', flags: MessageFlags.Ephemeral });
        }
        settings.pingMember = ping === 'yes';
        settings.deleteAfterSeconds = deleteAfter;
      } else {
        return;
      }

      saveCommunitySettings();
      const savedPanel = {
        content: `${kind === 'welcome' ? 'Welcome' : 'Leave'} settings saved.`,
        embeds: [memberPanelEmbed(i.guildId, kind)],
        components: memberPanelComponents(kind, settings)
      };
      if (i.isFromMessage()) return i.update(savedPanel);
      return i.reply({ ...savedPanel, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error('Member message panel interaction failed:', error);
    const payload = { content: 'Could not process that setup action. Reopen the panel and try again.', flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) return i.followUp(payload).catch(() => {});
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
