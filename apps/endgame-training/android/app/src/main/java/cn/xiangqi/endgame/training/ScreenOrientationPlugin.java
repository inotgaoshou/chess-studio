package cn.xiangqi.endgame.training;

import android.content.pm.ActivityInfo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenOrientation")
public class ScreenOrientationPlugin extends Plugin {
    @PluginMethod
    public void set(PluginCall call) {
        String orientation = call.getString("orientation", "auto");
        final int requestedOrientation;
        switch (orientation) {
            case "landscape": requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE; break;
            case "portrait": requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT; break;
            case "auto": requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED; break;
            default: call.reject("不支持的屏幕方向"); return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(requestedOrientation);
            call.resolve();
        });
    }
}
