package com.gientech.wordcatcher;

import com.intellij.openapi.application.ApplicationManager;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/**
 * 单词增强：组合在线词典（翻译 / 词性 / 音标 / 例句 / 词源）
 * 与本地词根拆解，把结果写回生词记录（表格自动刷新）。
 * 词根本地可得，即使网络全失败也会写入 root 字段。
 */
public final class WordEnricher {

    private WordEnricher() {
    }

    /** 异步增强：后台查词典 + 词根分析，结果写回存储。 */
    public static void enrichAsync(@NotNull String word) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> enrichSync(word));
    }

    /**
     * 同步增强（阻塞，勿在 EDT 调用）。
     *
     * @return 有任何字段被写入返回 true
     */
    public static boolean enrichSync(@NotNull String word) {
        String trimmed = word.trim();
        if (trimmed.isEmpty()) {
            return false;
        }
        WordTranslator.DictInfo info = WordTranslator.lookupSync(trimmed);
        String root = RootAnalyzer.analyze(trimmed);
        return WordStorage.getInstance().update(trimmed, entry -> {
            boolean changed = false;
            if (info != null) {
                changed |= fillIfAbsent(entry::getTranslation, entry::setTranslation, info.translation);
                changed |= fillIfAbsent(entry::getPosMeaning, entry::setPosMeaning, info.posMeaning);
                changed |= fillIfAbsent(entry::getPhonetic, entry::setPhonetic, info.phonetic);
                changed |= fillIfAbsent(entry::getExample, entry::setExample, info.example);
                changed |= fillIfAbsent(entry::getOrigin, entry::setOrigin, info.origin);
            }
            if (root != null && (entry.getRoot() == null || entry.getRoot().isBlank())) {
                entry.setRoot(root);
                changed = true;
            }
            return changed ? entry : null;
        });
    }

    private interface Getter {
        @Nullable String get();
    }

    private interface Setter {
        void set(@Nullable String value);
    }

    private static boolean fillIfAbsent(Getter getter, Setter setter, @Nullable String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        String current = getter.get();
        if (current != null && !current.isBlank()) {
            return false;
        }
        setter.set(value);
        return true;
    }
}
