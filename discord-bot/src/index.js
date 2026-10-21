
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} from 'discord.js';

import { app } from './api.js';
import { players, links, coins } from './store.js';

const token = process.env.DISCORD_TOKEN;
const port = Number(process.env.PORT || 8787);

if (!token || !process.env.API_TOKEN) {
  throw new Error('Set DISCORD_TOKEN and API_TOKEN in your environment');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const base = `http://127.0.0.1:${port}`;

async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `API HTTP ${response.status}`);
  }

  return data;
}

function envIds(name) {
  return (process.env[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

async function hasStaffPermission(interaction, permission) {
  const ownerOrDev =
    envIds('OWNER_IDS').includes(interaction.user.id) ||
    envIds('DEVELOPER_IDS').includes(interaction.user.id);

  const roleEnvNames = permission === 'moderation'
    ? ['ADMIN_ROLE_IDS', 'MOD_ROLE_IDS']
    : ['OWNER_ROLE_IDS', 'DEVELOPER_ROLE_IDS', 'ADMIN_ROLE_IDS'];

  const roleIds = roleEnvNames.flatMap(envIds);

  if (ownerOrDev) return true;

  if (!interaction.guild) return false;

  try {
    const member = await interaction.guild.members.fetch(
      interaction.user.id
    );

    return member.roles.cache.some(role => roleIds.includes(role.id));
  } catch {
    return false;
  }
}

async function deny(interaction) {
  return interaction.reply({
    content: 'You do not have permission to use this command.',
    ephemeral: true
  });
}

function findPlayer(username) {
  const query = username.toLowerCase();

  return Object.values(players.all()).find(
    player => player.uuid &&
      player.uuid !== '__server__' &&
      player.username?.toLowerCase() === query
  );
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const name = interaction.commandName;

    // PUBLIC HELP
    if (name === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('LegacyMC • Command Help')
        .setColor(0x5865f2)
        .setDescription([
          '**Account commands**',
          '`/minelink` `/mineunlink` `/mineaccount`',
          '',
          '**Stats and coins**',
          '`/minestats` `/mineleaderboard` `/minebalance`',
          '',
          '**Staff commands**',
          '`/announce` `/addcoin` `/takecoin`',
          '`/givecoins` `/takecoins`',
          '`/minekick` `/mineban` `/minetempban` `/mineunban`',
          '',
          '**Server**',
          '`/minestatus`',
          '',
          'Staff commands require configured permissions.'
        ].join('\n'));

      return interaction.reply({ embeds: [embed] });
    }

    // ANNOUNCEMENT: STAFF ONLY
    if (name === 'announce') {
      if (!await hasStaffPermission(interaction, 'staff')) {
        return deny(interaction);
      }

      await interaction.deferReply({ ephemeral: true });

      const message = interaction.options.getString('message', true);
      const channel = interaction.options.getChannel('channel');

      // Queue announcement for the Minecraft plugin.
      const result = await api('/v1/announcements', 'POST', {
        message,
        actor: interaction.user.id
      });

      let discordPosted = false;

      // Optional Discord channel.
      if (channel) {
        try {
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('📢 LegacyMC Announcement')
                .setDescription(message)
                .setColor(0x36b37e)
                .setFooter({ text: `Posted by ${interaction.user.username}` })
                .setTimestamp()
            ]
          });

          discordPosted = true;
        } catch {
          return interaction.editReply(
            `The Minecraft announcement was queued (ID: ${result.id}), ` +
            'but I could not post in the selected Discord channel. ' +
            'Check the bot’s channel permissions.'
          );
        }
      }

      return interaction.editReply(
        '✅ Announcement queued for Minecraft.' +
        (channel
          ? (discordPosted ? ' Also posted in Discord.' : '')
          : ' No Discord channel was selected.')
      );
    }

    // NEW COIN COMMANDS AND EXISTING ALIASES
    if (['addcoin', 'takecoin', 'givecoins', 'takecoins'].includes(name)) {
      if (!await hasStaffPermission(interaction, 'staff')) {
        return deny(interaction);
      }

      await interaction.deferReply({ ephemeral: true });

      const username = interaction.options.getString('player', true);
      const player = findPlayer(username);

      if (!player) {
        return interaction.editReply(
          'Player not found. They must join the Minecraft server at least once.'
        );
      }

      const amount = interaction.options.getInteger('amount', true);
      const adding = name === 'addcoin' || name === 'givecoins';
      const signedAmount = adding ? amount : -amount;
      const reason = interaction.options.getString('reason', true);

      const result = await api('/v1/coins/adjust', 'POST', {
        uuid: player.uuid,
        amount: signedAmount,
        actor: interaction.user.id,
        reason
      });

      return interaction.editReply(
        `${adding ? 'Added' : 'Removed'} ${amount} coins for **${player.username}**. ` +
        `New balance: **${result.balance}** coins.\nReason: ${reason}`
      );
    }

    // LINK ACCOUNT
    if (name === 'minelink') {
      await interaction.deferReply({ ephemeral: true });

      const result = await api('/v1/links/verify', 'POST', {
        code: interaction.options.getString('code', true),
        discordId: interaction.user.id
      });

      return interaction.editReply(
        `Linked successfully to Minecraft account **${result.link.username}**.`
      );
    }

    if (name === 'mineunlink') {
      await api(`/v1/links/${interaction.user.id}`, 'DELETE');

      return interaction.reply({
        content: 'Your account link was removed.',
        ephemeral: true
      });
    }

    if (name === 'mineaccount') {
      const result = await api(`/v1/links/${interaction.user.id}`);

      return interaction.reply({
        content: result.link
          ? `Linked Minecraft account: **${result.link.username}**`
          : 'No Minecraft account linked.',
        ephemeral: true
      });
    }

    // LEADERBOARD
    if (name === 'mineleaderboard') {
      await interaction.deferReply();

      const type = interaction.options.getString('type', true);
      const result = await api(`/v1/leaderboards/${type}`);

      const lines = result.rows.map((player, index) => {
        const value = type === 'playtime'
          ? `${Math.floor((player.playtimeTicks || 0) / 20 / 60)} min`
          : player[type];

        return `${index + 1}. **${player.username}** — ${value}`;
      }).join('\n') || 'No data recorded yet.';

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`LegacyMC • ${type} leaderboard`)
            .setDescription(lines)
            .setColor(0x36b37e)
        ]
      });
    }

    // COIN BALANCE
    if (name === 'minebalance') {
      const link = links.get(interaction.user.id);

      if (!link) {
        return interaction.reply({
          content: 'Link your account first using `/discordlink` in Minecraft and `/minelink` in Discord.',
          ephemeral: true
        });
      }

      return interaction.reply({
        content: `Community coins: **${coins.get(link.uuid)}**`,
        ephemeral: true
      });
    }

    // PLAYER STATS
    if (name === 'minestats') {
      const username = interaction.options.getString('player', true);
      const player = findPlayer(username);

      if (!player) {
        return interaction.reply({
          content: 'No stats found. The player must join after the plugin is installed.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`Stats • ${player.username}`)
        .addFields(
          { name: 'Kills', value: String(player.kills || 0), inline: true },
          { name: 'Deaths', value: String(player.deaths || 0), inline: true },
          {
            name: 'Playtime',
            value: `${Math.floor((player.playtimeTicks || 0) / 20 / 3600)} hours`,
            inline: true
          },
          {
            name: 'Money',
            value: player.money == null ? 'Unavailable' : String(player.money),
            inline: true
          },
          {
            name: 'Community coins',
            value: String(coins.get(player.uuid)),
            inline: true
          }
        )
        .setColor(0x5865f2);

      return interaction.reply({ embeds: [embed] });
    }

    // MODERATION REQUESTS
    if (['minekick', 'mineban', 'minetempban', 'mineunban'].includes(name)) {
      if (!await hasStaffPermission(interaction, 'moderation')) {
        return deny(interaction);
      }

      await interaction.deferReply({ ephemeral: true });

      const body = {
        type: {
          minekick: 'kick',
          mineban: 'ban',
          minetempban: 'tempban',
          mineunban: 'unban'
        }[name],
        player: interaction.options.getString('player', true),
        reason: interaction.options.getString('reason', true),
        hours: interaction.options.getInteger('hours'),
        actor: interaction.user.id
      };

      const result = await api('/v1/moderation', 'POST', body);

      return interaction.editReply(
        `Request **${result.id}** was recorded as **${result.status}**. ` +
        'This starter records moderation requests but does not execute them in Minecraft.'
      );
    }

    // SERVER STATUS
    if (name === 'minestatus') {
      const server = players.get('__server__');

      return interaction.reply({
        content: server
          ? `Last heartbeat: ${Math.floor((Date.now() - server.heartbeat) / 1000)} seconds ago · Online: ${server.online}/${server.max}`
          : 'No server heartbeat received yet.',
        ephemeral: true
      });
    }
  } catch (error) {
    const message = `Error: ${error.message}`.slice(0, 1800);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({
        content: message,
        ephemeral: true
      }).catch(() => {});
    }
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`SneakSMP API listening on ${port}`);
});

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

client.login(token);
