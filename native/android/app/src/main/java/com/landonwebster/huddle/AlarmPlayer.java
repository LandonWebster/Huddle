package com.landonwebster.huddle;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/**
 * Plays an alarm's own song or Huddle sound (just the part picked, on repeat, or the full song;
 * "Start quiet, get louder" fades it in over 30 seconds) and vibrates in its pattern, until
 * Snooze or Turn off (AlarmScheduler.stopRinging), or 10 minutes pass.
 */
final class AlarmPlayer {
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static MediaPlayer player;
    private static Ringtone ringtone;
    private static Vibrator vibrator;

    private AlarmPlayer() {}

    /** True when the alarm has its own sound file that's on the phone. */
    static boolean hasSound(JSONObject a) {
        if (a == null || !a.has("sound")) return false;
        String path = a.optString("soundPath", "");
        return !path.isEmpty() && new File(path).exists();
    }

    /** True when the alarm has its own vibration pattern (an empty one means no vibration). */
    static boolean hasVibration(JSONObject a) {
        return a != null && a.has("sound") && a.optJSONArray("vibPattern") != null;
    }

    static void start(Context c, JSONObject a, boolean sound, boolean vibrate) {
        stop();
        Context app = c.getApplicationContext();
        if (sound) playSound(app, a);
        if (vibrate) vibrate(app, a.optJSONArray("vibPattern"));
        handler.postDelayed(AlarmPlayer::stop, 10 * 60 * 1000L);
    }

    private static AudioAttributes alarmAudio() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();
    }

    private static void playSound(Context app, JSONObject a) {
        JSONObject s = a.optJSONObject("sound");
        final float vol = Math.max(0.05f, Math.min(1f, (s != null ? s.optInt("vol", 80) : 80) / 100f));
        final boolean ramp = s == null || s.optBoolean("ramp", true);
        try {
            final MediaPlayer mp = new MediaPlayer();
            player = mp;
            mp.setAudioAttributes(alarmAudio());
            mp.setDataSource(a.optString("soundPath", ""));
            mp.setWakeMode(app, PowerManager.PARTIAL_WAKE_LOCK);
            mp.prepare();
            int dur = mp.getDuration();
            final int from = a.optInt("playFrom", 0) * 1000;
            final int to = a.optInt("playTo", 0) * 1000;
            final boolean clip = to > from && from < dur;
            if (clip) {
                mp.seekTo(from);
                // Plays just the part picked, over and over.
                handler.post(new Runnable() {
                    @Override public void run() {
                        if (player != mp) return;
                        try {
                            int pos = mp.getCurrentPosition();
                            if (pos >= Math.min(to, dur - 50) || !mp.isPlaying()) { mp.seekTo(from); if (!mp.isPlaying()) mp.start(); }
                        } catch (Exception ignored) {}
                        handler.postDelayed(this, 200);
                    }
                });
            } else {
                mp.setLooping(true);
            }
            mp.setVolume(ramp ? vol * 0.08f : vol, ramp ? vol * 0.08f : vol);
            mp.start();
            if (ramp) for (int i = 1; i <= 30; i++) {
                final float v = vol * (0.08f + 0.92f * i / 30f);
                handler.postDelayed(() -> { if (player == mp) try { mp.setVolume(v, v); } catch (Exception ignored) {} }, i * 1000L);
            }
        } catch (Exception e) {
            // The file couldn't play: ring with the phone's alarm sound instead.
            if (player != null) { try { player.release(); } catch (Exception ignored) {} player = null; }
            try {
                ringtone = RingtoneManager.getRingtone(app, AlarmScheduler.alarmSound());
                if (ringtone != null) {
                    ringtone.setAudioAttributes(alarmAudio());
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone.setLooping(true);
                    ringtone.play();
                }
            } catch (Exception ignored) {}
        }
    }

    private static void vibrate(Context app, JSONArray pattern) {
        if (pattern == null || pattern.length() == 0) return;
        long[] t = new long[pattern.length() + 1];
        t[0] = 0;
        long total = 0;
        for (int i = 0; i < pattern.length(); i++) { t[i + 1] = Math.max(0, pattern.optLong(i)); total += t[i + 1]; }
        if (total <= 0) return;
        try {
            vibrator = (Vibrator) app.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(t, 0), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            } else {
                vibrator.vibrate(t, 0);
            }
        } catch (Exception ignored) {}
    }

    static void stop() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (ringtone != null) { try { ringtone.stop(); } catch (Exception ignored) {} ringtone = null; }
        if (vibrator != null) { try { vibrator.cancel(); } catch (Exception ignored) {} vibrator = null; }
    }
}
