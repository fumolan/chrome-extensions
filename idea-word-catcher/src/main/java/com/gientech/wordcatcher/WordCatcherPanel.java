package com.gientech.wordcatcher;

import com.intellij.icons.AllIcons;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.ToggleAction;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.IconLoader;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.IdeBorderFactory;
import com.intellij.ui.SideBorder;
import com.intellij.ui.ToolbarDecorator;
import com.intellij.ui.components.JBTextArea;
import com.intellij.ui.table.JBTable;
import com.intellij.util.ui.ColumnInfo;
import com.intellij.util.ui.JBUI;
import com.intellij.util.ui.ListTableModel;
import com.intellij.util.ui.UIUtil;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.awt.datatransfer.StringSelection;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/** 「生词本」工具窗面板：表格 + 工具栏（删除 / 朗读 / 翻译 / 卡片 / 高亮 / 复制 / 导出 / 清空）。 */
public class WordCatcherPanel extends JPanel {

    private static final DateTimeFormatter TIME_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault());

    private final Project myProject;
    private final ListTableModel<WordEntry> myModel;
    private final JBTable myTable = new JBTable();
    private final JBTextArea myDetails = new JBTextArea();
    private final WordStorage.Listener myListener = this::refresh;

    WordCatcherPanel(Project project) {
        super(new BorderLayout());
        myProject = project;

        myModel = new ListTableModel<>(
                wordColumn(), translationColumn(), countColumn(),
                exampleColumn(), contextColumn(), sourceColumn(), timeColumn());
        myTable.setModel(myModel);
        myTable.setStriped(true);
        myTable.getEmptyText().setText("暂无生词：在编辑器中选中单词后按 Alt+Shift+W");
        myTable.getColumnModel().getColumn(0).setPreferredWidth(130);
        myTable.getColumnModel().getColumn(1).setPreferredWidth(200);
        myTable.getColumnModel().getColumn(3).setPreferredWidth(220);
        myTable.getColumnModel().getColumn(4).setPreferredWidth(260);
        myTable.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2) {
                    int row = myTable.rowAtPoint(e.getPoint());
                    int modelRow = row >= 0 ? myTable.convertRowIndexToModel(row) : -1;
                    if (modelRow >= 0 && modelRow < myModel.getItems().size()) {
                        SpeakWord.speakAsync(myProject, myModel.getItems().get(modelRow).getWord());
                    }
                }
            }
        });
        myTable.getSelectionModel().addListSelectionListener(e -> updateDetails());

        myDetails.setEditable(false);
        myDetails.setLineWrap(true);
        myDetails.setWrapStyleWord(true);
        myDetails.setRows(5);
        myDetails.setBorder(JBUI.Borders.empty(4, 8));
        myDetails.setFont(JBUI.Fonts.label());
        JPanel detailsPanel = new JPanel(new BorderLayout());
        detailsPanel.setBorder(IdeBorderFactory.createBorder(SideBorder.TOP));
        detailsPanel.add(myDetails, BorderLayout.CENTER);

        ToolbarDecorator decorator = ToolbarDecorator.createDecorator(myTable)
                .setRemoveAction(button -> removeSelected())
                .disableUpAction()
                .disableDownAction()
                .addExtraAction(new SpeakSelectedAction())
                .addExtraAction(new EnrichMissingAction())
                .addExtraAction(new FlashcardsAction())
                .addExtraAction(new ToggleHighlightAction())
                .addExtraAction(new CopyAllAction())
                .addExtraAction(new ExportCsvAction())
                .addExtraAction(new ClearAllAction());

        add(decorator.createPanel(), BorderLayout.CENTER);
        add(detailsPanel, BorderLayout.SOUTH);
        refresh();
        WordStorage.getInstance().addListener(myListener);
    }

    void dispose() {
        WordStorage.getInstance().removeListener(myListener);
    }

    private void refresh() {
        List<WordEntry> words = WordStorage.getInstance().getWords();
        if (SwingUtilities.isEventDispatchThread()) {
            myModel.setItems(words);
        } else {
            SwingUtilities.invokeLater(() -> myModel.setItems(words));
        }
    }

    private void removeSelected() {
        int[] viewRows = myTable.getSelectedRows();
        if (viewRows.length == 0) {
            return;
        }
        int[] modelRows = new int[viewRows.length];
        for (int i = 0; i < viewRows.length; i++) {
            modelRows[i] = myTable.convertRowIndexToModel(viewRows[i]);
        }
        Arrays.sort(modelRows);
        for (int i = modelRows.length - 1; i >= 0; i--) {
            WordStorage.getInstance().removeAt(modelRows[i]);
        }
    }

    private void speakSelected() {
        List<WordEntry> items = myModel.getItems();
        String text = Arrays.stream(myTable.getSelectedRows())
                .mapToObj(myTable::convertRowIndexToModel)
                .filter(row -> row >= 0 && row < items.size())
                .map(items::get)
                .map(WordEntry::getWord)
                .collect(Collectors.joining(". "));
        if (!text.isEmpty()) {
            SpeakWord.speakAsync(myProject, text);
        }
    }

    /** 选中行变化时刷新底部详情区（音标 / 词性释义 / 词根 / 例句 / 词源 / 上下文）。 */
    private void updateDetails() {
        int viewRow = myTable.getSelectedRow();
        int modelRow = viewRow >= 0 ? myTable.convertRowIndexToModel(viewRow) : -1;
        List<WordEntry> items = myModel.getItems();
        if (modelRow < 0 || modelRow >= items.size()) {
            myDetails.setText("");
            return;
        }
        WordEntry entry = items.get(modelRow);
        StringBuilder sb = new StringBuilder();
        sb.append("【").append(entry.getWord()).append("】");
        if (notBlank(entry.getPhonetic())) {
            sb.append("  ").append(entry.getPhonetic());
        }
        sb.append("    （遇到 ").append(entry.getCount()).append(" 次）\n");
        String meaning = notBlank(entry.getPosMeaning()) ? entry.getPosMeaning() : entry.getTranslation();
        if (notBlank(meaning)) {
            sb.append("释义：").append(meaning).append('\n');
        }
        if (notBlank(entry.getRoot())) {
            sb.append("词根：").append(entry.getRoot()).append('\n');
        }
        if (notBlank(entry.getExample())) {
            sb.append("例句：").append(entry.getExample()).append('\n');
        }
        if (notBlank(entry.getOrigin())) {
            sb.append("词源：").append(entry.getOrigin()).append('\n');
        }
        if (notBlank(entry.getContext())) {
            sb.append("上下文：").append(entry.getContext());
        }
        myDetails.setText(sb.toString().trim());
        myDetails.setCaretPosition(0);
    }

    private static boolean notBlank(@Nullable String value) {
        return value != null && !value.isBlank();
    }

    /** 给词典信息不全的生词补查（词性 / 音标 / 例句 / 词根 / 翻译，后台逐个执行，完成后通知）。 */
    private void enrichMissing() {
        List<WordEntry> missing = WordStorage.getInstance().getWords().stream()
                .filter(WordCatcherPanel::needsEnrich)
                .collect(Collectors.toList());
        if (missing.isEmpty()) {
            WordCatcherNotifications.info(myProject, "所有生词的词典信息都齐全了。");
            return;
        }
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            int succeeded = 0;
            for (WordEntry entry : missing) {
                if (WordEnricher.enrichSync(entry.getWord())) {
                    succeeded++;
                }
                try {
                    Thread.sleep(300);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            int done = succeeded;
            ApplicationManager.getApplication().invokeLater(() -> WordCatcherNotifications.info(
                    myProject, "词典补全完成：" + done + "/" + missing.size() + " 个单词获取到新信息。"));
        });
    }

    /** 任一词典字段为空即认为需要补全。 */
    private static boolean needsEnrich(WordEntry entry) {
        return !notBlank(entry.getTranslation()) || !notBlank(entry.getPosMeaning())
                || !notBlank(entry.getPhonetic()) || !notBlank(entry.getExample())
                || !notBlank(entry.getRoot());
    }

    private static ColumnInfo<WordEntry, String> wordColumn() {
        return new ColumnInfo<WordEntry, String>("单词") {
            @Override
            public String valueOf(WordEntry entry) {
                return entry.getWord();
            }

            @Nullable
            @Override
            public Comparator<WordEntry> getComparator() {
                return Comparator.comparing(WordEntry::getWord, String.CASE_INSENSITIVE_ORDER);
            }
        };
    }

    private static ColumnInfo<WordEntry, String> translationColumn() {
        return new ColumnInfo<WordEntry, String>("释义（词性）") {
            @Override
            public String valueOf(WordEntry entry) {
                if (notBlank(entry.getPosMeaning())) {
                    return entry.getPosMeaning();
                }
                String translation = entry.getTranslation();
                return translation == null ? "" : translation;
            }
        };
    }

    private static ColumnInfo<WordEntry, String> exampleColumn() {
        return new ColumnInfo<WordEntry, String>("例句") {
            @Override
            public String valueOf(WordEntry entry) {
                return notBlank(entry.getExample()) ? entry.getExample() : "";
            }
        };
    }

    private static ColumnInfo<WordEntry, Integer> countColumn() {
        return new ColumnInfo<WordEntry, Integer>("次数") {
            @Override
            public Integer valueOf(WordEntry entry) {
                return entry.getCount();
            }

            @Nullable
            @Override
            public Comparator<WordEntry> getComparator() {
                return Comparator.comparingInt(WordEntry::getCount);
            }
        };
    }

    private static ColumnInfo<WordEntry, String> contextColumn() {
        return new ColumnInfo<WordEntry, String>("上下文") {
            @Override
            public String valueOf(WordEntry entry) {
                return entry.getContext();
            }
        };
    }

    private static ColumnInfo<WordEntry, String> sourceColumn() {
        return new ColumnInfo<WordEntry, String>("来源文件") {
            @Override
            public String valueOf(WordEntry entry) {
                return entry.getSourceFile();
            }
        };
    }

    private static ColumnInfo<WordEntry, String> timeColumn() {
        return new ColumnInfo<WordEntry, String>("最近记录") {
            @Override
            public String valueOf(WordEntry entry) {
                return TIME_FORMAT.format(Instant.ofEpochMilli(entry.getLastCaptured()));
            }
        };
    }

    private class SpeakSelectedAction extends AnAction {
        SpeakSelectedAction() {
            super("朗读", "用系统语音朗读选中的生词（双击列表行也可朗读）",
                    IconLoader.getIcon("/icons/speak.svg", WordCatcherPanel.class));
        }

        @Override
        public void actionPerformed(@NotNull AnActionEvent e) {
            speakSelected();
        }

        @Override
        public void update(@NotNull AnActionEvent e) {
            e.getPresentation().setEnabled(myTable.getSelectedRowCount() > 0);
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }
    }

    private class EnrichMissingAction extends AnAction {
        EnrichMissingAction() {
            super("补全词典", "给词典信息不全的生词补查：词性 / 音标 / 例句 / 词根 / 翻译",
                    AllIcons.Actions.Find);
        }

        @Override
        public void actionPerformed(@NotNull AnActionEvent e) {
            enrichMissing();
        }

        @Override
        public void update(@NotNull AnActionEvent e) {
            e.getPresentation().setEnabled(!myModel.getItems().isEmpty());
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }
    }

    private class FlashcardsAction extends AnAction {
        FlashcardsAction() {
            super("生词卡片", "随机抽出生词做翻卡自测", IconLoader.getIcon("/icons/cards.svg", WordCatcherPanel.class));
        }

        @Override
        public void actionPerformed(@NotNull AnActionEvent e) {
            List<WordEntry> words = WordStorage.getInstance().getWords();
            if (words.isEmpty()) {
                WordCatcherNotifications.warn(myProject, "生词本是空的，先记录几个单词再来测验吧。");
                return;
            }
            new FlashcardsDialog(myProject, words).show();
        }

        @Override
        public void update(@NotNull AnActionEvent e) {
            e.getPresentation().setEnabled(!myModel.getItems().isEmpty());
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }
    }

    private class ToggleHighlightAction extends ToggleAction {
        ToggleHighlightAction() {
            super("生词高亮", "在编辑器中高亮所有已记录的生词", AllIcons.Actions.Highlighting);
        }

        @Override
        public boolean isSelected(@NotNull AnActionEvent e) {
            return WordHighlighter.isHighlightEnabled();
        }

        @Override
        public void setSelected(@NotNull AnActionEvent e, boolean state) {
            WordHighlighter.setHighlightEnabled(state);
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }
    }

    private class CopyAllAction extends AnAction {
        CopyAllAction() {
            super("复制全部单词", "把所有单词按行复制到剪贴板（可直接导入 Anki 等）", AllIcons.Actions.Copy);
        }

        @Override
        public void actionPerformed(@NotNull AnActionEvent e) {
            List<WordEntry> words = WordStorage.getInstance().getWords();
            if (words.isEmpty()) {
                return;
            }
            String text = words.stream().map(WordEntry::getWord).collect(Collectors.joining("\n"));
            CopyPasteManager.getInstance().setContents(new StringSelection(text));
            WordCatcherNotifications.info(myProject, "已复制 " + words.size() + " 个单词。");
        }

        @Override
        public void update(@NotNull AnActionEvent e) {
            e.getPresentation().setEnabled(!myModel.getItems().isEmpty());
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }
    }

    private class ExportCsvAction extends AnAction {
        ExportCsvAction() {
            super("导出 CSV", "选择目录，导出生词本为 CSV 文件", AllIcons.Actions.Download);
        }

        @Override
        public void actionPerformed(@NotNull AnActionEvent e) {
            List<WordEntry> words = WordStorage.getInstance().getWords();
            if (words.isEmpty()) {
                return;
            }
            VirtualFile dir = FileChooser.chooseFile(
                    FileChooserDescriptorFactory.createSingleFolderDescriptor(), myProject, null);
            if (dir == null) {
                return;
            }
            File target = new File(VfsUtilCore.virtualToIoFile(dir), "wordbook-" + LocalDate.now() + ".csv");
            try {
                writeCsv(target, words);
            } catch (IOException ex) {
                Messages.showErrorDialog(myProject, "导出失败：" + ex.getMessage(), "导出生词本");
                return;
            }
            WordCatcherNotifications.info(myProject, "已导出到 " + target.getAbsolutePath());
        }

        @Override
        public void update(@NotNull AnActionEvent e) {
            e.getPresentation().setEnabled(!myModel.getItems().isEmpty());
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }
    }

    private class ClearAllAction extends AnAction {
        ClearAllAction() {
            super("清空生词本", "删除全部生词记录", AllIcons.Actions.GC);
        }

        @Override
        public void actionPerformed(@NotNull AnActionEvent e) {
            if (WordStorage.getInstance().getWords().isEmpty()) {
                return;
            }
            int answer = Messages.showYesNoDialog(myProject,
                    "确定要清空全部生词记录吗？该操作不可撤销。", "清空生词本", Messages.getWarningIcon());
            if (answer == Messages.YES) {
                WordStorage.getInstance().clear();
            }
        }

        @Override
        public void update(@NotNull AnActionEvent e) {
            e.getPresentation().setEnabled(!myModel.getItems().isEmpty());
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }
    }

    private static void writeCsv(File target, List<WordEntry> words) throws IOException {
        try (var writer = Files.newBufferedWriter(target.toPath(), StandardCharsets.UTF_8)) {
            writer.write('\uFEFF'); // UTF-8 BOM，方便 Excel 直接打开
            writer.write("单词,音标,词性释义,翻译,词根拆解,例句,次数,首次记录,最近记录,来源文件,上下文");
            writer.newLine();
            for (WordEntry entry : words) {
                writer.write(csv(entry.getWord()));
                writer.write(',');
                writer.write(csv(safe(entry.getPhonetic())));
                writer.write(',');
                writer.write(csv(safe(entry.getPosMeaning())));
                writer.write(',');
                writer.write(csv(safe(entry.getTranslation())));
                writer.write(',');
                writer.write(csv(safe(entry.getRoot())));
                writer.write(',');
                writer.write(csv(safe(entry.getExample())));
                writer.write(',');
                writer.write(String.valueOf(entry.getCount()));
                writer.write(',');
                writer.write(csv(TIME_FORMAT.format(Instant.ofEpochMilli(entry.getFirstCaptured()))));
                writer.write(',');
                writer.write(csv(TIME_FORMAT.format(Instant.ofEpochMilli(entry.getLastCaptured()))));
                writer.write(',');
                writer.write(csv(entry.getSourceFile()));
                writer.write(',');
                writer.write(csv(entry.getContext()));
                writer.newLine();
            }
        }
    }

    private static String safe(@Nullable String value) {
        return value == null ? "" : value;
    }

    private static String csv(String value) {
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return '"' + value.replace("\"", "\"\"") + '"';
        }
        return value;
    }
}
