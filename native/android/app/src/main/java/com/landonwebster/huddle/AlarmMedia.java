package com.landonwebster.huddle;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Set;

/**
 * The songs, photos and videos picked in the alarm editor (and Huddle's own alarm sounds), kept
 * in the app's own files so the phone's alarm can play and show them with Huddle closed.
 * The page sends each file in pieces (base64), from the "alarmMedia" plugin call:
 *   { op: "list" }                                   -> { files: { id: path } }
 *   { op: "write", id, ext, data, append, done }     -> { path } when done
 *   { op: "prune", keep: [ids] }                     deletes the others
 *   { op: "open", url }                              opens a song link (Spotify, Apple Music, YouTube)
 */
final class AlarmMedia {
    private AlarmMedia() {}

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "alarm-media");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String idOf(String name) {
        int dot = name.indexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    static JSObject handle(Context c, JSONObject data) throws Exception {
        String op = data.optString("op", "");
        JSObject out = new JSObject();
        File d = dir(c);
        if ("list".equals(op)) {
            JSObject files = new JSObject();
            File[] all = d.listFiles();
            if (all != null) for (File f : all) {
                if (f.getName().endsWith(".part")) { f.delete(); continue; }
                files.put(idOf(f.getName()), f.getAbsolutePath());
            }
            out.put("files", files);
        } else if ("write".equals(op)) {
            String id = data.optString("id", "").replaceAll("[^A-Za-z0-9-]", "");
            String ext = data.optString("ext", "bin").replaceAll("[^a-z0-9]", "");
            if (id.isEmpty() || id.length() > 40 || ext.isEmpty() || ext.length() > 5) throw new IllegalArgumentException("bad file");
            File part = new File(d, id + ".part");
            byte[] bytes = Base64.decode(data.optString("data", ""), Base64.DEFAULT);
            try (FileOutputStream os = new FileOutputStream(part, data.optBoolean("append", false))) {
                os.write(bytes);
            }
            if (data.optBoolean("done", false)) {
                File[] old = d.listFiles();
                if (old != null) for (File f : old) if (!f.equals(part) && idOf(f.getName()).equals(id)) f.delete();
                File done = new File(d, id + "." + ext);
                if (!part.renameTo(done)) throw new IllegalStateException("couldn't save");
                out.put("path", done.getAbsolutePath());
            }
        } else if ("prune".equals(op)) {
            Set<String> keep = new HashSet<>();
            JSONArray k = data.optJSONArray("keep");
            if (k != null) for (int i = 0; i < k.length(); i++) keep.add(k.optString(i));
            File[] all = d.listFiles();
            if (all != null) for (File f : all) if (!keep.contains(idOf(f.getName()))) f.delete();
        } else if ("open".equals(op)) {
            open(c, data.optString("url", ""));
        } else {
            throw new IllegalArgumentException("unknown op");
        }
        return out;
    }

    /** Opens a song link in its app (or the browser). Only https links. */
    static void open(Context c, String url) {
        if (url == null || !url.startsWith("https://")) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Exception ignored) {}
    }
}
