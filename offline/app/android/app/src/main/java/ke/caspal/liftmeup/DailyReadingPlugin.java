package ke.caspal.liftmeup;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.time.LocalDate;
import java.time.ZonedDateTime;

/** The web app's bridge to the morning schedule: configure it, ask for permission, test it. */
@CapacitorPlugin(
    name = "DailyReading",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class DailyReadingPlugin extends Plugin {
    private String launchDate;

    @Override
    public void load() {
        ReadingSchedule.ensureChannel(getContext());
        Intent intent = getActivity().getIntent();
        if (intent != null) {
            launchDate = intent.getStringExtra(ReadingSchedule.EXTRA_DATE);
            intent.removeExtra(ReadingSchedule.EXTRA_DATE);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String date = intent.getStringExtra(ReadingSchedule.EXTRA_DATE);
        if (date == null) return;
        intent.removeExtra(ReadingSchedule.EXTRA_DATE);
        JSObject data = new JSObject();
        data.put("date", date);
        notifyListeners("readingOpened", data, true);
    }

    private String permission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
        }
        PermissionState s = getPermissionState("notifications");
        return s == PermissionState.GRANTED ? "granted" : s == PermissionState.DENIED ? "denied" : "prompt";
    }

    private JSObject status(ZonedDateTime next) {
        JSObject o = new JSObject();
        o.put("permission", permission());
        o.put("enabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        o.put("exact", ReadingSchedule.canScheduleExact(getContext()));
        o.put("nextAt", next == null ? null : next.toOffsetDateTime().toString());
        o.put("nextDate", next == null ? null : next.toLocalDate().toString());
        o.put("lastNotified", ReadingSchedule.prefs(getContext()).getString("lastNotified", null));
        return o;
    }

    /** { startDate: "YYYY-MM-DD", time: "HH:MM", timezone, items: [{ title, dek }] } */
    @PluginMethod
    public void configure(PluginCall call) {
        String start = call.getString("startDate");
        String time = call.getString("time", "08:00");
        String tz = call.getString("timezone", "Africa/Nairobi");
        JSArray items = call.getArray("items", new JSArray());
        if (start == null) {
            call.reject("startDate is required");
            return;
        }
        try {
            LocalDate.parse(start);
        } catch (Exception e) {
            call.reject("startDate must be YYYY-MM-DD");
            return;
        }
        ReadingSchedule.save(getContext(), start, time, tz, items.toString());
        call.resolve(status(ReadingSchedule.scheduleNext(getContext())));
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status(ReadingSchedule.nextDelivery(getContext())));
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionAnswered");
        } else {
            call.resolve(status(ReadingSchedule.nextDelivery(getContext())));
        }
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        call.resolve(status(ReadingSchedule.scheduleNext(getContext())));
    }

    /** Post a reading's notification now: { date } */
    @PluginMethod
    public void sendTest(PluginCall call) {
        String date = call.getString("date");
        boolean sent = false;
        try {
            sent = date != null && ReadingSchedule.post(getContext(), LocalDate.parse(date), true);
        } catch (Exception ignored) {
            // Leave sent false.
        }
        JSObject o = new JSObject();
        o.put("sent", sent);
        call.resolve(o);
    }

    /** The reading a tapped notification asked for when it started the app, once. */
    @PluginMethod
    public void takeLaunchDate(PluginCall call) {
        JSObject o = new JSObject();
        o.put("date", launchDate);
        launchDate = null;
        call.resolve(o);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
