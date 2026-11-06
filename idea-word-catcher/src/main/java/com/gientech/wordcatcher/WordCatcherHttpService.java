package com.gientech.wordcatcher;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.Application;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.diagnostic.Logger;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * 本地 HTTP 服务：供配套浏览器扩展（项目 browser/ 目录）共享生词本的数据与操作。
 *
 * <p>只绑定 127.0.0.1:{@value PORT}，不出本机。所有读写都走 {@link WordStorage} /
 * {@link WordEnricher}，与 IDE 内操作同一条代码路径：词典多源降级、词根拆解、去重计数全部复用，
 * 存储变更统一在 EDT 上触发（与 IDE 内一致），持久化仍由 IDE 写 wordCatcher.xml——
 * 因此 IDE 进程是唯一写入方，浏览器取词后工具窗经现有 Listener 实时刷新，无文件冲突。</p>
 *
 * <p>浏览器扩展的使用前提是 IDE 在运行；端口被占用（例如同时开了两个 IDE 实例）时
 * 本服务不启动并只记日志，不影响 IDE 本身。</p>
 */
public class WordCatcherHttpService implements Disposable {

    public static final int PORT = 18091;

    private static final Logger LOG = Logger.getInstance(WordCatcherHttpService.class);
    private static final Gson GSON = new Gson();
    private static final int MAX_BODY_BYTES = 64 * 1024;

    private HttpServer myServer;
    private boolean myStartAttempted;

    public static WordCatcherHttpService getInstance() {
        return ApplicationManager.getApplication().getService(WordCatcherHttpService.class);
    }

