import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { app } from './api.js';
import { players, links, coins } from './store.js';

const token=process.env.DISCORD_TOKEN;
if(!token||!process.env.API_TOKEN) throw new Error('Set DISCORD_TOKEN and API_TOKEN in .env');
const client=new Client({intents:[GatewayIntentBits.Guilds]});
const base=`http://127.0.0.1:${process.env.PORT||8787}`;
async function api(path,method='GET',body) {
 const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${process.env.API_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(data.error||`API HTTP ${r.status}`);
 return data;
}
function isOwnerOrDevOrAdmin(i) {
 const ids=[...(process.env.OWNER_IDS||'').split(','),...(process.env.DEVELOPER_IDS||'').split(',')].filter(Boolean);
 const roles=[...(process.env.ADMIN_ROLE_IDS||'').split(',')].filter(Boolean);
 return ids.includes(i.user.id)||i.member?.roles?.cache?.some(r=>roles.includes(r.id));
}
function isMod(i) {
 const roles=[...(process.env.ADMIN_ROLE_IDS||'').split(','),...(process.env.MOD_ROLE_IDS||'').split(',')].filter(Boolean);
 const ids=[...(process.env.OWNER_IDS||'').split(','),...(process.env.DEVELOPER_IDS||'').split(',')].filter(Boolean);
 return ids.includes(i.user.id)||i.member?.roles?.cache?.some(r=>roles.includes(r.id));
}
client.on('interactionCreate',async i=>{
 if(!i.isChatInputCommand())return;
 try {
  const name=i.commandName;
  if(name==='minelink'){
   await i.deferReply({ephemeral:true});
   const d=await api('/v1/links/verify','POST',{code:i.options.getString('code'),discordId:i.user.id});
   return i.editReply(`Linked successfully to Minecraft account **${d.link.username}**.`);
  }
  if(name==='mineunlink'){
   await api(`/v1/links/${i.user.id}`,'DELETE');
   return i.reply({content:'Your account link was removed.',ephemeral:true});
  }
  if(name==='mineaccount'){
   const d=await api(`/v1/links/${i.user.id}`);
   return i.reply({content:d.link?`Linked Minecraft account: **${d.link.username}**`:'No Minecraft account linked.',ephemeral:true});
  }
  if(name==='mineleaderboard'){
   await i.deferReply();
   const type=i.options.getString('type');const d=await api(`/v1/leaderboards/${type}`);
   const lines=d.rows.map((p,n)=>`${n+1}. **${p.username}** — ${type==='playtime'?Math.floor((p.playtimeTicks||0)/20/60)+' min':p[type]}`).join('\n')||'No data recorded yet.';
   return i.editReply({embeds:[new EmbedBuilder().setTitle(`SneakSMP • ${type} leaderboard`).setDescription(lines).setColor(0x36b37e)]});
  }
  if(name==='minebalance'){
   const link=links.get(i.user.id);if(!link)return i.reply({content:'Link your Minecraft account first with `/discordlink` in-game and `/minelink` here.',ephemeral:true});
   return i.reply({content:`Community coins: **${coins.get(link.uuid)}**`,ephemeral:true});
  }
  if(name==='minestats'){
   const query=i.options.getString('player').toLowerCase();
   const p=Object.values(players.all()).find(p=>p.username?.toLowerCase()===query);
   if(!p)return i.reply({content:'No stats found. The player must join after the plugin is installed.',ephemeral:true});
   return i.reply({embeds:[new EmbedBuilder().setTitle(`Stats • ${p.username}`).addFields(
    {name:'Kills',value:String(p.kills||0),inline:true},{name:'Deaths',value:String(p.deaths||0),inline:true},
    {name:'Playtime',value:`${Math.floor((p.playtimeTicks||0)/20/3600)} hours`,inline:true},
    {name:'Money',value:p.money==null?'Unavailable':String(p.money),inline:true},
    {name:'Community coins',value:String(coins.get(p.uuid)),inline:true}
   ).setColor(0x5865f2)]});
  }
  if(name==='givecoins'||name==='takecoins'){
   if(!isOwnerOrDevOrAdmin(i))return i.reply({content:'You do not have permission for this command.',ephemeral:true});
   await i.deferReply({ephemeral:true});
   const username=i.options.getString('player');const p=Object.values(players.all()).find(p=>p.username?.toLowerCase()===username.toLowerCase());
   if(!p)return i.editReply('Player not found. They must join the server at least once.');
   const amount=i.options.getInteger('amount')*(name==='givecoins'?1:-1);
   const d=await api('/v1/coins/adjust','POST',{uuid:p.uuid,amount,actor:i.user.id,reason:i.options.getString('reason')});
   return i.editReply(`${name==='givecoins'?'Added':'Removed'} coins. **${p.username}** now has **${d.balance}** community coins.`);
  }
  if(['minekick','mineban','minetempban','mineunban'].includes(name)){
   if(!isMod(i))return i.reply({content:'You do not have permission for this command.',ephemeral:true});
   await i.deferReply({ephemeral:true});
   const body={type:{minekick:'kick',mineban:'ban',minetempban:'tempban',mineunban:'unban'}[name],player:i.options.getString('player'),reason:i.options.getString('reason'),hours:i.options.getInteger('hours'),actor:i.user.id};
   const d=await api('/v1/moderation','POST',body);
   return i.editReply(`Request **${d.id}** was recorded as **${d.status}**. Actual Minecraft execution is not enabled in this starter; configure and test the server command worker before relying on punishments.`);
  }
  if(name==='minestatus'){
   const p=players.get('__server__');
   return i.reply({content:p?`Last heartbeat: ${Math.floor((Date.now()-p.heartbeat)/1000)} seconds ago · Online: ${p.online}/${p.max}`:'No server heartbeat received yet.',ephemeral:true});
  }
 } catch(e) {
  const msg=`Error: ${e.message}`.slice(0,1800);
  if(i.deferred||i.replied) await i.editReply(msg).catch(()=>{});
  else await i.reply({content:msg,ephemeral:true}).catch(()=>{});
 }
});
app.listen(Number(process.env.PORT||8787),'0.0.0.0',()=>console.log(`SneakSMP API listening on ${process.env.PORT||8787}`));
client.once('ready',()=>console.log(`Discord bot logged in as ${client.user.tag}`));
client.login(token);
