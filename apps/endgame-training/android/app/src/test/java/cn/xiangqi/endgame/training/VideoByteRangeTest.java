package cn.xiangqi.endgame.training;
import org.junit.Test;
import static org.junit.Assert.*;
public class VideoByteRangeTest {
 @Test public void boundedAndOpenAndSuffix(){assertEquals(100,VideoByteRange.parse("bytes=0-99",1000).length());assertEquals(900,VideoByteRange.parse("bytes=100-",1000).length());assertEquals(950,VideoByteRange.parse("bytes=-50",1000).start);assertEquals(1000,VideoByteRange.parse("bytes=-2000",1000).length());assertEquals(100,VideoByteRange.parse("bytes=900-9999",1000).length());assertEquals(1000,VideoByteRange.parse(null,1000).length());}
 @Test public void rejectsInvalidRanges(){for(String h:new String[]{"bytes=1000-","bytes=5-4","bytes=-0","bytes=0-1,4-5","bytes=999999999999999999999999-","garbage"}){try{VideoByteRange.parse(h,1000);fail(h);}catch(IllegalArgumentException expected){}}}
}
