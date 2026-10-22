package com.jarvis.phonehub

import android.os.Bundle
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale
import com.google.zxing.integration.android.IntentIntegrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private var endpoint by mutableStateOf("")
    private var pairingId by mutableStateOf("")
    private var code by mutableStateOf("")
    private var deviceName by mutableStateOf("Android phone")
    private var status by mutableStateOf("Not connected")
    private var statusJson by mutableStateOf("")
    private var notificationText by mutableStateOf("No notifications loaded")
    private var busy by mutableStateOf(false)
    private var callMessage by mutableStateOf("JARVIS is calling to remind you to check in.")
    private var voiceReply by mutableStateOf("")
    private var tts: TextToSpeech? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        endpoint = getSharedPreferences("phonehub_settings", MODE_PRIVATE).getString("endpoint", "") ?: ""
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(
                        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("JARVIS Phone Hub", style = MaterialTheme.typography.headlineMedium)
                        Text("Connect your phone to JARVIS over your trusted local network.")
                        OutlinedTextField(endpoint, { endpoint = it }, label = { Text("Laptop HTTPS address") },
                            placeholder = { Text("https://192.168.1.10:18443") }, modifier = Modifier.fillMaxWidth(),
                            singleLine = true)
                        Button(onClick = { IntentIntegrator(this@MainActivity).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the one-time JARVIS Phone Hub QR").setBeepEnabled(false).setOrientationLocked(false).initiateScan() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Scan pairing QR") }
                        OutlinedTextField(pairingId, { pairingId = it.trim() }, label = { Text("Pairing ID") },
                            modifier = Modifier.fillMaxWidth(), singleLine = true)
                        OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("6-digit pairing code") },
                            modifier = Modifier.fillMaxWidth(), singleLine = true)
                        OutlinedTextField(deviceName, { deviceName = it.take(80) }, label = { Text("Device name") },
                            modifier = Modifier.fillMaxWidth(), singleLine = true)
                        Button(onClick = { pair() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                            Text(if (busy) "Working…" else "Pair device")
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            Button(onClick = { refreshStatus() }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Refresh status") }
                            Button(onClick = { refreshNotifications() }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Notifications") }
                        }
                        Button(onClick = { startVoiceSession() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Speak to JARVIS") }
                        if (voiceReply.isNotBlank()) Card(modifier = Modifier.fillMaxWidth()) { Text(voiceReply, modifier = Modifier.padding(14.dp)) }
                        OutlinedTextField(callMessage, { callMessage = it.take(600) }, label = { Text("Message for a real phone call") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                        Button(onClick = { callMe() }, enabled = !busy && callMessage.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Call my phone") }
                        Button(onClick = { forgetPhone() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                            Text("Forget this phone")
                        }
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Connection", style = MaterialTheme.typography.titleMedium)
                                Text(status)
                                if (statusJson.isNotBlank()) Text(statusJson)
                            }
                        }
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Notifications", style = MaterialTheme.typography.titleMedium)
                                Text(notificationText)
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("Security: HTTPS only. Install/trust your laptop gateway certificate on Android if it is issued by your own local CA. The app does not disable TLS certificate validation.")
                    }
                }
            }
        }
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
        tts = TextToSpeech(this) { result -> if (result == TextToSpeech.SUCCESS) tts?.language = Locale.getDefault() }
        if (!TokenVault.load(this).isNullOrBlank()) PhoneHubNotificationWorker.schedule(this)
    }


    @Deprecated("Deprecated in Android API; ZXing's embedded scanner uses this callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (result != null) {
            val contents = result.contents
            if (contents.isNullOrBlank()) {
                setUi { status = "QR scan cancelled." }
            } else {
                try {
                    val payload = JSONObject(contents)
                    require(payload.optInt("version") == 1) { "Unsupported pairing QR version" }
                    val scannedEndpoint = payload.optString("endpoint")
                    val scannedId = payload.optString("pairingId")
                    val scannedCode = payload.optString("code")
                    require(scannedEndpoint.startsWith("https://") && scannedId.matches(Regex("[a-fA-F0-9]{24}")) &&
                        scannedCode.matches(Regex("[0-9]{6}"))) { "QR is not a valid JARVIS Phone Hub pairing code" }
                    setUi {
                        endpoint = scannedEndpoint
                        pairingId = scannedId
                        code = scannedCode
                        status = "QR scanned. Confirm the laptop address, then tap Pair device."
                    }
                } catch (e: Exception) {
                    setUi { status = "Invalid Phone Hub QR: " + safeMessage(e) }
                }
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }


    private fun startVoiceSession() {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), 1002)
            setUi { status = "Allow microphone access, then tap Speak to JARVIS again." }
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            setUi { status = "Speech recognition is unavailable on this device." }
            return
        }
        val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to JARVIS")
        }
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { setUi { status = "Listening…" } }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { setUi { status = "Thinking…" } }
            override fun onError(error: Int) {
                recognizer.destroy()
                setUi { status = "Speech recognition failed (code $error). Check microphone and speech service." }
            }
            override fun onResults(results: Bundle?) {
                recognizer.destroy()
                val spoken = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                if (spoken.isBlank()) { setUi { status = "I did not catch that. Try again." }; return }
                runWithToken { client, token ->
                    setUi { status = "You: " + spoken.take(180) }
                    val reply = client.voiceReply(token, spoken)
                    setUi {
                        voiceReply = reply
                        status = if (reply.isBlank()) "JARVIS returned an empty reply." else "JARVIS replied."
                        if (reply.isNotBlank()) tts?.speak(reply, TextToSpeech.QUEUE_FLUSH, null, "jarvis-voice-reply")
                    }
                }
            }
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        recognizer.startListening(intent)
    }

    private fun callMe() = runWithToken { client, token ->
        val response = client.callJarvis(token, callMessage)
        val call = response.optJSONObject("call")
        setUi { status = "Call requested. Provider status: " + (call?.optString("status") ?: "queued") }
    }

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        super.onDestroy()
    }

    private fun pair() = runOnIo {
        try {
            val client = PhoneHubClient(endpoint)
            val response = client.pair(pairingId, code, deviceName)
            val token = response.optString("token")
            if (token.isBlank()) throw IllegalStateException("Gateway did not return a device token")
            TokenVault.save(this, token)
            PhoneHubNotificationWorker.schedule(this)
            getSharedPreferences("phonehub_settings", MODE_PRIVATE).edit().putString("endpoint", endpoint).apply()
            setUi {
                status = "Paired as " + response.optJSONObject("device")?.optString("name", deviceName)
                statusJson = "Token saved in Android Keystore-encrypted storage."
                pairingId = ""
                code = ""
            }
        } catch (e: Exception) {
            setUi { status = safeMessage(e) }
        }
    }

    private fun forgetPhone() {
        TokenVault.clear(this)
        PhoneHubNotificationWorker.cancel(this)
        getSharedPreferences("phonehub_notifications", MODE_PRIVATE).edit().remove("last_seen_id").apply()
        setUi {
            status = "Phone token removed from this device. Revoke the paired device on the laptop too if needed."
            statusJson = ""
            notificationText = "No notifications loaded"
        }
    }

    private fun refreshStatus() = runWithToken { client, token ->
        val response = client.status(token)
        setUi {
            status = if (response.optBoolean("ok")) "Connected to JARVIS" else "Gateway did not confirm connection"
            statusJson = response.optJSONObject("data")?.toString(2) ?: response.toString(2)
        }
    }

    private fun refreshNotifications() = runWithToken { client, token ->
        val items: JSONArray = client.notifications(token)
        val rendered = if (items.length() == 0) {
            "No recent JARVIS notifications."
        } else {
            (0 until items.length()).joinToString("\n\n") { index ->
                val item = items.optJSONObject(index) ?: JSONObject()
                val title = item.optString("title", "JARVIS notification")
                val body = item.optString("body", item.optString("message", ""))
                (title + if (body.isBlank()) "" else "\n" + body).take(1000)
            }
        }
        setUi { notificationText = rendered }
    }

    private fun interface PhoneHubAction {
        fun run(client: PhoneHubClient, token: String)
    }

    private fun runWithToken(action: PhoneHubAction) = runWithTokenInternal(action)

    private fun runWithTokenInternal(action: PhoneHubAction) = runOnIo {
        val token = TokenVault.load(this)
        if (token.isNullOrBlank()) {
            setUi { status = "Pair this phone first." }
            return@runOnIo
        }
        try {
            action.run(PhoneHubClient(endpoint), token)
            getSharedPreferences("phonehub_settings", MODE_PRIVATE).edit().putString("endpoint", endpoint).apply()
        } catch (e: Exception) {
            val message = safeMessage(e)
            setUi {
                status = message
                if (message.contains("UNAUTHENTICATED") || message.contains("DEVICE_REVOKED") || message.contains("SESSION_EXPIRED")) {
                    TokenVault.clear(this@MainActivity)
                    status += " Pair this phone again."
                }
            }
        }
    }

    private fun setUi(block: () -> Unit) {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) block()
        else runOnUiThread(block)
    }

    private fun runOnIo(block: () -> Unit) {
        if (busy) return
        setUi {
            busy = true
            status = "Connecting securely…"
        }
        Thread {
            try { block() } finally { setUi { busy = false } }
        }.start()
    }

    private fun safeMessage(error: Exception): String =
        (error.message ?: "Phone Hub request failed").take(240)
}
