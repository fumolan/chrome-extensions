package com.gientech.wordcatcher;

import com.intellij.ide.AppLifecycleListener;

/**
 * IDE 启动完成时启动本地 HTTP 服务（application service 是懒加载的，这里作为启动钩子，
 * 不依赖任何项目打开，欢迎页状态下服务也可用）。
 */
public class WordCatcherStartup implements AppLifecycleListener {

    @Override
    public void appStarted() {
        WordCatcherHttpService.getInstance().ensureStarted();
    }
}
