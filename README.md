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
- Discord bot application with `applications.commands` and `bot` scopes; invite with Send Messages, Embed Links, Use Application Commands permissions. Enable the Message Content privileged intent in the Discord Developer Portal so auto-replies can read messages, and the Server Members Intent for welcome/leave events. Invite attribution needs Manage Server so Discord includes invite usage metadata; View Audit Log alone does not include the usage counts this tracker needs.

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
Set `NVIDIA_API_KEY` to your NVIDIA API key to enable SneakAI. Staff use `/setupsneakai` to add or remove dedicated AI channels; members can type normally in those channels and get replies only there. Mention the bot with a question to start an AI session in any channel; mention it with `stop` to clear that session's AI context and messages. The bot needs **Manage Messages** to delete member messages during cleanup. `/ask question:<text>` is also limited to a configured channel. Nemotron 3 Ultra is the default model; `NVIDIA_MODEL` can override the model ID. Keep API keys private and restart the bot after changing `.env`.
Use a strong random API token (32+ random bytes). Do not commit `.env`.

## 3. Commands
Minecraft:
- `/discordlink` — generate a five-minute, one-use code.
- `/sneaksmp reload` — reload config (console or `sneaksmp.admin`).

Discord:
- `/setupsneakai` — open the staff-only SneakAI panel with **Add Channel**, **Remove Channel**, and **Requirements** buttons.
- In a configured SneakAI channel, members can send a normal message to get an AI response (requires `NVIDIA_API_KEY`; one request per user every 15 seconds).
- Mention the bot with a question to start a session in that channel; mention it with `stop` to clear the session context and session messages.
- `/ask question:<text>` — ask the AI from a configured SneakAI channel.
- `/givecoins player:<Minecraft username> amount:<positive number> reason:<text>`
- `/takecoins player:<Minecraft username> amount:<positive number> reason:<text>`
- `/setup` — open the staff-only welcome setup dashboard shown as an interactive panel.
- `/welcome panel` and `/leave panel` — open the matching welcome or leave dashboard.
- `/leave set channel:<channel> message:<text> title:<optional> image_url:<optional> color:<optional> emoji:<optional>` — configure the member leave card (staff only). Configure welcome messages through `/welcome panel` or `/setup`.
- `/welcome test|show|disable` and `/leave test|show|disable` — preview, inspect, or turn off each card (staff only).
- Welcome and leave messages send editable text above a generated card with the member's avatar, account username, server name, and member number. The configured image URL is downloaded and cached in the bot's data folder so Discord upload links continue working after their URL expires. A dark gradient is used if no image is set.
- The dashboards include channel selection, enable/disable, preview, message and image editing, placeholders, reset, up to five link buttons, accent color, and member ping/message auto-delete settings.
- `/invites check user:<optional member>` — show total joins, active members, fake joins, seven-day rejoins, and departures; available to everyone.
- `/invites leaderboard` — show top inviters with active, fake, and rejoin counts; available to everyone.
- `/invites logchannel channel:<channel>` — configure join attribution logs (staff only).
- `/autoresponder add trigger:<word or phrase> reply:<text> matchmode:<optional>` — add a normal text auto-reply.
- `/autoresponder embed add trigger:<word or phrase> reply:<text> matchmode:<optional> title:<optional> color:<optional HEX>` — add an embed containing only the optional custom title and reply text.
- Both command paths support `edit`, `editreply`, `editmatchmode`, `remove`, `delete`, `show`, `showraw`, `list`, `help`, and `panel`. Each path manages its own reply type and provides Add/Manage/List buttons.
- `/autoresponder help` is available to everyone. All other autoresponder actions are restricted to staff. Add/edit/remove save immediately; the visual panel requires clicking **Save Changes**. `contains` is the default match mode; `exact`, `starts_with`, and `ends_with` are also available. Up to 25 triggers are supported per server. Run `npm run deploy` after updating the bot to register the command changes.

Welcome and leave message templates accept `{username}`, `{displayname}`, `{mention}`, `{server}`, `{member_count}`, `{member_number}`, `{join_date}`, `{inviter}`, `{invites}`, `{active_invites}`, `{emoji}`, and `{avatar}`. Type Discord custom emoji markup (including animated emoji markup) directly in the text above the card, or set `emoji` and use `{emoji}`. `image_url` accepts a direct HTTP(S) image URL, including a Discord CDN upload link; the bot checks the link and saves a local copy. Invite counts begin after the tracker is running with invite usage metadata access; earlier joins cannot be recovered. If invite access is unavailable or a member uses an untracked link, the join is counted as unattributed.

Invite tracking labels accounts created within the past seven days as fake joins. A member who returns within seven days is credited to the original inviter and counted as a rejoin rather than a fresh invite.

## Permission configuration
In `discord-bot/.env`, set `OWNER_IDS`, `DEVELOPER_IDS`, `ADMIN_ROLE_IDS` as comma-separated Discord IDs.
Owner/developer/admin are checked for coin commands; owner/developer/admin for bans/unbans; owner/developer/admin/mod role IDs for kick/tempban. The starter uses Discord role IDs, not role names.

## Data and limitations
- API JSON storage is single-instance local file storage. Do not run multiple API instances against the same data directory.
- Welcome/leave configuration and invite history are stored in `discord-bot/data/community-settings.json`; keep this file with the bot's data when moving the service.
- Minecraft kills/deaths/playtime are recorded by this plugin for events observed after installation. It does not retroactively reconstruct past playtime/kills.
- Money is read via Vault when a player is online; offline money depends on the economy provider and is marked unavailable if not supported.
- This starter's moderation API queue is a framework; production use should add command acknowledgement polling, robust queue recovery, and test against your exact LiteBans version before using bans on a live server.
- Never put the Discord bot token or API token into public repositories or share them in screenshots.
