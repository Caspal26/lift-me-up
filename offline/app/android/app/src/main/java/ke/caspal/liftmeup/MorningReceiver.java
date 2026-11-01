package ke.caspal.liftmeup;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.time.LocalDate;

/**
 * Fires at delivery time (the morning alarm), and on the system events after
 * which pending alarms must be set again: a reboot, an app update, a change
 * of clock or time zone, or a change to the exact-alarm permission.
 */
public class MorningReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (ReadingSchedule.ACTION_MORNING.equals(action)) {
            String date = intent.getStringExtra(ReadingSchedule.EXTRA_DATE);
            String last = ReadingSchedule.prefs(ctx).getString("lastNotified", "");
            if (date != null && !date.equals(last)) {
                try {
                    ReadingSchedule.post(ctx, LocalDate.parse(date), false);
                } catch (Exception ignored) {
                    // A malformed date: still set the next alarm below.
                }
            }
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            ReadingSchedule.catchUp(ctx);
        }
        ReadingSchedule.scheduleNext(ctx);
    }
}
