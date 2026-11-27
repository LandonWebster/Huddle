package com.landonwebster.huddle;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
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
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * The full-screen alarm: shows over the lock screen and turns the screen on. The sound comes
 * from the alarm notification (AlarmScheduler), which keeps repeating until Snooze or Stop.
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

    private void build(Intent intent) {
        kind = intent.getStringExtra("kind");
        id = intent.getStringExtra("id");
        String title = intent.getStringExtra("title");
        String text = intent.getStringExtra("text");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(32), dp(48), dp(32), dp(48));
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { Color.parseColor("#111113"), Color.parseColor("#0B1640") });
        root.setBackground(bg);

        View pip = new View(this);
        GradientDrawable blob = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[] { Color.parseColor("#22D3EE"), Color.parseColor("#2F55E4") });
        blob.setShape(GradientDrawable.OVAL);
        pip.setBackground(blob);
        LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(dp(96), dp(96));
        pl.bottomMargin = dp(28);
        root.addView(pip, pl);

        TextView big = new TextView(this);
        big.setText(title == null ? "Alarm" : title);
        big.setTextColor(Color.WHITE);
        big.setTextSize(52);
        big.setTypeface(Typeface.DEFAULT_BOLD);
        big.setGravity(Gravity.CENTER);
        root.addView(big);

        TextView sub = new TextView(this);
        sub.setText(text == null ? "" : text);
        sub.setTextColor(Color.parseColor("#B8C0D6"));
        sub.setTextSize(18);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sl.bottomMargin = dp(40);
        root.addView(sub, sl);

        if (!"timer".equals(kind)) {
            Button snooze = button("Snooze 9 min", false);
            snooze.setOnClickListener(v -> { AlarmScheduler.snooze(this, id); finish(); });
            root.addView(snooze);
        }
        Button stop = button("Stop", true);
        stop.setOnClickListener(v -> { AlarmScheduler.stopRinging(this); finish(); });
        root.addView(stop);
        setContentView(root);

        // Pip says good morning (alarms with "Pip says good morning" on).
        JSONObject a = AlarmScheduler.find(this, id);
        if (a != null && a.optBoolean("pip")) {
            String name = AlarmScheduler.prefs(this).getString("name", "");
            int h = a.optInt("h");
            String label = a.optString("label", "");
            final String line = h < 12
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

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        if (showing.get() == this) showing = new WeakReference<>(null);
        super.onDestroy();
    }
}
