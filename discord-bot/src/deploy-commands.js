import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
if(!process.env.DISCORD_TOKEN||!process.env.CLIENT_ID||!process.env.GUILD_ID) throw new Error('Set DISCORD_TOKEN, CLIENT_ID, GUILD_ID in .env');
const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:commands});
console.log(`Registered ${commands.length} guild slash commands.`);
