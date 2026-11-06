package com.gientech.wordcatcher;

/**
 * 一条生词记录。为兼容 XmlSerializer 持久化，保留无参构造器与 getter/setter。
 */
public class WordEntry {

    private String word = "";
    private String translation;
    private int count;
    private long firstCaptured;
    private long lastCaptured;
    private String context = "";
    private String sourceFile = "";
    /** 音标，如 /ˈælɡərɪðəm/ */
    private String phonetic;
    /** 带词性的释义，如 "n. 算法；v. 计算" */
    private String posMeaning;
    /** 词根拆解，如 "pre-(预先) + dict(说) + -ion(名词后缀)" */
    private String root;
    /** 例句（英文，可能附中文翻译） */
    private String example;
    /** 词源说明 */
    private String origin;

    public WordEntry() {
    }

    public WordEntry(String word, String context, String sourceFile) {
        this.word = word;
        this.context = context == null ? "" : context;
        this.sourceFile = sourceFile == null ? "" : sourceFile;
        this.count = 1;
        long now = System.currentTimeMillis();
        this.firstCaptured = now;
        this.lastCaptured = now;
    }

    public String getWord() {
        return word;
    }

    public void setWord(String word) {
        this.word = word;
    }

    public String getTranslation() {
        return translation;
    }

    public void setTranslation(String translation) {
        this.translation = translation;
    }

    public int getCount() {
        return count;
    }

    public void setCount(int count) {
        this.count = count;
    }

    public long getFirstCaptured() {
        return firstCaptured;
    }

    public void setFirstCaptured(long firstCaptured) {
        this.firstCaptured = firstCaptured;
    }

    public long getLastCaptured() {
        return lastCaptured;
    }

    public void setLastCaptured(long lastCaptured) {
        this.lastCaptured = lastCaptured;
    }

    public String getContext() {
        return context;
    }

    public void setContext(String context) {
        this.context = context == null ? "" : context;
    }

    public String getSourceFile() {
        return sourceFile;
    }

    public void setSourceFile(String sourceFile) {
        this.sourceFile = sourceFile == null ? "" : sourceFile;
    }

    public String getPhonetic() {
        return phonetic;
    }

    public void setPhonetic(String phonetic) {
        this.phonetic = phonetic;
    }

    public String getPosMeaning() {
        return posMeaning;
    }

    public void setPosMeaning(String posMeaning) {
        this.posMeaning = posMeaning;
    }

    public String getRoot() {
        return root;
    }

    public void setRoot(String root) {
        this.root = root;
    }

    public String getExample() {
        return example;
    }

    public void setExample(String example) {
        this.example = example;
    }

    public String getOrigin() {
        return origin;
    }

    public void setOrigin(String origin) {
        this.origin = origin;
    }
}
