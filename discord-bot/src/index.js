
import 'dotenv/config';

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits
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
  intents: [GatewayIntentBits.Guilds]
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`SneakSMP API listening on ${port}`);
});

server.on('error', error => {
  console.error('API server failed:', error.message);
});

// --------------------------------------------------
// API HELPER
// --------------------------------------------------

const apiBase = (
  process.env.API_BASE_URL ||
  `http://127.0.0.1:${port}`
).replace(/\/+$/, '');

async function api(path, method = 'GET', body = undefined) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {})
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
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
    throw new Error(
      data.error || `API request failed (${response.status})`
    );
  }

  return data;
}

// --------------------------------------------------
// PERMISSIONS
// Configure comma-separated IDs in environment variables.
// --------------------------------------------------

function parseIds(name) {
  return (process.env[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function isOwner(interaction) {
  return parseIds('OWNER_IDS').includes(interaction.user.id) ||
    parseIds('OWNER_ROLE_IDS').some(id =>
      interaction.member?.roles?.cache?.has(id)
    );
}

function isDeveloper(interaction) {
  return parseIds('DEVELOPER_IDS').includes(interaction.user.id) ||
    parseIds('DEVELOPER_ROLE_IDS').some(id =>
      interaction.member?.roles?.cache?.has(id)
    );
}

function isAdmin(interaction) {
  return isOwner(interaction) ||
    isDeveloper(interaction) ||
    parseIds('ADMIN_ROLE_IDS').some(id =>
      interaction.member?.roles?.cache?.has(id)
    ) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    );
}

function isModerator(interaction) {
  return isAdmin(interaction) ||
    parseIds('MOD_ROLE_IDS').some(id =>
      interaction.member?.roles?.cache?.has(id)
    );
}

async function deny(interaction, message = 'You do not have permission to use this command.') {
  return interaction.reply({
    content: message,
    ephemeral: true
  });
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getString(interaction, ...names) {
  for (const name of names) {
    const value = interaction.options.getString(name);
    if (value !== null) return value;
  }

  return null;
}

function getInteger(interaction, ...names) {
  for (const name of names) {
    const value = interaction.options.getInteger(name);
    if (value !== null) return value;
  }

  return null;
}

function findPlayer(name) {
  if (!name) return null;

  const all = Object.values(players.all());

  return all.find(player =>
    player.username?.toLowerCase() === name.toLowerCase()
  ) || null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function errorMessage(error) {
  console.error(error);
  return `Something went wrong: ${error.message || 'Unknown error'}`;
}

async function replyError(interaction, error) {
  const message = errorMessage(error);

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({
      content: message,
      ephemeral: true
    }).catch(() => {});
  }

  return interaction.reply({
    content: message,
    ephemeral: true
  }).catch(() => {});
}

function linkedAccount(discordId) {
  return links.get(discordId);
}

// --------------------------------------------------
// BOT READY
// --------------------------------------------------

client.once('clientReady', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

// --------------------------------------------------
// SLASH COMMAND HANDLER
// Commands must also exist in commands.js and be deployed.
// --------------------------------------------------

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  try {
    // ----------------------------------------------
    // /help
    // ----------------------------------------------

    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('LegacyMC Commands')
        .setDescription('Available commands for the LegacyMC Minecraft community.')
        .addFields(
          {
            name: 'Account linking',
            value: '`/minelink` · `/mineunlink` · `/mineaccount`'
          },
          {
            name: 'Stats and economy',
            value: '`/minestats` · `/mineleaderboard` · `/minebalance`'
          },
          {
            name: 'Staff commands',
            value: '`/announce` · `/addcoin` · `/takecoin` · `/givecoins` · `/takecoins`'
          },
          {
            name: 'Moderation and status',
            value: '`/minekick` · `/mineban` · `/minetempban` · `/mineunban` · `/minestatus`'
          }
        )
        .setFooter({ text: 'LegacyMC • SneakSMP Bridge' });

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // /announce
    // Adds announcement to Minecraft queue.
    // Optional Discord channel receives an embed too.
    // ----------------------------------------------

    if (command === 'announce') {
      if (!isAdmin(interaction)) {
        return deny(interaction);
      }

      const message = getString(interaction, 'message');

      if (!message?.trim() || message.length > 1000) {
        return interaction.reply({
          content: 'Provide an announcement between 1 and 1000 characters.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await api('/v1/announcements', 'POST', {
        message: message.trim(),
        actor: interaction.user.id
      });

      const channel = interaction.options.getChannel('channel');

      if (
        channel &&
        channel.type === ChannelType.GuildText &&
        channel.isTextBased()
      ) {
        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('📢 LegacyMC Announcement')
          .setDescription(message.trim())
          .setFooter({ text: 'LegacyMC • Official Announcement' })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }

      return interaction.editReply(
        `Announcement queued for Minecraft. ID: \`${result.id}\``
      );
    }

    // ----------------------------------------------
    // /minelink
    // Player gets a code in Minecraft using /discordlink.
    // ----------------------------------------------

    if (command === 'minelink') {
      const code = getString(interaction, 'code');

      if (!code || !/^\d{6}$/.test(code)) {
        return interaction.reply({
          content: 'Enter the six-digit code provided in Minecraft by `/discordlink`.',
          ephemeral: true
        });
      }

      const result = await api('/v1/links/verify', 'POST', {
        code,
        discordId: interaction.user.id
      });

      return interaction.reply({
        content: `Your Minecraft account **${result.link.username}** is now linked to Discord.`,
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // /mineunlink
    // ----------------------------------------------

    if (command === 'mineunlink') {
      const account = linkedAccount(interaction.user.id);

      if (!account) {
        return interaction.reply({
          content: 'You do not have a linked Minecraft account.',
          ephemeral: true
        });
      }

      await api(
        `/v1/links/${interaction.user.id}`,
        'DELETE'
      );

      return interaction.reply({
        content: 'Your Minecraft account has been unlinked.',
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // /mineaccount
    // ----------------------------------------------

    if (command === 'mineaccount') {
      const account = linkedAccount(interaction.user.id);

      if (!account) {
        return interaction.reply({
          content: 'No Minecraft account linked. Use `/minelink` with the code from Minecraft.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('Linked Minecraft Account')
        .addFields(
          { name: 'Username', value: account.username || 'Unknown', inline: true },
          { name: 'UUID', value: account.uuid || 'Unknown', inline: true }
        );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // /mineleaderboard
    // ----------------------------------------------

    if (command === 'mineleaderboard') {
      const type = getString(interaction, 'type') || 'kills';

      if (!['kills', 'deaths', 'money', 'playtime', 'coins'].includes(type)) {
        return interaction.reply({
          content: 'Choose kills, deaths, money, playtime, or coins.',
          ephemeral: true
        });
      }

      const result = await api(
        `/v1/leaderboards/${encodeURIComponent(type)}`
      );

      const rows = result.rows || [];

      const description = rows.length
        ? rows.map((player, index) => {
            const value = type === 'playtime'
              ? `${formatNumber(Math.floor((player.playtimeTicks || 0) / 20))} seconds`
              : formatNumber(player[type]);

            return `**${index + 1}. ${player.username || 'Unknown'}** — ${value}`;
          }).join('\n')
        : 'No player stats are available yet.';

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`LegacyMC ${type} leaderboard`)
        .setDescription(description);

      return interaction.reply({ embeds: [embed] });
    }

    // ----------------------------------------------
    // /minestats
    // ----------------------------------------------

    if (command === 'minestats') {
      const name = getString(interaction, 'player', 'username');

      let player;

      if (name) {
        player = findPlayer(name);
      } else {
        const account = linkedAccount(interaction.user.id);
        player = account ? players.get(account.uuid) : null;
      }

      if (!player) {
        return interaction.reply({
          content: 'Player stats were not found. The player may need to join the server first.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`${player.username || 'Player'} — Stats`)
        .addFields(
          { name: 'Kills', value: formatNumber(player.kills), inline: true },
          { name: 'Deaths', value: formatNumber(player.deaths), inline: true },
          {
            name: 'Playtime',
            value: `${formatNumber(Math.floor((player.playtimeTicks || 0) / 20))} seconds`,
            inline: true
          },
          {
            name: 'Money',
            value: player.money == null ? 'Not available' : formatNumber(player.money),
            inline: true
          },
          {
            name: 'Coins',
            value: formatNumber(coins.get(player.uuid)),
            inline: true
          }
        );

      return interaction.reply({ embeds: [embed] });
    }

    // ----------------------------------------------
    // /minebalance
    // ----------------------------------------------

    if (command === 'minebalance') {
      const account = linkedAccount(interaction.user.id);

      if (!account) {
        return interaction.reply({
          content: 'Link your Minecraft account first using `/minelink`.',
          ephemeral: true
        });
      }

      return interaction.reply({
        content: `**${account.username}** has **${formatNumber(coins.get(account.uuid))} coins**.`,
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // /addcoin, /takecoin, /givecoins, /takecoins
    // ----------------------------------------------

    if (['addcoin', 'takecoin', 'givecoins', 'takecoins'].includes(command)) {
      if (!isAdmin(interaction)) {
        return deny(interaction);
      }

      const playerName = getString(interaction, 'player', 'username');
      const amount = getInteger(interaction, 'amount');
      const reason = getString(interaction, 'reason');

      if (!playerName || !amount || amount < 1 || !reason || reason.trim().length < 2) {
        return interaction.reply({
          content: 'Provide a player, a positive amount, and a reason.',
          ephemeral: true
        });
      }

      const player = findPlayer(playerName);

      if (!player) {
        return interaction.reply({
          content: `Could not find Minecraft player **${playerName}**. They may need to join the server first.`,
          ephemeral: true
        });
      }

      const subtract = ['takecoin', 'takecoins'].includes(command);

      const result = await api('/v1/coins/adjust', 'POST', {
        uuid: player.uuid,
        amount: subtract ? -amount : amount,
        actor: interaction.user.id,
        reason: reason.trim()
      });

      return interaction.reply({
        content: `Updated **${player.username}**'s coins by ${subtract ? '-' : '+'}${formatNumber(amount)}. New balance: **${formatNumber(result.balance)}**.`,
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // Moderation commands
    // These only queue/log a request in the current API.
    // They do not yet execute Minecraft commands.
    // ----------------------------------------------

    if (['minekick', 'mineban', 'minetempban', 'mineunban'].includes(command)) {
      if (!isModerator(interaction)) {
        return deny(interaction);
      }

      const player = getString(interaction, 'player', 'username');
      const reason = getString(interaction, 'reason') || 'No reason provided';
      const hours = getInteger(interaction, 'hours');

      const typeMap = {
        minekick: 'kick',
        mineban: 'ban',
        minetempban: 'tempban',
        mineunban: 'unban'
      };

      if (!player) {
        return interaction.reply({
          content: 'Provide the Minecraft player name.',
          ephemeral: true
        });
      }

      if (command === 'minetempban' && (!hours || hours < 1)) {
        return interaction.reply({
          content: 'Provide a positive ban duration in hours.',
          ephemeral: true
        });
      }

      const result = await api('/v1/moderation', 'POST', {
        type: typeMap[command],
        player,
        reason,
        hours,
        actor: interaction.user.id
      });

      return interaction.reply({
        content: `Moderation request recorded for **${player}** (ID: \`${result.id}\`). **This request is not executed in Minecraft yet.**`,
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // /minestatus
    // ----------------------------------------------

    if (command === 'minestatus') {
      const serverInfo = players.get('__server__');

      if (!serverInfo?.heartbeat) {
        return interaction.reply({
          content: 'Server status is not available yet. Waiting for a plugin heartbeat.',
          ephemeral: true
        });
      }

      const ageSeconds = Math.floor(
        (Date.now() - serverInfo.heartbeat) / 1000
      );

      const online = ageSeconds <= 120;

      const embed = new EmbedBuilder()
        .setColor(online ? 0x2ecc71 : 0xe74c3c)
        .setTitle('LegacyMC Server Status')
        .setDescription(online ? '🟢 Server heartbeat is active' : '🔴 Server heartbeat is stale')
        .addFields(
          { name: 'Last heartbeat', value: `${ageSeconds} seconds ago`, inline: true }
        );

      return interaction.reply({ embeds: [embed] });
    }

    // ----------------------------------------------
    // Unknown command
    // ----------------------------------------------

    return interaction.reply({
      content: 'This command is not handled by the current bot code.',
      ephemeral: true
    });

  } catch (error) {
    await replyError(interaction, error);
  }
});

// --------------------------------------------------
// START DISCORD BOT
// --------------------------------------------------

client.login(token).catch(error => {
  console.error('Discord login failed:', error);
  server.close();
  process.exitCode = 1;
});
