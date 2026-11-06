package com.gientech.wordcatcher;

import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.TextRange;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

import java.util.regex.Pattern;

/**
 * 取词动作：记录选中的单词；没有选区时取光标所在单词。
 * 快捷键 Alt+Shift+W，也可从编辑器右键菜单触发。
 */
public class CaptureWordAction extends AnAction {

    /** 只接受英文单词，允许内部连字符 / 撇号，例如 state-of-the-art、don't。本地 HTTP 服务共用。 */
    static final Pattern WORD_PATTERN = Pattern.compile("[A-Za-z]+(?:['-][A-Za-z]+)*");

    @Override
    public void update(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        Editor editor = e.getData(CommonDataKeys.EDITOR);
        e.getPresentation().setEnabledAndVisible(project != null && editor != null);
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.EDT;
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        Editor editor = e.getData(CommonDataKeys.EDITOR);
        if (project == null || editor == null) {
            return;
        }

        String word = editor.getSelectionModel().getSelectedText();
        if (word == null || word.isBlank()) {
            editor.getCaretModel().getPrimaryCaret().selectWordAtCaret(false);
            word = editor.getSelectionModel().getSelectedText();
        }
        if (word == null || word.isBlank()) {
            WordCatcherNotifications.warn(project, "未找到可记录的单词：请先选中单词，或把光标放在单词上。");
            return;
        }
        word = word.trim();
        if (!WORD_PATTERN.matcher(word).matches()) {
            WordCatcherNotifications.warn(project, "“" + word + "” 不是英文单词，无法记入生词本。");
            return;
        }

        VirtualFile file = e.getData(CommonDataKeys.VIRTUAL_FILE);
        String sourceFile = file != null ? file.getName() : "";
        String context = lineAtCaret(editor);

        int total = WordStorage.getInstance().addWord(word, context, sourceFile);
        String message = total > 1
                ? "已记录 “" + word + "”，第 " + total + " 次遇到。"
                : "已记录 “" + word + "”。";
        WordCatcherNotifications.info(project, message);

        // 后台补在线词典（词性 / 音标 / 例句 / 词源 / 翻译）+ 本地词根拆解，写入后表格自动刷新
        WordEnricher.enrichAsync(word);
    }

    /** 取光标所在行文本作为上下文（压缩空白并截断到 160 字符）。 */
    private static String lineAtCaret(@NotNull Editor editor) {
        Document document = editor.getDocument();
        int offset = Math.max(0, Math.min(editor.getCaretModel().getOffset(), document.getTextLength()));
        if (document.getLineCount() == 0) {
            return "";
        }
        int line = Math.min(document.getLineNumber(offset), document.getLineCount() - 1);
        String text = document.getText(
                new TextRange(document.getLineStartOffset(line), document.getLineEndOffset(line)));
        text = text.replaceAll("\\s+", " ").trim();
        return text.length() > 160 ? text.substring(0, 160) + "…" : text;
    }
}
