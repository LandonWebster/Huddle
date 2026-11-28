package com.landonwebster.huddle;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.VideoView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * The full-screen alarm: shows over the lock screen and turns the screen on. It shows the alarm's
 * own look (a photo, a video, or colors), routine, and snooze button color from the alarm editor.
 * The sound comes from the alarm notification (AlarmScheduler) or, for an alarm with its own
 * song or sound, AlarmPlayer; both keep going until Snooze or Turn off.
 */
public class AlarmActivity extends Activity {
    private static WeakReference<AlarmActivity> showing = new WeakReference<>(null);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private String kind, id;

    static void finishShowing() {
        AlarmActivity a = showing.get();
        if (a != null) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        showing = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        build(getIntent());
        handler.postDelayed(this::finish, 10 * 60 * 1000L);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        build(intent);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(18);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(28));
        bg.setColor(primary ? Color.parseColor("#2F55E4") : Color.parseColor("#26FFFFFF"));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }

    private static int color(String hex, String fallback) {
        try { return Color.parseColor(hex); } catch (Exception e) { return Color.parseColor(fallback); }
    }

    private void build(Intent intent) {
        kind = intent.getStringExtra("kind");
        id = intent.getStringExtra("id");
        String title = intent.getStringExtra("title");
        String text = intent.getStringExtra("text");
        final JSONObject a = "timer".equals(kind) ? null : AlarmScheduler.find(this, id);
        // The alarm editor's choices (older alarms have none, and look like before).
        final boolean custom = a != null && a.has("sound");
        JSONObject screen = custom ? a.optJSONObject("screen") : null;
        String alarmColor = custom ? a.optString("color", "#2F55E4") : "#2F55E4";
        String snoozeColor = custom ? a.optString("snoozeColor", "#22D3EE") : "#26FFFFFF";
        String routine = custom ? a.optString("routine", "none") : "none";
        String mediaPath = custom ? a.optString("mediaPath", "") : "";
        String mediaKind = custom ? a.optString("mediaKind", "") : "";
        boolean hasMedia = !mediaPath.isEmpty() && new File(mediaPath).exists();

        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.BLACK);
        FrameLayout.LayoutParams fill = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        if (hasMedia && "video".equals(mediaKind)) {
            VideoView v = new VideoView(this);
            v.setVideoURI(Uri.fromFile(new File(mediaPath)));
            v.setOnPreparedListener(mp -> { mp.setLooping(true); mp.setVolume(0f, 0f); v.start(); });
            v.setOnErrorListener((mp, what, extra) -> true);
            FrameLayout.LayoutParams vl = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER);
            frame.addView(v, vl);
        } else if (hasMedia) {
            ImageView img = new ImageView(this);
            img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            Bitmap bmp = loadPicture(mediaPath);
            if (bmp != null) img.setImageBitmap(bmp);
            frame.addView(img, fill);
        } else {
            View bgv = new View(this);
            int[] cols;
            JSONArray lc = custom ? a.optJSONArray("lookColors") : null;
            if (lc != null && lc.length() >= 2) {
                cols = new int[lc.length()];
                for (int i = 0; i < lc.length(); i++) cols[i] = color(lc.optString(i), "#07080C");
            } else cols = new int[] { Color.parseColor("#111113"), Color.parseColor("#0B1640") };
            bgv.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, cols));
            frame.addView(bgv, fill);
        }
        if (custom && (screen == null || screen.optBoolean("shade", true))) {
            View shade = new View(this);
            shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { 0x33000000, 0x80000000 }));
            frame.addView(shade, fill);
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(32), dp(48), dp(32), dp(48));
        frame.addView(root, fill);

        if (!"none".equals(routine)) {
            TextView tag = new TextView(this);
            tag.setText("night".equals(routine) ? "NIGHT ROUTINE" : "MORNING ROUTINE");
            tag.setTextColor(Color.WHITE);
            tag.setTextSize(12);
            tag.setTypeface(Typeface.DEFAULT_BOLD);
            tag.setLetterSpacing(0.1f);
            tag.setPadding(dp(12), dp(5), dp(12), dp(5));
            GradientDrawable pill = new GradientDrawable();
            pill.setCornerRadius(dp(14));
            pill.setColor(color(alarmColor, "#2F55E4"));
            tag.setBackground(pill);
            LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            tl.bottomMargin = dp(18);
            root.addView(tag, tl);
        }

        if (!hasMedia) {
            View pip = new View(this);
            GradientDrawable blob = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[] { Color.parseColor("#22D3EE"), Color.parseColor("#2F55E4") });
            blob.setShape(GradientDrawable.OVAL);
            pip.setBackground(blob);
            LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(dp(96), dp(96));
            pl.bottomMargin = dp(28);
            root.addView(pip, pl);
        }

        TextView big = new TextView(this);
        big.setText(title == null ? "Alarm" : title);
        big.setTextColor(Color.WHITE);
        big.setTextSize(52);
        big.setTypeface(Typeface.DEFAULT_BOLD);
        big.setGravity(Gravity.CENTER);
        big.setShadowLayer(dp(8), 0, dp(2), 0x66000000);
        root.addView(big);

        TextView sub = new TextView(this);
        sub.setText(text == null ? "" : text);
        sub.setTextColor(Color.parseColor("#E6E7F5"));
        sub.setTextSize(18);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sl.bottomMargin = dp(12);
        root.addView(sub, sl);

        final String link = custom ? a.optString("link", "") : "";
        String appName = custom ? a.optString("appName", "") : "";
        if (!link.isEmpty() && !appName.isEmpty()) {
            TextView now = new TextView(this);
            now.setText("Opens " + appName + " when you turn it off");
            now.setTextColor(Color.parseColor("#F0F1FA"));
            now.setTextSize(13);
            now.setPadding(dp(10), dp(6), dp(10), dp(6));
            GradientDrawable nb = new GradientDrawable();
            nb.setCornerRadius(dp(10));
            nb.setColor(0x66000000);
            now.setBackground(nb);
            root.addView(now);
        }
        View gap = new View(this);
        root.addView(gap, new LinearLayout.LayoutParams(1, dp(28)));

        if (!"timer".equals(kind)) {
            Button snooze = button("Snooze 9 min", false);
            ((GradientDrawable) snooze.getBackground()).setColor(color(snoozeColor, "#26FFFFFF"));
            snooze.setOnClickListener(v -> { AlarmScheduler.snooze(this, id); finish(); });
            root.addView(snooze);
        }
        Button stop = button("Turn off", !custom);
        stop.setOnClickListener(v -> {
            AlarmScheduler.stopRinging(this);
            if (!link.isEmpty()) AlarmMedia.open(this, link); // the song, in Spotify / Apple Music / YouTube
            finish();
        });
        root.addView(stop);

        // Extra alarms still to come ("Set more alarms"): skip them.
        final int later = custom ? a.optInt("count", 0) - a.optInt("idx", 0) : 0;
        if (later > 0) {
            Button skip = new Button(this);
            skip.setText("Skip the other " + later + (later == 1 ? " alarm" : " alarms"));
            skip.setAllCaps(false);
            skip.setTextSize(15);
            skip.setTextColor(Color.parseColor("#E6E7F5"));
            skip.setBackgroundColor(Color.TRANSPARENT);
            LinearLayout.LayoutParams kl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            kl.topMargin = dp(8);
            skip.setOnClickListener(v -> { skipRest(a, later); AlarmScheduler.stopRinging(this); finish(); });
            root.addView(skip, kl);
        }
        setContentView(frame);

        // Pip talks (alarms with "Pip talks when it rings" on), in the routine's words.
        if (a != null && a.optBoolean("pip")) {
            String name = AlarmScheduler.prefs(this).getString("name", "");
            int h = a.optInt("h");
            String label = a.optString("label", "");
            final String line = "morning".equals(routine)
                ? "Good morning" + (name.isEmpty() ? "" : ", " + name) + ". Time to get up and start your day."
                : "night".equals(routine)
                ? "Hey" + (name.isEmpty() ? "" : " " + name) + ". It's time to start winding down for bed."
                : h < 12
                ? "Good morning" + (name.isEmpty() ? "" : ", " + name) + ". Time to get up."
                : "Hey" + (name.isEmpty() ? "" : " " + name) + ". It's time" + (label.isEmpty() ? "" : " for " + label) + ".";
            if (tts != null) tts.shutdown();
            tts = new TextToSpeech(this, status -> {
                if (status != TextToSpeech.SUCCESS || tts == null) return;
                tts.setLanguage(Locale.getDefault());
                handler.postDelayed(() -> { if (tts != null) tts.speak(line, TextToSpeech.QUEUE_FLUSH, null, "pip-alarm"); }, 1500);
            });
        }
    }

    /** A photo, made small enough for the screen. */
    private Bitmap loadPicture(String path) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, o);
            int max = Math.max(o.outWidth, o.outHeight), sample = 1;
            while (max / sample > 2200) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            return BitmapFactory.decodeFile(path, o2);
        } catch (Throwable t) {
            return null;
        }
    }

    /** "Skip the other alarms": this alarm's extra alarms wait until after the last one. */
    private void skipRest(JSONObject a, int later) {
        try {
            String base = a.optString("base", id);
            JSONObject more = a.optJSONObject("more");
            int every = more != null ? Math.max(1, more.optInt("every", 5)) : 5;
            long until = System.currentTimeMillis() + later * every * 60000L + 60000L;
            AlarmScheduler.prefs(this).edit().putLong("skip_" + base, until).apply();
            JSONArray days = a.optJSONArray("days");
            if (days == null || days.length() == 0) {
                // A one-time alarm: turn the rest of it off.
                JSONArray list = AlarmScheduler.alarms(this);
                for (int i = 0; i < list.length(); i++) {
                    JSONObject x = list.optJSONObject(i);
                    if (x != null && base.equals(x.optString("base"))) x.put("on", false);
                }
                AlarmScheduler.prefs(this).edit().putString("alarms", list.toString()).apply();
            }
            AlarmScheduler.schedule(this);
        } catch (Exception ignored) {}
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        if (showing.get() == this) showing = new WeakReference<>(null);
        super.onDestroy();
    }
}
