import Link from "next/link";
import { ImportForm } from "./ImportForm";

export default function ImportPage() {
  return (
    <section className="content">
        <header className="topbar">
          <div>
            <h1>数据导入</h1>
            <p>先接入抖音采集结果，后续星图、蒲公英、小红书都可以复用同一套入库规则。</p>
          </div>
          <Link className="button-link" href="/creators">
            查看达人库
          </Link>
        </header>

        <ImportForm />
      </section>
  );
}
