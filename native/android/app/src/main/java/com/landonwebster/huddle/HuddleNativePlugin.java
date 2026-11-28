package com.landonwebster.huddle;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import java.util.ArrayList;
import android.speech.tts.UtteranceProgressListener;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge between the Huddle web app and Android.
 *
 *  startCall / endCall         keep the call running when the phone is locked or you switch apps
 *  startScreenShare / stop...  share the phone screen (Android shows its own "start recording?" prompt)
 *  speak / stopSpeaking        Pip's voice (the phone's own text-to-speech)
 *  listen / stopListening      talk to Pip: speech to text (partial words arrive as "speechPartial")
 *  setAlarms                   the Alarms tab's alarms and timer, as real phone alarms (AlarmScheduler)
 *  notifyStatus / requestNotifications / openAlarmSettings   permission to notify and to ring on time
 *  setCallVolume / restoreVolume   quiet 911 calls: the phone's volume for the call, then back
 *  cancelNotification          take a ringing call's notification away
 *  showNotification            a chat or call-invite notification while Huddle is in the background
 *
 * Events sent to the page: "screenFrame" {data (JPEG base64), width, height}, "screenShareStopped"
 * and "screenshot" (someone took a screenshot of Huddle; Android 14+).
 */
@CapacitorPlugin(name = "HuddleNative")
public class HuddleNativePlugin extends Plugin {
    private static HuddleNativePlugin instance;

