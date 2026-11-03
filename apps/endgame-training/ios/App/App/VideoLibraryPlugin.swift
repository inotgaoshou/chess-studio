import Capacitor
import UIKit
import UniformTypeIdentifiers
import SQLite3
import CryptoKit
import AVFoundation

private func videoError(_ message: String) -> NSError { NSError(domain: "VideoLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
private let videoTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// A separate SQLite snapshot and content-addressed media directory; no video data on the bridge.
@objc(VideoLibraryPlugin)
final class VideoLibraryPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "VideoLibraryPlugin"
    let jsName = "VideoLibrary"
    let pluginMethods: [CAPPluginMethod] = ["snapshot", "exportMetadata", "pick", "receiveProvisioned", "cancel", "retry", "update", "deleteSeries", "deleteContent", "playback", "saveProgress", "bookmark"].compactMap { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let lock = NSRecursiveLock()
    private let worker = DispatchQueue(label: "cn.xiangqi.video-import", qos: .utility)
    private var database: OpaquePointer?
    private var state: [String: Any] = [:]
    private var committed: Data?
    private var openingError: Error?
    private var active = "" { didSet { updateImportIdleTimer() } }
    private var previousIdleTimerDisabled: Bool?
    private var cancelled = false
    private var backgroundObserver: NSObjectProtocol?
    private var pickerCall: CAPPluginCall?
    private var root: URL!
    private var media: URL { root.appendingPathComponent("media", isDirectory: true) }
    private var staging: URL { root.appendingPathComponent("staging", isDirectory: true) }
    private let keys = ["categories", "series", "chapters", "videos", "progress", "bookmarks", "tasks"]

    override func load() {
        backgroundObserver=NotificationCenter.default.addObserver(forName:UIApplication.willResignActiveNotification,object:nil,queue:.main){[weak self] _ in self?.notifyListeners("background",data:[:])}
        do {
            root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("VideoLibrary", isDirectory: true)
            try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
            var excluded = root!; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
            guard sqlite3_open(root.appendingPathComponent("library.sqlite").path, &database) == SQLITE_OK else { throw videoError("视频库无法打开，请检查存储空间") }
            try sql("PRAGMA journal_mode=WAL"); try sql("CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)")
            var stmt: OpaquePointer?; defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(database, "SELECT json FROM library WHERE id=1", -1, &stmt, nil) == SQLITE_OK else { throw videoError("无法读取视频数据库") }
            if sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) { state = try JSONSerialization.jsonObject(with: Data(String(cString: text).utf8)) as? [String: Any] ?? [:] }
            for key in keys where state[key] == nil { state[key] = [[String: Any]]() }
            if state["jobs"] == nil { state["jobs"] = [String: Any]() }
            if list("categories").isEmpty { state["categories"] = [("opening","布局"),("middle","中局"),("endgame","残局"),("other","其他")].enumerated().map { ["id":"category-\($0.element.0)","title":$0.element.1,"order":$0.offset] as [String:Any] } }
            state["tasks"] = list("tasks").map { task -> [String:Any] in var t=task; if ["running","scanning"].contains(t["state"] as? String ?? "") { t["state"]="interrupted" }; return t }
            for file in try FileManager.default.contentsOfDirectory(at: media, includingPropertiesForKeys: nil) where file.pathExtension == "part" { try? FileManager.default.removeItem(at:file) }
            try persist()
        } catch { openingError = error }
    }
    deinit {
        if let observer=backgroundObserver{NotificationCenter.default.removeObserver(observer)}
        if let previous=previousIdleTimerDisabled { DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled=previous } }
        sqlite3_close(database)
    }
    private func updateImportIdleTimer() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.locked({!self.active.isEmpty}) {
                if self.previousIdleTimerDisabled == nil { self.previousIdleTimerDisabled=UIApplication.shared.isIdleTimerDisabled }
                UIApplication.shared.isIdleTimerDisabled=true
            } else if let previous=self.previousIdleTimerDisabled {
                UIApplication.shared.isIdleTimerDisabled=previous
                self.previousIdleTimerDisabled=nil
            }
        }
    }
    private func sql(_ sql: String) throws { guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw videoError("视频库写入失败，请释放本机空间后重试") } }
    private func persist() throws {
        let data = try JSONSerialization.data(withJSONObject: state)
        let text = String(decoding: data, as: UTF8.self)
        var stmt: OpaquePointer?; defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(database,"INSERT OR REPLACE INTO library(id,json) VALUES(1,?)",-1,&stmt,nil) == SQLITE_OK else { throw videoError("无法保存视频数据库") }
        sqlite3_bind_text(stmt,1,text,-1,videoTransient)
        guard sqlite3_step(stmt) == SQLITE_DONE else { rollback(); throw videoError("保存失败，请释放存储空间后重试") }
        committed=data
        if let jobs=state["jobs"] as? [String:[String:Any]],let task=list("tasks").last(where:{jobs[$0["id"] as? String ?? ""]?["migration"] != nil}),let id=task["id"] as? String,let receipt=jobs[id]?["receipt"] as? String {
            let status:[String:Any]=["receipt":receipt,"requestId":jobs[id]?["requestId"] ?? "","replayed":jobs[id]?["replayed"] ?? false,"state":task["state"] ?? "interrupted","completed":task["completed"] ?? 0,"total":task["total"] ?? 0,"error":task["errors"] ?? []]
            if let bytes=try? JSONSerialization.data(withJSONObject:status){try? bytes.write(to:root.appendingPathComponent("migration-status.json"),options:.atomic)}
        }
        var receipt=[String:Int64]()
        for video in list("videos") { if let h=video["hash"] as? String,let size=video["size"] as? NSNumber,let attrs=try? FileManager.default.attributesOfItem(atPath:media.appendingPathComponent(h+".mp4").path),let actual=attrs[.size] as? NSNumber,actual.int64Value==size.int64Value {receipt[h]=actual.int64Value} }
        if let bytes=try? JSONSerialization.data(withJSONObject:receipt){try? bytes.write(to:root.appendingPathComponent("inventory.json"),options:.atomic)}
    }
    private func rollback() { if let data=committed,let saved=try? JSONSerialization.jsonObject(with:data) as? [String:Any] {state=saved} }
    private func list(_ key:String) -> [[String:Any]] { state[key] as? [[String:Any]] ?? [] }
    private func find(_ key:String,_ id:String) -> [String:Any]? { list(key).first { $0["id"] as? String == id } }
    private func require(_ key:String,_ id:String) throws -> [String:Any] { guard let item=find(key,id) else { throw videoError("记录不存在，请重新打开视频库") }; return item }
    private func put(_ key:String,_ item:[String:Any]) { var a=list(key); if let i=a.firstIndex(where:{$0["id"] as? String == item["id"] as? String}) { a[i]=item } else { a.append(item) }; state[key]=a }
    private func remove(_ key:String,_ predicate:([String:Any])->Bool) { state[key]=list(key).filter{ !predicate($0) } }
    private func locked<T>(_ action:() throws -> T) rethrows -> T { lock.lock(); defer{lock.unlock()}; return try action() }
    private func respond(_ call:CAPPluginCall,_ action:() throws -> [String:Any]) { do { try locked { if let error=openingError { throw error }; call.resolve(try action()) } } catch { locked{rollback()};call.reject(error.localizedDescription) } }
    private func digest(_ value:String) -> String { SHA256.hash(data:Data(value.utf8)).map{String(format:"%02x",$0)}.joined() }
    private func isCancelled() -> Bool { locked { cancelled } }
    @objc func snapshot(_ call:CAPPluginCall) { respond(call) { Dictionary(uniqueKeysWithValues: self.keys.map{($0,self.list($0))}) } }
    @objc func exportMetadata(_ call:CAPPluginCall) {respond(call){
        guard active.isEmpty else{throw videoError("请等待导入完成后导出迁移资料")}
        let metadata=try VideoMigration.metadata(state)
        try JSONSerialization.data(withJSONObject:metadata).write(to:root.appendingPathComponent("migration-export.json"),options:.atomic)
        return metadata
    }}
    private func startMigration(_ id:String,_ manifest:[String:Any]) throws {
        guard let migration=manifest["migration"] as? [String:Any],let input=migration["metadata"] as? [String:Any],let receipt=migration["receipt"] as? String,receipt.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else{throw videoError("迁移清单无效")}
        let metadata=try VideoMigration.metadata(input),videos=metadata["videos"] as? [[String:Any]] ?? []
        put("tasks",["id":id,"state":"running","total":videos.count,"completed":0,"duplicates":0,"failed":0,"bytes":0,"totalBytes":videos.reduce(Int64(0)){$0+(($1["size"] as? NSNumber)?.int64Value ?? 0)},"errors":[String]()])
        var jobs=state["jobs"] as? [String:Any] ?? [:];jobs[id]=["migration":metadata,"receipt":receipt,"requestId":manifest["requestId"] as? String ?? id,"replayed":(state["migrationReceipts"] as? [String:Bool])?[receipt]==true];state["jobs"]=jobs;try persist()
    }
    private func processMigration(_ id:String) throws {
        let j=try locked{try job(id)}
        guard let metadata=j["migration"] as? [String:Any],let receipt=j["receipt"] as? String else{throw videoError("迁移任务缺失")}
        for (i,v) in (metadata["videos"] as? [[String:Any]] ?? []).enumerated() {
            if isCancelled(){throw videoError("迁移已取消，可重试")}
            let h=v["hash"] as? String ?? "",target=media.appendingPathComponent(h+".mp4"),staged=staging.appendingPathComponent(h+".mp4")
            let file=FileManager.default.fileExists(atPath:staged.path) ? staged : target
            guard let expected=v["size"] as? NSNumber,let attrs=try? FileManager.default.attributesOfItem(atPath:file.path),let size=attrs[.size] as? NSNumber,size.int64Value==expected.int64Value else{throw videoError("迁移视频缺失或大小不符，请重新传输")}
            let input=try FileHandle(forReadingFrom:file);var hash=SHA256()
            do{while let data=try input.read(upToCount:256*1024),!data.isEmpty{if isCancelled(){throw videoError("迁移已取消")};hash.update(data:data)};try input.close()}catch{try? input.close();throw error}
            guard hash.finalize().map({String(format:"%02x",$0)}).joined()==h else{throw videoError("迁移视频校验失败，请重新传输")}
            try validate(file)
            if file != target {guard rename(file.path,target.path)==0 else{throw videoError("迁移保存失败，请检查空间")}}
            try locked{var task=try require("tasks",id);task["completed"]=i+1;task["current"]=v["title"];put("tasks",task);try persist()}
        }
        try locked{if cancelled{throw videoError("迁移已取消")};state=try VideoMigration.merge(state,metadata,receipt);var task=try require("tasks",id);task["state"]="completed";task["current"]="";put("tasks",task);try persist()}
    }
    @objc func pick(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.locked({self.active.isEmpty}), self.pickerCall == nil else { call.reject("已有导入任务，请稍后再试"); return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: call.getBool("folder",false) ? [.folder] : [.mpeg4Movie], asCopy:false)
            picker.allowsMultipleSelection = !call.getBool("folder",false); picker.delegate=self; self.pickerCall=call
            self.bridge?.viewController?.present(picker,animated:true)
        }
    }
    func documentPickerWasCancelled(_ controller:UIDocumentPickerViewController) { pickerCall?.resolve(); pickerCall=nil }
    func documentPicker(_ controller:UIDocumentPickerViewController,didPickDocumentsAt urls:[URL]) {
        guard let call=pickerCall else{return};pickerCall=nil
        let id=UUID().uuidString
        guard locked({ if !active.isEmpty {return false};active=id;cancelled=false;return true }) else {call.reject("已有导入任务");return}
        do { try locked { put("tasks",["id":id,"state":"scanning","total":0,"completed":0,"duplicates":0,"failed":0,"bytes":0,"totalBytes":0,"errors":[String]()]);try persist() };call.resolve(["taskId":id]) } catch {locked{active=""};call.reject(error.localizedDescription);return}
        worker.async {
            defer { self.locked { self.active="" } }
            do {
                var sources=[[String:Any]](); var title=call.getString("seriesTitle","")
                for url in urls {
                    let access=url.startAccessingSecurityScopedResource(); defer{if access{url.stopAccessingSecurityScopedResource()}}
                    let bookmark=try url.bookmarkData(options:[],includingResourceValuesForKeys:nil,relativeTo:nil).base64EncodedString()
                    if call.getBool("folder",false) {
                        if title.isEmpty { title=url.lastPathComponent }
                        guard let enumerator=FileManager.default.enumerator(at:url,includingPropertiesForKeys:[.isRegularFileKey,.fileSizeKey],options:[.skipsHiddenFiles,.skipsPackageDescendants]) else {throw videoError("文件夹无法访问，请重新选择并允许访问")}
                        for case let file as URL in enumerator where file.pathExtension.lowercased()=="mp4" {
                            if self.isCancelled(){throw videoError("选择已取消")}
                            let rel=String(file.path.dropFirst(url.path.count+1)); let chapter=(rel as NSString).deletingLastPathComponent
                            let item=try self.source(file,chapter:chapter,bookmark:bookmark,relative:rel);sources.append(item)
                            try self.locked{var t=try self.require("tasks",id);t["total"]=sources.count;t["totalBytes"]=(t["totalBytes"] as? NSNumber)?.int64Value ?? 0;t["totalBytes"]=(t["totalBytes"] as? Int64 ?? 0)+((item["size"] as? NSNumber)?.int64Value ?? 0);t["current"]=item["title"];self.put("tasks",t);try self.persist()}
                        }
                    } else if url.pathExtension.lowercased()=="mp4" {sources.append(try self.source(url,chapter:"",bookmark:bookmark,relative:""))}
                }
                if title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty{title="导入视频"}
                try self.locked {try self.start(id,sources:sources,category:call.getString("categoryId","category-other"),series:call.getString("seriesId",""),title:title)}
                try self.process(id)
            } catch { self.finishError(id,error) }
        }
    }
    private func source(_ url:URL,chapter:String,bookmark:String,relative:String) throws -> [String:Any] {
        let values=try url.resourceValues(forKeys:[.fileSizeKey,.isRegularFileKey]);guard values.isRegularFile == true else{throw videoError("请选择完整的 MP4 文件")}
        return ["uri":url.absoluteString,"bookmark":bookmark,"relative":relative,"title":url.deletingPathExtension().lastPathComponent,"chapter":chapter,"size":values.fileSize ?? 0,"hash":"","status":"pending"]
    }
    private func start(_ id:String,sources:[[String:Any]],category:String,series:String,title:String) throws {
        guard !sources.isEmpty else{throw videoError("所选目录没有 MP4 视频")};_ = try require("categories",category)
        let sid=series.isEmpty ? digest(category+"/"+title) : series
        if series.isEmpty { if find("series",sid)==nil {put("series",["id":sid,"title":title,"categoryId":category,"order":list("series").count])} } else {_ = try require("series",sid)}
        let ordered=sources.sorted { (($0["chapter"] as? String ?? "")+"/"+($0["title"] as? String ?? "")).compare((($1["chapter"] as? String ?? "")+"/"+($1["title"] as? String ?? "")),options:[.numeric,.caseInsensitive]) == .orderedAscending }.enumerated().map{ index,item -> [String:Any] in var s=item;s["order"]=index;return s }
        put("tasks",["id":id,"state":"running","total":ordered.count,"completed":0,"duplicates":0,"failed":0,"bytes":0,"totalBytes":ordered.reduce(Int64(0)){$0+(($1["size"] as? NSNumber)?.int64Value ?? 0)},"errors":[String]()])
        var jobs=state["jobs"] as? [String:Any] ?? [:]; jobs[id]=["seriesId":sid,"sources":ordered];state["jobs"]=jobs;try persist()
    }
    private func job(_ id:String) throws -> [String:Any] {guard let jobs=state["jobs"] as? [String:Any],let job=jobs[id] as? [String:Any] else{throw videoError("扫描尚未完成，请重新选择原文件夹导入")};return job}
    private func setSource(_ id:String,index:Int,source:[String:Any]) throws {var j=try job(id);var sources=j["sources"] as? [[String:Any]] ?? [];sources[index]=source;j["sources"]=sources;var jobs=state["jobs"] as? [String:Any] ?? [:];jobs[id]=j;state["jobs"]=jobs}
    private func validate(_ url:URL) throws {
        let asset=AVURLAsset(url:url);let video=asset.tracks(withMediaType:.video)
        guard !video.isEmpty else{throw videoError("文件没有可播放的视频轨道，请检查原文件")}
        for track in video {for description in track.formatDescriptions {let format=description as! CMFormatDescription;guard CMFormatDescriptionGetMediaSubType(format)==kCMVideoCodecType_H264 else{throw videoError("视频编码不兼容，请转为 H.264 + AAC MP4 后导入")}}}
        for track in asset.tracks(withMediaType:.audio) {for description in track.formatDescriptions {let format=description as! CMFormatDescription;guard CMFormatDescriptionGetMediaSubType(format)==kAudioFormatMPEG4AAC else{throw videoError("音频编码不兼容，请转为 AAC 后导入")}}}
    }
    private func process(_ id:String) throws {
        if try locked({try job(id)["migration"] != nil}) {try processMigration(id);return}
        let j=try locked{try job(id)};let sources=j["sources"] as? [[String:Any]] ?? []
        for (index,original) in sources.enumerated() {
            if isCancelled(){break};if original["status"] as? String == "done"{continue};var s=original
            let partial=media.appendingPathComponent(id+".part");defer{try? FileManager.default.removeItem(at:partial)}
            try locked{var t=try require("tasks",id);t["current"]=s["title"];put("tasks",t);try persist()}
            do {
                let staged=s["uri"] as? String == "staged:";let expected=s["hash"] as? String ?? "";var accessURL:URL?;var input:URL
                if staged {
                    guard expected.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else{throw videoError("预置校验值无效")}
                    input=staging.appendingPathComponent(expected+".mp4");if !FileManager.default.fileExists(atPath:input.path){input=media.appendingPathComponent(expected+".mp4")}
                } else {
                    guard let data=Data(base64Encoded:s["bookmark"] as? String ?? "") else{throw videoError("原文件授权缺失，请重新选择导入")}
                    var stale=false;let selected=try URL(resolvingBookmarkData:data,options:[],relativeTo:nil,bookmarkDataIsStale:&stale)
                    _ = selected.startAccessingSecurityScopedResource(); accessURL=selected
                    let relative=s["relative"] as? String ?? "";input=relative.isEmpty ? selected : selected.appendingPathComponent(relative)
                }
                defer{accessURL?.stopAccessingSecurityScopedResource()}
                let size=(s["size"] as? NSNumber)?.int64Value ?? 0
                if !staged {let free=(try FileManager.default.attributesOfFileSystem(forPath:media.path)[.systemFreeSize] as? NSNumber)?.int64Value ?? 0;guard free>size+32*1024*1024 else{throw videoError("空间不足，请释放本机空间后重试")}}
                let handle=try FileHandle(forReadingFrom:input);defer{try? handle.close()}
                var output:FileHandle?
                if !staged {guard FileManager.default.createFile(atPath:partial.path,contents:nil) else{throw videoError("无法创建视频文件，请释放空间")};output=try FileHandle(forWritingTo:partial)}
                defer{try? output?.close()}
                var sha=SHA256();var bytes:Int64=0
                while let data=try handle.read(upToCount:256*1024),!data.isEmpty {if isCancelled(){throw videoError("导入已取消")};sha.update(data:data);try output?.write(contentsOf:data);bytes+=Int64(data.count)}
                try output?.synchronize();try output?.close();output=nil
                let h=sha.finalize().map{String(format:"%02x",$0)}.joined()
                guard expected.isEmpty || h==expected else{throw videoError("校验失败，请重新传输此视频")};guard size==0 || size==bytes else{throw videoError("文件大小不符，请重新传输")}
                let checked=staged ? input : partial;try validate(checked);let target=media.appendingPathComponent(h+".mp4")
                if checked != target { guard rename(checked.path,target.path)==0 else{throw videoError("无法保存视频，请检查本机空间后重试")} }
                try locked {
                    let sid=j["seriesId"] as? String ?? "",path=s["chapter"] as? String ?? "",cid=digest(sid+"/"+path),vid=digest(cid+"/"+h)
                    if find("chapters",cid)==nil {put("chapters",["id":cid,"seriesId":sid,"path":path,"title":path.isEmpty ? "全部视频" : path,"order":list("chapters").count])}
                    let duplicate=find("videos",vid) != nil
                    if !duplicate {put("videos",["id":vid,"chapterId":cid,"title":s["title"] ?? "视频","hash":h,"size":bytes,"order":s["order"] ?? index])}
                    var t=try require("tasks",id);t["completed"]=(t["completed"] as? Int ?? 0)+1;t["bytes"]=(t["bytes"] as? NSNumber)?.int64Value ?? 0;t["bytes"]=(t["bytes"] as? Int64 ?? 0)+bytes;if duplicate{t["duplicates"]=(t["duplicates"] as? Int ?? 0)+1}
                    s["hash"]=h;s["status"]="done";try setSource(id,index:index,source:s);put("tasks",t);try persist()
                }
            } catch {
                if isCancelled(){break}
                try locked {var t=try require("tasks",id);t["failed"]=(t["failed"] as? Int ?? 0)+1;var errors=t["errors"] as? [String] ?? [];errors.append("\(s["title"] as? String ?? "视频")：\(error.localizedDescription)");t["errors"]=errors;put("tasks",t);s["status"]="failed";try setSource(id,index:index,source:s);try persist()}
            }
        }
        try locked{var t=try require("tasks",id);t["state"]=cancelled ? "cancelled" : "completed";t["current"]="";put("tasks",t);try persist()}
    }
    private func finishError(_ id:String,_ error:Error) {try? locked{guard var t=find("tasks",id) else{return};t["state"]=cancelled ? "cancelled" : "interrupted";var errors=t["errors"] as? [String] ?? [];errors.append(error.localizedDescription);t["errors"]=errors;put("tasks",t);try persist()}}
    @objc func cancel(_ call:CAPPluginCall){respond(call){
        let id=call.getString("taskId","");var task=try require("tasks",id)
        if ["running","scanning"].contains(task["state"] as? String ?? "") {task["state"]="cancelled";put("tasks",task);try persist();if active==id{cancelled=true}}
        return [:]
    }}
    @objc func retry(_ call:CAPPluginCall){respond(call){guard active.isEmpty else{throw videoError("已有导入任务，请稍后再试")};let id=call.getString("taskId","");if try job(id)["migration"] == nil {_ = try require("series",try job(id)["seriesId"] as? String ?? "")};var t=try require("tasks",id);t["failed"]=0;t["errors"]=[String]();t["state"]="running";put("tasks",t);try persist();active=id;cancelled=false;worker.async{defer{self.locked{self.active=""}};do{try self.process(id)}catch{self.finishError(id,error)}};return [:]}}
    private var allowsLocalProvision:Bool {
        #if QIXI_LOCAL_VIDEO_PROVISION
        return true
        #else
        return false
        #endif
    }
    @objc func receiveProvisioned(_ call:CAPPluginCall) {
        guard allowsLocalProvision else{call.resolve();return}
        guard locked({active.isEmpty}) else{call.resolve();return}
        guard FileManager.default.fileExists(atPath:staging.appendingPathComponent("manifest.json").path) else {
            // A killed or upgraded app still has its verified files and pending staged sources.
            // Resume only interrupted computer installs; never restart a user's cancelled task.
            do {
                let ids: [String] = try locked {
                    guard active.isEmpty else { return [] }
                    let ids=list("tasks").filter { task in
                        guard task["state"] as? String == "interrupted",let id=task["id"] as? String,
                              let j=try? job(id) else {return false}
                        if j["migration"] != nil {return true}
                        guard let sid=j["seriesId"] as? String,find("series",sid) != nil,let sources=j["sources"] as? [[String:Any]],!sources.isEmpty else { return false }
                        return sources.allSatisfy { $0["uri"] as? String == "staged:" }
                    }.compactMap { $0["id"] as? String }
                    if let first=ids.first {
                        for id in ids {var t=try require("tasks",id);t["state"]="running";t["failed"]=0;t["errors"]=[String]();put("tasks",t)}
                        try persist();active=first;cancelled=false
                    }
                    return ids
                }
                if !ids.isEmpty {
                    worker.async {
                        defer { self.locked { self.active="" } }
                        for id in ids {
                            let skip=self.locked {if self.find("tasks",id)?["state"] as? String == "cancelled"{return true};self.active=id;self.cancelled=false;return false}
                            if skip { continue }
                            do {try self.process(id)} catch {self.finishError(id,error)}
                        }
                    }
                }
                call.resolve()
            } catch { call.reject(error.localizedDescription) }
            return
        }
        let id=UUID().uuidString;locked{active=id;cancelled=false}
        worker.async {
            defer{self.locked{self.active=""}}
            do {
                let file=self.staging.appendingPathComponent("manifest.json");let bytes=try Data(contentsOf:file);guard bytes.count<8*1024*1024,let manifest=try JSONSerialization.jsonObject(with:bytes) as? [String:Any],[1,2].contains(manifest["version"] as? Int ?? 0) else{throw videoError("预置清单无效或版本不支持")}
                if manifest["version"] as? Int == 2 {
                    try self.locked{try self.startMigration(id,manifest);try FileManager.default.removeItem(at:file)}
                    call.resolve(["taskId":id]);do{try self.processMigration(id)}catch{self.finishError(id,error)};return
                }
                guard let series=manifest["series"] as? [[String:Any]] else{throw videoError("预置系列缺失")}
                var ids=[String]()
                try self.locked {for (i,set) in series.enumerated(){let tid=i==0 ? id : UUID().uuidString;let sources=(set["videos"] as? [[String:Any]] ?? []).map{entry -> [String:Any] in var s=entry;s["uri"]="staged:";s["status"]="pending";return s};try self.start(tid,sources:sources,category:set["categoryId"] as? String ?? "category-other",series:set["seriesId"] as? String ?? "",title:set["title"] as? String ?? "预置视频");ids.append(tid)};try FileManager.default.removeItem(at:file)}
                call.resolve(["taskId":id]);for tid in ids {let skip=self.locked{if self.find("tasks",tid)?["state"] as? String == "cancelled"{return true};self.active=tid;self.cancelled=false;return false};if skip{continue};do{try self.process(tid)}catch{self.finishError(tid,error)}}
            } catch {call.reject(error.localizedDescription)}
        }
    }
    @objc func update(_ call:CAPPluginCall){respond(call){guard let key=["category":"categories","series":"series","chapter":"chapters","video":"videos"][call.getString("kind","")] else{throw videoError("目录类型无效")};let id=call.getString("id","");var o:[String:Any];if id.isEmpty && key=="categories"{o=["id":UUID().uuidString,"order":list(key).count]}else{o=try require(key,id)};if let title=call.getString("title"){let name=title.trimmingCharacters(in:.whitespacesAndNewlines);guard !name.isEmpty && name.count<=180 else{throw videoError("请输入1–180字的名称")};o["title"]=name};if let order=call.getInt("order"){o["order"]=max(0,order)};if key=="series",let cat=call.getString("categoryId"){_ = try require("categories",cat);o["categoryId"]=cat};put(key,o);try persist();return [:]}}
    @objc func playback(_ call:CAPPluginCall){respond(call){let v=try require("videos",call.getString("id",""));let f=media.appendingPathComponent((v["hash"] as? String ?? "")+".mp4");guard FileManager.default.fileExists(atPath:f.path) else{throw videoError("视频文件缺失，请从原文件重新导入，进度会保留")};return ["path":f.absoluteString]}}
    @objc func saveProgress(_ call:CAPPluginCall){respond(call){let id=call.getString("id","");_ = try require("videos",id);let p=call.getDouble("position",0),d=call.getDouble("duration",0);guard p.isFinite && d.isFinite else{throw videoError("播放位置无效")};put("progress",["id":id,"position":max(0,d>0 ? min(p,d) : p),"duration":max(0,d),"viewed":call.getBool("viewed",false),"updatedAt":Date().timeIntervalSince1970*1000]);try persist();return [:]}}
    @objc func bookmark(_ call:CAPPluginCall){respond(call){let id=call.getString("id","");guard !id.isEmpty else{throw videoError("书签标识缺失")};if call.getBool("remove",false){remove("bookmarks",{$0["id"] as? String == id})}else{let vid=call.getString("videoId","");_ = try require("videos",vid);let p=call.getDouble("position",0);guard p.isFinite && p>=0 else{throw videoError("书签位置无效")};put("bookmarks",["id":id,"videoId":vid,"position":p,"title":call.getString("title","书签")])};try persist();return [:]}}
    @objc func deleteSeries(_ call:CAPPluginCall){respond(call){try deleteRecords("series",id:call.getString("id",""));return [:]}}
    @objc func deleteContent(_ call:CAPPluginCall){respond(call){try deleteRecords(call.getString("kind",""),id:call.getString("id",""));return [:]}}
    private func deleteRecords(_ kind:String,id:String) throws {
        guard active.isEmpty else{throw videoError("请等导入完成后再删除内容")}
        var chapters=Set<String>(),videos=Set<String>(),affected=Set<String>()
        switch kind {
        case "series": _ = try require("series",id);affected.insert(id);chapters=Set(list("chapters").filter{$0["seriesId"] as? String == id}.compactMap{$0["id"] as? String})
        case "chapter": let ch=try require("chapters",id);chapters.insert(id);affected.insert(ch["seriesId"] as? String ?? "")
        case "video": let v=try require("videos",id);videos.insert(id);let ch=try require("chapters",v["chapterId"] as? String ?? "");affected.insert(ch["seriesId"] as? String ?? "")
        default:throw videoError("不支持的删除类型")
        }
        videos.formUnion(list("videos").filter{chapters.contains($0["chapterId"] as? String ?? "")}.compactMap{$0["id"] as? String})
        // Keep other unfinished sources available for retry after deleting one item.
        var jobs=state["jobs"] as? [String:Any] ?? [:];var retired=Set<String>()
        for (key,value) in jobs {
            guard var j=value as? [String:Any],let sid=j["seriesId"] as? String,affected.contains(sid) else{continue}
            if kind=="series"{retired.insert(key);continue}
            let sources=j["sources"] as? [[String:Any]] ?? [];var removedTitles=Set<String>()
            let kept=sources.filter{source in
                let cid=digest(sid+"/"+(source["chapter"] as? String ?? "")),h=source["hash"] as? String ?? ""
                let deleted=chapters.contains(cid) || videos.contains{vid in
                    guard let v=find("videos",vid),v["chapterId"] as? String == cid else{return false}
                    return v["hash"] as? String == h || (h.isEmpty && v["title"] as? String == source["title"] as? String)
                }
                if deleted{removedTitles.insert(source["title"] as? String ?? "")};return !deleted
            }
            if kept.count==sources.count{continue};if kept.isEmpty{retired.insert(key);continue}
            j["sources"]=kept;jobs[key]=j;var task=try require("tasks",key)
            let done=kept.filter{$0["status"] as? String == "done"}
            task["total"]=kept.count;task["completed"]=done.count;task["failed"]=kept.filter{$0["status"] as? String == "failed"}.count
            task["bytes"]=done.reduce(Int64(0)){$0+(($1["size"] as? NSNumber)?.int64Value ?? 0)}
            task["totalBytes"]=kept.reduce(Int64(0)){$0+(($1["size"] as? NSNumber)?.int64Value ?? 0)}
            task["duplicates"]=min(done.count,task["duplicates"] as? Int ?? 0)
            task["errors"]=(task["errors"] as? [String] ?? []).filter{error in !removedTitles.contains{error.hasPrefix($0+"：")}}
            put("tasks",task)
        }
        for key in retired{jobs.removeValue(forKey:key)};state["jobs"]=jobs;remove("tasks",{retired.contains($0["id"] as? String ?? "")})
        if kind=="series"{remove("series",{$0["id"] as? String == id})};remove("chapters",{chapters.contains($0["id"] as? String ?? "")});remove("videos",{videos.contains($0["id"] as? String ?? "")});remove("progress",{videos.contains($0["id"] as? String ?? "")});remove("bookmarks",{videos.contains($0["videoId"] as? String ?? "")});try persist()
        let hashes=Set(list("videos").compactMap{$0["hash"] as? String});for file in try FileManager.default.contentsOfDirectory(at:media,includingPropertiesForKeys:nil) where file.pathExtension=="mp4" && !hashes.contains(file.deletingPathExtension().lastPathComponent){try FileManager.default.removeItem(at:file)}
    }
}


