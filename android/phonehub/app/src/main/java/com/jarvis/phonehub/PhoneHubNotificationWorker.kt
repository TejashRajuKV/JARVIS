package com.jarvis.phonehub

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal class PhoneHubNotificationWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val token = TokenVault.load(applicationContext) ?: return Result.success()
        val prefs = applicationContext.getSharedPreferences("phonehub_settings", Context.MODE_PRIVATE)
        val endpoint = prefs.getString("endpoint", "").orEmpty()
        if (endpoint.isBlank()) return Result.success()

        return try {
            val items = PhoneHubClient(endpoint).notifications(token)
            deliverNewItems(items)
            Result.success()
        } catch (error: Exception) {
            val message = error.message.orEmpty()
            if (message.contains("UNAUTHENTICATED") || message.contains("DEVICE_REVOKED") ||
                message.contains("SESSION_EXPIRED")) {
                TokenVault.clear(applicationContext)
                Result.success()
            } else {
                Result.retry()
            }
        }
    }

    private fun deliverNewItems(items: JSONArray) {
        if (items.length() == 0) return
        val prefs = applicationContext.getSharedPreferences("phonehub_notifications", Context.MODE_PRIVATE)
        val previous = prefs.getString("last_seen_id", null)
        val newest = items.optJSONObject(0)?.optString("id").orEmpty()
        if (newest.isBlank()) return
        if (previous == null) {
            prefs.edit().putString("last_seen_id", newest).apply()
            return
        }

        val newItems = mutableListOf<JSONObject>()
        var foundPrevious = false
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val id = item.optString("id")
            if (id == previous) {
                foundPrevious = true
                break
            }
            if (id.isNotBlank()) newItems.add(item)
        }
        // If the prior cursor fell out of the bounded server queue, reset quietly instead
        // of spamming the phone with every retained historical item.
        if (!foundPrevious) {
            prefs.edit().putString("last_seen_id", newest).apply()
            return
        }
        prefs.edit().putString("last_seen_id", newest).apply()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return

        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "JARVIS alerts", NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
        val intent = Intent(applicationContext, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        newItems.asReversed().forEach { item ->
            val title = item.optString("title", "JARVIS alert").take(120)
            val body = item.optString("body", item.optString("message", "")).take(1000)
            val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build()
            NotificationManagerCompat.from(applicationContext).notify(item.optString("id").hashCode(), notification)
        }
    }

    companion object {
        private const val CHANNEL_ID = "jarvis_phonehub_alerts"
        private const val WORK_NAME = "jarvis-phonehub-notification-refresh"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<PhoneHubNotificationWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}
