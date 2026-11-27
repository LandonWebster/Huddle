package com.landonwebster.huddle;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Android's alarm went off (or Snooze / Stop was tapped): ring, then set the next one. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        String kind = intent.getStringExtra("kind");
        String id = intent.getStringExtra("id");
        if (AlarmScheduler.ACTION_SNOOZE.equals(action)) { AlarmScheduler.snooze(c, id); return; }
        if (AlarmScheduler.ACTION_STOP.equals(action)) { AlarmScheduler.stopRinging(c); return; }
        if (!AlarmScheduler.ACTION_RING.equals(action)) return;

        SharedPreferences p = AlarmScheduler.prefs(c);
        String title, text;
        if ("timer".equals(kind)) {
            p.edit().putLong("timer", 0).apply();
            title = "Time's up";
            text = "Your Huddle timer is done";
        } else {
            if ("snooze".equals(kind)) p.edit().putLong("snooze", 0).apply();
            JSONObject a = AlarmScheduler.find(c, id);
            if (a == null && !"snooze".equals(kind)) { AlarmScheduler.schedule(c); return; }
            int h = a != null ? a.optInt("h") : -1, m = a != null ? a.optInt("m") : 0;
            String label = a != null ? a.optString("label", "") : "";
            title = h >= 0 ? AlarmScheduler.timeText(h, m) : "Alarm";
            text = (label.isEmpty() ? "Alarm" : label) + ("snooze".equals(kind) ? " (snoozed)" : "");
            // A one-time alarm turns itself off after it rings.
            if (a != null && "alarm".equals(kind)) {
                JSONArray days = a.optJSONArray("days");
                if (days == null || days.length() == 0) turnOff(c, id);
            }
            kind = "alarm";
        }
        AlarmScheduler.showRinging(c, kind, id, title, text);
        AlarmScheduler.schedule(c);
    }

    private static void turnOff(Context c, String id) {
        try {
            JSONArray list = AlarmScheduler.alarms(c);
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i);
                if (a != null && id.equals(a.optString("id"))) a.put("on", false);
            }
            AlarmScheduler.prefs(c).edit().putString("alarms", list.toString()).apply();
        } catch (Exception ignored) {}
    }
}
