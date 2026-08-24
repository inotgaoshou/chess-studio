import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, LoaderCircle, Swords, X } from "lucide-react";
import { chessPlatform, type BookTopicDetail, type FlyknifeTopic, type RelatedMasterGame } from "./platform";

type Props = {
  topic: FlyknifeTopic;
  onClose(): void;
  onOpenTopic(): void;
  onOpenMasterGame(gameId: string): Promise<void>;
  onStudyTopic(): void;
};

export function BookTopicDialog({ topic, onClose, onOpenTopic, onOpenMasterGame, onStudyTopic }: Props) {
  const [detail, setDetail] = useState<BookTopicDetail>();
  const [related, setRelated] = useState<RelatedMasterGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("正在读取原书专题…");

  useEffect(() => {
    let disposed = false;
    void chessPlatform.getBookTopicDetail(topic.id)
      .then((value) => {
        if (disposed) return;
        if (!value) throw new Error("专题详情不存在");
        setDetail(value);
        setMessage("原书资料已加载。");
        return value;
      })
      .then((value) => value?.masterGameId ? undefined : chessPlatform.findRelatedMasterGames(topic.id, value?.checkpointFens ?? []))
      .then((items) => { if (!disposed && items) setRelated(items); })
      .catch((error) => {
        if (!disposed) setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => { disposed = true; };
  }, [topic.id]);

  async function openMaster(game: RelatedMasterGame) {
    setBusy(true);
    try {
      await onOpenMasterGame(game.id);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="book-topic-dialog" role="dialog" aria-modal="true" aria-label="书页飞刀专题">
      <header>
        <span><BookOpen size={18}/><strong>{topic.title}</strong></span>
        <button className="tool-button" title="关闭" onClick={onClose}><X size={16}/></button>
      </header>
      {!detail ? <p className="flyknife-notice"><LoaderCircle className="spin" size={15}/>{message}</p> : <div className="book-topic-body">
        <section className="book-topic-overview">
          <div><strong>{detail.redPlayer}</strong><span>执红</span><b>{detail.result}</b><span>执黑</span><strong>{detail.blackPlayer}</strong></div>
          <small>{detail.eventName} · {detail.source.bookTitle}第 {detail.source.page} 页 · 第 {detail.source.gameNo} 局</small>
          <p><em>书载飞刀，待 Pikafish 复核</em> 车八平五! 的原书评价尚未替代引擎结论。</p>
          <button className="primary" onClick={onStudyTopic}><Swords size={14}/>开始三段拆解学习</button>
          <button onClick={onOpenTopic}><BookOpen size={14}/>打开本地棋谱</button>
        </section>
        <section className="book-topic-images" aria-label="授权原书页">
          {detail.images.map((image) => <img key={image} src={image} alt="第53局授权原书页" />)}
        </section>
        <section className="book-topic-learning">
          <h3>原书转录</h3><p>{detail.rawTranscript}</p>
          <h3>拆解要点</h3>
          <dl>
            <dt>局势</dt><dd>{detail.teaching.situation}</dd>
            <dt>诱导</dt><dd>{detail.teaching.lure}</dd>
            <dt>飞刀</dt><dd>{detail.teaching.knife}</dd>
            <dt>应对</dt><dd>{detail.teaching.defense}</dd>
            <dt>练习</dt><dd>{detail.teaching.practice}</dd>
          </dl>
        </section>
        <section className="book-topic-related">
          <h3>关联大师对局</h3>
          {related.length ? related.map((game) => <article key={game.id}>
            <div><strong>{game.redPlayer} vs {game.blackPlayer}</strong><small>{game.matchLabel} · 第 {game.matchedPly} 着局面</small></div>
            <button disabled={busy} onClick={() => void openMaster(game)}><ExternalLink size={13}/>打开对照</button>
          </article>) : detail.masterGameId ? <article><div><strong>洪智 vs 黄仕清</strong><small>已找到原局 · 1998 全国个人赛 · 119 手</small></div><button disabled={busy} onClick={() => void openMaster({ id: detail.masterGameId!, title: "吉林 洪智 胜 南方棋院 黄仕清", redPlayer: "洪智", blackPlayer: "黄仕清", masterSide: undefined, eventName: detail.eventName, gameDate: "1998-12-13", result: detail.result, moveCount: detail.mainline.length, sourceUrl: detail.sourceUrl ?? "", matchKind: "exact", matchedPly: 20, matchedFen: "", matchLabel: "已找到原局" })}><ExternalLink size={13}/>打开原谱</button></article> : <p>当前服务端没有返回同型对局。</p>}
        </section>
        <p className="flyknife-notice" aria-live="polite">{message}</p>
      </div>}
    </section>
  </div>;
}
