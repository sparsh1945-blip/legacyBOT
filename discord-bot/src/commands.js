
import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ApplicationCommandOptionType
} from 'discord.js';

const playerOption = name =>
  name
    .setName('player')
    .setDescription('Minecraft username')
    .setRequired(true);

const amountOption = name =>
  name
    .setName('amount')
    .setDescription('Positive coin amount')
    .setRequired(true)
    .setMinValue(1)
    .setMaxValue(100000000);

const reasonOption = name =>
  name
    .setName('reason')
    .setDescription('Reason for this action')
    .setRequired(true);

const matchModeChoices = [
  { name: 'Contains phrase', value: 'contains' },
  { name: 'Exact message', value: 'exact' },
  { name: 'Starts with', value: 'starts_with' },
  { name: 'Ends with', value: 'ends_with' }
];

export const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show LegacyMC bot commands and help'),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send a Minecraft server announcement (staff only)')
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Announcement message')
        .setRequired(true)
        .setMaxLength(1000)
    )
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Optional Discord channel to announce in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('addcoin')
    .setDescription('Add community coins to a player (staff only)')
    .addStringOption(playerOption)
    .addIntegerOption(amountOption)
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('takecoin')
    .setDescription('Remove community coins from a player (staff only)')
    .addStringOption(playerOption)
    .addIntegerOption(amountOption)
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('minelink')
    .setDescription('Link your Minecraft account')
    .addStringOption(o =>
      o.setName('code')
        .setDescription('Code from /discordlink')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('mineunlink')
    .setDescription('Unlink your Minecraft account'),

  new SlashCommandBuilder()
    .setName('mineaccount')
    .setDescription('Show your linked Minecraft account'),

  new SlashCommandBuilder()
    .setName('mineleaderboard')
    .setDescription('Show a Minecraft leaderboard')
    .addStringOption(o =>
      o.setName('type')
        .setDescription('Leaderboard type')
        .setRequired(true)
        .addChoices(
          ...['kills', 'deaths', 'money', 'playtime', 'coins']
            .map(x => ({ name: x, value: x }))
        )
    ),

  new SlashCommandBuilder()
    .setName('minestats')
    .setDescription('Show Minecraft stats')
    .addStringOption(o =>
      o.setName('player')
        .setDescription('Minecraft username')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('minebalance')
    .setDescription('Show your community coin balance'),

  new SlashCommandBuilder()
    .setName('givecoins')
    .setDescription('Give community coins (staff only)')
    .addStringOption(playerOption)
    .addIntegerOption(amountOption)
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('takecoins')
    .setDescription('Take community coins (staff only)')
    .addStringOption(playerOption)
    .addIntegerOption(amountOption)
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('minekick')
    .setDescription('Request a Minecraft kick (staff only)')
    .addStringOption(playerOption)
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('mineban')
    .setDescription('Request a Minecraft ban (staff only)')
    .addStringOption(playerOption)
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('minetempban')
    .setDescription('Request a temporary ban (staff only)')
    .addStringOption(playerOption)
    .addIntegerOption(o =>
      o.setName('hours')
        .setDescription('Duration in hours')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(8760)
    )
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('mineunban')
    .setDescription('Request an unban (staff only)')
    .addStringOption(playerOption)
    .addStringOption(reasonOption),

  new SlashCommandBuilder()
    .setName('minestatus')
    .setDescription('Show server heartbeat status'),

  new SlashCommandBuilder()
    .setName('custommsg')
    .setDescription('Send a custom embed message (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel where the embed will be sent')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('title')
        .setDescription('Embed title')
        .setRequired(true)
        .setMaxLength(256)
    )
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Embed description')
        .setRequired(true)
        .setMaxLength(4000)
    )
    .addStringOption(o =>
      o.setName('color')
        .setDescription('Hex color, e.g. #5865F2')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('autoresponder')
    .setDescription('Manage automatic keyword and phrase replies')
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add an embedded or normal text auto-reply')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Word or phrase that triggers the reply')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption(o =>
          o.setName('reply')
            .setDescription('Message text shown inside the reply embed')
            .setRequired(true)
            .setMaxLength(2000)
        )
        .addStringOption(o =>
          o.setName('matchmode')
            .setDescription('How a message must match this trigger')
            .setRequired(false)
            .addChoices(...matchModeChoices)
        )
        .addStringOption(o =>
          o.setName('title')
            .setDescription('Optional title shown above the reply')
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption(o =>
          o.setName('color')
            .setDescription('Optional embed color, HEX such as #22C7D6')
            .setRequired(false)
            .setMaxLength(7)
        )
    )
    .addSubcommand(s =>
      s.setName('edit')
        .setDescription('Edit an auto-reply')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Current trigger word or phrase')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption(o =>
          o.setName('reply')
            .setDescription('New reply text')
            .setRequired(true)
            .setMaxLength(2000)
        )
        .addStringOption(o =>
          o.setName('new-trigger')
            .setDescription('Optional replacement trigger word or phrase')
            .setRequired(false)
            .setMaxLength(100)
        )
        .addStringOption(o =>
          o.setName('title')
            .setDescription('Optional embed title')
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption(o =>
          o.setName('color')
            .setDescription('Optional embed color, HEX such as #22C7D6')
            .setRequired(false)
            .setMaxLength(7)
        )
    )
    .addSubcommand(s =>
      s.setName('editreply')
        .setDescription('Edit the reply text of an auto-responder')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Trigger word or phrase to edit')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption(o =>
          o.setName('reply')
            .setDescription('New reply text')
            .setRequired(true)
            .setMaxLength(2000)
        )
    )
    .addSubcommand(s =>
      s.setName('editmatchmode')
        .setDescription('Edit how an auto-responder matches messages')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Trigger word or phrase to edit')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('How a message must match this trigger')
            .setRequired(true)
            .addChoices(...matchModeChoices)
        )
    )
    .addSubcommand(s =>
      s.setName('delete')
        .setDescription('Delete an auto-reply')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Trigger word or phrase to delete')
            .setRequired(true)
            .setMaxLength(100)
        )
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription('Remove an auto-responder')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Trigger word or phrase to remove')
            .setRequired(true)
            .setMaxLength(100)
        )
    )
    .addSubcommand(s =>
      s.setName('show')
        .setDescription('Show an auto-responder')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Trigger word or phrase to show')
            .setRequired(true)
            .setMaxLength(100)
        )
    )
    .addSubcommand(s =>
      s.setName('showraw')
        .setDescription('Show an auto-responder reply as plain text')
        .addStringOption(o =>
          o.setName('trigger')
            .setDescription('Trigger word or phrase to show')
            .setRequired(true)
            .setMaxLength(100)
        )
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List this server’s auto-reply triggers')
    )
    .addSubcommand(s =>
      s.setName('help')
        .setDescription('Show auto-reply commands, options, and examples')
    )
    .addSubcommand(s =>
      s.setName('panel')
        .setDescription('Open the embed auto-reply editor')
    )
].map(command => command.toJSON());

