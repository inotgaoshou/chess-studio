package cn.xiangqi.endgame.training;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TrainingStorePlugin.class);
        registerPlugin(ScreenOrientationPlugin.class);
        registerPlugin(CloudBookPlugin.class);
        registerPlugin(PikafishPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
