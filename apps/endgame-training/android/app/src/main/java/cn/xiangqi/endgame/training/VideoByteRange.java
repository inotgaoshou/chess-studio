package cn.xiangqi.endgame.training;

/** One HTTP byte range. Deliberately reject multipart ranges. */
final class VideoByteRange {
    final long start,end;
    VideoByteRange(long start,long end){this.start=start;this.end=end;}
    long length(){return end-start+1;}
    static VideoByteRange parse(String header,long size) {
        if(size<=0)throw new IllegalArgumentException("empty media");
        if(header==null)return new VideoByteRange(0,size-1);
        if(!header.matches("bytes=(\\d+-\\d*|-\\d+)"))throw new IllegalArgumentException("invalid range");
        String[] parts=header.substring(6).split("-",-1);
        long start,end;
        if(parts[0].isEmpty()){long suffix=Long.parseLong(parts[1]);if(suffix<=0)throw new IllegalArgumentException("empty suffix");start=Math.max(0,size-suffix);end=size-1;}
        else {start=Long.parseLong(parts[0]);end=parts[1].isEmpty()?size-1:Math.min(size-1,Long.parseLong(parts[1]));}
        if(start>=size||start>end)throw new IllegalArgumentException("unsatisfiable range");
        return new VideoByteRange(start,end);
    }
}
