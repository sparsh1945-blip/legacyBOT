
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

const memberMessageCommand = (name, description) => {
  const command = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addSubcommand(s =>
      s.setName('panel')
        .setDescription('Open the interactive setup dashboard')
    );

  if (name !== 'welcome') {
    command.addSubcommand(s =>
      s.setName('set')
        .setDescription('Create or edit the member message')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Text channel where the embed will be sent')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('message')
            .setDescription('Embed text; animated emojis and placeholders are supported')
            .setRequired(true)
            .setMaxLength(4000)
        )
        .addStringOption(o =>
          o.setName('title')
            .setDescription('Optional embed title template')
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('Optional direct image URL, including a Discord upload link')
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addStringOption(o =>
          o.setName('color')
            .setDescription('Optional embed color, e.g. #22C7D6')
            .setRequired(false)
            .setMaxLength(7)
        )
        .addStringOption(o =>
          o.setName('emoji')
            .setDescription('Optional emoji for the {emoji} placeholder; custom animated emojis work')
            .setRequired(false)
            .setMaxLength(100)
        )
    );
  }

  return command
    .addSubcommand(s =>
      s.setName('test')
        .setDescription('Send a preview to the configured channel')
    )
    .addSubcommand(s =>
      s.setName('show')
        .setDescription('Show the saved channel and message settings')
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription('Turn off this member message')
    );
};

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
    .setName('ask')
    .setDescription('Ask the NVIDIA Nemotron AI assistant')
    .addStringOption(o =>
      o.setName('question')
        .setDescription('What would you like to ask?')
        .setRequired(true)
        .setMaxLength(1500)
    ),

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
    .setName('setup')
    .setDescription('Open the interactive welcome setup dashboard (staff only)'),

  memberMessageCommand('welcome', 'Configure the server welcome embed'),

  memberMessageCommand('leave', 'Configure the server leave embed'),

  new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Check invite totals and server invite leaderboard')
    .addSubcommand(s =>
      s.setName('check')
        .setDescription('Show invite totals for you or another member')
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Member whose invite totals to view')
            .setRequired(false)
        )
    )
    .addSubcommand(s =>
      s.setName('leaderboard')
        .setDescription('Show the top inviters in this server')
    )
    .addSubcommand(s =>
      s.setName('logchannel')
        .setDescription('Set the staff invite log channel')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Text channel for join and invite attribution logs')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),

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
