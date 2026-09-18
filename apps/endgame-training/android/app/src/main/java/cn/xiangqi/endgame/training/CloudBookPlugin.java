package cn.xiangqi.endgame.training;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "CloudBook")
public class CloudBookPlugin extends Plugin {
    private static final String ENDPOINT = "https://www.chessdb.cn/chessdb.php";

    @PluginMethod
    public void query(PluginCall call) {
        String fen = call.getString("fen");
        if (fen == null || fen.trim().isEmpty()) { call.reject("缺少当前局面"); return; }
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                String url = ENDPOINT + "?action=queryall&board=" + URLEncoder.encode(fen, StandardCharsets.UTF_8.name());
                connection = (HttpURLConnection) new java.net.URL(url).openConnection();
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(6000);
                connection.setRequestProperty("Accept", "text/plain");
                if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IllegalStateException("HTTP " + connection.getResponseCode());
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }
                JSObject result = new JSObject();
                result.put("payload", body.toString());
                call.resolve(result);
            } catch (Exception error) { call.reject("云库请求失败", error); }
            finally { if (connection != null) connection.disconnect(); }
        }).start();
    }

}
