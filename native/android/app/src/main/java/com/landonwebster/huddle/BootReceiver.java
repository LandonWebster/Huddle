package com.landonwebster.huddle;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The phone restarted, Huddle updated, or the clock / time zone changed: set the alarms again. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        AlarmScheduler.schedule(c);
    }
}
