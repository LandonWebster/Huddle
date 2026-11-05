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

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

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
 *
 * Events sent to the page: "screenFrame" {data (JPEG base64), width, height} and "screenShareStopped".
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
}
