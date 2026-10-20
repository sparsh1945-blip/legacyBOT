import express from 'express';
import crypto from 'node:crypto';
import { players, links, coins, codes, audit } from './store.js';

export const app = express();
app.use(express.json({limit:'32kb'}));
app.use((req,res,next) => {
  if (req.path === '/health') return next();
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  const expected = process.env.API_TOKEN || '';
  if (!expected || supplied.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(401).json({error:'unauthorized'});
  }
  next();
});
const cleanName = s => typeof s === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(s);
app.get('/health', (_,res) => res.json({ok:true,service:'sneaksmp-api'}));

app.post('/v1/links/create', (req,res) => {
  const {uuid,username} = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(uuid || '') || !cleanName(username)) return res.status(400).json({error:'invalid player'});
  const code = String(crypto.randomInt(100000,1000000));
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  codes.set(hash,{uuid,username,expires:Date.now()+300000});
  players.put(uuid,{uuid,username,lastSeen:Date.now()});
  res.json({code,expiresIn:300});
});
app.post('/v1/links/verify', (req,res) => {
  const {code,discordId} = req.body || {};
  if (!/^\d{6}$/.test(code || '') || !/^\d{17,20}$/.test(discordId || '')) return res.status(400).json({error:'invalid input'});
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  const challenge = codes.consume(hash);
  if (!challenge || challenge.expires < Date.now()) return res.status(400).json({error:'code expired or invalid'});
  const existing = links.discordForUuid(challenge.uuid);
  if (existing && existing !== discordId) return res.status(409).json({error:'Minecraft account already linked'});
  links.set(discordId,{uuid:challenge.uuid,username:challenge.username,linkedAt:Date.now()});
  audit({type:'link',discordId,uuid:challenge.uuid});
  res.json({ok:true,link:links.get(discordId)});
});
app.get('/v1/links/:discordId',(req,res) => res.json({link:links.get(req.params.discordId)}));
app.delete('/v1/links/:discordId',(req,res) => { links.remove(req.params.discordId); audit({type:'unlink',discordId:req.params.discordId}); res.json({ok:true}); });
app.post('/v1/players/upsert',(req,res) => {
  const {uuid,username}=req.body||{};
  if (!/^[0-9a-f-]{36}$/i.test(uuid||'') || !cleanName(username)) return res.status(400).json({error:'invalid player'});
  players.put(uuid,{uuid,username,lastSeen:Date.now()}); res.json({ok:true});
});
app.post('/v1/players/stats',(req,res) => {
  const {uuid,username,kills,deaths,playtimeTicks,money}=req.body||{};
  if (!/^[0-9a-f-]{36}$/i.test(uuid||'') || !cleanName(username)) return res.status(400).json({error:'invalid player'});
  const numeric = [kills,deaths,playtimeTicks].every(v => Number.isFinite(v) && v >= 0);
  if (!numeric) return res.status(400).json({error:'invalid stats'});
  players.put(uuid,{uuid,username,kills,deaths,playtimeTicks,money:Number.isFinite(money)&&money>=0?money:null,lastSeen:Date.now()});
  res.json({ok:true});
});
app.post('/v1/stats/kill',(req,res) => {
  const {uuid,username}=req.body||{}; if (!/^[0-9a-f-]{36}$/i.test(uuid||'')||!cleanName(username)) return res.status(400).json({error:'invalid player'});
  const p=players.get(uuid)||{uuid,username,kills:0,deaths:0,playtimeTicks:0}; players.put(uuid,{...p,username,kills:(p.kills||0)+1}); res.json({ok:true});
});
app.post('/v1/stats/death',(req,res) => {
  const {uuid,username}=req.body||{}; if (!/^[0-9a-f-]{36}$/i.test(uuid||'')||!cleanName(username)) return res.status(400).json({error:'invalid player'});
  const p=players.get(uuid)||{uuid,username,kills:0,deaths:0,playtimeTicks:0}; players.put(uuid,{...p,username,deaths:(p.deaths||0)+1}); res.json({ok:true});
});
app.post('/v1/server/heartbeat',(req,res)=>{ players.put('__server__',{...req.body,heartbeat:Date.now()});res.json({ok:true});});
app.get('/v1/players/:uuid/stats',(req,res)=>{const p=players.get(req.params.uuid);p?res.json(p):res.status(404).json({error:'not found'});});
app.get('/v1/leaderboards/:type',(req,res)=>{
 const type=req.params.type; const allowed=['kills','deaths','money','playtime','coins'];
 if(!allowed.includes(type))return res.status(400).json({error:'invalid type'});
 const data=Object.values(players.all()).filter(p=>p.uuid&&p.uuid!=='__server__');
 const rows=data.map(p=>({...p,coins:coins.get(p.uuid)})).filter(p=>Number.isFinite(type==='playtime'?p.playtimeTicks:p[type]));
 rows.sort((a,b)=>(Number(b[type])||0)-(Number(a[type])||0));
 res.json({type,rows:rows.slice(0,10)});
});
app.post('/v1/coins/adjust',(req,res)=>{
 const {uuid,amount,actor,reason}=req.body||{};
 if(!/^[0-9a-f-]{36}$/i.test(uuid||'')||!Number.isSafeInteger(amount)||amount===0||typeof actor!=='string'||typeof reason!=='string'||reason.length<2||reason.length>300) return res.status(400).json({error:'invalid input'});
 try {const balance=coins.adjust(uuid,amount);audit({type:'coin-adjust',uuid,amount,actor,reason,balance});res.json({ok:true,balance});}
 catch(e){res.status(400).json({error:e.message});}
});
app.get('/v1/coins/:uuid',(req,res)=>res.json({uuid:req.params.uuid,balance:coins.get(req.params.uuid)}));
app.post('/v1/moderation',(req,res)=>{
 const {type,player,reason,hours,actor}=req.body||{};
 if(!['kick','ban','tempban','unban'].includes(type)||!cleanName(player)||typeof reason!=='string'||reason.length<2||reason.length>300||typeof actor!=='string')return res.status(400).json({error:'invalid request'});
 const id=crypto.randomUUID(); audit({type:'moderation-request',id,action:type,player,reason,hours,actor,status:'queued'});
 // Starter records the request only. Actual server execution requires a verified command-queue worker.
 res.status(202).json({id,status:'queued',warning:'Execution worker must be configured before using moderation in production.'});
});
