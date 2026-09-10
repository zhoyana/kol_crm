import Link from "next/link";
import { notFound } from "next/navigation";
import { getCreatorById } from "@/lib/creators";
import { CreatorProfileEditor } from "./CreatorProfileEditor";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function CreatorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const creator = await getCreatorById(id);

  if (!creator) {
    notFound();
  }

  return (
    <section className="content">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/creators">
              返回达人库
            </Link>
            <h1>{creator.name}</h1>
            <p>
              {creator.platform} / {creator.category}
            </p>
          </div>
          {creator.profileUrl ? (
            <a className="button-link" href={creator.profileUrl} rel="noreferrer" target="_blank">
              打开主页
            </a>
          ) : null}
        </header>

        <section className="panel side-panel">
            <h2>建联状态</h2>
            <dl>
              <div>
                <dt>当前状态</dt>
                <dd>{creator.outreachStatus}</dd>
              </div>
              <div>
                <dt>主页链接</dt>
                <dd>{creator.profileUrl ? "已记录" : "未记录"}</dd>
              </div>
            </dl>
        </section>

        <CreatorProfileEditor creator={creator} />

      </section>
  );
}
