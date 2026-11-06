package com.gientech.wordcatcher;

import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

final class WordCatcherNotifications {

    private static final String GROUP_ID = "Word Catcher Notifications";

    private WordCatcherNotifications() {
    }

    static void info(@NotNull Project project, @NotNull String message) {
        show(project, message, NotificationType.INFORMATION);
    }

    static void warn(@NotNull Project project, @NotNull String message) {
        show(project, message, NotificationType.WARNING);
    }

    private static void show(@NotNull Project project, @NotNull String message, NotificationType type) {
        NotificationGroupManager.getInstance()
                .getNotificationGroup(GROUP_ID)
                .createNotification("生词本", message, type)
                .notify(project);
    }
}
