package com.landonwebster.huddle;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;

import androidx.annotation.RequiresApi;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HuddleNativePlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings s = getBridge().getWebView().getSettings();
            // Let call audio and video play without an extra tap.
            s.setMediaPlaybackRequiresUserGesture(false);
        }
        // Calls, alarms and messages ring and notify, so ask once to show notifications (Android 13+).
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !AlarmScheduler.prefs(this).getBoolean("askedNotify", false)) {
            AlarmScheduler.prefs(this).edit().putBoolean("askedNotify", true).apply();
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4711);
        }
        AlarmScheduler.schedule(this);
    }

    // Android 14+ tells the app when someone takes a screenshot of it. The chat screen shows
    // "<name> took a screenshot" to everyone in that chat.
    private Object screenshotCallback; // an Activity.ScreenCaptureCallback on Android 14+

    @Override
    public void onStart() {
        super.onStart();
        if (Build.VERSION.SDK_INT >= 34) {
            if (screenshotCallback == null) screenshotCallback = Screenshots.make();
            Screenshots.register(this, screenshotCallback);
        }
    }

    @Override
    public void onStop() {
        if (Build.VERSION.SDK_INT >= 34 && screenshotCallback != null) Screenshots.unregister(this, screenshotCallback);
        super.onStop();
    }

    @RequiresApi(34)
    private static final class Screenshots {
        static Object make() {
            return (Activity.ScreenCaptureCallback) HuddleNativePlugin::screenshotTaken;
        }
        static void register(Activity a, Object cb) {
            try { a.registerScreenCaptureCallback(a.getMainExecutor(), (Activity.ScreenCaptureCallback) cb); } catch (Exception ignored) {}
        }
        static void unregister(Activity a, Object cb) {
            try { a.unregisterScreenCaptureCallback((Activity.ScreenCaptureCallback) cb); } catch (Exception ignored) {}
        }
    }
}
