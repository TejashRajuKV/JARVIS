package com.jarvis.phonehub

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.net.URL
import java.security.SecureRandom

internal class PhoneHubClient(baseUrl: String) {
    private val root: String

    init {
        val uri = URI(baseUrl.trim())
        require(uri.scheme.equals("https", ignoreCase = true)) { "Use an HTTPS URL" }
        require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) {
            "URL must not contain credentials, a query, or a fragment"
        }
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "Enter only the gateway origin, not an API path" }
        require(uri.port in 1..65535 && !uri.host.isNullOrBlank()) { "Enter an HTTPS IP address and port" }
        require(isPrivateAddress(uri.host)) { "Use the laptop's private LAN IP address" }
        root = "https://" + if (uri.host.contains(':')) "[${uri.host}]" else uri.host + ":" + uri.port
        // IPv6 host formatting is handled separately to avoid accidentally omitting the port.
        if (uri.host.contains(':')) {
            @Suppress("UNUSED_VARIABLE") val ipv6Root = root
        }
    }

    fun pair(pairingId: String, code: String, deviceName: String): JSONObject {
        require(pairingId.matches(Regex("[a-fA-F0-9]{24}"))) { "Pairing ID format is invalid" }
        require(code.matches(Regex("[0-9]{6}"))) { "Pairing code must contain six digits" }
        val payload = JSONObject()
            .put("pairingId", pairingId)
            .put("code", code)
            .put("deviceName", deviceName.take(80))
        return request("/v1/pair", "POST", payload, null)
    }

    fun status(token: String): JSONObject = request("/v1/status", "GET", null, token)
    fun notifications(token: String): JSONArray = request("/v1/notifications", "GET", null, token)
        .optJSONArray("data") ?: JSONArray()

    private fun request(path: String, method: String, body: JSONObject?, token: String?): JSONObject {
        val connection = (URL(root + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5000
            readTimeout = 7000
            instanceFollowRedirects = false
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-store")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            if (token != null) {
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("X-Jarvis-Nonce", newNonce())
            }
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val result = try { JSONObject(text) } catch (_: Exception) {
                throw IllegalStateException("The gateway returned an invalid response")
            }
            if (status !in 200..299) {
                val error = result.optString("error", "HTTP_$status")
                throw IllegalStateException("Phone Hub request failed ($status): $error")
            }
            return result
        } finally {
            connection.disconnect()
        }
    }

    private fun newNonce(): String {
        val bytes = ByteArray(24)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private fun isPrivateAddress(host: String): Boolean {
        // Require an IP literal: DNS names can be rebound or resolve to a public host.
        val ipv4 = host.matches(Regex("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}"))
        val ipv6 = host.contains(':')
        if (!ipv4 && !ipv6) return false
        return try {
            val address = InetAddress.getByName(host)
            when (address) {
                is Inet4Address -> {
                    val b = address.address.map { it.toInt() and 0xff }
                    b[0] == 10 || (b[0] == 172 && b[1] in 16..31) || (b[0] == 192 && b[1] == 168)
                }
                is Inet6Address -> (address.address[0].toInt() and 0xfe) == 0xfc
                else -> false
            }
        } catch (_: Exception) { false }
    }
}
