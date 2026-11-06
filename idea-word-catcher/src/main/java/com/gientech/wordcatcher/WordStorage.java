package com.gientech.wordcatcher;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 应用级（跨项目）生词存储，持久化到 IDE 配置目录下的 wordCatcher.xml。
 */
@State(name = "WordCatcherStorage", storages = @Storage("wordCatcher.xml"))
public class WordStorage implements PersistentStateComponent<WordStorage.State> {

    public static class State {
        public List<WordEntry> words = new ArrayList<>();
    }

    /** 生词列表变化时的回调（在 EDT 上触发）。 */
    public interface Listener {
        void onWordsChanged();
    }

    private final List<Listener> myListeners = new CopyOnWriteArrayList<>();
    private State myState = new State();

    public static WordStorage getInstance() {
        return ApplicationManager.getApplication().getService(WordStorage.class);
    }

    @Nullable
    @Override
    public State getState() {
        return myState;
    }

    @Override
    public void loadState(@NotNull State state) {
        myState = state;
        if (state.words == null) {
            state.words = new ArrayList<>();
        }
    }

    /**
     * 记录一个单词：已存在则次数 +1 并刷新上下文 / 来源；否则插入到列表头部。
     *
     * @return 该单词累计被记录的次数
     */
    public synchronized int addWord(@NotNull String word, String context, String sourceFile) {
        String trimmed = word.trim();
        long now = System.currentTimeMillis();
        for (WordEntry entry : myState.words) {
            if (entry.getWord().equalsIgnoreCase(trimmed)) {
                entry.setCount(entry.getCount() + 1);
                entry.setLastCaptured(now);
                entry.setContext(context);
                entry.setSourceFile(sourceFile);
                fireChanged();
                return entry.getCount();
            }
        }
        myState.words.add(0, new WordEntry(trimmed, context, sourceFile));
        fireChanged();
        return 1;
    }

    /** 更新某个单词的缓存释义（忽略大小写匹配）。 */
    public synchronized void setTranslation(@NotNull String word, @NotNull String translation) {
        update(word, entry -> {
            if (translation.equals(entry.getTranslation())) {
                return null; // 无变化，不触发刷新
            }
            entry.setTranslation(translation);
            return entry;
        });
    }

    /**
     * 按忽略大小写匹配更新单词记录；更新器返回 null 或未找到记录时不触发刷新。
     * 适合在线词典结果异步回填（词性 / 例句 / 音标等）。
     *
     * @return 是否实际更新（未找到记录或更新器返回 null 时为 false）
     */
    public synchronized boolean update(@NotNull String word, @NotNull java.util.function.UnaryOperator<WordEntry> updater) {
        String trimmed = word.trim();
        for (WordEntry entry : myState.words) {
            if (entry.getWord().equalsIgnoreCase(trimmed)) {
                WordEntry updated = updater.apply(entry);
                if (updated != null) {
                    fireChanged();
                    return true;
                }
                return false;
            }
        }
        return false;
    }

    public synchronized @NotNull List<WordEntry> getWords() {
        return new ArrayList<>(myState.words);
    }

    /** 按单词删除（忽略大小写），供本地 HTTP 服务与工具窗共用。@return 是否删除了记录 */
    public synchronized boolean removeWord(@NotNull String word) {
        String trimmed = word.trim();
        boolean removed = myState.words.removeIf(entry -> entry.getWord().equalsIgnoreCase(trimmed));
        if (removed) {
            fireChanged();
        }
        return removed;
    }

    public synchronized void removeAt(int index) {
        if (index >= 0 && index < myState.words.size()) {
            myState.words.remove(index);
            fireChanged();
        }
    }

    public synchronized void clear() {
        if (!myState.words.isEmpty()) {
            myState.words.clear();
            fireChanged();
        }
    }

    public void addListener(@NotNull Listener listener) {
        myListeners.add(listener);
    }

    public void removeListener(@NotNull Listener listener) {
        myListeners.remove(listener);
    }

    private void fireChanged() {
        for (Listener listener : myListeners) {
            listener.onWordsChanged();
        }
    }
}
