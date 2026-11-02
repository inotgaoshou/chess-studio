package cn.xiangqi.endgame.training;

import android.webkit.*;
import com.getcapacitor.*;

/** Preserve all Capacitor routing, narrowing only video responses to registered media. */
final class VideoWebViewClient extends BridgeWebViewClient {
    private final Bridge bridge;
    VideoWebViewClient(Bridge bridge) { super(bridge); this.bridge=bridge; }
    @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
        String path=request.getUrl().getPath();
        if(path!=null&&path.contains("/VideoLibrary/media/")) {
            PluginHandle handle=bridge.getPlugin("VideoLibrary");
            if(handle!=null&&handle.getInstance() instanceof VideoLibraryPlugin) return ((VideoLibraryPlugin)handle.getInstance()).serve(request);
        }
        return super.shouldInterceptRequest(view,request);
    }
}
