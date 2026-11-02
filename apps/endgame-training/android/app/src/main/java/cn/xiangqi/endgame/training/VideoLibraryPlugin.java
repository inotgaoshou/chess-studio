package cn.xiangqi.endgame.training;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;

/** Media never crosses the JS bridge. Only registered content hashes resolve to playback paths. */
@CapacitorPlugin(name="VideoLibrary")
public class VideoLibraryPlugin extends Plugin {
    private SQLiteDatabase db;
    private JSONObject state;
    private String committed;
    private String openingError;
    private File root, media, staging;
    private final java.util.concurrent.ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String active = "";
    private volatile boolean cancelled;
    private static final String[] KINDS = {"categories","series","chapters","videos","progress","bookmarks","tasks"};

    @Override public void load() {
        try {
            root = new File(getContext().getFilesDir(),"VideoLibrary"); media = new File(root,"media"); staging = new File(root,"staging");
            media.mkdirs(); staging.mkdirs();
            db = SQLiteDatabase.openOrCreateDatabase(new File(root,"library.sqlite"),null);
            db.enableWriteAheadLogging(); db.execSQL("CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)");
            try(Cursor c = db.rawQuery("SELECT json FROM library WHERE id=1",null)) { state = c.moveToFirst() ? new JSONObject(c.getString(0)) : new JSONObject(); }
            for(String k: KINDS) if(!state.has(k)) state.put(k,new JSONArray());
            if(!state.has("jobs")) state.put("jobs",new JSONObject());
            if(arr("categories").length()==0) for(String[] c: new String[][]{{"opening","布局"},{"middle","中局"},{"endgame","残局"},{"other","其他"}}) arr("categories").put(new JSONObject().put("id","category-"+c[0]).put("title",c[1]).put("order",arr("categories").length()));
            for(int i=0;i<arr("tasks").length();i++){JSONObject t=arr("tasks").getJSONObject(i); if(Arrays.asList("running","scanning").contains(t.optString("state"))) t.put("state","interrupted");}
            File[] partial=media.listFiles((d,n)->n.endsWith(".part")); if(partial!=null) for(File f:partial) f.delete();
            persist();
        } catch(Exception e) { openingError="视频库无法打开，请检查存储空间并重启应用";android.util.Log.e("VideoLibrary","视频数据库打开失败",e); }
    }
    @Override protected void handleOnPause() { notifyListeners("background",new JSObject()); }
    private JSONArray arr(String key) throws JSONException { if(state==null||openingError!=null) throw new JSONException("视频库无法打开，请检查存储空间并重启应用"); return state.getJSONArray(key); }
    private synchronized void persist() {
        String json=state.toString();
        try { db.execSQL("INSERT OR REPLACE INTO library(id,json) VALUES(1,?)",new Object[]{json}); committed=json; }
        catch(RuntimeException error){ rollback();throw error; }
        // Rebuildable receipt used only to skip computer transfers, never as the database.
        try { JSONObject receipt=new JSONObject(); for(int i=0;i<arr("videos").length();i++){JSONObject v=arr("videos").getJSONObject(i);String h=v.getString("hash");File f=new File(media,h+".mp4");if(f.isFile()&&f.length()==v.getLong("size"))receipt.put(h,f.length());}File tmp=new File(root,"inventory.json.part");Files.write(tmp.toPath(),receipt.toString().getBytes(StandardCharsets.UTF_8));tmp.renameTo(new File(root,"inventory.json")); }catch(Exception ignored){}
    }
    private void rollback(){if(committed!=null)try{state=new JSONObject(committed);}catch(JSONException ignored){}}
    private static String hash(String value) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    private static String hex(byte[] bytes) { StringBuilder b=new StringBuilder(); for(byte x:bytes)b.append(String.format(Locale.ROOT,"%02x",x&255)); return b.toString(); }
    private JSONObject find(String kind,String id) throws Exception { JSONArray a=arr(kind);for(int i=0;i<a.length();i++)if(a.getJSONObject(i).optString("id").equals(id))return a.getJSONObject(i);return null; }
    private JSONObject require(String kind,String id) throws Exception { JSONObject o=find(kind,id);if(o==null)throw new Exception("记录不存在，请重新打开视频库");return o; }
    private void remove(String kind,java.util.function.Predicate<JSONObject> test) throws Exception { JSONArray a=arr(kind),next=new JSONArray();for(int i=0;i<a.length();i++){JSONObject o=a.getJSONObject(i);if(!test.test(o))next.put(o);}state.put(kind,next); }
    private interface Action { void run() throws Exception; }
    private synchronized void reply(PluginCall c,Action a) { try{a.run();c.resolve();}catch(Exception e){rollback();c.reject(e.getMessage(),e);} }
    @PluginMethod public synchronized void snapshot(PluginCall c) {try{JSONObject out=new JSONObject();for(String k:KINDS)out.put(k,arr(k));c.resolve(JSObject.fromJSONObject(out));}catch(Exception e){c.reject(e.getMessage(),e);} }
    @PluginMethod public void pick(PluginCall c) {
        if(!active.isEmpty()){c.reject("已有导入任务，请等待或取消后再试");return;}
        Intent i=new Intent(Boolean.TRUE.equals(c.getBoolean("folder"))?Intent.ACTION_OPEN_DOCUMENT_TREE:Intent.ACTION_OPEN_DOCUMENT);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        if(!Boolean.TRUE.equals(c.getBoolean("folder"))){i.setType("video/mp4");i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);i.addCategory(Intent.CATEGORY_OPENABLE);}
        startActivityForResult(c,i,"picked");
    }
    @ActivityCallback private void picked(PluginCall c,ActivityResult result) {
        if(c==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null){c.resolve();return;}
        synchronized(this){if(!active.isEmpty()){c.reject("已有导入任务");return;} active=UUID.randomUUID().toString();cancelled=false;}
        String id=active;Intent data=result.getData();
        try { scanning(id); JSObject out=new JSObject();out.put("taskId",id);c.resolve(out); }catch(Exception e){active="";c.reject(e.getMessage(),e);return;}
        worker.execute(()->{
            try{
                JSONArray sources=new JSONArray();String title=c.getString("seriesTitle","");
                if(Boolean.TRUE.equals(c.getBoolean("folder"))){Uri uri=data.getData();keep(uri);String document=DocumentsContract.getTreeDocumentId(uri);Uri node=DocumentsContract.buildDocumentUriUsingTree(uri,document);if(title.trim().isEmpty())title=display(node);scan(uri,document,"",sources);}
                else {List<Uri> uris=new ArrayList<>();if(data.getClipData()!=null)for(int n=0;n<data.getClipData().getItemCount();n++)uris.add(data.getClipData().getItemAt(n).getUri());else uris.add(data.getData());for(Uri uri:uris){keep(uri);String name=display(uri);if(name.toLowerCase(Locale.ROOT).endsWith(".mp4"))sources.put(source(uri.toString(),name,"",size(uri),sources.length(),""));}}
                if(title.trim().isEmpty())title="导入视频";
                start(id,sources,c.getString("categoryId","category-other"),c.getString("seriesId",""),title);
                process(id);
            }catch(Exception e){finishError(id,e);}finally{active="";}
        });
    }
    private synchronized void scanning(String id) throws Exception { arr("tasks").put(new JSONObject().put("id",id).put("state","scanning").put("total",0).put("completed",0).put("duplicates",0).put("failed",0).put("bytes",0).put("totalBytes",0).put("errors",new JSONArray()));persist(); }
    private synchronized void discovered(String title,long bytes) throws Exception { JSONObject t=require("tasks",active);t.put("total",t.getInt("total")+1).put("totalBytes",t.getLong("totalBytes")+bytes).put("current",title);persist(); }
    private void keep(Uri uri) {try{getContext().getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){} }
    private String display(Uri uri) {try(Cursor c=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())return c.getString(0);}catch(Exception ignored){}return "视频.mp4";}
    private long size(Uri uri) {try(Cursor c=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.SIZE},null,null,null)){if(c!=null&&c.moveToFirst())return c.getLong(0);}catch(Exception ignored){}return 0;}
    private void scan(Uri tree,String parent,String path,JSONArray out) throws Exception {
        if(cancelled)throw new Exception("已取消选择");
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parent);
        try(Cursor c=getContext().getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null)){
            if(c==null)throw new Exception("无法读取文件夹，请重新选择并允许访问");
            while(c.moveToNext()){String name=c.getString(1);if(name.startsWith("."))continue;String doc=c.getString(0);if(DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)))scan(tree,doc,path.isEmpty()?name:path+"/"+name,out);else if(name.toLowerCase(Locale.ROOT).endsWith(".mp4")){out.put(source(DocumentsContract.buildDocumentUriUsingTree(tree,doc).toString(),name,path,c.getLong(3),out.length(),""));discovered(name,c.getLong(3));}}
        }
    }
    private JSONObject source(String uri,String name,String chapter,long bytes,int order,String hash) throws Exception{return new JSONObject().put("uri",uri).put("title",name.replaceFirst("(?i)\\.mp4$","")).put("chapter",chapter).put("size",bytes).put("order",order).put("hash",hash).put("status","pending");}
    private static int natural(String a,String b){java.util.regex.Pattern p=java.util.regex.Pattern.compile("\\d+|\\D+");java.util.regex.Matcher x=p.matcher(a),y=p.matcher(b);while(x.find()&&y.find()){String l=x.group(),r=y.group();int n;if(Character.isDigit(l.charAt(0))&&Character.isDigit(r.charAt(0)))n=new java.math.BigInteger(l).compareTo(new java.math.BigInteger(r));else n=l.compareToIgnoreCase(r);if(n!=0)return n;}return a.compareToIgnoreCase(b);}
    private synchronized void start(String id,JSONArray sources,String categoryId,String seriesId,String title) throws Exception {
        if(sources.length()==0)throw new Exception("所选目录没有 MP4 视频");require("categories",categoryId);
        if(seriesId.isEmpty()){seriesId=hash(categoryId+"/"+title);if(find("series",seriesId)==null)arr("series").put(new JSONObject().put("id",seriesId).put("categoryId",categoryId).put("title",title).put("order",arr("series").length()));}else require("series",seriesId);
        List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<sources.length();i++)sorted.add(sources.getJSONObject(i));sorted.sort((a,b)->natural(a.optString("chapter")+"/"+a.optString("title"),b.optString("chapter")+"/"+b.optString("title")));
        sources=new JSONArray();long total=0;for(int i=0;i<sorted.size();i++){JSONObject s=sorted.get(i);s.put("order",i);sources.put(s);total+=s.optLong("size");}
        JSONObject t=new JSONObject().put("id",id).put("state","running").put("total",sources.length()).put("completed",0).put("duplicates",0).put("failed",0).put("bytes",0).put("totalBytes",total).put("errors",new JSONArray());
        remove("tasks",o->o.optString("id").equals(id));arr("tasks").put(t);state.getJSONObject("jobs").put(id,new JSONObject().put("seriesId",seriesId).put("sources",sources));persist();
    }
    private void validate(File file) throws Exception {
        MediaExtractor ex=new MediaExtractor();try{ex.setDataSource(file.getAbsolutePath());boolean video=false;for(int i=0;i<ex.getTrackCount();i++){String mime=ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);if(mime!=null&&mime.startsWith("video/")){if(!mime.equals("video/avc"))throw new Exception("视频编码不兼容，请转为 H.264 + AAC MP4 后导入");video=true;}if(mime!=null&&mime.startsWith("audio/")&&!mime.equals("audio/mp4a-latm"))throw new Exception("声音编码不兼容，请转为 AAC 后导入");}if(!video)throw new Exception("文件没有可播放的视频轨道，请检查原文件");}finally{ex.release();}
    }
    private void process(String id) throws Exception {
        JSONObject job; synchronized(this){job=state.getJSONObject("jobs").getJSONObject(id);}JSONArray sources=job.getJSONArray("sources");
        for(int i=0;i<sources.length();i++){
            if(cancelled)break;JSONObject s=sources.getJSONObject(i);if(s.optString("status").equals("done"))continue;
            File partial=new File(media,id+".part");File inputFile=null;
            synchronized(this){require("tasks",id).put("current",s.optString("title"));persist();}
            try{
                String uri=s.getString("uri");boolean staged=uri.startsWith("staged:");long length=s.optLong("size");
                if(staged){String h=s.getString("hash");if(!h.matches("[a-f0-9]{64}"))throw new Exception("清单校验值无效");inputFile=new File(staging,h+".mp4");if(!inputFile.isFile()){File existing=new File(media,h+".mp4");if(existing.isFile())inputFile=existing;else throw new Exception("暂存视频未传输完成，请重新运行电脑预置");}}
                if(!staged&&media.getUsableSpace()<length+32L*1024*1024)throw new Exception("空间不足，请释放空间后重试");
                MessageDigest digest=MessageDigest.getInstance("SHA-256");long bytes=0;
                try(InputStream in=staged?new FileInputStream(inputFile):getContext().getContentResolver().openInputStream(Uri.parse(uri));OutputStream out=staged?new OutputStream(){@Override public void write(int b){} @Override public void write(byte[] b,int o,int n){}}:new FileOutputStream(partial)){
                    if(in==null)throw new Exception("原文件不可访问，请重新选择导入");byte[] buffer=new byte[256*1024];int n;while((n=in.read(buffer))!=-1){if(cancelled)throw new InterruptedIOException("导入已取消");digest.update(buffer,0,n);out.write(buffer,0,n);bytes+=n;}
                }
                String h=hex(digest.digest());if(!s.optString("hash").isEmpty()&&!s.getString("hash").equals(h))throw new Exception("校验失败，请重新传输此视频");if(length>0&&bytes!=length)throw new Exception("文件大小不符，请重新传输");
                File checked=staged?inputFile:partial;validate(checked);File target=new File(media,h+".mp4");
                if(!checked.equals(target)){ android.system.Os.rename(checked.getAbsolutePath(),target.getAbsolutePath()); }
                synchronized(this){
                    String sid=job.getString("seriesId"),path=s.optString("chapter"),cid=hash(sid+"/"+path),vid=hash(cid+"/"+h);
                    if(find("chapters",cid)==null)arr("chapters").put(new JSONObject().put("id",cid).put("seriesId",sid).put("path",path).put("title",path.isEmpty()?"全部视频":path).put("order",arr("chapters").length()));
                    JSONObject task=require("tasks",id);boolean duplicate=find("videos",vid)!=null;
                    if(!duplicate)arr("videos").put(new JSONObject().put("id",vid).put("chapterId",cid).put("title",s.getString("title")).put("hash",h).put("size",bytes).put("order",s.getInt("order")));
                    s.put("hash",h).put("status","done");task.put("completed",task.getInt("completed")+1).put("bytes",task.getLong("bytes")+bytes);if(duplicate)task.put("duplicates",task.getInt("duplicates")+1);persist();
                }
            }catch(Exception e){if(cancelled)break;synchronized(this){JSONObject t=require("tasks",id);s.put("status","failed");t.put("failed",t.getInt("failed")+1);t.getJSONArray("errors").put(s.optString("title")+"："+e.getMessage());persist();}}
            finally{partial.delete();}
        }
        synchronized(this){require("tasks",id).put("state",cancelled?"cancelled":"completed").put("current","");persist();}
    }
    @PluginMethod public synchronized void cancel(PluginCall c){reply(c,()->{
        String id=c.getString("taskId");JSONObject task=require("tasks",id);
        if(Arrays.asList("running","scanning").contains(task.optString("state"))){
            task.put("state","cancelled");persist();if(active.equals(id))cancelled=true;
        }
    });}
    @PluginMethod public synchronized void retry(PluginCall c){try{if(!active.isEmpty())throw new Exception("已有导入任务，请稍后重试");String id=c.getString("taskId");if(!state.getJSONObject("jobs").has(id))throw new Exception("扫描尚未完成，请重新选择原文件夹导入");require("series",state.getJSONObject("jobs").getJSONObject(id).getString("seriesId"));JSONObject t=require("tasks",id);t.put("failed",0).put("errors",new JSONArray()).put("state","running");persist();active=id;cancelled=false;c.resolve();worker.execute(()->{try{process(id);}catch(Exception e){finishError(id,e);}finally{active="";}});}catch(Exception e){c.reject(e.getMessage(),e);}}
    private synchronized void finishError(String id,Exception e){try{JSONObject t=require("tasks",id);t.put("state",cancelled?"cancelled":"interrupted");t.getJSONArray("errors").put(e.getMessage());persist();}catch(Exception ignored){} }
    @PluginMethod public void receiveProvisioned(PluginCall c){
        synchronized(this){if(!active.isEmpty()){c.resolve();return;}File manifest=new File(staging,"manifest.json");if(!manifest.isFile()){c.resolve();return;}active=UUID.randomUUID().toString();cancelled=false;}
        String id=active;worker.execute(()->{try{
            File manifest=new File(staging,"manifest.json");if(manifest.length()>8*1024*1024)throw new Exception("预置清单过大");JSONObject m=new JSONObject(new String(Files.readAllBytes(manifest.toPath()),StandardCharsets.UTF_8));if(m.getInt("version")!=1)throw new Exception("预置清单版本不支持");
            // One task per series; all jobs are durable before the manifest is removed.
            List<String> ids=new ArrayList<>();JSONArray sets=m.getJSONArray("series");synchronized(this){for(int j=0;j<sets.length();j++){JSONObject set=sets.getJSONObject(j);String tid=j==0?id:UUID.randomUUID().toString();JSONArray entries=set.getJSONArray("videos"),sources=new JSONArray();for(int n=0;n<entries.length();n++){JSONObject e=entries.getJSONObject(n);sources.put(source("staged:",e.getString("title")+".mp4",e.optString("chapter"),e.getLong("size"),n,e.getString("hash")));}String cat=set.optString("categoryId","category-other");start(tid,sources,cat,set.optString("seriesId",""),set.getString("title"));ids.add(tid);}manifest.delete();}
            JSObject out=new JSObject();out.put("taskId",id);c.resolve(out);for(String tid:ids){synchronized(this){if(require("tasks",tid).optString("state").equals("cancelled"))continue;active=tid;cancelled=false;}try{process(tid);}catch(Exception e){finishError(tid,e);}}
        }catch(Exception e){c.reject(e.getMessage(),e);}finally{active="";}});
    }
    @PluginMethod public synchronized void update(PluginCall c){reply(c,()->{
        String key;switch(c.getString("kind","")){case "category":key="categories";break;case "series":key="series";break;case "chapter":key="chapters";break;case "video":key="videos";break;default:throw new Exception("不支持的目录类型");}
        String id=c.getString("id","");JSONObject o;if(id.isEmpty()&&key.equals("categories")){o=new JSONObject().put("id",UUID.randomUUID().toString()).put("order",arr(key).length());arr(key).put(o);}else o=require(key,id);
        String title=c.getString("title");if(title!=null){if(title.trim().isEmpty()||title.length()>180)throw new Exception("请输入1–180字的名称");o.put("title",title.trim());}if(c.getInt("order")!=null)o.put("order",Math.max(0,c.getInt("order")));if(key.equals("series")&&c.getString("categoryId")!=null){require("categories",c.getString("categoryId"));o.put("categoryId",c.getString("categoryId"));}persist();
    });}
    // WebView seeks even error bodies before applying our HTTP status.
    private InputStream emptyResponseStream(){return new ByteArrayInputStream(new byte[0]){@Override public long skip(long bytes){return Math.max(0,bytes);}};}
    synchronized android.webkit.WebResourceResponse serve(android.webkit.WebResourceRequest request) {
        Map<String,String> headers=new HashMap<>();headers.put("Accept-Ranges","bytes");headers.put("Cache-Control","no-store");
        File file=null;
        try {
            String path=request.getUrl().getPath();
            for(int i=0;i<arr("videos").length();i++){JSONObject v=arr("videos").getJSONObject(i);File f=new File(media,v.getString("hash")+".mp4");if(("/_capacitor_file_"+f.getAbsolutePath()).equals(path)){file=f;break;}}
            if(file==null||!file.isFile())return new android.webkit.WebResourceResponse("text/plain",null,404,"Not Found",headers,emptyResponseStream());
            String range=null;for(Map.Entry<String,String> h:request.getRequestHeaders().entrySet())if(h.getKey().equalsIgnoreCase("Range"))range=h.getValue();
            VideoByteRange bounds=VideoByteRange.parse(range,file.length());headers.put("Content-Length",Long.toString(bounds.length()));
            if(range!=null)headers.put("Content-Range","bytes "+bounds.start+"-"+bounds.end+"/"+file.length());
            InputStream stream;
            if(request.getMethod().equals("HEAD"))stream=emptyResponseStream();
            else stream=new VideoRangeInputStream(file,bounds);
            return new android.webkit.WebResourceResponse("video/mp4",null,range==null?200:206,range==null?"OK":"Partial Content",headers,stream);
        }catch(IllegalArgumentException error){headers.put("Content-Range","bytes */"+(file==null?0:file.length()));return new android.webkit.WebResourceResponse("text/plain",null,416,"Range Not Satisfiable",headers,emptyResponseStream());}
        catch(Exception error){android.util.Log.e("VideoRange", "视频范围读取失败", error);return new android.webkit.WebResourceResponse("text/plain",null,404,"Not Found",headers,emptyResponseStream());}
    }
    @PluginMethod public synchronized void playback(PluginCall c){try{JSONObject v=require("videos",c.getString("id"));File f=new File(media,v.getString("hash")+".mp4");if(!f.isFile())throw new Exception("视频文件缺失，请从原文件重新导入，进度会保留");JSObject out=new JSObject();out.put("path",Uri.fromFile(f).toString());c.resolve(out);}catch(Exception e){c.reject(e.getMessage(),e);}}
    @PluginMethod public synchronized void saveProgress(PluginCall c){reply(c,()->{String id=c.getString("id");require("videos",id);double p=c.getDouble("position",0d),d=c.getDouble("duration",0d);if(!Double.isFinite(p)||!Double.isFinite(d))throw new Exception("无效的播放位置");remove("progress",o->o.optString("id").equals(id));arr("progress").put(new JSONObject().put("id",id).put("position",Math.max(0,d>0?Math.min(p,d):p)).put("duration",Math.max(0,d)).put("viewed",c.getBoolean("viewed",false)).put("updatedAt",System.currentTimeMillis()));persist();});}
    @PluginMethod public synchronized void bookmark(PluginCall c){reply(c,()->{String id=c.getString("id");if(id==null||id.isEmpty())throw new Exception("书签标识缺失");if(!Boolean.TRUE.equals(c.getBoolean("remove"))){require("videos",c.getString("videoId"));double p=c.getDouble("position",0d);if(!Double.isFinite(p)||p<0)throw new Exception("书签位置无效");remove("bookmarks",o->o.optString("id").equals(id));arr("bookmarks").put(new JSONObject().put("id",id).put("videoId",c.getString("videoId")).put("position",p).put("title",c.getString("title","书签")));}else remove("bookmarks",o->o.optString("id").equals(id));persist();});}
    @PluginMethod public synchronized void deleteSeries(PluginCall c){reply(c,()->deleteRecords("series",c.getString("id")));}
    @PluginMethod public synchronized void deleteContent(PluginCall c){reply(c,()->deleteRecords(c.getString("kind"),c.getString("id")));}
    private void deleteRecords(String kind,String id) throws Exception {
        if(!active.isEmpty())throw new Exception("请等导入完成后再删除内容");
        Set<String> chapters=new HashSet<>(),videos=new HashSet<>(),affectedSeries=new HashSet<>();
        if("series".equals(kind)){require("series",id);affectedSeries.add(id);}
        else if("chapter".equals(kind)){JSONObject ch=require("chapters",id);chapters.add(id);affectedSeries.add(ch.getString("seriesId"));}
        else if("video".equals(kind)){JSONObject v=require("videos",id);videos.add(id);affectedSeries.add(require("chapters",v.getString("chapterId")).getString("seriesId"));}
        else throw new Exception("不支持的删除类型");
        if("series".equals(kind))for(int i=0;i<arr("chapters").length();i++){JSONObject ch=arr("chapters").getJSONObject(i);if(ch.optString("seriesId").equals(id))chapters.add(ch.getString("id"));}
        for(int i=0;i<arr("videos").length();i++){JSONObject v=arr("videos").getJSONObject(i);if(chapters.contains(v.optString("chapterId")))videos.add(v.getString("id"));}
        // Remove only sources that could restore deleted content; retain unrelated failures.
        JSONObject jobs=state.getJSONObject("jobs");Set<String> retired=new HashSet<>();Iterator<String> it=jobs.keys();
        while(it.hasNext()){
            String jid=it.next();JSONObject job=jobs.getJSONObject(jid);String sid=job.optString("seriesId");
            if(!affectedSeries.contains(sid))continue;
            if("series".equals(kind)){retired.add(jid);continue;}
            JSONArray sources=job.getJSONArray("sources"),kept=new JSONArray();Set<String> removedTitles=new HashSet<>();
            for(int n=0;n<sources.length();n++){
                JSONObject source=sources.getJSONObject(n);String cid=hash(sid+"/"+source.optString("chapter"));boolean deleted=chapters.contains(cid);
                if(!deleted)for(String vid:videos){JSONObject v=require("videos",vid);if(v.optString("chapterId").equals(cid)&&(v.optString("hash").equals(source.optString("hash"))||(source.optString("hash").isEmpty()&&v.optString("title").equals(source.optString("title"))))){deleted=true;break;}}
                if(deleted)removedTitles.add(source.optString("title"));else kept.put(source);
            }
            if(kept.length()==sources.length())continue;
            if(kept.length()==0){retired.add(jid);continue;}
            job.put("sources",kept);JSONObject task=require("tasks",jid);int done=0,failed=0;long bytes=0,totalBytes=0;
            for(int n=0;n<kept.length();n++){JSONObject source=kept.getJSONObject(n);long size=source.optLong("size");totalBytes+=size;if(source.optString("status").equals("done")){done++;bytes+=size;}if(source.optString("status").equals("failed"))failed++;}
            JSONArray errors=new JSONArray(),old=task.getJSONArray("errors");for(int n=0;n<old.length();n++){String error=old.getString(n);boolean removed=false;for(String title:removedTitles)if(error.startsWith(title+"：")){removed=true;break;}if(!removed)errors.put(error);}
            task.put("total",kept.length()).put("completed",done).put("failed",failed).put("bytes",bytes).put("totalBytes",totalBytes).put("duplicates",Math.min(done,task.optInt("duplicates"))).put("errors",errors);
        }
        for(String jid:retired)jobs.remove(jid);remove("tasks",o->retired.contains(o.optString("id")));
        if("series".equals(kind))remove("series",o->o.optString("id").equals(id));remove("chapters",o->chapters.contains(o.optString("id")));remove("videos",o->videos.contains(o.optString("id")));remove("progress",o->videos.contains(o.optString("id")));remove("bookmarks",o->videos.contains(o.optString("videoId")));persist();
        Set<String> hashes=new HashSet<>();for(int i=0;i<arr("videos").length();i++)hashes.add(arr("videos").getJSONObject(i).getString("hash"));File[] files=media.listFiles((d,n)->n.endsWith(".mp4"));if(files!=null)for(File f:files)if(!hashes.contains(f.getName().replace(".mp4","")))f.delete();
    }
}
