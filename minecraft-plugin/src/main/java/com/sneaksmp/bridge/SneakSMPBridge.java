
package com.sneaksmp.bridge;

import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import net.milkbowl.vault.economy.Economy;

import org.bukkit.Bukkit;
import org.bukkit.Statistic;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class SneakSMPBridge extends JavaPlugin
        implements Listener {

    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F-]{36}$"
    );

    private static final Pattern PLAYER_NAME_PATTERN = Pattern.compile(
            "^[A-Za-z0-9_]{1,16}$"
    );

    private static final Pattern CODE_PATTERN = Pattern.compile(
            "\"code\"\\s*:\\s*\"(\\d{6})\""
    );

    private static final Pattern MESSAGE_PATTERN = Pattern.compile(
            "\"messageB64\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\""
    );

    private static final LegacyComponentSerializer LEGACY_SERIALIZER =
            LegacyComponentSerializer.legacyAmpersand();

    private HttpClient http;
    private Economy economy;

    private final AtomicBoolean announcementPollRunning =
            new AtomicBoolean(false);

    @Override
    public void onEnable() {
        saveDefaultConfig();

        http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();

        setupEconomy();
        getServer().getPluginManager().registerEvents(this, this);

        long interval = Math.max(
                30L,
                getConfig().getLong("stats-sync-interval-seconds", 60L)
        );

        // Bukkit player data is collected on the main thread.
        // API requests are made asynchronously.
        getServer().getScheduler().runTaskTimer(
                this,
                this::syncOnlineStats,
                100L,
                interval * 20L
        );

        // Poll the authenticated API every five seconds.
        getServer().getScheduler().runTaskTimerAsynchronously(
                this,
                this::pollAnnouncement,
                100L,
                100L
        );

        String base = getConfig().getString("api-base-url", "");
        String token = apiToken();

        getLogger().info("SneakSMP Bridge enabled.");
        getLogger().info("API URL configured: " +
                (base != null && !base.isBlank()));
        getLogger().info("API token configured: " +
                (token != null && !token.isBlank()));
    }

    @Override
    public void onDisable() {
        // Bukkit cancels this plugin's scheduled tasks automatically.
    }

    private void setupEconomy() {
        if (getServer().getPluginManager().getPlugin("Vault") == null) {
            getLogger().info(
                    "Vault not found. Money statistics will be unavailable."
            );
            return;
        }

        RegisteredServiceProvider<Economy> provider =
                getServer().getServicesManager()
                        .getRegistration(Economy.class);

        if (provider != null) {
            economy = provider.getProvider();
            getLogger().info("Vault economy hooked successfully.");
        } else {
            getLogger().info("No Vault economy provider found.");
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

        post(
                "/v1/players/upsert",
                "{\"uuid\":\"" + player.getUniqueId()
                        + "\",\"username\":\"" + esc(player.getName()) + "\"}"
        );
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        post("/v1/players/stats", statsJson(event.getPlayer()));
    }

    @EventHandler
    public void onDeath(PlayerDeathEvent event) {
        Player victim = event.getEntity();

        post(
                "/v1/stats/death",
                "{\"uuid\":\"" + victim.getUniqueId()
                        + "\",\"username\":\"" + esc(victim.getName()) + "\"}"
        );

        Player killer = victim.getKiller();

        if (killer != null) {
            post(
                    "/v1/stats/kill",
                    "{\"uuid\":\"" + killer.getUniqueId()
                            + "\",\"username\":\""
                            + esc(killer.getName()) + "\"}"
            );
        }
    }

    private void syncOnlineStats() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            post("/v1/players/stats", statsJson(player));
        }

        String heartbeat =
                "{\"online\":" + Bukkit.getOnlinePlayers().size()
                        + ",\"max\":" + Bukkit.getMaxPlayers()
                        + ",\"version\":\""
                        + esc(Bukkit.getMinecraftVersion()) + "\"}";

        post("/v1/server/heartbeat", heartbeat);
    }

    private String statsJson(Player player) {
        double money = -1;

        if (economy != null) {
            try {
                money = economy.getBalance(player);

                if (!Double.isFinite(money) || money < 0) {
                    money = -1;
                }
            } catch (Exception exception) {
                getLogger().fine(
                        "Could not read economy balance for "
                                + player.getName()
                );
            }
        }

        return "{\"uuid\":\"" + player.getUniqueId()
                + "\",\"username\":\"" + esc(player.getName())
                + "\",\"kills\":" + player.getStatistic(Statistic.PLAYER_KILLS)
                + ",\"deaths\":" + player.getStatistic(Statistic.DEATHS)
                + ",\"playtimeTicks\":"
                + player.getStatistic(Statistic.PLAY_ONE_MINUTE)
                + ",\"money\":" + money + "}";
    }

    @Override
    public boolean onCommand(
            CommandSender sender,
            Command command,
            String label,
            String[] args
    ) {
        if (command.getName().equalsIgnoreCase("discordlink")) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("Only players can link an account.");
                return true;
            }

            String body = "{\"uuid\":\"" + player.getUniqueId()
                    + "\",\"username\":\"" + esc(player.getName()) + "\"}";

            player.sendMessage("§7Requesting your Discord link code...");

            CompletableFuture.runAsync(() -> {
                String response = request(
                        "POST",
                        "/v1/links/create",
                        body
                );

                String code = extract(response, CODE_PATTERN);

                Bukkit.getScheduler().runTask(this, () -> {
                    if (!player.isOnline()) {
                        return;
                    }

                    if (code != null) {
                        player.sendMessage(
                                "§aYour Discord link code: §e" + code
                        );
                        player.sendMessage(
                                "§7Use it in Discord within 5 minutes."
                        );
                    } else {
                        player.sendMessage(
                                "§cCould not create a link code."
                        );
                        player.sendMessage(
                                "§7Check the Minecraft server console for the API error."
                        );
                    }
                });
            }).exceptionally(error -> {
                getLogger().warning("Link-code task failed.");
                return null;
            });

            return true;
        }

        if (command.getName().equalsIgnoreCase("sneaksmp")) {
            if (!sender.hasPermission("sneaksmp.admin")) {
                sender.sendMessage("§cYou do not have permission.");
                return true;
            }

            if (args.length == 1
                    && args[0].equalsIgnoreCase("reload")) {
                reloadConfig();
                sender.sendMessage("§aSneakSMP Bridge config reloaded.");
                return true;
            }

            sender.sendMessage("Usage: /sneaksmp reload");
            return true;
        }

        return false;
    }

    private void post(String path, String body) {
        CompletableFuture.runAsync(() -> request("POST", path, body))
                .exceptionally(error -> {
                    getLogger().warning(
                            "Background API task failed for " + path
                    );
                    return null;
                });
    }

    /**
     * Fetches one queued announcement.
     *
     * Network work happens asynchronously. Bukkit broadcasts are
     * scheduled back onto the main server thread.
     */
    private void pollAnnouncement() {
        if (!isEnabled()
                || !announcementPollRunning.compareAndSet(false, true)) {
            return;
        }

        try {
            String response = request(
                    "GET",
                    "/v1/announcements/next",
                    null
            );

            if (response.isBlank()) {
                return;
            }

            String encoded = extract(response, MESSAGE_PATTERN);

            // An empty queue returns {"announcement":null}.
            if (encoded == null || encoded.isBlank()) {
                return;
            }

            final String message;

            try {
                message = new String(
                        Base64.getDecoder().decode(encoded),
                        StandardCharsets.UTF_8
                );
            } catch (IllegalArgumentException exception) {
                getLogger().warning(
                        "Announcement contained invalid Base64 data."
                );
                return;
            }

            if (message.isBlank()) {
                return;
            }

            Bukkit.getScheduler().runTask(this, () -> {
                if (!isEnabled()) {
                    return;
                }

                Bukkit.broadcast(
                        LEGACY_SERIALIZER.deserialize(
                                "&8[&aLegacyMC&8] &f" + message
                        )
                );
            });

        } catch (Exception exception) {
            getLogger().warning(
                    "Could not process announcement: "
                            + exception.getClass().getSimpleName()
            );
        } finally {
            announcementPollRunning.set(false);
        }
    }

    private String request(String method, String path, String body) {
        try {
            String base = getConfig()
                    .getString("api-base-url", "")
                    .trim()
                    .replaceAll("/+$", "");

            if (base.isBlank()) {
                getLogger().severe(
                        "API base URL is missing in config.yml."
                );
                return "";
            }

            String token = apiToken();

            if (token == null || token.isBlank()) {
                getLogger().severe(
                        "API token is missing in config.yml."
                );
                return "";
            }

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(base + path))
                    .timeout(Duration.ofSeconds(15))
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json");

            if ("POST".equalsIgnoreCase(method)) {
                builder.POST(
                        HttpRequest.BodyPublishers.ofString(
                                body == null ? "{}" : body,
                                StandardCharsets.UTF_8
                        )
                );
            } else if ("GET".equalsIgnoreCase(method)) {
                builder.GET();
            } else if ("DELETE".equalsIgnoreCase(method)) {
                builder.DELETE();
            } else {
                getLogger().warning(
                        "Unsupported HTTP method: " + method
                );
                return "";
            }

            HttpResponse<String> response = http.send(
                    builder.build(),
                    HttpResponse.BodyHandlers.ofString(
                            StandardCharsets.UTF_8
                    )
            );

            int status = response.statusCode();
            String responseBody = response.body() == null
                    ? ""
                    : response.body();

            if (status < 200 || status >= 300) {
                getLogger().warning(
                        "API request failed: " + method + " " + path
                                + " returned HTTP " + status
                                + ". Response: "
                                + responseBody.substring(
                                        0,
                                        Math.min(responseBody.length(), 300)
                                )
                );
                return "";
            }

            // Avoid logging every empty announcement poll.
            if (!path.equals("/v1/announcements/next")
                    || !responseBody.contains("\"announcement\":null")) {
                getLogger().fine(
                        "API request successful: " + path
                                + " (HTTP " + status + ")"
                );
            }

            return responseBody;

        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            getLogger().warning("API request interrupted for " + path);
            return "";

        } catch (Exception exception) {
            getLogger().warning(
                    "API request failed for " + path + ": "
                            + exception.getClass().getSimpleName()
            );
            return "";
        }
    }

    private String apiToken() {
        return getConfig().getString("api-token", "");
    }

    private static String esc(String value) {
        if (value == null) {
            return "";
        }

        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static String extract(String json, Pattern pattern) {
        if (json == null || json.isBlank()) {
            return null;
        }

        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
