package com.landonwebster.huddle;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Keeps a Huddle call alive while the phone is locked or another app is open.
 *
 * Android requires a "foreground service" for that, and every foreground service must have a
 * notification. Huddle never asks for notification permission, so on Android 13 and newer that
 * notification is hidden from the notification shade. The channel is the quietest Android allows:
 * no sound, no vibration, no badge, hidden on the lock screen.
 */
public class CallService extends Service {
    static final String ACTION_START = "huddle.START";
    static final String ACTION_SHARE = "huddle.SHARE";
    static final String ACTION_STOP_SHARE = "huddle.STOP_SHARE";
    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_RESULT_DATA = "resultData";

    private static final String CHANNEL = "huddle_call_quiet";
    private static final int NOTIFICATION_ID = 7;
    private static final int MAX_SIDE = 1280;
    private static final long FRAME_INTERVAL_MS = 1000 / 15;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread captureThread;
    private long lastFrame;
    private MediaProjection.Callback projectionCallback;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_SHARE.equals(action)) {
            goForeground(true);
            startProjection(intent);
        } else if (ACTION_STOP_SHARE.equals(action)) {
            stopProjection(false);
            goForeground(false);
        } else {
            goForeground(false);
        }
        holdLocks();
        return START_NOT_STICKY;
    }

    private boolean granted(String perm) {
        return ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED;
    }

    private void goForeground(boolean sharing) {
        Notification n = buildNotification();
        int types = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (granted(Manifest.permission.CAMERA)) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
            if (granted(Manifest.permission.RECORD_AUDIO)) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        }
        int mp = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0;
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, n);
            else if (sharing) startForeground(NOTIFICATION_ID, n, types | mp);
            else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) startForeground(NOTIFICATION_ID, n);
            else if (types != 0) startForeground(NOTIFICATION_ID, n, types);
            else stopSelf();
        } catch (Exception e) {
            // e.g. the screen-share consent could not be used: keep the call itself running.
            try {
                if (types != 0) startForeground(NOTIFICATION_ID, n, types);
                else stopSelf();
            } catch (Exception ignored) {
                stopSelf();
            }
        }
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Call running", NotificationManager.IMPORTANCE_MIN);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.enableLights(false);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_huddle)
            .setContentTitle("Huddle")
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .build();
    }

    private void holdLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "huddle:call");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(6 * 60 * 60 * 1000L);
            }
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, "huddle:call");
                    wifiLock.setReferenceCounted(false);
                    wifiLock.acquire();
                }
            }
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
        wakeLock = null;
        wifiLock = null;
    }

    // ---------- Screen sharing ----------
    private void startProjection(Intent intent) {
        stopProjection(false);
        int code = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent data = Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class)
            : intent.getParcelableExtra(EXTRA_RESULT_DATA);
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null || data == null) { HuddleNativePlugin.emitShareStopped(); return; }
        try {
            projection = mpm.getMediaProjection(code, data);
        } catch (Exception e) {
            projection = null;
        }
        if (projection == null) { HuddleNativePlugin.emitShareStopped(); return; }

        captureThread = new HandlerThread("huddle-share");
        captureThread.start();
        Handler handler = new Handler(captureThread.getLooper());

        // Android 14 requires this callback before the capture starts. It fires when the person
        // taps "Stop sharing" in the status bar.
        projectionCallback = new MediaProjection.Callback() {
            @Override
            public void onStop() {
                stopProjection(true);
                goForeground(false);
            }
        };
        projection.registerCallback(projectionCallback, handler);

        DisplayMetrics dm = new DisplayMetrics();
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        wm.getDefaultDisplay().getRealMetrics(dm);
        int w = dm.widthPixels, h = dm.heightPixels;
        float scale = Math.min(1f, (float) MAX_SIDE / Math.max(w, h));
        w = Math.max(2, Math.round(w * scale) & ~1);
        h = Math.max(2, Math.round(h * scale) & ~1);
        final int width = w, height = h;

        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(r -> {
            Image img = null;
            try {
                img = r.acquireLatestImage();
                if (img == null) return;
                long now = System.currentTimeMillis();
                if (now - lastFrame < FRAME_INTERVAL_MS) return;
                lastFrame = now;
                Image.Plane plane = img.getPlanes()[0];
                ByteBuffer buf = plane.getBuffer();
                int pixelStride = plane.getPixelStride();
                int rowStride = plane.getRowStride();
                int padded = rowStride / pixelStride;
                Bitmap bmp = Bitmap.createBitmap(padded, height, Bitmap.Config.ARGB_8888);
                bmp.copyPixelsFromBuffer(buf);
                Bitmap frame = padded == width ? bmp : Bitmap.createBitmap(bmp, 0, 0, width, height);
                ByteArrayOutputStream out = new ByteArrayOutputStream(128 * 1024);
                frame.compress(Bitmap.CompressFormat.JPEG, 70, out);
                if (frame != bmp) frame.recycle();
                bmp.recycle();
                HuddleNativePlugin.emitFrame(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP), width, height);
            } catch (Exception ignored) {
            } finally {
                if (img != null) img.close();
            }
        }, handler);

        try {
            display = projection.createVirtualDisplay("HuddleShare", width, height, dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, handler);
        } catch (Exception e) {
            stopProjection(true);
        }
    }

    private void stopProjection(boolean notify) {
        boolean wasSharing = projection != null;
        try { if (display != null) display.release(); } catch (Exception ignored) {}
        display = null;
        try { if (reader != null) reader.close(); } catch (Exception ignored) {}
        reader = null;
        MediaProjection p = projection;
        projection = null;
        if (p != null) {
            try { if (projectionCallback != null) p.unregisterCallback(projectionCallback); } catch (Exception ignored) {}
            try { p.stop(); } catch (Exception ignored) {}
        }
        projectionCallback = null;
        if (captureThread != null) { captureThread.quitSafely(); captureThread = null; }
        if (notify && wasSharing) HuddleNativePlugin.emitShareStopped();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping Huddle away from recent apps ends the call.
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopProjection(true);
        releaseLocks();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }
}