const autoReplyCommand = commands.find(command => command.name === 'autoresponder');
const embedReplySubcommands = structuredClone(autoReplyCommand.options);

autoReplyCommand.description = 'Manage automatic keyword and phrase replies';
autoReplyCommand.options.find(option => option.name === 'add').description = 'Add a normal text auto-reply';
autoReplyCommand.options.find(option => option.name === 'add').options.find(option => option.name === 'reply').description = 'Normal text sent as the reply';
autoReplyCommand.options.find(option => option.name === 'panel').description = 'Open the normal text auto-reply editor';

embedReplySubcommands.find(option => option.name === 'add').description = 'Add an embedded auto-reply';
embedReplySubcommands.find(option => option.name === 'add').options.find(option => option.name === 'reply').description = 'Reply text shown inside the embed';
embedReplySubcommands.find(option => option.name === 'panel').description = 'Open the embedded auto-reply editor';

for (const subcommand of autoReplyCommand.options) {
  if (['add', 'edit'].includes(subcommand.name)) {
    subcommand.options = subcommand.options.filter(option => !['title', 'color'].includes(option.name));
  }
}

autoReplyCommand.options.push({
  type: ApplicationCommandOptionType.SubcommandGroup,
  name: 'embed',
  description: 'Manage embedded auto-replies',
  options: embedReplySubcommands
});
