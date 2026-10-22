
package com.sneaksmp.bridge;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;

import org.bukkit.Bukkit;
import org.bukkit.Statistic;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class SneakSMPBridge extends JavaPlugin {

    private HttpClient http;

    private BukkitTask announcementTask;
    private BukkitTask reminderTask;
    private BukkitTask statsTask;
    private BukkitTask heartbeatTask;

    private String apiBaseUrl;
    private String apiToken;

    private final Set<UUID> linkedCache = ConcurrentHashMap.newKeySet();
    private final Set<UUID> reminderInProgress = ConcurrentHashMap.newKeySet();

    private static final Pattern CODE_PATTERN =
            Pattern.compile("\"code\"\\s*:\\s*\"?([A-Za-z0-9]{6,12})\"?");

    private static final Pattern LINKED_PATTERN =
            Pattern.compile("\"linked\"\\s*:\\s*true");

    private static final Pattern MESSAGE_PATTERN =
            Pattern.compile("\"messageB64\"\\s*:\\s*\"([^\"]*)\"");

    @Override
    public void onEnable() {
        saveDefaultConfig();

        http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        loadSettings();
        startTasks();

        getLogger().info("SneakSMPBridge enabled.");
    }

    @Override
    public void onDisable() {
        cancel(announcementTask);
        cancel(reminderTask);
        cancel(statsTask);
        cancel(heartbeatTask);

        getLogger().info("SneakSMPBridge disabled.");
    }

    private void cancel(BukkitTask task) {
        if (task != null) {
            task.cancel();
        }
    }

    private void loadSettings() {
        apiBaseUrl = getConfig()
                .getString(
                        "api-base-url",
                        "https://legacybot-bbm3.onrender.com"
                )
                .trim()
                .replaceAll("/+$", "");

        apiToken = getConfig().getString("api-token", "").trim();

        if (apiToken.isEmpty() || apiToken.equals("CHANGE_ME")) {
            getLogger().warning(
                    "Set api-token in plugins/SneakSMPBridge/config.yml"
            );
        }
    }

    private void startTasks() {
        long announcementInterval = Math.max(
                5,
                getConfig().getLong("announcement-poll-seconds", 5)
        );

        long reminderMinutes = Math.max(
                1,
                getConfig().getLong("link-reminder-interval-minutes", 10)
        );

        long statsSeconds = Math.max(
                15,
                getConfig().getLong("stats-sync-interval-seconds", 60)
        );

        announcementTask =
                Bukkit.getScheduler().runTaskTimerAsynchronously(
                        this,
                        this::pollAnnouncement,
                        40L,
                        announcementInterval * 20L
                );

        reminderTask = Bukkit.getScheduler().runTaskTimer(
                this,
                this::checkOnlinePlayersForReminders,
                100L,
                reminderMinutes * 60L * 20L
        );

        // Read Bukkit player data on the main server thread.
        statsTask = Bukkit.getScheduler().runTaskTimer(
                this,
                this::scheduleStatsSync,
                100L,
                statsSeconds * 20L
        );

        heartbeatTask =
                Bukkit.getScheduler().runTaskTimerAsynchronously(
                        this,
                        this::sendHeartbeat,
                        100L,
                        1200L
                );
    }

    // ==================================================
    // COMMANDS
    // ==================================================

    @Override
    public boolean onCommand(
            CommandSender sender,
            Command command,
            String label,
            String[] args
    ) {
        if (command.getName().equalsIgnoreCase("discordlink")) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("Only players can use this command.");
                return true;
            }

            createLinkCode(player);
            return true;
        }

        if (command.getName().equalsIgnoreCase("sneaksmp")) {
            if (!sender.hasPermission("sneaksmp.admin")) {
                sender.sendMessage(
                        Component.text(
                                "You don't have permission.",
                                NamedTextColor.RED
                        )
                );
                return true;
            }

            if (args.length == 1
                    && args[0].equalsIgnoreCase("reload")) {
                reloadConfig();
                loadSettings();

                sender.sendMessage(
                        Component.text(
                                "SneakSMPBridge configuration reloaded.",
                                NamedTextColor.GREEN
                        )
                );
            } else {
                sender.sendMessage(
                        Component.text(
                                "Usage: /sneaksmp reload",
                                NamedTextColor.YELLOW
                        )
                );
            }

            return true;
        }

        return false;
    }

    // ==================================================
    // ACCOUNT LINKING
    // ==================================================

    private void createLinkCode(Player player) {
        String body = "{"
                + "\"uuid\":\"" + player.getUniqueId() + "\","
                + "\"username\":\"" + escapeJson(player.getName()) + "\""
                + "}";

        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            String response = apiRequest(
                    "POST",
                    "/v1/links/create",
                    body
            );

            Matcher matcher = CODE_PATTERN.matcher(response);

            if (!matcher.find()) {
                Bukkit.getScheduler().runTask(this, () -> {
                    if (player.isOnline()) {
                        player.sendMessage(
                                Component.text(
                                        "Could not create a link code. "
                                                + "Please try again later.",
                                        NamedTextColor.RED
                                )
                        );
                    }
                });

                getLogger().warning(
                        "Link-code request failed. Check API endpoint and token."
                );
                return;
            }

            String code = matcher.group(1);

            Bukkit.getScheduler().runTask(this, () -> {
                if (player.isOnline()) {
                    sendLinkCode(player, code);
                }
            });
        });
    }

    private void sendLinkCode(Player player, String code) {
        player.sendMessage(Component.empty());

        player.sendMessage(
                Component.text(
                        "SneakSMP • Account Linking",
                        NamedTextColor.AQUA
                )
        );

        player.sendMessage(
                Component.text(
                        "Link your Minecraft account to our Discord server.",
                        NamedTextColor.GRAY
                )
        );

        player.sendMessage(Component.empty());

        player.sendMessage(
                Component.text("YOUR LINK CODE", NamedTextColor.YELLOW)
        );

        player.sendMessage(
                Component.text(code, NamedTextColor.WHITE)
                        .clickEvent(ClickEvent.copyToClipboard(code))
        );

        player.sendMessage(
                Component.text(
                                "[ CLICK TO COPY CODE ]",
                                NamedTextColor.GREEN
                        )
                        .clickEvent(ClickEvent.copyToClipboard(code))
        );

        player.sendMessage(
                Component.text(
                        "Use this code with the LegacyMC Discord bot.",
                        NamedTextColor.GRAY
                )
        );

        player.sendMessage(Component.empty());
    }

    // ==================================================
    // LINK STATUS AND REMINDERS
    // ==================================================

    private boolean isLinked(UUID uuid) {
        String response = apiRequest(
                "GET",
                "/v1/links/status?uuid=" + uuid,
                null
        );

        return LINKED_PATTERN.matcher(response).find();
    }

    private void checkOnlinePlayersForReminders() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            UUID uuid = player.getUniqueId();

            if (!reminderInProgress.add(uuid)) {
                continue;
            }

            Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                try {
                    boolean linked = isLinked(uuid);

                    if (linked) {
                        linkedCache.add(uuid);
                    } else {
                        linkedCache.remove(uuid);

                        Bukkit.getScheduler().runTask(this, () -> {
                            if (!player.isOnline()) {
                                return;
                            }

                            player.sendMessage(Component.empty());

                            player.sendMessage(
                                    Component.text(
                                            "🔗 SneakSMP Account Reminder",
                                            NamedTextColor.AQUA
                                    )
                            );

                            player.sendMessage(
                                    Component.text(
                                            "Link your Minecraft account to Discord "
                                                    + "to access account features and rewards!",
                                            NamedTextColor.YELLOW
                                    )
                            );

                            player.sendMessage(
                                    Component.text(
                                                    "[ LINK YOUR ACCOUNT ]",
                                                    NamedTextColor.GREEN
                                            )
                                            .clickEvent(
                                                    ClickEvent.runCommand("/discordlink")
                                            )
                                            .hoverEvent(
                                                    Component.text(
                                                            "Generate your linking code"
                                                    )
                                            )
                            );
                        });
                    }
                } finally {
                    reminderInProgress.remove(uuid);
                }
            });
        }
    }

    // ==================================================
    // DISCORD ANNOUNCEMENTS
    // ==================================================

    private void pollAnnouncement() {
        String response = apiRequest(
                "GET",
                "/v1/announcements/next",
                null
        );

        Matcher matcher = MESSAGE_PATTERN.matcher(response);

        if (!matcher.find()) {
            return;
        }

        try {
            String message = new String(
                    Base64.getDecoder().decode(matcher.group(1)),
                    StandardCharsets.UTF_8
            );

            if (message.isBlank()) {
                return;
            }

            Bukkit.getScheduler().runTask(
                    this,
                    () -> showAnnouncement(message)
            );

        } catch (IllegalArgumentException exception) {
            getLogger().warning("Invalid announcement encoding received.");
        }
    }

    private void showAnnouncement(String message) {
        Component title = Component.text(
                getConfig().getString(
                        "announcement-title",
                        "ANNOUNCEMENT"
                ),
                NamedTextColor.AQUA
        );

        Component subtitle = Component.text(
                message,
                NamedTextColor.WHITE
        );

        int fadeIn = Math.max(
                0,
                getConfig().getInt("announcement-fade-in-ticks", 10)
        );

        int stay = Math.max(
                1,
                getConfig().getInt("announcement-stay-seconds", 4)
        );

        int fadeOut = Math.max(
                0,
                getConfig().getInt("announcement-fade-out-ticks", 20)
        );

        Title.Times times = Title.Times.times(
                Duration.ofMillis(fadeIn * 50L),
                Duration.ofSeconds(stay),
                Duration.ofMillis(fadeOut * 50L)
        );

        Title announcement = Title.title(title, subtitle, times);

        for (Player player : Bukkit.getOnlinePlayers()) {
            player.showTitle(announcement);

            player.sendMessage(
                    Component.text(
                            "[ANNOUNCEMENT] ",
                            NamedTextColor.AQUA
                    ).append(
                            Component.text(message, NamedTextColor.WHITE)
                    )
            );
        }

        getLogger().info("[ANNOUNCEMENT] " + message);
    }

    // ==================================================
    // PLAYER STATISTICS
    // ==================================================

    private void scheduleStatsSync() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            String body = "{"
                    + "\"uuid\":\"" + player.getUniqueId() + "\","
                    + "\"username\":\"" + escapeJson(player.getName()) + "\","
                    + "\"kills\":" + player.getStatistic(Statistic.PLAYER_KILLS) + ","
                    + "\"deaths\":" + player.getStatistic(Statistic.DEATHS) + ","
                    + "\"playtimeTicks\":" + player.getStatistic(Statistic.PLAY_ONE_MINUTE)
                    + "}";

            Bukkit.getScheduler().runTaskAsynchronously(
                    this,
                    () -> apiRequest("POST", "/v1/players/sync", body)
            );
        }
    }

    // ==================================================
    // SERVER HEARTBEAT
    // ==================================================

    private void sendHeartbeat() {
        // Snapshot Bukkit state on the main thread before making HTTP calls.
        Bukkit.getScheduler().runTask(this, () -> {
            String body = "{"
                    + "\"server\":\"SneakSMP\","
                    + "\"onlinePlayers\":" + Bukkit.getOnlinePlayers().size() + ","
                    + "\"maxPlayers\":" + Bukkit.getMaxPlayers()
                    + "}";

            Bukkit.getScheduler().runTaskAsynchronously(
                    this,
                    () -> apiRequest("POST", "/v1/server/heartbeat", body)
            );
        });
    }

    // ==================================================
    // HTTP API
    // ==================================================

    private String apiRequest(
            String method,
            String endpoint,
            String body
    ) {
        if (apiToken == null
                || apiToken.isBlank()
                || apiToken.equals("CHANGE_ME")) {
            return "";
        }

        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(apiBaseUrl + endpoint))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + apiToken)
                    .header("Accept", "application/json");

            if ("POST".equalsIgnoreCase(method)) {
                builder.header(
                        "Content-Type",
                        "application/json; charset=utf-8"
                );

                builder.POST(
                        HttpRequest.BodyPublishers.ofString(
                                body == null ? "{}" : body,
                                StandardCharsets.UTF_8
                        )
                );
            } else {
                builder.GET();
            }

            HttpResponse<String> response = http.send(
                    builder.build(),
                    HttpResponse.BodyHandlers.ofString(
                            StandardCharsets.UTF_8
                    )
            );

            if (response.statusCode() < 200
                    || response.statusCode() >= 300) {
                getLogger().warning(
                        method + " " + endpoint
                                + " returned HTTP "
                                + response.statusCode()
                );
            }

            return response.body() == null ? "" : response.body();

        } catch (Exception exception) {
            getLogger().warning(
                    "API request failed for " + endpoint
                            + ": " + exception.getMessage()
            );

            return "";
        }
    }

    // ==================================================
    // JSON ESCAPING
    // ==================================================

    private String escapeJson(String value) {
        if (value == null) {
            return "";
        }

        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
