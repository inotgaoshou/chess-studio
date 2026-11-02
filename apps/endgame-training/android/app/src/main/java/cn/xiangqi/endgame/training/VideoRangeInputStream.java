package cn.xiangqi.endgame.training;
import java.io.*;

/** WebView verifies available() and seeks the raw stream itself before reading.
 * Keep the initial full size visible, then bound reads at the requested end.
 * Pre-seeking here would make WebView seek twice and break nonzero ranges.
 */
final class VideoRangeInputStream extends FileInputStream {
    private final long end;
    private final long size;
    VideoRangeInputStream(File file,VideoByteRange range)throws IOException{super(file);end=range.end;size=file.length();}
    @Override public int available()throws IOException{return size>Integer.MAX_VALUE?0:super.available();}
    @Override public int read()throws IOException{if(getChannel().position()>end)return -1;return super.read();}
    @Override public int read(byte[] b)throws IOException{return read(b,0,b.length);}
    @Override public int read(byte[] b,int off,int len)throws IOException{if(len==0)return 0;long remaining=end+1-getChannel().position();if(remaining<=0)return -1;return super.read(b,off,(int)Math.min(len,remaining));}
}
