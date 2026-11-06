package com.gientech.wordcatcher;

import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.editor.event.EditorFactoryEvent;
import com.intellij.openapi.editor.event.EditorFactoryListener;
import com.intellij.openapi.editor.markup.HighlighterLayer;
import com.intellij.openapi.editor.markup.HighlighterTargetArea;
import com.intellij.openapi.editor.markup.RangeHighlighter;
import com.intellij.openapi.editor.markup.TextAttributes;
import com.intellij.ui.JBColor;
import com.intellij.util.Alarm;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 在所有编辑器中高亮已记录的生词。通过 plugin.xml 注册为应用级 EditorFactoryListener，
 * 随 IDE 启动；开关状态持久化在 PropertiesComponent。
 */
public class WordHighlighter implements EditorFactoryListener {

    private static final String HIGHLIGHT_ENABLED_KEY = "wordcatcher.highlight.enabled";

    /** 生词高亮背景色（浅色主题 / 深色主题）。 */
    private static final TextAttributes ATTRIBUTES = new TextAttributes(
            null, new JBColor(0xFFE9A8, 0x5C4A1E), null, null, Font.PLAIN);

    /** 超大文档跳过高亮，避免卡顿。 */
    private static final int MAX_TEXT_LENGTH = 2_000_000;

    private static volatile WordHighlighter ourInstance;

    private final Map<Editor, EditorState> myStates = new ConcurrentHashMap<>();
    private volatile Pattern myPattern;

    public WordHighlighter() {
        ourInstance = this;
        WordStorage.getInstance().addListener(() -> {
            myPattern = null; // 单词表变化，重建匹配正则
            refreshAll();
        });
    }

    public static boolean isHighlightEnabled() {
        return PropertiesComponent.getInstance().getBoolean(HIGHLIGHT_ENABLED_KEY, true);
    }

    public static void setHighlightEnabled(boolean enabled) {
        PropertiesComponent.getInstance().setValue(HIGHLIGHT_ENABLED_KEY, enabled);
        WordHighlighter highlighter = ourInstance;
        if (highlighter != null) {
            highlighter.refreshAll();
        }
    }

    @Override
    public void editorCreated(@NotNull EditorFactoryEvent event) {
        Editor editor = event.getEditor();
        EditorState state = new EditorState();
        myStates.put(editor, state);
        state.myDocListener = new DocumentListener() {
            @Override
            public void documentChanged(@NotNull DocumentEvent e) {
                state.myAlarm.cancelAllRequests();
                state.myAlarm.addRequest(() -> applyHighlights(editor), 300);
            }
        };
        editor.getDocument().addDocumentListener(state.myDocListener);
        applyHighlights(editor);
    }

    @Override
    public void editorReleased(@NotNull EditorFactoryEvent event) {
        Editor editor = event.getEditor();
        EditorState state = myStates.remove(editor);
        if (state == null) {
            return;
        }
        state.myAlarm.cancelAllRequests();
        editor.getDocument().removeDocumentListener(state.myDocListener);
        for (RangeHighlighter highlighter : state.myHighlighters) {
            editor.getMarkupModel().removeHighlighter(highlighter);
        }
        state.myHighlighters.clear();
    }

    public void refreshAll() {
        if (SwingUtilities.isEventDispatchThread()) {
            doRefreshAll();
        } else {
            SwingUtilities.invokeLater(this::doRefreshAll);
        }
    }

    private void doRefreshAll() {
        for (Editor editor : EditorFactory.getInstance().getAllEditors()) {
            applyHighlights(editor);
        }
    }

    private void applyHighlights(Editor editor) {
        if (editor.isDisposed()) {
            return;
        }
        EditorState state = myStates.get(editor);
        if (state == null) {
            return;
        }
        for (RangeHighlighter highlighter : state.myHighlighters) {
            editor.getMarkupModel().removeHighlighter(highlighter);
        }
        state.myHighlighters.clear();
        if (!isHighlightEnabled()) {
            return;
        }
        List<WordEntry> words = WordStorage.getInstance().getWords();
        if (words.isEmpty()) {
            return;
        }
        Document document = editor.getDocument();
        if (document.getTextLength() == 0 || document.getTextLength() > MAX_TEXT_LENGTH) {
            return;
        }
        Pattern pattern = myPattern;
        if (pattern == null) {
            StringJoiner alternation = new StringJoiner("|");
            for (WordEntry word : words) {
                alternation.add(Pattern.quote(word.getWord()));
            }
            pattern = Pattern.compile("\\b(?:" + alternation + ")\\b", Pattern.CASE_INSENSITIVE);
            myPattern = pattern;
        }
        Matcher matcher = pattern.matcher(document.getCharsSequence());
        while (matcher.find()) {
            state.myHighlighters.add(editor.getMarkupModel().addRangeHighlighter(
                    matcher.start(), matcher.end(),
                    HighlighterLayer.ADDITIONAL_SYNTAX, ATTRIBUTES, HighlighterTargetArea.EXACT_RANGE));
        }
    }

    private static final class EditorState {
        private final List<RangeHighlighter> myHighlighters = new ArrayList<>();
        private final Alarm myAlarm = new Alarm();
        private DocumentListener myDocListener;
    }
}
