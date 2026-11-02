package cn.xiangqi.endgame.training;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class TrainingStoreContractTest {

    @Test
    public void usesTheStandaloneTrainingPackage() {
        String suffix = BuildConfig.BUILD_TYPE.equals("family") ? ".family" : BuildConfig.BUILD_TYPE.equals("debug") ? ".preview" : "";
        assertEquals("cn.xiangqi.endgame.training" + suffix, BuildConfig.APPLICATION_ID);
    }
}