    @Override
    public void load() {
        instance = this;
        tts = new TextToSpeech(getContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) return;
            tts.setLanguage(Locale.getDefault());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { finishSpeech(id); }
                @Override public void onError(String id) { finishSpeech(id); }
                @Override public void onStop(String id, boolean interrupted) { finishSpeech(id); }
            });
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
    }

    // ---------- Pip's voice ----------
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private final Map<String, PluginCall> speaking = new HashMap<>();
    private int utteranceCounter = 0;

    private void finishSpeech(String id) {
        PluginCall c;
        synchronized (speaking) { c = speaking.remove(id); }
        if (c != null) c.resolve();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (!ttsReady || tts == null || text.isEmpty()) { call.resolve(); return; }
        float rate = call.getFloat("rate", 1f);
        float pitch = call.getFloat("pitch", 1f);
        float volume = call.getFloat("volume", 1f);
        tts.setSpeechRate(rate);
        tts.setPitch(pitch);
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0f, Math.min(1f, volume)));
        String id = "pip" + (++utteranceCounter);
        synchronized (speaking) { speaking.put(id, call); }
        // Replace anything Pip was still saying (that call ends through onStop).
        int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, id);
        if (r != TextToSpeech.SUCCESS) finishSpeech(id);
    }

    // ---------- Talking to Pip ----------
    private SpeechRecognizer recognizer;
    private PluginCall listenCall;

    private void endListen(String text, String error) {
        PluginCall c = listenCall;
        listenCall = null;
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
        if (c == null) return;
        if (error != null) { c.reject(error); return; }
        JSObject r = new JSObject();
        r.put("text", text == null ? "" : text);
        c.resolve(r);
    }

    private static String firstResult(Bundle b) {
        if (b == null) return "";
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() ? "" : list.get(0);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (!granted(Manifest.permission.RECORD_AUDIO)) { call.reject("no-mic"); return; }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("not-available"); return; }
        getActivity().runOnUiThread(() -> {
            if (listenCall != null) endListen(null, "replaced");
            listenCall = call;
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int eventType, Bundle params) {}
                @Override public void onPartialResults(Bundle partial) {
                    JSObject d = new JSObject();
                    d.put("text", firstResult(partial));
                    notifyListeners("speechPartial", d);
                }
                @Override public void onResults(Bundle results) { endListen(firstResult(results), null); }
                @Override public void onError(int error) {
                    // No words heard counts as an empty answer, not a failure.
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) endListen("", null);
                    else endListen(null, "error-" + error);
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            try { recognizer.startListening(intent); } catch (Exception e) { endListen(null, "start-failed"); }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) { try { recognizer.stopListening(); } catch (Exception ignored) {} }
            call.resolve();
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        java.util.List<PluginCall> pending;
        synchronized (speaking) { pending = new java.util.ArrayList<>(speaking.values()); speaking.clear(); }
        for (PluginCall c : pending) c.resolve();
        call.resolve();
    }

    static void emitFrame(String jpegBase64, int width, int height) {
        HuddleNativePlugin p = instance;
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("data", jpegBase64);
        data.put("width", width);
        data.put("height", height);
        p.notifyListeners("screenFrame", data);
    }

    static void emitShareStopped() {
        HuddleNativePlugin p = instance;
        if (p == null) return;
        p.notifyListeners("screenShareStopped", new JSObject());
    }

    // A screenshot was taken while Huddle was on screen (Android 14+, see MainActivity).
    static void screenshotTaken() {
        HuddleNativePlugin p = instance;
        if (p == null) return;
        p.notifyListeners("screenshot", new JSObject());
    }

    private boolean granted(String perm) {
        return ContextCompat.checkSelfPermission(getContext(), perm) == PackageManager.PERMISSION_GRANTED;
    }

    private void send(String action, Intent extras) {
        Context ctx = getContext();
        Intent i = extras != null ? extras : new Intent();
        i.setClass(ctx, CallService.class);
        i.setAction(action);
        ContextCompat.startForegroundService(ctx, i);
    }

    @PluginMethod
    public void startCall(PluginCall call) {
        // Android only lets the camera and mic keep running in the background when they were allowed first.
        if (!granted(Manifest.permission.CAMERA) && !granted(Manifest.permission.RECORD_AUDIO)) {
            call.resolve(new JSObject().put("running", false));
            return;
        }
        try {
            send(CallService.ACTION_START, null);
            call.resolve(new JSObject().put("running", true));
        } catch (Exception e) {
            call.reject("Couldn't keep the call running in the background", e);
        }
    }

    @PluginMethod
    public void endCall(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), CallService.class));
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void startScreenShare(PluginCall call) {
        MediaProjectionManager mpm = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) {
            call.reject("Screen sharing isn't available on this phone");
            return;
        }
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "onShareConsent");
    }

    @ActivityCallback
    private void onShareConsent(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("denied", "DENIED");
            return;
        }
        try {
            Intent i = new Intent();
            i.putExtra(CallService.EXTRA_RESULT_CODE, result.getResultCode());
            i.putExtra(CallService.EXTRA_RESULT_DATA, result.getData());
            send(CallService.ACTION_SHARE, i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't start screen sharing", e);
        }
    }

    @PluginMethod
    public void stopScreenShare(PluginCall call) {
        try {
            send(CallService.ACTION_STOP_SHARE, null);
        } catch (Exception ignored) {}
        call.resolve();
    }

    /** Opens another installed app (e.g. Roblox), or its Play Store page if it isn't installed. */
    @PluginMethod
    public void openApp(PluginCall call) {
        String pkg = call.getString("package", "");
        if (pkg == null || !pkg.matches("[A-Za-z0-9_.]+")) {
            call.reject("bad package");
            return;
        }
        Context ctx = getContext();
        try {
            Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(pkg);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(launch);
                call.resolve(new JSObject().put("opened", "app"));
                return;
            }
            Intent store = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
            store.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                ctx.startActivity(store);
            } catch (Exception e) {
                Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg));
                web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(web);
            }
            call.resolve(new JSObject().put("opened", "store"));
        } catch (Exception e) {
            call.reject("Couldn't open the app", e);
        }
    }

    // ---------- Alarms (real phone alarms) ----------
    @PluginMethod
    public void setAlarms(PluginCall call) {
        Context ctx = getContext();
        JSArray list = call.getArray("alarms");
        Long timer = call.getLong("timer", 0L);
        AlarmScheduler.prefs(ctx).edit()
            .putString("alarms", list != null ? list.toString() : "[]")
            .putLong("timer", timer != null ? timer : 0L)
            .putString("name", call.getString("name", ""))
            .putBoolean("sound", Boolean.TRUE.equals(call.getBoolean("sound", true)))
            .putBoolean("vibrate", Boolean.TRUE.equals(call.getBoolean("vibrate", true)))
            .apply();
        AlarmScheduler.schedule(ctx);
        call.resolve(new JSObject().put("exact", AlarmScheduler.canExact(ctx)));
    }

    /** Songs, photos and videos for alarms, saved in the app so the phone's alarm can use them (AlarmMedia). */
    @PluginMethod
    public void alarmMedia(PluginCall call) {
        try {
            call.resolve(AlarmMedia.handle(getContext(), call.getData()));
        } catch (Exception e) {
            call.reject("Couldn't save that for the alarm", e);
        }
    }

    // ---------- Notifications ----------
    @PluginMethod
    public void notifyStatus(PluginCall call) {
        Context ctx = getContext();
        call.resolve(new JSObject()
            .put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
            .put("exactAlarms", AlarmScheduler.canExact(ctx)));
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        Context ctx = getContext();
        if (NotificationManagerCompat.from(ctx).areNotificationsEnabled()) { call.resolve(); return; }
        Activity a = getActivity();
        if (Build.VERSION.SDK_INT >= 33 && a != null && !granted(Manifest.permission.POST_NOTIFICATIONS)
                && !AlarmScheduler.prefs(ctx).getBoolean("askedNotify", false)) {
            AlarmScheduler.prefs(ctx).edit().putBoolean("askedNotify", true).apply();
            ActivityCompat.requestPermissions(a, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4711);
        } else {
            // Asked before (or older Android): the switch is in the phone's settings.
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { ctx.startActivity(i); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void openAlarmSettings(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { ctx.startActivity(i); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    /** A notification from the open app (Huddle in the background): chats and call invites. */
    @PluginMethod
    public void showNotification(PluginCall call) {
        Context ctx = getContext();
        boolean ringing = "calls".equals(call.getString("channel", "messages"));
        boolean silent = Boolean.TRUE.equals(call.getBoolean("silent", false));
        boolean vibrate = Boolean.TRUE.equals(call.getBoolean("vibrate", true));
        String channel = channel(ctx, ringing, !silent, vibrate);
        String url = call.getString("url", "/");
        String tag = call.getString("tag", "huddle");
        Intent open = new Intent(ctx, MainActivity.class)
            .putExtra("huddle_url", url)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(ctx, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_huddle)
            .setContentTitle(call.getString("title", "Huddle"))
            .setContentText(call.getString("body", ""))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(ringing ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(ringing ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH);
        if (ringing) {
            b.setTimeoutAfter(30000).addAction(0, call.getString("action", "Join"), pi);
            // A call: on a locked or sleeping phone it opens full screen, like a normal phone call.
            if (Boolean.TRUE.equals(call.getBoolean("fullScreen", false))) b.setFullScreenIntent(pi, true);
        }
        if (silent) b.setSilent(true);
        Notification n = b.build();
        if (ringing && !silent) n.flags |= Notification.FLAG_INSISTENT; // rings until opened or 30 s pass
        try { NotificationManagerCompat.from(ctx).notify(tag, 1, n); } catch (SecurityException ignored) {}
        call.resolve();
    }

    /** The call stopped ringing (answered, declined or hung up): take its notification away. */
    @PluginMethod
    public void cancelNotification(PluginCall call) {
        String tag = call.getString("tag", "huddle");
        try { NotificationManagerCompat.from(getContext()).cancel(tag, 1); } catch (Exception ignored) {}
        call.resolve();
    }

    private static String channel(Context ctx, boolean calls, boolean sound, boolean vibrate) {
        String id = (calls ? "huddle_calls" : "huddle_messages") + (sound ? "_s" : "") + (vibrate ? "_v" : "");
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(id) == null) {
            String name = (calls ? "Huddle calls" : "Messages") + (!sound && !vibrate ? " (silent)" : !sound ? " (vibrate only)" : !vibrate ? " (no vibration)" : "");
            NotificationChannel ch = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
            if (sound) {
                Uri u = RingtoneManager.getDefaultUri(calls ? RingtoneManager.TYPE_RINGTONE : RingtoneManager.TYPE_NOTIFICATION);
                ch.setSound(u, new AudioAttributes.Builder()
                    .setUsage(calls ? AudioAttributes.USAGE_NOTIFICATION_RINGTONE : AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            } else ch.setSound(null, null);
            ch.enableVibration(vibrate);
            if (vibrate && calls) ch.setVibrationPattern(new long[] { 0, 800, 400, 800, 400 });
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(ch);
        }
        return id;
    }

    /** A notification was tapped while Huddle was open in the background: go to its screen. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        openFrom(intent);
    }

    void openFrom(Intent intent) {
        String url = intent != null ? intent.getStringExtra("huddle_url") : null;
        if (url == null || !url.startsWith("/") || getBridge() == null || getBridge().getWebView() == null) return;
        intent.removeExtra("huddle_url");
        String js = "window.huddleOpen && window.huddleOpen(" + JSONObject.quote(url) + ")";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    // ---------- 911 call volume ----------
    // For safety, 911 calls start quiet: the phone's call and media volume go to the chosen level
    // (0-10; 1 is the lowest you can hear) and the ringer to the chosen level, then all go back.
    private int[] savedVolumes = null;
    private static final int[] VOLUME_STREAMS = { AudioManager.STREAM_VOICE_CALL, AudioManager.STREAM_MUSIC, AudioManager.STREAM_RING };

    private static int level(AudioManager am, int stream, int of10, boolean audibleFloor) {
        int max = am.getStreamMaxVolume(stream);
        int min = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? am.getStreamMinVolume(stream) : 0;
        if (of10 <= 0) return min;
        int v = Math.round(max * of10 / 10f);
        return Math.max(audibleFloor ? Math.max(1, min) : min, Math.min(max, v));
    }

    @PluginMethod
    public void setCallVolume(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) { call.resolve(); return; }
        int callVol = Math.max(0, Math.min(10, call.getInt("call", 1)));
        int ringVol = Math.max(0, Math.min(10, call.getInt("ring", 0)));
        if (savedVolumes == null) {
            savedVolumes = new int[VOLUME_STREAMS.length];
            for (int i = 0; i < VOLUME_STREAMS.length; i++) savedVolumes[i] = am.getStreamVolume(VOLUME_STREAMS[i]);
        }
        try { am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, level(am, AudioManager.STREAM_VOICE_CALL, callVol, true), 0); } catch (Exception ignored) {}
        try { am.setStreamVolume(AudioManager.STREAM_MUSIC, level(am, AudioManager.STREAM_MUSIC, callVol, true), 0); } catch (Exception ignored) {}
        // Turning the ringer all the way down can need Do Not Disturb access; if Android says no, it's left as is.
        try { am.setStreamVolume(AudioManager.STREAM_RING, level(am, AudioManager.STREAM_RING, ringVol, false), 0); } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void restoreVolume(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null && savedVolumes != null) {
            for (int i = 0; i < VOLUME_STREAMS.length; i++) {
                try { am.setStreamVolume(VOLUME_STREAMS[i], savedVolumes[i], 0); } catch (Exception ignored) {}
            }
        }
        savedVolumes = null;
        call.resolve();
    }
}
