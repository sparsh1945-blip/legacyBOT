# SneakSMP Bridge V1 (no external database)

Starter project for Paper 1.21.11 + Discord bot + local JSON API.
- Minecraft plugin: Java 21, Paper API, Vault hook.
- Discord bot/API: Node.js 20+, discord.js v14, Express.
- Local JSON files only. No Firebase, Firestore, or SQL.
- Includes linking flow, leaderboard/stat endpoints, community coins, and moderation command framework.

## Important scope
This is a starter implementation, not a deployed service. Test on a separate server first.
The bot/API must run on a machine reachable by the Minecraft host over HTTPS in production.
For local testing, HTTP can be used only on a trusted private network. Do not expose an unauthenticated API publicly.
The plugin's outbound API calls use a shared bearer token. Set the same strong random token in plugin `config.yml` and API `.env`.
For offline/cracked servers, UUIDs can be impersonated unless the server/proxy authentication is properly secured. Linking proves only that the in-game session could run the command; secure offline authentication before public deployment.

## Requirements
- Java 21 JDK
- Paper 1.21.11
- Vault + a compatible economy plugin (EssentialsX Economy is common)
- Node.js 20+
- Discord bot application with `applications.commands` and `bot` scopes; invite with Send Messages, Embed Links, Use Application Commands permissions. Enable the Message Content privileged intent in the Discord Developer Portal so auto-replies can read messages.

## 1. Build the plugin
From `minecraft-plugin/`:
```bash
gradle build
```
or open the folder in IntelliJ IDEA and run Gradle `build`.
Copy `build/libs/SneakSMPBridge-1.0.0.jar` to the server's `plugins/` folder, restart the server, then edit `plugins/SneakSMPBridge/config.yml`.
Set `api-base-url` to the API address and `api-token` to the same token configured in the API.
Restart the server after changing config.

## 2. Run Discord bot/API
From `discord-bot/`:
```bash
npm install
copy .env.example .env
```
On Linux/macOS use `cp .env.example .env`.
Edit `.env`, then:
```bash
npm start
```
On first run, JSON storage is created under `discord-bot/data/`.
Register slash commands:
```bash
npm run deploy
```
Set `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, and `API_TOKEN`.
Use a strong random API token (32+ random bytes). Do not commit `.env`.

## 3. Commands
Minecraft:
- `/discordlink` — generate a five-minute, one-use code.
- `/sneaksmp reload` — reload config (console or `sneaksmp.admin`).

Discord:
- `/minelink code:<code>`
- `/mineunlink`
- `/mineaccount`
- `/mineleaderboard type:<kills|deaths|money|playtime|coins>`
- `/minestats player:<Minecraft username>`
- `/minebalance`
- `/givecoins player:<Minecraft username> amount:<positive number> reason:<text>`
- `/takecoins player:<Minecraft username> amount:<positive number> reason:<text>`
- `/minekick player:<Minecraft username> reason:<text>`
- `/mineban player:<Minecraft username> reason:<text>`
- `/minetempban player:<Minecraft username> hours:<number> reason:<text>`
- `/mineunban player:<Minecraft username> reason:<text>`
- `/minestatus`
- `/autoresponder add trigger:<word or phrase> reply:<text> replytype:<optional embed|text> matchmode:<optional> title:<optional> color:<optional HEX>` — add an embedded or normal text auto-reply.
- `/autoresponder editreply trigger:<trigger> reply:<new text> replytype:<optional embed|text>` — change a saved reply and optionally switch its message type. `/autoresponder editmatchmode trigger:<trigger> mode:<contains|exact|starts_with|ends_with>` — change how its trigger matches.
- `/autoresponder show trigger:<trigger>` and `/autoresponder showraw trigger:<trigger>` — inspect a saved embed or its plain reply text.
- `/autoresponder remove trigger:<trigger>` and `/autoresponder list` — manage saved replies. `/autoresponder delete` remains available as an alias for `remove`.
- `/autoresponder edit` can also change the reply, trigger, type, title, or color. `/autoresponder help` shows options and examples; `/autoresponder panel` opens the visual editor. Up to 25 triggers are supported per server.

The add, edit, and remove commands save immediately. Replies default to embeds; choose `replytype:text` for a normal message. Embed title and HEX color (for example, `#22C7D6`) apply to embed replies. `contains` is the default match mode and matches a complete word or phrase, ignoring case; `exact`, `starts_with`, and `ends_with` are also available. The panel lets admins edit reply type and embed title/message/color and requires clicking **Save Changes**. Run `npm run deploy` after updating the bot to register the command.

## Permission configuration
In `discord-bot/.env`, set `OWNER_IDS`, `DEVELOPER_IDS`, `ADMIN_ROLE_IDS` as comma-separated Discord IDs.
Owner/developer/admin are checked for coin commands; owner/developer/admin for bans/unbans; owner/developer/admin/mod role IDs for kick/tempban. The starter uses Discord role IDs, not role names.

## Data and limitations
- API JSON storage is single-instance local file storage. Do not run multiple API instances against the same data directory.
- Minecraft kills/deaths/playtime are recorded by this plugin for events observed after installation. It does not retroactively reconstruct past playtime/kills.
- Money is read via Vault when a player is online; offline money depends on the economy provider and is marked unavailable if not supported.
- This starter's moderation API queue is a framework; production use should add command acknowledgement polling, robust queue recovery, and test against your exact LiteBans version before using bans on a live server.
- Never put the Discord bot token or API token into public repositories or share them in screenshots.
