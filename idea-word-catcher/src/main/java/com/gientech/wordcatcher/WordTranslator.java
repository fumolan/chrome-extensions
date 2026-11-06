package com.gientech.wordcatcher;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.util.io.HttpRequests;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 在线翻译（英→中）。依次尝试多个免费接口：MyMemory（国内直连可用）→ Google（兜底）。
 * 请求都在后台线程执行；结果建议用 WordStorage.setTranslation 缓存。
 */
public final class WordTranslator {

    private static final int TIMEOUT_MS = 5000;

    private WordTranslator() {
    }

    /** 异步翻译，回调在 EDT 上执行；失败回调 null。 */
    public static void translateAsync(@NotNull String word, @Nullable Consumer<String> callback) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String translation = translateSync(word);
            if (callback != null) {
                ApplicationManager.getApplication().invokeLater(() -> callback.accept(translation));
            }
        });
    }

    /** 一次词典查询的结果：各字段查询失败时为 null，调用方按需取用。 */
    public static final class DictInfo {
        /** 中文翻译 */
        public String translation;
        /** 带词性的释义，如 "n. 算法 ｜ v. 计算" */
        public String posMeaning;
        /** 音标，如 /ˈælɡərɪðəm/ */
        public String phonetic;
        /** 例句（英文，可能附中文翻译） */
        public String example;
        /** 词源说明 */
        public String origin;
    }

    /** 异步词典查询，回调在 EDT 上执行；至少词根等本地信息存在时回调非 null，全失败回调 null。 */
    public static void lookupAsync(@NotNull String word, @Nullable Consumer<DictInfo> callback) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            DictInfo info = lookupSync(word);
            if (callback != null) {
                ApplicationManager.getApplication().invokeLater(() -> callback.accept(info));
            }
        });
    }

    /**
     * 同步词典查询（阻塞，勿在 EDT 调用）。
     * 中文词性释义 / 音标 / 双语例句优先来自必应词典（国内直连可用）；
     * 音标备用 / 英文释义 / 词源来自 Free Dictionary API；
     * Google 词典补中文翻译与例句，最后 MyMemory 纯翻译兜底。
     */
    @Nullable
    public static DictInfo lookupSync(@NotNull String word) {
        String trimmed = word.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        DictInfo info = new DictInfo();

        DictInfo bing = tryBingDict(trimmed);
        if (bing != null) {
            info.phonetic = bing.phonetic;
            info.posMeaning = bing.posMeaning;
            info.example = bing.example;
            info.translation = bing.translation;
        }

        DictInfo freeDict = tryFreeDictionary(trimmed);
        if (freeDict != null) {
            if (info.phonetic == null) {
                info.phonetic = freeDict.phonetic;
            }
            if (info.posMeaning == null) {
                info.posMeaning = freeDict.posMeaning;
            }
            if (info.example == null) {
                info.example = freeDict.example;
            }
            info.origin = freeDict.origin;
        }

        DictInfo google = tryGoogleDict(trimmed);
        if (google != null) {
            if (info.translation == null) {
                info.translation = google.translation;
            }
            if (info.posMeaning == null) {
                info.posMeaning = google.posMeaning;
            }
            if (info.example == null) {
                info.example = google.example;
            }
        }
        if (info.translation == null) {
            info.translation = translateSync(trimmed); // MyMemory → Google 纯翻译兜底
        }
        return info;
    }

    // ---------- 必应词典（cn.bing.com/dict，国内直连可用，无需 token） ----------

    @Nullable
    private static DictInfo tryBingDict(String word) {
        try {
            String url = "https://cn.bing.com/dict/search?q="
                    + URLEncoder.encode(word, StandardCharsets.UTF_8);
            String html = request(url);

            DictInfo info = new DictInfo();

            // 音标：美 [xxx]（hd_prUS）/ 英 [xxx]（hd_pr），内容含 HTML 实体
            StringBuilder phonetic = new StringBuilder();
            Matcher us = Pattern.compile("hd_prUS[^>]*>([^<]{5,80})<").matcher(html);
            if (us.find()) {
                phonetic.append(cleanPhonetic(us.group(1), "美"));
            }
            Matcher uk = Pattern.compile("\"hd_pr [^\"]*\"[^>]*>([^<]{5,80})<").matcher(html);
            if (uk.find()) {
                if (phonetic.length() > 0) {
                    phonetic.append("  ");
                }
                phonetic.append(cleanPhonetic(uk.group(1), "英"));
            }
            info.phonetic = phonetic.length() == 0 ? null : phonetic.toString();

            // 词性 + 中文释义：<span class="pos">n.</span><span class="def ...">算法；计算程序</span>
            StringBuilder posBuilder = new StringBuilder();
            Matcher posDef = Pattern
                    .compile("<span class=\"pos(?: web)?\">([^<]+)</span>\\s*<span class=\"def[^\"]*\">(.*?)</span>")
                    .matcher(html);
            int groups = 0;
            String firstDef = null;
            while (posDef.find() && groups < 3) {
                String pos = htmlText(posDef.group(1));
                String def = truncate(htmlText(posDef.group(2)), 60);
                if (pos.isEmpty() || def.isEmpty()) {
                    continue;
                }
                if (posBuilder.length() > 0) {
                    posBuilder.append(" ｜ ");
                }
                posBuilder.append(pos).append(' ').append(def);
                if (firstDef == null && !"网络".equals(pos)) {
                    firstDef = def; // 第一条中文释义可直接当翻译
                }
                groups++;
            }
            info.posMeaning = posBuilder.length() == 0 ? null : posBuilder.toString();
            info.translation = firstDef;

            // 双语例句：第一对 sen_en / sen_cn
            Matcher example = Pattern
                    .compile("class=\"sen_en[^\"]*\"[^>]*>(.*?)</div>[\\s\\S]{0,300}?class=\"sen_cn[^\"]*\"[^>]*>(.*?)</div>")
                    .matcher(html);
            if (example.find()) {
                String en = truncate(htmlText(example.group(1)), 200);
                String zh = truncate(htmlText(example.group(2)), 120);
                if (!en.isEmpty()) {
                    info.example = zh.isEmpty() ? en : en + " —— " + zh;
                }
            }

            boolean empty = info.phonetic == null && info.posMeaning == null && info.example == null;
            return empty ? null : info;
        } catch (Exception ignored) {
            return null;
        }
    }

    /** 去掉音标原始文本里的「美 / 英国」前缀，统一成 "美[xxx]" 形式。 */
    private static String cleanPhonetic(String raw, String label) {
        String text = htmlText(raw).replaceFirst("^(美国英语|美国|美式|美|英国英语|英国|英式|英)\\s*", "");
        return text.isEmpty() ? "" : label + "[" + text + "]";
    }

    /** 去 HTML 标签、反转义常见实体、压缩空白。 */
    private static String htmlText(String html) {
        String text = html.replaceAll("<[^>]+>", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&nbsp;", " ")
                .replace("&#160;", " ");
        Matcher entity = Pattern.compile("&#(\\d+);").matcher(text);
        StringBuilder sb = new StringBuilder();
        while (entity.find()) {
            entity.appendReplacement(sb, Matcher.quoteReplacement(
                    String.valueOf((char) Integer.parseInt(entity.group(1)))));
        }
        entity.appendTail(sb);
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    // ---------- Free Dictionary API（音标 / 词性+英文释义 / 例句 / 词源） ----------

    @Nullable
    private static DictInfo tryFreeDictionary(String word) {
        try {
            String url = "https://api.dictionaryapi.dev/api/v2/entries/en/"
                    + URLEncoder.encode(word, StandardCharsets.UTF_8);
            JsonArray entries = JsonParser.parseString(request(url)).getAsJsonArray();
            if (entries.isEmpty()) {
                return null;
            }
            DictInfo info = new DictInfo();
            JsonObject first = entries.get(0).getAsJsonObject();
            info.phonetic = optString(first, "phonetic");
            if (info.phonetic == null && first.has("phonetics")) {
                for (JsonElement e : first.getAsJsonArray("phonetics")) {
                    String text = optString(e.getAsJsonObject(), "text");
                    if (text != null) {
                        info.phonetic = text;
                        break;
                    }
                }
            }
            info.origin = optString(first, "origin");
            if (first.has("meanings")) {
                StringBuilder posBuilder = new StringBuilder();
                for (JsonElement meaningElement : first.getAsJsonArray("meanings")) {
                    JsonObject meaning = meaningElement.getAsJsonObject();
                    String pos = posAbbr(optString(meaning, "partOfSpeech"));
                    JsonArray definitions = meaning.getAsJsonArray("definitions");
                    if (definitions == null || definitions.isEmpty()) {
                        continue;
                    }
                    String definition = optString(definitions.get(0).getAsJsonObject(), "definition");
                    if (definition == null) {
                        continue;
                    }
                    if (posBuilder.length() > 0) {
                        posBuilder.append(" ｜ ");
                    }
                    posBuilder.append(pos).append(' ').append(truncate(definition, 90));
                    if (info.example == null) {
                        String example = optString(definitions.get(0).getAsJsonObject(), "example");
                        if (example != null) {
                            info.example = example;
                        }
                    }
                    if (posBuilder.length() > 200) {
                        break;
                    }
                }
                info.posMeaning = posBuilder.length() == 0 ? null : posBuilder.toString();
            }
            boolean empty = info.phonetic == null && info.posMeaning == null
                    && info.example == null && info.origin == null;
            return empty ? null : info;
        } catch (Exception ignored) {
            return null;
        }
    }

    // ---------- Google translate gtx 词典（中文翻译 / 词性中文词条 / 中英例句） ----------

    @Nullable
    private static DictInfo tryGoogleDict(String word) {
        try {
            String url = "https://translate.googleapis.com/translate_a/single"
                    + "?client=gtx&sl=en&tl=zh-CN&dt=t&dt=bd&dt=ex&q="
                    + URLEncoder.encode(word, StandardCharsets.UTF_8);
            JsonArray root = JsonParser.parseString(request(url)).getAsJsonArray();

            DictInfo info = new DictInfo();
            // [0] dt=t：整句中文翻译
            if (root.size() > 0 && root.get(0).isJsonArray()) {
                StringBuilder translation = new StringBuilder();
                for (JsonElement segment : root.get(0).getAsJsonArray()) {
                    JsonArray pair = segment.getAsJsonArray();
                    if (pair.size() > 0 && !pair.get(0).isJsonNull()) {
                        translation.append(pair.get(0).getAsString());
                    }
                }
                info.translation = sanitize(translation.toString());
            }
            // [1] dt=bd：词性 + 中文词条
            if (root.size() > 1 && root.get(1).isJsonArray()) {
                StringBuilder posBuilder = new StringBuilder();
                for (JsonElement dictElement : root.get(1).getAsJsonArray()) {
                    JsonObject dict = dictElement.getAsJsonObject();
                    String pos = posAbbr(optString(dict, "pos"));
                    JsonArray terms = dict.getAsJsonArray("terms");
                    if (terms == null || terms.isEmpty()) {
                        continue;
                    }
                    if (posBuilder.length() > 0) {
                        posBuilder.append(" ｜ ");
                    }
                    posBuilder.append(pos);
                    for (int i = 0; i < Math.min(terms.size(), 3); i++) {
                        posBuilder.append(i == 0 ? " " : "；").append(terms.get(i).getAsString());
                    }
                    if (posBuilder.length() > 160) {
                        break;
                    }
                }
                info.posMeaning = posBuilder.length() == 0 ? null : posBuilder.toString();
            }
            // [13] dt=ex：中英对照例句，兼容 [ex[[en,zh,...]], ...] 两种层级
            if (root.size() > 13 && root.get(13).isJsonArray()) {
                JsonArray exWrapper = root.get(13).getAsJsonArray();
                JsonArray pairs = exWrapper;
                if (exWrapper.size() > 0 && exWrapper.get(0).isJsonArray()
                        && exWrapper.get(0).getAsJsonArray().size() > 0
                        && exWrapper.get(0).getAsJsonArray().get(0).isJsonArray()) {
                    pairs = exWrapper.get(0).getAsJsonArray();
                }
                if (!pairs.isEmpty() && pairs.get(0).isJsonArray()) {
                    JsonArray pair = pairs.get(0).getAsJsonArray();
                    String en = pair.size() > 0 && !pair.get(0).isJsonNull() ? pair.get(0).getAsString() : null;
                    String zh = pair.size() > 1 && !pair.get(1).isJsonNull() ? pair.get(1).getAsString() : null;
                    if (en != null) {
                        info.example = zh == null ? en : truncate(en, 200) + " —— " + truncate(zh, 120);
                    }
                }
            }
            boolean empty = info.translation == null && info.posMeaning == null && info.example == null;
            return empty ? null : info;
        } catch (Exception ignored) {
            return null;
        }
    }

    /** 英文词性全称 → 缩写，未知原样返回并加点。 */
    private static String posAbbr(@Nullable String pos) {
        if (pos == null) {
            return "?";
        }
        switch (pos) {
            case "noun": return "n.";
            case "verb": return "v.";
            case "adjective": return "adj.";
            case "adverb": return "adv.";
            case "preposition": return "prep.";
            case "conjunction": return "conj.";
            case "pronoun": return "pron.";
            case "interjection": case "exclamation": return "interj.";
            case "numeral": return "num.";
            default: return pos + ".";
        }
    }

    @Nullable
    private static String optString(@NotNull JsonObject object, @NotNull String key) {
        return object.has(key) && object.get(key).isJsonPrimitive() ? object.get(key).getAsString() : null;
    }

    @Nullable
    private static String truncate(@Nullable String value, int max) {
        if (value == null) {
            return null;
        }
        String cleaned = value.replaceAll("\\s+", " ").trim();
        return cleaned.length() > max ? cleaned.substring(0, max) + "…" : cleaned;
    }

    /** 同步翻译（阻塞，勿在 EDT 调用）；失败返回 null。 */
    @Nullable
    public static String translateSync(@NotNull String word) {
        String trimmed = word.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        for (Provider provider : PROVIDERS) {
            String result = null;
            try {
                result = provider.translate(trimmed);
            } catch (Exception ignored) {
            }
            if (result != null && !result.isBlank()) {
                return sanitize(result);
            }
        }
        return null;
    }

    private interface Provider {
        @Nullable
        String translate(@NotNull String word) throws Exception;
    }

    private static final Provider[] PROVIDERS = {
            // MyMemory 免费接口（无需 key，国内直连可用）
            word -> {
                String url = "https://api.mymemory.translated.net/get?q="
                        + URLEncoder.encode(word, StandardCharsets.UTF_8) + "&langpair=en|zh-CN";
                JsonObject responseData = JsonParser.parseString(request(url))
                        .getAsJsonObject().getAsJsonObject("responseData");
                if (responseData == null || !responseData.has("translatedText")) {
                    return null;
                }
                String text = responseData.get("translatedText").getAsString();
                return text.startsWith("MYMEMORY WARNING") ? null : text;
            },
            // Google translate gtx 接口（部分网络 / 代理环境可用，兜底）
            word -> {
                String url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q="
                        + URLEncoder.encode(word, StandardCharsets.UTF_8);
                JsonArray segments = JsonParser.parseString(request(url))
                        .getAsJsonArray().get(0).getAsJsonArray();
                StringBuilder result = new StringBuilder();
                for (JsonElement segment : segments) {
                    result.append(segment.getAsJsonArray().get(0).getAsString());
                }
                return result.toString();
            },
    };

    private static String request(String url) throws Exception {
        return HttpRequests.request(url)
                .connectTimeout(TIMEOUT_MS)
                .readTimeout(TIMEOUT_MS)
                .tuner(connection -> connection.setRequestProperty(
                        "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"))
                .readString();
    }

    private static String sanitize(String value) {
        String cleaned = value.replaceAll("\\s+", " ").trim();
        if (cleaned.isEmpty()) {
            return null;
        }
        return cleaned.length() > 200 ? cleaned.substring(0, 200) + "…" : cleaned;
    }
}
