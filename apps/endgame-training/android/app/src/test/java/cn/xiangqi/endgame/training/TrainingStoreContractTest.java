package cn.xiangqi.endgame.training;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class TrainingStoreContractTest {

    @Test
    public void usesTheStandaloneTrainingPackage() {
        assertEquals("cn.xiangqi.endgame.training", BuildConfig.APPLICATION_ID);
    }
}
