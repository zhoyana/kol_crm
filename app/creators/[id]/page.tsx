import Link from "next/link";
import { notFound } from "next/navigation";
import { formatNumber, generateOutreachScript, getCreatorById, getOutreachLogsByCreatorId } from "@/lib/creators";
import { AiEvaluationPanel } from "./AiEvaluationPanel";
import { CreatorProfileEditor } from "./CreatorProfileEditor";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

const gradeLabel = {
  S: "S级",
  A: "A级",
  B: "B级",
  C: "C级",
  D: "D级"
};

const priorityLabel = {
  high: "优先建联",
  medium: "持续观察",
  low: "暂缓"
};

const actionLabel: Record<string, string> = {
  mark_sent: "标记已发送",
  mark_followup: "稍后跟进",
  update_profile: "更新资料",
  update_status: "状态更新"
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default async function CreatorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const creator = await getCreatorById(id);

  if (!creator) {
    notFound();
  }

  const outreachLogs = await getOutreachLogsByCreatorId(id);
  const script = generateOutreachScript(creator);
  const maxPlay = Math.max(...creator.plays, 1);
  const cpmStatus =
    creator.currentCpm == null ? "暂无报价" : creator.currentCpm > 20 ? "报价偏高" : creator.currentCpm <= 15 ? "价格友好" : "可谈";

  return (
    <section className="content">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/creators">
              返回达人库
            </Link>
            <h1>{creator.name}</h1>
            <p>
              {creator.platform} / {creator.category} / {priorityLabel[creator.priority]}
            </p>
          </div>
          {creator.profileUrl ? (
            <a className="button-link" href={creator.profileUrl} rel="noreferrer" target="_blank">
              打开主页
            </a>
          ) : null}
        </header>

        <section className="detail-grid">
          <div className="panel hero-panel">
            <div className="detail-title">
              <div>
                <span className={`grade grade-${creator.grade.toLowerCase()}`}>{gradeLabel[creator.grade]}</span>
                <h2>达人概况</h2>
              </div>
              <span className={`priority ${creator.priority}`}>{priorityLabel[creator.priority]}</span>
            </div>

            <div className="detail-stats">
              <div>
                <span>粉丝数</span>
                <strong>{formatNumber(creator.fans)}</strong>
              </div>
              <div>
                <span>平均播放</span>
                <strong>{formatNumber(creator.avgPlay)}</strong>
              </div>
              <div>
                <span>稳定播放</span>
                <strong>{formatNumber(creator.stablePlay)}</strong>
              </div>
              <div>
                <span>当前 CPM</span>
                <strong className={creator.currentCpm && creator.currentCpm > 20 ? "danger" : ""}>
                  {creator.currentCpm ?? "-"}
                </strong>
              </div>
            </div>
          </div>

          <div className="panel side-panel">
            <h2>建联状态</h2>
            <dl>
              <div>
                <dt>当前状态</dt>
                <dd>{creator.outreachStatus}</dd>
              </div>
              <div>
                <dt>合作状态</dt>
                <dd>{creator.cooperationStatus}</dd>
              </div>
              <div>
                <dt>联系方式</dt>
                <dd>{creator.contact}</dd>
              </div>
              <div>
                <dt>主页链接</dt>
                <dd>{creator.profileUrl ? "已记录" : "未记录"}</dd>
              </div>
            </dl>
          </div>
        </section>

        <CreatorProfileEditor creator={creator} />

        <section className="detail-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>报价判断</h2>
                <p>以目标 CPM 15 计算建议报价，用来作为谈判锚点。</p>
              </div>
            </div>
            <div className="quote-grid">
              <div>
                <span>当前报价</span>
                <strong>{creator.quote ? `¥${formatNumber(creator.quote)}` : "-"}</strong>
              </div>
              <div>
                <span>建议报价</span>
                <strong>¥{formatNumber(creator.suggestedPrice)}</strong>
              </div>
              <div>
                <span>价格判断</span>
                <strong>{cpmStatus}</strong>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>近 5 条播放</h2>
                <p>用于判断账号稳定性，后续可以替换成真实平台数据。</p>
              </div>
            </div>
            <div className="play-bars">
              {creator.plays.length ? (
                creator.plays.map((play, index) => (
                  <div key={`${creator.id}-${index}`}>
                    <span>播放 {index + 1}</span>
                    <div>
                      <i style={{ width: `${Math.max(8, (play / maxPlay) * 100)}%` }} />
                    </div>
                    <strong>{formatNumber(play)}</strong>
                  </div>
                ))
              ) : (
                <p className="empty-state">暂无播放数据</p>
              )}
            </div>
          </div>
        </section>

        <section className="panel script-panel">
          <div className="panel-header">
            <div>
              <h2>建联话术草稿</h2>
              <p>先用模板生成可复制草稿，后面可以接 AI 做个性化改写。</p>
            </div>
          </div>
          <pre>{script}</pre>
        </section>

        <AiEvaluationPanel creatorId={creator.id} profileUrl={creator.profileUrl} />

        <section className="panel script-panel">
          <div className="panel-header">
            <div>
              <h2>建联记录</h2>
              <p>记录状态变更和操作历史，任务页按钮和详情编辑会写入这里。</p>
            </div>
          </div>
          {outreachLogs.length ? (
            <div className="timeline">
              {outreachLogs.map((log) => (
                <article key={log.id}>
                  <div>
                    <strong>{actionLabel[log.action] || log.action}</strong>
                    <span>{formatDateTime(log.createdAt)}</span>
                  </div>
                  <p>
                    {log.oldStatus} -&gt; {log.newStatus}
                  </p>
                  {log.content ? <p className="notes">{log.content}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">暂无建联记录。可以在任务页标记已发送，或在这里保存资料生成记录。</p>
          )}
        </section>
      </section>
  );
}
