package com.gientech.wordcatcher;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * 用操作系统自带的 TTS 朗读单词：
 * Windows 依次尝试 PowerShell 的 System.Speech 与 SAPI COM 引擎（离线可用，前者在
 * 部分 Windows 11 24H2/25H2 机器上会静默失效，所以必须留备选）；macOS 用 say，Linux 用 espeak。
 *
 * <p>所有失败都会抛 {@link SpeakException}：异步路径记日志并弹通知，HTTP 路径把错误
 * 返回给浏览器扩展（以便它回退到浏览器语音合成），不再无声无息。</p>
 */
public final class SpeakWord {

    private static final Logger LOG = Logger.getInstance(SpeakWord.class);

    private SpeakWord() {
    }

    /** 异步朗读：失败时写 idea.log 并在 IDE 里弹通知（可见，不再静默）。 */
    public static void speakAsync(@Nullable Project project, @NotNull String text) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                speak(text);
            } catch (Exception e) {
                LOG.warn("朗读失败: " + text, e);
                if (project != null && !project.isDisposed()) {
                    WordCatcherNotifications.warn(project, "朗读失败：" + e.getMessage());
                }
            }
        });
    }

    /** 同步朗读（HTTP /api/speak 用，运行在 HTTP 工作线程）：失败抛异常。 */
    public static void speakOrThrow(@NotNull String text) throws SpeakException {
        speak(text);
    }

    private static void speak(@NotNull String text) throws SpeakException {
        String cleaned = text.trim();
        if (cleaned.isEmpty()) {
            return;
        }
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        List<ProcessBuilder> candidates = new ArrayList<>();
        if (os.contains("win")) {
            // 单引号转义后内联，避免 stdin/参数编码问题
            String safe = cleaned.replace("'", "''");
            // 首选：System.Speech（.NET 封装的 SAPI5）
            candidates.add(new ProcessBuilder("powershell", "-NoProfile", "-STA", "-Command",
                    "Add-Type -AssemblyName System.Speech; " +
                            "(New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('" + safe + "')"));
            // 备选：SAPI COM 引擎（同一语音库，绕开 System.Speech 在部分新系统上的故障）
            candidates.add(new ProcessBuilder("powershell", "-NoProfile", "-STA", "-Command",
                    "$v = New-Object -ComObject SAPI.SpVoice; $v.Speak('" + safe + "') | Out-Null"));
        } else if (os.contains("mac") || os.contains("darwin")) {
            candidates.add(new ProcessBuilder("say", cleaned));
        } else {
            candidates.add(new ProcessBuilder("espeak", cleaned));
        }

        StringBuilder errors = new StringBuilder();
        for (ProcessBuilder builder : candidates) {
            builder.redirectErrorStream(true);
            String output = run(builder);
            if (output == null) {
                return; // 该引擎成功
            }
            if (errors.length() > 0) {
                errors.append("；");
            }
            errors.append(output);
        }
        throw new SpeakException("所有系统语音引擎都失败了：" + errors);
    }

    /**
     * 执行命令并等它结束；返回 null 表示成功（退出码 0），
     * 否则返回简短的失败描述（含退出码与输出前 160 字符）。
     */
    private static @Nullable String run(@NotNull ProcessBuilder builder) {
        Process process;
        try {
            process = builder.start();
        } catch (Exception e) {
            return "无法启动 " + builder.command().get(0) + "：" + e.getMessage();
        }
        String output;
        try (InputStream stream = process.getInputStream()) {
            output = new String(stream.readAllBytes(), java.nio.charset.Charset.defaultCharset());
        } catch (Exception e) {
            output = e.getMessage();
        }
        try {
            if (!process.waitFor(15, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                return "执行超时（15 秒）";
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            return "被中断";
        }
        int code = process.exitValue();
        if (code == 0) {
            return null;
        }
        String brief = output == null ? "" : output.trim();
        if (brief.length() > 160) {
            brief = brief.substring(0, 160) + "…";
        }
        return "退出码 " + code + (brief.isEmpty() ? "" : "：" + brief);
    }

    /** 朗读失败（所有引擎都不可用）时抛出，消息可直接展示给用户。 */
    public static final class SpeakException extends Exception {
        public SpeakException(@NotNull String message) {
            super(message);
        }
    }
}
