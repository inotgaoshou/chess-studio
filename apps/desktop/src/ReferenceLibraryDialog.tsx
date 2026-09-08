import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Database, Download, FolderOpen, ListChecks, RefreshCw, Search, ShieldCheck, Upload, X } from "lucide-react";
import type { ChessPlatform, OpeningCategoryDto, ReferenceGameFilters, ReferenceGameSummaryDto, ReferenceImportBatchDto, ReferenceReviewIssueDto, ReferenceSourceDto } from "./platform/types";

type Props = { platform: ChessPlatform; onClose(): void };
type Tab = "openings" | "sources" | "batches";

function resultLabel(result: string) {
  return result === "1-0" ? "红胜" : result === "0-1" ? "黑胜" : result === "1/2-1/2" ? "和棋" : "未知";
}

type ReviewIssueRowProps = {
  issue: ReferenceReviewIssueDto;
  categories: OpeningCategoryDto[];
  busy: boolean;
  onIdentity(red: string, black: string, date: string): void;
  onOpening(code: string, alias: string): void;
  onDuplicate(merge: boolean): void;
};

function ReviewIssueRow({ issue, categories, busy, onIdentity, onOpening, onDuplicate }: ReviewIssueRowProps) {
  const [red, setRed] = useState(issue.redPlayer);
  const [black, setBlack] = useState(issue.blackPlayer);
  const [date, setDate] = useState(issue.gameDate);
  const [code, setCode] = useState(categories[0]?.code ?? "");
  const [alias, setAlias] = useState(issue.opening);
  return <div className="reference-review-issue">
    <span><b>{issue.title || "未命名棋局"}</b><small>{issue.detail}</small></span>
    {issue.kind === "identity" && <div className="reference-review-controls">
      <input aria-label="红方姓名" value={red} onChange={(event) => setRed(event.target.value)} placeholder="红方"/>
      <input aria-label="黑方姓名" value={black} onChange={(event) => setBlack(event.target.value)} placeholder="黑方"/>
      <input aria-label="完整日期" value={date} onChange={(event) => setDate(event.target.value)} placeholder="YYYY-MM-DD"/>
      <button disabled={busy} onClick={() => onIdentity(red, black, date)}><Check size={13}/>保存</button>
    </div>}
    {issue.kind === "opening" && <div className="reference-review-controls opening">
      <select aria-label="主布局编码" value={code} onChange={(event) => setCode(event.target.value)}>{categories.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select>
      <input aria-label="审核别名" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="原始布局别名"/>
      <button disabled={busy || !code} onClick={() => onOpening(code, alias)}><Check size={13}/>确认</button>
    </div>}
    {issue.kind === "duplicate" && <div className="reference-review-controls duplicate"><small>候选 {issue.candidateGameId?.slice(0, 8)}</small><button disabled={busy} onClick={() => onDuplicate(true)}>合并</button><button disabled={busy} onClick={() => onDuplicate(false)}>保留两盘</button></div>}
  </div>;
}

export function ReferenceLibraryDialog({ platform, onClose }: Props) {
  const desktop = platform.kind === "desktop";
  const [tab, setTab] = useState<Tab>("openings");
  const [openings, setOpenings] = useState<OpeningCategoryDto[]>([]);
  const [openingChildren, setOpeningChildren] = useState<Record<string, OpeningCategoryDto[]>>({});
  const [selectedCode, setSelectedCode] = useState<string>();
  const [games, setGames] = useState<ReferenceGameSummaryDto[]>([]);
  const [sources, setSources] = useState<ReferenceSourceDto[]>([]);
  const [batches, setBatches] = useState<ReferenceImportBatchDto[]>([]);
  const [issuesByBatch, setIssuesByBatch] = useState<Record<string, ReferenceReviewIssueDto[]>>({});
  const [query, setQuery] = useState("");
  const [player, setPlayer] = useState("");
  const [eventName, setEventName] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [side, setSide] = useState<"" | "red" | "black">("");
  const [masterOnly, setMasterOnly] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState("local-only");
  const [serverSourceId, setServerSourceId] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [publicLocator, setPublicLocator] = useState("");
  const [licenseNote, setLicenseNote] = useState("");
  const [packageUrl, setPackageUrl] = useState("");
  const [packageSha256, setPackageSha256] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(
    () => [...openings, ...Object.values(openingChildren).flat()].find((item) => item.code === selectedCode),
    [openingChildren, openings, selectedCode],
  );
  const gameFilters = useMemo<ReferenceGameFilters>(() => ({
    player: player.trim() || undefined,
    event: eventName.trim() || undefined,
    yearFrom: /^\d{4}$/.test(yearFrom) ? Number(yearFrom) : undefined,
    yearTo: /^\d{4}$/.test(yearTo) ? Number(yearTo) : undefined,
    side: player.trim() ? side || undefined : undefined,
    masterOnly,
  }), [eventName, masterOnly, player, side, yearFrom, yearTo]);
  const commonPlayers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of games) {
      for (const name of [game.redPlayer, game.blackPlayer]) {
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 6);
  }, [games]);
  const similarOpenings = useMemo(() => selected
    ? (selected.parentCode ? openingChildren[selected.parentCode] ?? [] : openings)
      .filter((item) => item.code !== selected.code)
      .slice(0, 5)
    : [], [openingChildren, openings, selected]);
  const openingOptions = useMemo(() => [...openings, ...Object.values(openingChildren).flat()], [openingChildren, openings]);

  async function refresh() {
    setBusy(true); setError("");
    try {
      const [nextOpenings, nextSources, nextBatches, account] = await Promise.all([
        platform.browseReferenceOpenings(), desktop ? platform.listReferenceSources() : Promise.resolve([]), desktop ? platform.listReferenceImportBatches(undefined, 50) : Promise.resolve([]),
        platform.getSyncAccount().catch(() => undefined),
      ]);
      const childGroups = await Promise.all(nextOpenings.map(async (opening) => [
        opening.code,
        await platform.browseReferenceOpenings(opening.code),
      ] as const));
      setOpenings(nextOpenings); setSources(nextSources); setBatches(nextBatches);
      setOpeningChildren(Object.fromEntries(childGroups));
      setServerUrl((current) => current || account?.serverUrl || "");
      const allCodes = new Set([...nextOpenings, ...childGroups.flatMap(([, items]) => items)].map((item) => item.code));
      setSelectedCode((current) => current && allCodes.has(current) ? current : nextOpenings[0]?.code);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let disposed = false;
    void platform.listReferenceGames(selectedCode, query, 100, 0, gameFilters)
      .then((items) => { if (!disposed) setGames(items); })
      .catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { disposed = true; };
  }, [gameFilters, platform, query, selectedCode]);

  async function addSource() {
    const path = await platform.chooseReferenceSource();
    if (!path) return;
    const displayName = path.split(/[\\/]/).filter(Boolean).at(-1) ?? "CBL 资料源";
    setBusy(true); setError("");
    try {
      const source = await platform.registerReferenceSource(path, displayName, true, licenseStatus.trim() || "unreviewed");
      await platform.scanReferenceSource(source.id);
      await refresh();
      setTab("batches");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function scan(sourceId: string) {
    setBusy(true); setError("");
    try { await platform.scanReferenceSource(sourceId); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function classify(batchId: string) {
    setBusy(true); setError("");
    try { await platform.classifyReferenceBatch(batchId); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function loadIssues(batchId: string) {
    if (issuesByBatch[batchId]) {
      setIssuesByBatch((current) => { const next = { ...current }; delete next[batchId]; return next; });
      return;
    }
    setBusy(true); setError("");
    try {
      const issues = await platform.listReferenceBatchIssues(batchId);
      setIssuesByBatch((current) => ({ ...current, [batchId]: issues }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function updateIssue(batchId: string, action: () => Promise<void>) {
    setBusy(true); setError("");
    try {
      await action();
      const issues = await platform.listReferenceBatchIssues(batchId);
      setIssuesByBatch((current) => ({ ...current, [batchId]: issues }));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function approve(batchId: string) {
    setBusy(true); setError("");
    try { await platform.reviewReferenceBatch(batchId, true, "本机审核通过"); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function publish(batchId: string) {
    if (!serverSourceId.trim() || !serverUrl.trim()) {
      setError("发布前请填写服务端来源 ID 和同步服务地址。");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await platform.publishReferenceBatch(batchId, serverSourceId.trim(), serverUrl.trim());
      setNotice(`发布完成：新增 ${result.inserted} 盘，复用 ${result.duplicates} 盘，停用来源 ${result.removed ?? 0} 条。`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function registerOnServer(source: ReferenceSourceDto | undefined) {
    if (!source || !serverUrl.trim() || !licenseNote.trim()) {
      setError("登记服务端来源前请填写同步服务地址和许可说明。");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const id = await platform.createServerReferenceSource(
        source.displayName, source.licenseStatus, licenseNote.trim(), publicLocator.trim() || undefined, serverUrl.trim(),
      );
      setServerSourceId(id);
      setNotice(`服务端来源已登记：${id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function installOfflinePackage() {
    if (!packageUrl.trim() || !packageSha256.trim()) {
      setError("请填写离线包地址和 SHA-256。");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await platform.installReferenceOfflinePackage(packageUrl.trim(), packageSha256.trim());
      setNotice(`离线参考库已更新：${result.gameCount.toLocaleString()} 盘。`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function loadOfflinePackageManifest() {
    if (!serverUrl.trim()) {
      setError("请先填写同步服务地址。");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const manifest = await platform.getReferenceOfflinePackageManifest(serverUrl.trim());
      setPackageUrl(manifest.packageUrl);
      setPackageSha256(manifest.sha256);
      setNotice(`已获取离线库 ${manifest.version}：${manifest.gameCount.toLocaleString()} 盘。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="reference-library-dialog" role="dialog" aria-modal="true" aria-label="参考实战库与布局探索">
      <header><span><Database size={18}/><strong>参考实战库</strong><small>布局体系、局面统计与资料源审核</small></span><button type="button" title="关闭" aria-label="关闭" onClick={onClose}><X size={17}/></button></header>
      <nav className="reference-tabs" aria-label="参考库视图">
        <button className={tab === "openings" ? "active" : ""} onClick={() => setTab("openings")}><BookOpen size={14}/>布局探索</button>
        {desktop && <button className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}><FolderOpen size={14}/>资料源</button>}
        {desktop && <button className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}><ShieldCheck size={14}/>导入批次</button>}
        <button className="icon" type="button" title="刷新" aria-label="刷新" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14}/></button>
      </nav>
      {error && <p className="reference-dialog-error">{error}</p>}
      {notice && <p className="reference-dialog-notice">{notice}</p>}
      {tab === "openings" && <div className="reference-opening-body">
        <aside>{openings.map((item) => <div className="reference-opening-group" key={item.code}><button className={item.code === selectedCode ? "active" : ""} onClick={() => setSelectedCode(item.code)}><b>{item.code}</b><span>{item.name}<small>{item.gameCount.toLocaleString()} 局</small></span></button>{openingChildren[item.code]?.map((child) => <button key={child.code} className={`child ${child.code === selectedCode ? "active" : ""}`} onClick={() => setSelectedCode(child.code)}><b>{child.code}</b><span>{child.name}<small>{child.gameCount.toLocaleString()} 局</small></span></button>)}</div>)}</aside>
        <main>
          <header><div><strong>{selected ? `${selected.code} · ${selected.name}` : "布局目录"}</strong><small>{selected?.aliases.join("、") || "规范分类与已审核别名"}</small></div><label><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="棋手、赛事或标题"/></label></header>
          <div className="reference-opening-filters">
            <div className="reference-scope-toggle" role="group" aria-label="实战范围"><button className={!masterOnly ? "active" : ""} onClick={() => setMasterOnly(false)}>全部实战</button><button className={masterOnly ? "active" : ""} onClick={() => setMasterOnly(true)}>大师实战</button></div>
            <label>棋手<input value={player} onChange={(change) => setPlayer(change.target.value)} placeholder="姓名"/></label>
            <label>赛事<input value={eventName} onChange={(change) => setEventName(change.target.value)} placeholder="赛事名"/></label>
            <label>年份<input aria-label="起始年份" inputMode="numeric" maxLength={4} value={yearFrom} onChange={(change) => setYearFrom(change.target.value.replace(/\D/g, ""))} placeholder="起始"/><span>至</span><input aria-label="结束年份" inputMode="numeric" maxLength={4} value={yearTo} onChange={(change) => setYearTo(change.target.value.replace(/\D/g, ""))} placeholder="结束"/></label>
            <label>执方<select value={side} disabled={!player.trim()} onChange={(change) => setSide(change.target.value as "" | "red" | "black")}><option value="">不限</option><option value="red">执红</option><option value="black">执黑</option></select></label>
          </div>
          {(commonPlayers.length > 0 || similarOpenings.length > 0) && <div className="reference-opening-shortcuts">
            {commonPlayers.length > 0 && <span><small>常用棋手</small>{commonPlayers.map(([name, count]) => <button key={name} className={player === name ? "active" : ""} onClick={() => setPlayer(player === name ? "" : name)}>{name}<i>{count}</i></button>)}</span>}
            {similarOpenings.length > 0 && <span><small>相近布局</small>{similarOpenings.map((item) => <button key={item.code} onClick={() => setSelectedCode(item.code)}>{item.code}</button>)}</span>}
          </div>}
          <div className="reference-opening-stats"><span>棋局 <b>{selected?.gameCount ?? 0}</b></span><span className="red">红胜 <b>{selected?.redWins ?? 0}</b></span><span>和棋 <b>{selected?.draws ?? 0}</b></span><span>黑胜 <b>{selected?.blackWins ?? 0}</b></span></div>
          <div className="reference-game-table"><div className="head"><span>对局</span><span>赛事 / 日期</span><span>结果</span><span>手数</span></div>{games.length === 0 ? <p>该分类暂无已归类棋局。</p> : games.map((game) => <div key={game.id}><span><b>{game.redPlayer || "红方未知"}</b><small>对 {game.blackPlayer || "黑方未知"}</small></span><span><b>{game.eventName || game.title}</b><small>{game.gameDate || "日期未知"} {game.roundName}</small></span><span>{resultLabel(game.result)}</span><span>{game.moveCount}</span></div>)}</div>
        </main>
      </div>}
      {tab === "sources" && <div className="reference-source-body"><header><div><strong>登记 CBL 资料源</strong><small>启动与手动刷新时按文件指纹扫描；本地绝对路径不会上传。</small></div><label>许可状态<input value={licenseStatus} onChange={(event) => setLicenseStatus(event.target.value)} placeholder="local-only / authorized"/></label><button disabled={busy} onClick={() => void addSource()}><FolderOpen size={14}/>添加目录</button></header><div className="reference-source-list">{sources.length === 0 ? <p>尚未登记资料源。</p> : sources.map((source) => <div key={source.id}><span><strong>{source.displayName}</strong><small>{source.rootPath}</small></span><em>{source.licenseStatus}</em><small>{source.lastScannedAt ? new Date(source.lastScannedAt).toLocaleString() : "尚未扫描"}</small><button disabled={busy} title="扫描新增和修订" onClick={() => void scan(source.id)}><RefreshCw size={14}/>扫描</button></div>)}</div><div className="reference-publish-settings"><label>离线包地址<input value={packageUrl} onChange={(event) => setPackageUrl(event.target.value)} placeholder="https://example.com/reference-library-v2.sqlite.zst"/></label><label>SHA-256<input value={packageSha256} onChange={(event) => setPackageSha256(event.target.value)} placeholder="64 位校验值"/></label><button disabled={busy} title="从同步服务获取最新版离线库信息" onClick={() => void loadOfflinePackageManifest()}><RefreshCw size={14}/>获取最新版</button><button disabled={busy} title="校验并原子替换本地参考库" onClick={() => void installOfflinePackage()}><Download size={14}/>安装离线包</button></div></div>}
      {tab === "batches" && <div className="reference-batch-body">
        <div className="reference-publish-settings"><label>同步服务地址<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://example.com"/></label><label>服务端来源 ID<input value={serverSourceId} onChange={(event) => setServerSourceId(event.target.value)} placeholder="可在下方登记后自动填写"/></label><label>公开来源说明<input value={publicLocator} onChange={(event) => setPublicLocator(event.target.value)} placeholder="公开网页或档案编号，不填本地路径"/></label><label>许可说明<input value={licenseNote} onChange={(event) => setLicenseNote(event.target.value)} placeholder="授权主体、范围或公版依据"/></label></div>
        <div className="reference-batch-list">{batches.length === 0 ? <p>尚无导入批次。</p> : batches.map((batch) => {
          const source = sources.find((item) => item.id === batch.sourceId);
          const publishable = batch.reviewStatus === "approved" && ["authorized", "public-domain", "self-owned"].includes(source?.licenseStatus ?? "");
          const issues = issuesByBatch[batch.id];
          return <div key={batch.id}>
            <header><span><strong>{new Date(batch.createdAt).toLocaleString()}</strong><small>{batch.status} · {batch.reviewStatus}</small></span><nav><button disabled={busy} onClick={() => void classify(batch.id)}><BookOpen size={14}/>归类</button><button disabled={busy} onClick={() => void loadIssues(batch.id)}><ListChecks size={14}/>{issues ? "收起问题" : "审核问题"}</button><button disabled={busy || batch.reviewStatus === "approved"} onClick={() => void approve(batch.id)}><Check size={14}/>审核通过</button><button disabled={busy || !publishable} title={publishable ? "登记服务端来源" : "来源许可不允许共享"} onClick={() => void registerOnServer(source)}><Database size={14}/>登记来源</button><button disabled={busy || !publishable || !serverSourceId.trim()} title={publishable ? "发布已审核主线" : "需审核通过且来源许可允许共享"} onClick={() => void publish(batch.id)}><Upload size={14}/>发布</button></nav></header>
            <dl><div><dt>新增</dt><dd>{batch.importedRecords}</dd></div><div><dt>修订</dt><dd>{batch.revisedRecords}</dd></div><div><dt>重复</dt><dd>{batch.duplicateRecords}</dd></div><div><dt>非法</dt><dd>{batch.invalidRecords}</dd></div><div><dt>待分类</dt><dd>{batch.unclassifiedRecords}</dd></div><div><dt>空库</dt><dd>{batch.emptyFiles}</dd></div></dl>
            {issues && <div className="reference-review-issues">{issues.length === 0 ? <small>没有待人工处理的问题。</small> : issues.map((issue) => <ReviewIssueRow
              key={issue.id}
              issue={issue}
              categories={openingOptions}
              busy={busy}
              onIdentity={(red, black, date) => void updateIssue(batch.id, () => platform.updateReferenceGameIdentity(issue.gameId, red, black, date))}
              onOpening={(code, alias) => void updateIssue(batch.id, () => platform.overrideReferenceGameOpening(issue.gameId, code, alias.trim() || undefined))}
              onDuplicate={(merge) => void updateIssue(batch.id, () => platform.resolveReferenceDuplicate(issue.id, merge))}
            />)}</div>}
            {batch.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}
          </div>;
        })}</div>
      </div>}
    </section>
  </div>;
}
