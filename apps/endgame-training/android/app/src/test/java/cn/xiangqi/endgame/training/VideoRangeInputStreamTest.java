package cn.xiangqi.endgame.training;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
public class VideoRangeInputStreamTest {
 @Test public void permitsWebViewSeekButBoundsResponse()throws Exception{
  File f=File.createTempFile("video-range", ".bin");try{try(FileOutputStream out=new FileOutputStream(f)){for(int i=0;i<256;i++)out.write(i);}
   try(VideoRangeInputStream in=new VideoRangeInputStream(f,VideoByteRange.parse("bytes=100-199",256))){assertEquals(256,in.available());assertEquals(100,in.skip(100));byte[] b=new byte[256];assertEquals(100,in.read(b));assertEquals(100,b[0]&255);assertEquals(199,b[99]&255);assertEquals(-1,in.read());}
  }finally{f.delete();}
 }
}