/// Video-only merge shared by native export and provisioning; all other stores are out of scope.
private enum VideoMigration {
    static let fields: [(String,[String])] = [
        ("categories",["id","title","order"]),("series",["id","categoryId","title","order"]),
        ("chapters",["id","seriesId","title","path","order"]),("videos",["id","chapterId","title","hash","size","order"]),
        ("progress",["id","position","duration","viewed","updatedAt"]),("bookmarks",["id","videoId","position","title"])
    ]
    static func metadata(_ state:[String:Any]) throws -> [String:Any] {
        var result=[String:Any]()
        for (key,columns) in fields {
            guard let input=state[key] as? [[String:Any]] else{throw videoError("迁移数据不完整")}
            var rows=[[String:Any]](),ids=Set<String>()
            for item in input {
                var row=[String:Any]()
                for field in columns {guard let value=item[field] else{throw videoError("迁移字段缺失")};row[field]=value}
                guard let id=row["id"] as? String,!id.isEmpty,id.count<=512,ids.insert(id).inserted else{throw videoError("迁移标识为空或重复")}
                if columns.contains("order") {guard let order=row["order"] as? Int,order>=0,let title=row["title"] as? String,!title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{throw videoError("迁移名称或顺序无效")}}
                if key=="videos" {guard let h=row["hash"] as? String,h.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,let size=row["size"] as? NSNumber,size.int64Value>0 else{throw videoError("迁移视频校验信息无效")}}
                for field in ["position","duration","updatedAt"] where columns.contains(field) {guard let n=row[field] as? NSNumber,n.doubleValue.isFinite,n.doubleValue>=0 else{throw videoError("迁移播放记录无效")}}
                rows.append(row)
            }
            result[key]=rows
        }
        for (key,field,parent) in [("series","categoryId","categories"),("chapters","seriesId","series"),("videos","chapterId","chapters"),("progress","id","videos"),("bookmarks","videoId","videos")] {
            let ids=Set((result[parent] as? [[String:Any]] ?? []).compactMap{$0["id"] as? String})
            for item in result[key] as? [[String:Any]] ?? [] {guard let ref=item[field] as? String,ids.contains(ref) else{throw videoError("迁移目录或视频引用缺失")}}
        }
        return result
    }
    static func sameBookmark(_ a:[String:Any],_ b:[String:Any])->Bool {
        a["videoId"] as? String == b["videoId"] as? String && a["title"] as? String == b["title"] as? String && (a["position"] as? NSNumber)?.doubleValue == (b["position"] as? NSNumber)?.doubleValue
    }
    static func merge(_ destination:[String:Any],_ input:[String:Any],_ receipt:String) throws -> [String:Any] {
        guard receipt.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else{throw videoError("迁移回执无效")}
        let source=try metadata(input);var next=destination,receipts=destination["migrationReceipts"] as? [String:Bool] ?? [:]
        if receipts[receipt]==true{return next}
        for (key,_) in fields {
            var rows=next[key] as? [[String:Any]] ?? []
            for var item in source[key] as? [[String:Any]] ?? [] {
                let old=rows.first{$0["id"] as? String == item["id"] as? String}
                if let old,key=="videos" {guard old["hash"] as? String == item["hash"] as? String,(old["size"] as? NSNumber)?.int64Value == (item["size"] as? NSNumber)?.int64Value,old["chapterId"] as? String == item["chapterId"] as? String else{throw videoError("视频标识冲突，未覆盖已有课程")}}
                if let old,key=="chapters",old["seriesId"] as? String != item["seriesId"] as? String {throw videoError("章节标识冲突，未覆盖已有目录")}
                if let old,key=="progress",(old["updatedAt"] as? NSNumber)?.doubleValue ?? 0 >= (item["updatedAt"] as? NSNumber)?.doubleValue ?? 0 {continue}
                if let old,key=="bookmarks" {
                    if sameBookmark(old,item){continue}
                    let millis=Int64(((item["position"] as? NSNumber)?.doubleValue ?? 0)*1000+0.5)
                    let seed="\(item["id"] as? String ?? "")|\(item["videoId"] as? String ?? "")|\(item["title"] as? String ?? "")|\(millis)"
                    let base="migration-"+SHA256.hash(data:Data(seed.utf8)).map{String(format:"%02x",$0)}.joined()
                    var candidate=base,n=0
                    while let conflict=rows.first(where:{$0["id"] as? String == candidate}),!sameBookmark(conflict,item){n+=1;candidate=base+"-\(n)"}
                    item["id"]=candidate
                }
                if let i=rows.firstIndex(where:{$0["id"] as? String == item["id"] as? String}){rows[i]=item}else{rows.append(item)}
            }
            next[key]=rows
        }
        receipts[receipt]=true;next["migrationReceipts"]=receipts;return next
    }
}
