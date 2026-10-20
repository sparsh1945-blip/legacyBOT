package com.sneaksmp.bridge;

import net.milkbowl.vault.economy.Economy;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
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
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

public final class SneakSMPBridge extends JavaPlugin implements Listener {
    private HttpClient http;
    private Economy economy;

    @Override public void onEnable() {
        saveDefaultConfig();
        http = HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(3)).build();
        if (getServer().getPluginManager().getPlugin("Vault") != null) {
            RegisteredServiceProvider<Economy> rsp = getServer().getServicesManager().getRegistration(Economy.class);
            if (rsp != null) economy = rsp.getProvider();
        }
        getServer().getPluginManager().registerEvents(this, this);
        long interval = Math.max(30, getConfig().getLong("stats-sync-interval-seconds", 60));
        getServer().getScheduler().runTaskTimerAsynchronously(this, this::syncOnlineStats, 100L, interval * 20L);
        getLogger().info("SneakSMP Bridge enabled. API configured: " + !apiToken().equals("CHANGE_ME_TO_A_LONG_RANDOM_SECRET"));
    }

    @Override public void onDisable() { }

    @EventHandler public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        post("/v1/players/upsert", "{\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + esc(p.getName()) + "\"}");
    }

    @EventHandler public void onQuit(PlayerQuitEvent e) {
        Player p = e.getPlayer();
        post("/v1/players/stats", statsJson(p));
    }

    @EventHandler public void onDeath(PlayerDeathEvent e) {
        Player victim = e.getEntity();
        post("/v1/stats/death", "{\"uuid\":\"" + victim.getUniqueId() + "\",\"username\":\"" + esc(victim.getName()) + "\"}");
        Player killer = victim.getKiller();
        if (killer != null) post("/v1/stats/kill", "{\"uuid\":\"" + killer.getUniqueId() + "\",\"username\":\"" + esc(killer.getName()) + "\"}");
    }

    private void syncOnlineStats() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            String body = statsJson(p);
            post("/v1/players/stats", body);
        }
        post("/v1/server/heartbeat", "{\"online\":" + Bukkit.getOnlinePlayers().size() + ",\"max\":" + Bukkit.getMaxPlayers() + ",\"version\":\"" + esc(Bukkit.getMinecraftVersion()) + "\"}");
    }

    private String statsJson(Player p) {
        double money = -1;
        if (economy != null) {
            try { money = economy.getBalance(p); } catch (Exception ignored) { }
        }
        return "{\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + esc(p.getName()) +
                "\",\"kills\":" + p.getStatistic(Statistic.PLAYER_KILLS) +
                ",\"deaths\":" + p.getStatistic(Statistic.DEATHS) +
                ",\"playtimeTicks\":" + p.getStatistic(Statistic.PLAY_ONE_MINUTE) +
                ",\"money\":" + money + "}";
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equalsIgnoreCase("discordlink")) {
            if (!(sender instanceof Player p)) { sender.sendMessage("Only players can link an account."); return true; }
            String body = "{\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + esc(p.getName()) + "\"}";
            CompletableFuture.runAsync(() -> {
                String response = request("POST", "/v1/links/create", body);
                String code = extract(response, "code");
                Bukkit.getScheduler().runTask(this, () -> {
                    if (code == null || code.isBlank()) p.sendMessage("§cCould not create a link code. Is the SneakSMP API running?");
                    else p.sendMessage("§aYour Discord link code: §e" + code + " §7(5 minutes, one use).");
                });
            });
            return true;
        }
        if (command.getName().equalsIgnoreCase("sneaksmp")) {
            if (!sender.hasPermission("sneaksmp.admin")) { sender.sendMessage("No permission."); return true; }
            if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
                reloadConfig(); sender.sendMessage("SneakSMP Bridge config reloaded."); return true;
            }
            sender.sendMessage("Usage: /sneaksmp reload"); return true;
        }
        return false;
    }

    private void post(String path, String body) {
        CompletableFuture.runAsync(() -> request("POST", path, body));
    }

    private String request(String method, String path, String body) {
        try {
            String base = getConfig().getString("api-base-url", "").replaceAll("/+$", "");
            if (base.isBlank()) return "";
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path))
                    .timeout(java.time.Duration.ofSeconds(5))
                    .header("Authorization", "Bearer " + apiToken())
                    .header("Content-Type", "application/json");
            if (method.equals("POST")) b.POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
            HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() >= 400) getLogger().warning("API " + path + " returned HTTP " + r.statusCode());
            return r.body();
        } catch (Exception ex) {
            getLogger().fine("API request failed: " + ex.getMessage());
            return "";
        }
    }

    private String apiToken() { return getConfig().getString("api-token", ""); }
    private static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
    private static String extract(String json, String key) {
        if (json == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }
}
