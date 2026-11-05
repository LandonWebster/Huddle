package com.landonwebster.huddle;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HuddleNativePlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings s = getBridge().getWebView().getSettings();
            // Let call audio and video play without an extra tap.
            s.setMediaPlaybackRequiresUserGesture(false);
        }
    }
}
