package cn.xiangqi.endgame.training;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TrainingStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
