package cn.xiangqi.endgame.training;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicLong;

@CapacitorPlugin(name = "CommentarySpeech")
public final class CommentarySpeechPlugin extends Plugin {
    private TextToSpeech engine;
    private boolean ready;
    private PluginCall pending;
    private final AtomicLong generation = new AtomicLong();

    @Override public void load() {
        getActivity().runOnUiThread(() -> {
            engine = new TextToSpeech(getContext(), status -> getActivity().runOnUiThread(() -> ready = status == TextToSpeech.SUCCESS));
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { finish(id, false); }
                @Override public void onError(String id) { finish(id, true); }
                @Override public void onError(String id, int code) { finish(id, true); }
            });
        });
    }

    private void finish(String id, boolean failed) {
        getActivity().runOnUiThread(() -> {
            if (!id.equals(Long.toString(generation.get())) || pending == null) return;
            PluginCall call = pending; pending = null;
            if (failed) call.reject("本机中文语音播放失败，文字讲解仍可查看。");
            else call.resolve();
        });
    }

    private void stopOnMain() {
        generation.incrementAndGet();
        if (engine != null) engine.stop();
        if (pending != null) {
            JSObject result = new JSObject(); result.put("stopped", true);
            pending.resolve(result); pending = null;
        }
    }

    @PluginMethod public void speak(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopOnMain();
            if (!ready || engine == null) { call.reject("系统语音尚未就绪，请稍后重试；若未安装，请在系统设置安装离线中文语音包。"); return; }
            String text = call.getString("text", "").trim();
            if (text.isEmpty() || text.length() > TextToSpeech.getMaxSpeechInputLength()) { call.reject("朗读文字为空或过长。"); return; }
            if (engine.getVoices() == null) { call.reject("请在系统文字转语音设置中安装离线中文语音包。"); return; }
            Voice voice = engine.getVoices().stream()
                .filter(v -> ("zh".equals(v.getLocale().getLanguage()) || "cmn".equals(v.getLocale().getLanguage()))
                    && "CN".equals(v.getLocale().getCountry()) && !v.isNetworkConnectionRequired())
                .filter(v -> v.getFeatures() == null || !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))
                .findFirst().orElse(null);
            if (voice == null || engine.setVoice(voice) != TextToSpeech.SUCCESS) { call.reject("请在系统文字转语音设置中安装离线中文语音包。"); return; }
            float rate = Math.max(.6f, Math.min(1.5f, call.getFloat("rate", 1f)));
            engine.setSpeechRate(rate);
            pending = call;
            String id = Long.toString(generation.incrementAndGet());
            if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) finish(id, true);
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { stopOnMain(); call.resolve(); });
    }
    @Override protected void handleOnPause() { getActivity().runOnUiThread(this::stopOnMain); }
    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(() -> { stopOnMain(); if (engine != null) engine.shutdown(); ready = false; });
    }
}
