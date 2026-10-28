package com.cogwild.game;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// Cogwild: full-screen game (system bars hidden, swipe from the edge to show them) and the screen stays on.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // the phone's Back button / gesture works like Esc in the game (closes a menu, opens the match menu, goes back a
        // screen); only on the main menu does it leave, and then the app just goes to the background
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript("(window.CW && CW.onBack) ? CW.onBack() : 'exit'", (res) -> {
                    if (res != null && res.contains("exit")) moveTaskToBack(true);
                });
            }
        });
        // music may start the moment the game opens, without waiting for a tap
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        // the game opens Google sign-in (and other https pages) in the phone's own browser: CogwildNative.openUrl(url)
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void openUrl(String url) {
                if (url == null || !url.startsWith("https://")) return;
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { startActivity(i); } catch (Exception e) { /* no browser */ }
            }
            // typing in the chat from the menu: upright, then back to sideways
            @JavascriptInterface
            public void setOrientation(String o) {
                final int want = "portrait".equals(o) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
                runOnUiThread(() -> setRequestedOrientation(want));
            }
            // voice chat on: sound from the loudspeaker (or the headphones/earbuds plugged in), not the quiet earpiece
            @JavascriptInterface
            @SuppressWarnings("deprecation") // setSpeakerphoneOn still works everywhere and is the simplest switch
            public void setVoiceAudio(boolean on) {
                runOnUiThread(() -> {
                    AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                    if (am == null) return;
                    if (on) {
                        boolean headset = false;
                        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                            int t = d.getType();
                            if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                                || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == 26 /* BLE headset */) headset = true;
                        }
                        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                        am.setSpeakerphoneOn(!headset);
                    } else {
                        am.setSpeakerphoneOn(false);
                        am.setMode(AudioManager.MODE_NORMAL);
                    }
                });
            }
        }, "CogwildNative");
        // the keyboard: the game gets shorter instead of the keyboard covering it (a full-screen app doesn't do that by
        // itself), so the chat's tabs and close button at the top and the box you type in all stay on screen
        View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            v.setPadding(0, 0, 0, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
            return insets;
        });
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
