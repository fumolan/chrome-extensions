package com.gientech.wordcatcher;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBLabel;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 生词卡片：随机顺序翻卡自测 —— 看单词回忆释义，翻转核对，最后统计认识 / 不认识。
 */
public class FlashcardsDialog extends DialogWrapper {

    private final Project myProject;
    private final List<WordEntry> myCards;
    private final JBLabel myProgress = new JBLabel("", SwingConstants.CENTER);
    private final JBLabel myWord = new JBLabel("", SwingConstants.CENTER);
    private final JBLabel myPhonetic = new JBLabel(" ", SwingConstants.CENTER);
    private final JBLabel myTranslation = new JBLabel("", SwingConstants.CENTER);
    private final JBLabel myRoot = new JBLabel(" ", SwingConstants.CENTER);
    private final JBLabel myExample = new JBLabel(" ", SwingConstants.CENTER);
    private final JBLabel myContext = new JBLabel("", SwingConstants.CENTER);
    private final JButton myFlip = new JButton("显示释义");
    private final JButton myKnown = new JButton("认识 ✓");
    private final JButton myUnknown = new JButton("不认识 ✗");
    private final JButton mySpeak = new JButton("朗读");
    private final JButton mySkip = new JButton("跳过");
    private int myIndex = -1;
    private boolean myFlipped;
    private int myKnownCount;
    private int myUnknownCount;

    public FlashcardsDialog(@Nullable Project project, @NotNull List<WordEntry> words) {
        super(project, false);
        myProject = project;
        myCards = new ArrayList<>(words);
        Collections.shuffle(myCards);
        setTitle("生词卡片");
        setOKButtonText("结束测验");
        init();
        showNext();
    }

    @Nullable
    @Override
    protected JComponent createCenterPanel() {
        myWord.setFont(myWord.getFont().deriveFont(Font.BOLD, 30f));
        myPhonetic.setFont(myPhonetic.getFont().deriveFont(Font.PLAIN, 14f));
        myPhonetic.setForeground(new JBColor(0x8C8C8C, 0x909090));
        myTranslation.setFont(myTranslation.getFont().deriveFont(Font.PLAIN, 16f));
        myRoot.setFont(myRoot.getFont().deriveFont(Font.PLAIN, 13f));
        myRoot.setForeground(new JBColor(0x1B7E5A, 0x6FBF9A));
        myExample.setFont(myExample.getFont().deriveFont(Font.PLAIN, 13f));
        myContext.setFont(myContext.getFont().deriveFont(Font.ITALIC, 12f));
        myContext.setForeground(new JBColor(0x8C8C8C, 0x909090));

        JPanel root = new JPanel(new BorderLayout(JBUI.scale(4), JBUI.scale(8)));
        root.setBorder(JBUI.Borders.empty(10, 30, 20, 30));
        root.setPreferredSize(JBUI.size(600, 360));
        root.add(myProgress, BorderLayout.NORTH);

        JPanel cardFace = new JPanel(new BorderLayout(0, JBUI.scale(2)));
        cardFace.add(myWord, BorderLayout.CENTER);
        cardFace.add(myPhonetic, BorderLayout.SOUTH);
        root.add(cardFace, BorderLayout.CENTER);

        JPanel textPanel = new JPanel(new GridLayout(4, 1, 0, JBUI.scale(4)));
        textPanel.add(myTranslation);
        textPanel.add(myRoot);
        textPanel.add(myExample);
        textPanel.add(myContext);
        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.CENTER, JBUI.scale(8), 0));
        buttonPanel.add(mySpeak);
        buttonPanel.add(myFlip);
        buttonPanel.add(mySkip);
        buttonPanel.add(myKnown);
        buttonPanel.add(myUnknown);
        JPanel south = new JPanel(new BorderLayout(0, JBUI.scale(12)));
        south.add(textPanel, BorderLayout.CENTER);
        south.add(buttonPanel, BorderLayout.SOUTH);
        root.add(south, BorderLayout.SOUTH);

        myFlip.addActionListener(e -> flip());
        myKnown.addActionListener(e -> grade(true));
        myUnknown.addActionListener(e -> grade(false));
        mySkip.addActionListener(e -> showNext());
        mySpeak.addActionListener(e -> speakCurrent());
        return root;
    }

    @NotNull
    @Override
    protected Action[] createActions() {
        return new Action[]{getOKAction()};
    }

    private void showNext() {
        myIndex++;
        myFlipped = false;
        if (myIndex >= myCards.size()) {
            showSummary();
            return;
        }
        WordEntry entry = myCards.get(myIndex);
        myProgress.setText("第 " + (myIndex + 1) + " / " + myCards.size() + " 张    认识 "
                + myKnownCount + " · 不认识 " + myUnknownCount);
        myWord.setText(entry.getWord());
        String phonetic = entry.getPhonetic();
        myPhonetic.setText(phonetic == null || phonetic.isBlank() ? " " : phonetic);
        myTranslation.setText("（先回忆释义，再点「显示释义」核对）");
        myRoot.setText(" ");
        myExample.setText(" ");
        String context = entry.getContext();
        myContext.setText(context == null || context.isBlank() ? " " : "“" + context + "”");
        myFlip.setEnabled(true);
        mySpeak.setEnabled(true);
        mySkip.setEnabled(true);
        myKnown.setVisible(false);
        myUnknown.setVisible(false);
        JRootPane rootPane = myFlip.getRootPane();
        if (rootPane != null) {
            rootPane.setDefaultButton(myFlip);
        }
    }

    private void flip() {
        if (myFlipped || myIndex >= myCards.size()) {
            return;
        }
        myFlipped = true;
        WordEntry entry = myCards.get(myIndex);
        String meaning = notBlank(entry.getPosMeaning()) ? entry.getPosMeaning() : entry.getTranslation();
        myTranslation.setText(meaning == null || meaning.isBlank()
                ? "（暂无释义，可在生词本里点「补全词典」）" : meaning);
        myRoot.setText(notBlank(entry.getRoot()) ? "词根：" + entry.getRoot() : " ");
        myExample.setText(notBlank(entry.getExample()) ? "例句：" + entry.getExample() : " ");
        myFlip.setEnabled(false);
        myKnown.setVisible(true);
        myUnknown.setVisible(true);
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    private void grade(boolean known) {
        if (!myFlipped) {
            return;
        }
        if (known) {
            myKnownCount++;
        } else {
            myUnknownCount++;
        }
        showNext();
    }

    private void showSummary() {
        myProgress.setText(" ");
        myWord.setText("测验完成！");
        myPhonetic.setText(" ");
        myTranslation.setText("认识 " + myKnownCount + " 个，不认识 " + myUnknownCount + " 个");
        myRoot.setText(" ");
        myExample.setText(" ");
        myContext.setText(" ");
        myFlip.setEnabled(false);
        mySpeak.setEnabled(false);
        mySkip.setEnabled(false);
        myKnown.setVisible(false);
        myUnknown.setVisible(false);
    }

    private void speakCurrent() {
        if (myIndex >= 0 && myIndex < myCards.size()) {
            SpeakWord.speakAsync(myProject, myCards.get(myIndex).getWord());
        }
    }
}
