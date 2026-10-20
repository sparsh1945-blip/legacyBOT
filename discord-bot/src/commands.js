import { SlashCommandBuilder } from 'discord.js';

const player = name => ({type:3,name,description:'Minecraft username',required:true});
const reason = {type:3,name:'reason',description:'Reason for this action',required:true};
export const commands = [
 new SlashCommandBuilder().setName('minelink').setDescription('Link your Minecraft account').addStringOption(o=>o.setName('code').setDescription('Code from /discordlink').setRequired(true)),
 new SlashCommandBuilder().setName('mineunlink').setDescription('Unlink your Minecraft account'),
 new SlashCommandBuilder().setName('mineaccount').setDescription('Show your linked Minecraft account'),
 new SlashCommandBuilder().setName('mineleaderboard').setDescription('Show a Minecraft leaderboard').addStringOption(o=>o.setName('type').setDescription('Leaderboard type').setRequired(true).addChoices(...['kills','deaths','money','playtime','coins'].map(x=>({name:x,value:x})))),
 new SlashCommandBuilder().setName('minestats').setDescription('Show Minecraft stats').addStringOption(o=>o.setName('player').setDescription('Minecraft username').setRequired(true)),
 new SlashCommandBuilder().setName('minebalance').setDescription('Show your community coin balance'),
 new SlashCommandBuilder().setName('givecoins').setDescription('Give community coins (staff only)').addStringOption(o=>o.setName('player').setDescription('Minecraft username').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Positive coin amount').setRequired(true).setMinValue(1).setMaxValue(100000000)).addStringOption(o=>o.setName('reason').setDescription('Audit reason').setRequired(true)),
 new SlashCommandBuilder().setName('takecoins').setDescription('Take community coins (staff only)').addStringOption(o=>o.setName('player').setDescription('Minecraft username').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Positive coin amount').setRequired(true).setMinValue(1).setMaxValue(100000000)).addStringOption(o=>o.setName('reason').setDescription('Audit reason').setRequired(true)),
 new SlashCommandBuilder().setName('minekick').setDescription('Request a Minecraft kick (staff only)').addStringOption(o=>o.setName('player').setDescription('Minecraft username').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
 new SlashCommandBuilder().setName('mineban').setDescription('Request a Minecraft ban (staff only)').addStringOption(o=>o.setName('player').setDescription('Minecraft username').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
 new SlashCommandBuilder().setName('minetempban').setDescription('Request a temporary ban (staff only)').addStringOption(o=>o.setName('player').setDescription('Minecraft username').setRequired(true)).addIntegerOption(o=>o.setName('hours').setDescription('Duration in hours').setRequired(true).setMinValue(1).setMaxValue(8760)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
 new SlashCommandBuilder().setName('mineunban').setDescription('Request an unban (staff only)').addStringOption(o=>o.setName('player').setDescription('Minecraft username').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
 new SlashCommandBuilder().setName('minestatus').setDescription('Show server heartbeat status')
].map(c=>c.toJSON());
