package ke.caspal.liftmeup;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;

/**
 * The morning schedule, kept on the phone so it works with no app open and no
 * network. Edition i belongs to startDate + i days. Exactly one alarm is ever
 * pending (the next morning's); when it fires it posts that morning's title
 * and sets the one after, so Android's limit of about 500 pending alarms per
 * app never comes into play however many editions are bundled.
 */
final class ReadingSchedule {
    static final String CHANNEL_ID = "morning-reading";
    static final String EXTRA_DATE = "lmu_date";
    static final String ACTION_MORNING = "ke.caspal.liftmeup.MORNING";
    private static final String PREFS = "lmu_schedule";
    private static final int NOTIFICATION_ID = 1;
    private static final int ALARM_REQUEST = 1001;

    private ReadingSchedule() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isConfigured(Context ctx) {
        return prefs(ctx).contains("start");
    }

    static void save(Context ctx, String start, String time, String tz, String itemsJson) {
        prefs(ctx).edit()
            .putString("start", start)
            .putString("time", time)
            .putString("tz", tz)
            .putString("items", itemsJson)
            .apply();
    }

    static ZoneId zone(Context ctx) {
        try {
            return ZoneId.of(prefs(ctx).getString("tz", "Africa/Nairobi"));
        } catch (Exception e) {
            return ZoneId.systemDefault();
        }
    }

    static LocalTime time(Context ctx) {
        try {
            return LocalTime.parse(prefs(ctx).getString("time", "08:00"));
        } catch (Exception e) {
            return LocalTime.of(8, 0);
        }
    }

    static int count(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString("items", "[]")).length();
        } catch (Exception e) {
            return 0;
        }
    }

    static long indexFor(Context ctx, LocalDate date) {
        LocalDate start = LocalDate.parse(prefs(ctx).getString("start", date.toString()));
        return ChronoUnit.DAYS.between(start, date);
    }

    static JSONObject itemFor(Context ctx, LocalDate date) {
        try {
            long i = indexFor(ctx, date);
            JSONArray items = new JSONArray(prefs(ctx).getString("items", "[]"));
            if (i < 0 || i >= items.length()) return null;
            return items.getJSONObject((int) i);
        } catch (Exception e) {
            return null;
        }
    }

    /** The next delivery after now that has an edition, or null at the end of the bundle. */
    static ZonedDateTime nextDelivery(Context ctx) {
        if (!isConfigured(ctx)) return null;
        ZoneId zone = zone(ctx);
        ZonedDateTime now = ZonedDateTime.now(zone);
        ZonedDateTime at = now.toLocalDate().atTime(time(ctx)).atZone(zone);
        if (!at.isAfter(now)) at = at.plusDays(1);
        LocalDate start = LocalDate.parse(prefs(ctx).getString("start", now.toLocalDate().toString()));
        // Day one's reading opens at first launch, so the first announcement is day two's.
        if (!at.toLocalDate().isAfter(start)) at = start.plusDays(1).atTime(time(ctx)).atZone(zone);
        return itemFor(ctx, at.toLocalDate()) == null ? null : at;
    }

    static boolean canScheduleExact(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    private static PendingIntent alarmIntent(Context ctx, String date) {
        Intent intent = new Intent(ctx, MorningReceiver.class).setAction(ACTION_MORNING);
        if (date != null) intent.putExtra(EXTRA_DATE, date);
        return PendingIntent.getBroadcast(ctx, ALARM_REQUEST, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Replace the single pending alarm with the next morning's. Returns its time, or null. */
    static ZonedDateTime scheduleNext(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return null;
        ZonedDateTime next = nextDelivery(ctx);
        if (next == null) {
            am.cancel(alarmIntent(ctx, null));
            prefs(ctx).edit().remove("nextAt").apply();
            return null;
        }
        PendingIntent pi = alarmIntent(ctx, next.toLocalDate().toString());
        long at = next.toInstant().toEpochMilli();
        if (canScheduleExact(ctx)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            // Without the exact-alarm permission Android may deliver this a little late.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
        prefs(ctx).edit().putString("nextAt", next.toOffsetDateTime().toString()).apply();
        return next;
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Morning reading", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("The title of each morning's reading, at the time you choose.");
        nm.createNotificationChannel(ch);
    }

    /** Post the reading for a date. Returns false when there is none or notifications are off. */
    static boolean post(Context ctx, LocalDate date, boolean test) {
        JSONObject item = itemFor(ctx, date);
        if (item == null) return false;
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_DATE, date.toString());
        PendingIntent content = PendingIntent.getActivity(ctx, (int) (date.toEpochDay() % 100000), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = item.optString("title", "Today's reading");
        String dek = item.optString("dek", "");
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_reading)
            .setColor(0xFFA84A24)
            .setContentTitle(title)
            .setContentText(test ? "A test of this morning's notification" : dek)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(test ? "A test of this morning's notification" : dek))
            .setSubText("Today's reading")
            .setContentIntent(content)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (!nm.areNotificationsEnabled()) return false;
        try {
            nm.notify(NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {
            return false;
        }
        if (!test) prefs(ctx).edit().putString("lastNotified", date.toString()).apply();
        return true;
    }

    /** The phone was off (or the clock moved) at delivery time: post today's reading late, once. */
    static void catchUp(Context ctx) {
        if (!isConfigured(ctx)) return;
        ZoneId zone = zone(ctx);
        ZonedDateTime now = ZonedDateTime.now(zone);
        LocalDate today = now.toLocalDate();
        ZonedDateTime due = today.atTime(time(ctx)).atZone(zone);
        if (now.isBefore(due) || today.toString().equals(prefs(ctx).getString("lastNotified", ""))) return;
        // Day one's reading opens at first launch; there is nothing to announce later that day.
        if (indexFor(ctx, today) == 0) return;
        post(ctx, today, false);
    }
}
