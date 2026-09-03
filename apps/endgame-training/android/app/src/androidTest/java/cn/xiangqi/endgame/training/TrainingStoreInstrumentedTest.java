package cn.xiangqi.endgame.training;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class TrainingStoreInstrumentedTest {

    @Test
    public void usesTheStandaloneTrainingPackage() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("cn.xiangqi.endgame.training", appContext.getPackageName());
    }
}
