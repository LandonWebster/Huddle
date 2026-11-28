package com.landonwebster.huddle;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Sleep Mode's "Quiet other apps" (public/sleep.js). Android doesn't let one app close other
// apps, so this is the closest real thing: while Sleep Mode is on, Huddle turns on the phone's
// Do Not Disturb so other apps can't ring, buzz or pop up. Alarms, media (a sleep call's audio)
// and Huddle's own call notifications still get through. Turning Sleep Mode off puts Do Not
// Disturb back the way it was. Needs the person to allow "Do Not Disturb access" once.
@CapacitorPlugin(name = "HuddleSleepFocus")
public class SleepFocusPlugin extends Plugin {
    private static final String PREFS = "huddle_sleep_focus";

    private NotificationManager nm() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
    private boolean hasAccess() {
        NotificationManager nm = nm();
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && nm != null && nm.isNotificationPolicyAccessGranted();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        r.put("access", hasAccess());
        r.put("active", prefs().getBoolean("active", false));
        call.resolve(r);
    }

    // Opens Android's "Do Not Disturb access" page, where the person switches Huddle on.
    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (hasAccess()) { status(call); return; }
        try {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            call.reject("Couldn't open the Do Not Disturb settings");
            return;
        }
        status(call);
    }

    @PluginMethod
    public void start(PluginCall call) {
        NotificationManager nm = nm();
        if (!hasAccess() || nm == null) { status(call); return; }
        try {
            SharedPreferences p = prefs();
            if (!p.getBoolean("active", false)) {
                // Remember the person's own Do Not Disturb so it can be put back.
                SharedPreferences.Editor e = p.edit();
                e.putInt("filter", nm.getCurrentInterruptionFilter());
                NotificationManager.Policy old = nm.getNotificationPolicy();
                if (old != null) {
                    e.putInt("cats", old.priorityCategories);
                    e.putInt("callers", old.priorityCallSenders);
                    e.putInt("msgs", old.priorityMessageSenders);
                    e.putInt("visual", old.suppressedVisualEffects);
                    e.putBoolean("hasPolicy", true);
                }
                e.putBoolean("active", true).apply();
            }
            // Huddle's own call notifications get through Do Not Disturb.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                for (NotificationChannel ch : nm.getNotificationChannels()) {
                    if (ch.getId().startsWith("huddle_calls") || ch.getId().startsWith("huddle_alarm")) {
                        ch.setBypassDnd(true);
                        nm.createNotificationChannel(ch);
                    }
                }
            }
            // Only alarms and media (sleep call audio) through; everything else stays quiet.
            int cats = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                cats = NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS | NotificationManager.Policy.PRIORITY_CATEGORY_MEDIA;
            }
            nm.setNotificationPolicy(new NotificationManager.Policy(cats, 0, 0));
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
        } catch (Exception e) {
            call.reject("Couldn't turn on Do Not Disturb");
            return;
        }
        status(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        NotificationManager nm = nm();
        SharedPreferences p = prefs();
        if (hasAccess() && nm != null && p.getBoolean("active", false)) {
            try {
                if (p.getBoolean("hasPolicy", false)) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        nm.setNotificationPolicy(new NotificationManager.Policy(p.getInt("cats", 0), p.getInt("callers", 0), p.getInt("msgs", 0), p.getInt("visual", 0)));
                    } else {
                        nm.setNotificationPolicy(new NotificationManager.Policy(p.getInt("cats", 0), p.getInt("callers", 0), p.getInt("msgs", 0)));
                    }
                }
                nm.setInterruptionFilter(p.getInt("filter", NotificationManager.INTERRUPTION_FILTER_ALL));
            } catch (Exception ignored) {}
        }
        p.edit().clear().apply();
        status(call);
    }
}
