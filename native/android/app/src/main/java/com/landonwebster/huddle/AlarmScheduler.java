package com.landonwebster.huddle;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * Real phone alarms for the Huddle Alarms tab. The web app sends its alarms here (setAlarms);
 * they're kept on the phone and the soonest one is set with Android's alarm clock, so it rings
 * on time even when Huddle is closed, the screen is off, or the phone restarted (BootReceiver).
 *
 * Saved in SharedPreferences "huddle_alarms":
 *   alarms  [{ id, h, m, days: [0..6 Sun..Sat], label, on, pip }]
 *   timer   when a running timer ends (ms), or 0
 *   snooze  when a snoozed alarm rings again (ms), or 0, with snoozeId
 *   name    first name, for Pip's "Good morning"
 *   sound, vibrate   Settings switches
 */
final class AlarmScheduler {
    static final String PREFS = "huddle_alarms";
    static final String ACTION_RING = "huddle.ALARM_RING";
    static final String ACTION_SNOOZE = "huddle.ALARM_SNOOZE";
    static final String ACTION_STOP = "huddle.ALARM_STOP";
    static final int NOTIFICATION_ID = 21;
    static final long SNOOZE_MS = 9 * 60 * 1000L;

    private AlarmScheduler() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray alarms(Context c) {
        try { return new JSONArray(prefs(c).getString("alarms", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static JSONObject find(Context c, String id) {
        JSONArray list = alarms(c);
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a != null && id != null && id.equals(a.optString("id"))) return a;
        }
        return null;
    }

    /** When an alarm rings next (ms), or 0 when it's off. */
    static long nextAt(JSONObject a, long from) {
        if (a == null || !a.optBoolean("on")) return 0;
        JSONArray days = a.optJSONArray("days");
        for (int i = 0; i < 8; i++) {
            Calendar cal = Calendar.getInstance();
            cal.setTimeInMillis(from);
            cal.add(Calendar.DAY_OF_YEAR, i);
            cal.set(Calendar.HOUR_OF_DAY, a.optInt("h"));
            cal.set(Calendar.MINUTE, a.optInt("m"));
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            long t = cal.getTimeInMillis();
            if (t <= from) continue;
            if (days == null || days.length() == 0) return t;
            int dow = cal.get(Calendar.DAY_OF_WEEK) - 1; // 0 = Sunday, like the web app
            for (int d = 0; d < days.length(); d++) if (days.optInt(d, -1) == dow) return t;
        }
        return 0;
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /** Sets Android's alarm for whatever rings soonest (an alarm, the timer, or a snooze). */
    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        SharedPreferences p = prefs(c);
        long now = System.currentTimeMillis();
        long best = 0;
        String kind = null, id = null;
        JSONArray list = alarms(c);
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            long t = nextAt(a, now);
            if (t > 0 && (best == 0 || t < best)) { best = t; kind = "alarm"; id = a.optString("id"); }
        }
        long timer = p.getLong("timer", 0);
        if (timer > now && (best == 0 || timer < best)) { best = timer; kind = "timer"; id = "timer"; }
        long snooze = p.getLong("snooze", 0);
        if (snooze > now && (best == 0 || snooze < best)) { best = snooze; kind = "snooze"; id = p.getString("snoozeId", ""); }

        PendingIntent ring = ringIntent(c, kind, id);
        am.cancel(ring);
        if (best == 0) return;
        Intent show = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent showPi = PendingIntent.getActivity(c, 31, show, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            if (canExact(c)) am.setAlarmClock(new AlarmManager.AlarmClockInfo(best, showPi), ring);
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, best, ring);
            else am.set(AlarmManager.RTC_WAKEUP, best, ring);
        } catch (SecurityException e) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, best, ring);
        }
    }

    private static PendingIntent ringIntent(Context c, String kind, String id) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_RING);
        if (kind != null) i.putExtra("kind", kind);
        if (id != null) i.putExtra("id", id);
        // One alarm is set at a time, so one request code (FLAG_UPDATE_CURRENT swaps the extras).
        return PendingIntent.getBroadcast(c, 30, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static PendingIntent action(Context c, String action, String kind, String id, int code) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(action).putExtra("kind", kind).putExtra("id", id);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ---------- The ringing notification ----------
    // The channel plays the phone's alarm sound on the alarm volume and repeats it ("insistent")
    // until it's stopped. Android doesn't let an app change a channel's sound later, so there is
    // one channel for each Sounds / Vibration choice.
    static String channel(Context c, boolean sound, boolean vibrate) {
        String id = "huddle_alarm" + (sound ? "_s" : "") + (vibrate ? "_v" : "");
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(id) == null) {
            String name = "Alarms" + (!sound && !vibrate ? " (silent)" : !sound ? " (vibrate only)" : !vibrate ? " (no vibration)" : "");
            NotificationChannel ch = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Your Huddle alarms and timers");
            if (sound) {
                ch.setSound(alarmSound(), new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            } else ch.setSound(null, null);
            ch.enableVibration(vibrate);
            if (vibrate) ch.setVibrationPattern(new long[] { 0, 1000, 500, 1000, 500 });
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setBypassDnd(true);
            nm.createNotificationChannel(ch);
        }
        return id;
    }

    static Uri alarmSound() {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return u;
    }

    static void showRinging(Context c, String kind, String id, String title, String text) {
        SharedPreferences p = prefs(c);
        boolean sound = p.getBoolean("sound", true), vibrate = p.getBoolean("vibrate", true);
        Intent full = new Intent(c, AlarmActivity.class)
            .putExtra("kind", kind).putExtra("id", id).putExtra("title", title).putExtra("text", text)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullPi = PendingIntent.getActivity(c, 32, full, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel(c, sound, vibrate))
            .setSmallIcon(R.drawable.ic_stat_huddle)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullPi)
            .setFullScreenIntent(fullPi, true)
            .setTimeoutAfter(10 * 60 * 1000L)
            .setDeleteIntent(action(c, ACTION_STOP, kind, id, 35));
        if (!"timer".equals(kind)) b.addAction(0, "Snooze 9 min", action(c, ACTION_SNOOZE, kind, id, 33));
        b.addAction(0, "Stop", action(c, ACTION_STOP, kind, id, 34));
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        try { if (nm != null) nm.notify(NOTIFICATION_ID, n); } catch (SecurityException ignored) {}
    }

    static void stopRinging(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
        AlarmActivity.finishShowing();
    }

    static void snooze(Context c, String id) {
        stopRinging(c);
        prefs(c).edit().putLong("snooze", System.currentTimeMillis() + SNOOZE_MS).putString("snoozeId", id == null ? "" : id).apply();
        schedule(c);
    }

    static String timeText(int h, int m) {
        return (h % 12 == 0 ? 12 : h % 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? " AM" : " PM");
    }
}
