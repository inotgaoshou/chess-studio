package cn.xiangqi.endgame.training;

import static android.content.Context.MODE_PRIVATE;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private static final String KEY_ALIAS = "xiangqi_teaching_session_key";
    private static final String PREFS = "xiangqi_teaching_secure_session";
    private static final String VALUE = "encrypted_session";

    @PluginMethod
    public void load(PluginCall call) {
        try {
            String value = getContext().getSharedPreferences(PREFS, MODE_PRIVATE).getString(VALUE, null);
            JSObject result = new JSObject();
            if (value != null) result.put("session", decrypt(value));
            call.resolve(result);
        } catch (Exception error) {
            getContext().getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(VALUE).apply();
            call.reject("无法读取安全登录会话", error);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String session = call.getString("session");
        if (session == null || session.isEmpty()) { call.reject("登录会话无效"); return; }
        try {
            getContext().getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(VALUE, encrypt(session)).apply();
            call.resolve();
        } catch (Exception error) { call.reject("无法保存安全登录会话", error); }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        getContext().getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(VALUE).apply();
        call.resolve();
    }

    private SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        String[] pieces = value.split("\\.", 2);
        if (pieces.length != 2) throw new IllegalStateException("invalid session");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