    /** 幂等启动（由 {@link WordCatcherStartup} 在首个项目打开时触发）。 */
    public synchronized void ensureStarted() {
        if (myStartAttempted) {
            return;
        }
        myStartAttempted = true;
        try {
            myServer = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 0);
            myServer.createContext("/", this::handle);
            myServer.setExecutor(Executors.newFixedThreadPool(4, r -> {
                Thread thread = new Thread(r, "word-catcher-http");
                thread.setDaemon(true);
                return thread;
            }));
            myServer.start();
            LOG.info("Word Catcher HTTP service started on 127.0.0.1:" + PORT);
        } catch (IOException e) {
            myServer = null;
            LOG.warn("Word Catcher HTTP 服务启动失败（端口 " + PORT + " 被占用？例如已开另一个 IDE 实例）", e);
        }
    }

    @Override
    public synchronized void dispose() {
        if (myServer != null) {
            myServer.stop(0);
            myServer = null;
        }
    }

    // ---------- 路由 ----------

    private void handle(@NotNull HttpExchange exchange) throws IOException {
        try {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            if ("OPTIONS".equals(method)) {
                send(exchange, 204, null);
            } else if ("/api/health".equals(path) && "GET".equals(method)) {
                int count = WordStorage.getInstance().getWords().size();
                send(exchange, 200, GSON.toJson(Map.of("ok", true, "count", count)));
            } else if ("/api/words".equals(path) && "GET".equals(method)) {
                List<WordEntry> words = WordStorage.getInstance().getWords();
                send(exchange, 200, GSON.toJson(words));
            } else if ("/api/words".equals(path) && "POST".equals(method)) {
                handleAdd(exchange);
            } else if ("/api/words".equals(path) && "DELETE".equals(method)) {
                handleDelete(exchange);
            } else if ("/api/words/enrich".equals(path) && "POST".equals(method)) {
                handleEnrich(exchange);
            } else if ("/api/speak".equals(path) && "POST".equals(method)) {
                handleSpeak(exchange);
            } else {
                send(exchange, 404, "{\"error\":\"not found\"}");
            }
        } catch (Exception e) {
            LOG.warn("Word Catcher HTTP 处理请求出错: " + exchange.getRequestMethod() + " " + exchange.getRequestURI(), e);
            try {
                send(exchange, 500, "{\"error\":\"internal error\"}");
            } catch (Exception ignored) {
            }
        } finally {
            exchange.close();
        }
    }

    /** POST /api/words {word, context?, source?}：记入生词本并后台补词典，返回累计次数。 */
    private void handleAdd(@NotNull HttpExchange exchange) throws IOException {
        JsonObject body = readBody(exchange);
        String word = string(body, "word");
        if (word == null || word.isBlank() || !CaptureWordAction.WORD_PATTERN.matcher(word.trim()).matches()) {
            send(exchange, 400, "{\"error\":\"不是有效的英文单词\"}");
            return;
        }
        final String trimmed = word.trim();
        String context = truncateContext(string(body, "context"));
        String source = string(body, "source");
        int count = onEdt(() -> WordStorage.getInstance().addWord(trimmed, context, source));
        // 与 IDE 内取词一致：后台补在线词典 + 词根拆解，写入后工具窗自动刷新
        WordEnricher.enrichAsync(trimmed);
        send(exchange, 200, GSON.toJson(Map.of("word", trimmed, "count", count)));
    }

    /** DELETE /api/words?word=xxx：按词删除（忽略大小写）。 */
    private void handleDelete(@NotNull HttpExchange exchange) throws IOException {
        String word = queryParams(exchange).get("word");
        if (word == null || word.isBlank()) {
            send(exchange, 400, "{\"error\":\"缺少 word 参数\"}");
            return;
        }
        boolean deleted = onEdt(() -> WordStorage.getInstance().removeWord(word.trim()));
        send(exchange, 200, GSON.toJson(Map.of("word", word.trim(), "deleted", deleted)));
    }

    /** POST /api/words/enrich {word}：同步补全词典（浏览器端「补全词典」逐词调用）。 */
    private void handleEnrich(@NotNull HttpExchange exchange) throws IOException {
        JsonObject body = readBody(exchange);
        String word = string(body, "word");
        if (word == null || word.isBlank()) {
            send(exchange, 400, "{\"error\":\"缺少 word 字段\"}");
            return;
        }
        word = word.trim();
        // enrichSync 阻塞查多源词典，只能在 HTTP 工作线程调用（勿在 EDT）
        boolean updated = WordEnricher.enrichSync(word);
        send(exchange, 200, GSON.toJson(Map.of("word", word, "updated", updated)));
    }

    /** POST /api/speak {word}：用与 IDE 工具窗相同的系统 TTS 朗读（离线可用，同一声音）。 */
    private void handleSpeak(@NotNull HttpExchange exchange) throws IOException {
        JsonObject body = readBody(exchange);
        String word = string(body, "word");
        if (word == null || word.isBlank()) {
            send(exchange, 400, "{\"error\":\"缺少 word 字段\"}");
            return;
        }
        final String cleaned = word.trim();
        if (cleaned.length() > 200) {
            send(exchange, 400, "{\"error\":\"text too long\"}");
            return;
        }
        // 同步朗读并返回真实结果：失败时返回 500，浏览器扩展据此回退到浏览器语音合成
        try {
            SpeakWord.speakOrThrow(cleaned);
            send(exchange, 200, GSON.toJson(Map.of("ok", true)));
        } catch (Exception e) {
            LOG.warn("朗读失败: " + cleaned, e);
            String message = e.getMessage() == null ? "未知错误" : e.getMessage();
            send(exchange, 500, GSON.toJson(Map.of("error", message)));
        }
    }

    // ---------- 请求 / 响应工具 ----------

    private static @NotNull JsonObject readBody(@NotNull HttpExchange exchange) throws IOException {
        byte[] bytes = exchange.getRequestBody().readAllBytes();
        if (bytes.length > MAX_BODY_BYTES) {
            throw new IOException("request body too large: " + bytes.length);
        }
        if (bytes.length == 0) {
            return new JsonObject();
        }
        return GSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
    }

    private static @Nullable String string(@NotNull JsonObject body, @NotNull String key) {
        var element = body.get(key);
        return element != null && element.isJsonPrimitive() ? element.getAsString() : null;
    }

    private static @NotNull Map<String, String> queryParams(@NotNull HttpExchange exchange) {
        Map<String, String> params = new HashMap<>();
        String query = exchange.getRequestURI().getRawQuery();
        if (query == null || query.isEmpty()) {
            return params;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            String key = eq < 0 ? pair : pair.substring(0, eq);
            String value = eq < 0 ? "" : pair.substring(eq + 1);
            params.put(URLDecoder.decode(key, StandardCharsets.UTF_8), URLDecoder.decode(value, StandardCharsets.UTF_8));
        }
        return params;
    }

    /** 与 IDE 取词的上下文规则一致：压缩空白、截断到 160 字符。 */
    private static @NotNull String truncateContext(@Nullable String context) {
        if (context == null) {
            return "";
        }
        String text = context.replaceAll("\\s+", " ").trim();
        return text.length() > 160 ? text.substring(0, 160) + "…" : text;
    }

    private static void send(@NotNull HttpExchange exchange, int status, @Nullable String json) throws IOException {
        if (json == null) {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
            exchange.sendResponseHeaders(status, -1);
            return;
        }
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        var headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    /**
     * 切到 EDT 执行并等待结果（WordStorage 的 Listener 约定在 EDT 上触发）。
     * 用 any() 模态，弹窗（如生词卡片）打开时浏览器取词也不被阻塞。
     */
    private static <T> T onEdt(@NotNull Supplier<T> action) throws IOException {
        Application app = ApplicationManager.getApplication();
        if (app.isDispatchThread()) {
            return action.get();
        }
        CompletableFuture<T> future = new CompletableFuture<>();
        app.invokeLater(() -> {
            try {
                future.complete(action.get());
            } catch (Throwable t) {
                future.completeExceptionally(t);
            }
        }, ModalityState.any());
        try {
            return future.get(15, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IOException("IDE busy: " + e.getMessage(), e);
        }
    }
}
