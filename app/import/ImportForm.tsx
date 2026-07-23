"use client";

import { ChangeEvent, useMemo, useState } from "react";
import Link from "next/link";
import { csvRowsToObjects } from "@/lib/csv";

const sampleCsv = `达人ID,达人昵称,平台,主页链接,类目,粉丝数,播放1,播放2,播放3,播放4,播放5,报价,建联状态,合作状态,联系方式,备注
dy-mock-001,阿晨好物研究所,抖音,https://example.com/dy/a-chen,家居好物,186000,42000,68000,51000,79000,63000,1200,未建联,,,
xhs-mock-002,小鹿的通勤包,小红书,https://example.com/xhs/xiao-lu,时尚穿搭,93000,18000,25000,21000,33000,28000,800,未建联,,,
dy-mock-003,老周数码测评,抖音,https://example.com/dy/lao-zhou,数码科技,412000,96000,122000,88000,146000,118000,2600,已建联,待确认,wx_laozhou,对方要看产品卖点和预算`;

type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
  sourceFile?: string;
};

function ResultBox({ result }: { result: ImportResult }) {
  return (
    <div className="result-box">
      <strong>导入完成</strong>
      <p>
        新增 {result.imported} 条，更新 {result.updated} 条，跳过 {result.skipped} 条。
      </p>
      {result.sourceFile ? <p>来源文件：{result.sourceFile}</p> : null}
      {result.errors.length ? (
        <ul>
          {result.errors.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <Link href="/creators">去达人库查看</Link>
    </div>
  );
}

export function ImportForm() {
  const [csvText, setCsvText] = useState(sampleCsv);
  const [douyinText, setDouyinText] = useState("");
  const [douyinCategory, setDouyinCategory] = useState("服饰");
  const [manualResult, setManualResult] = useState<ImportResult | null>(null);
  const [douyinResult, setDouyinResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"manual" | "douyin-text" | "douyin-latest" | "">("");

  const previewRows = useMemo(() => csvRowsToObjects(csvText).slice(0, 6), [csvText]);
  const previewHeaders = previewRows[0] ? Object.keys(previewRows[0]).slice(0, 8) : [];

  async function handleManualFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setManualResult(null);
    setError("");
    setCsvText(await file.text());
  }

  async function handleDouyinFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setDouyinResult(null);
    setError("");
    setDouyinText(await file.text());
  }

  async function submitManualImport() {
    setLoading("manual");
    setManualResult(null);
    setError("");

    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "导入失败，请检查 CSV 字段。");
        return;
      }

      setManualResult(data);
    } catch {
      setError("导入接口没有响应，请确认本地服务还在运行。");
    } finally {
      setLoading("");
    }
  }

  async function submitDouyinImport(mode: "text" | "latest") {
    setLoading(mode === "latest" ? "douyin-latest" : "douyin-text");
    setDouyinResult(null);
    setError("");

    try {
      const response = await fetch("/api/import/douyin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          content: mode === "text" ? douyinText : undefined,
          category: douyinCategory
        })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "抖音采集结果导入失败。");
        return;
      }

      setDouyinResult(data);
    } catch {
      setError("抖音导入接口没有响应，请确认本地服务还在运行。");
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="import-stack">
      <section className="panel import-panel">
        <div className="panel-header">
          <div>
            <h2>抖音采集结果导入</h2>
            <p>支持 MediaCrawler 的 raw jsonl，也支持候选达人 csv。先从关键词作品里提取达人，再导入达人库。</p>
          </div>
        </div>

        <div className="import-body">
          <label className="text-input-label">
            关键词/类目
            <input onChange={(event) => setDouyinCategory(event.target.value)} value={douyinCategory} />
          </label>

          <label className="upload-box">
            <span>选择 MediaCrawler 结果文件</span>
            <input accept=".jsonl,.csv,text/csv,application/json" onChange={handleDouyinFile} type="file" />
          </label>

          <label className="text-area-label">
            采集结果内容
            <textarea
              onChange={(event) => setDouyinText(event.target.value)}
              placeholder="可以粘贴 data/douyin/jsonl/search_contents_*.jsonl，或 creators_candidate.csv 的内容"
              spellCheck={false}
              value={douyinText}
            />
          </label>

          <div className="import-actions">
            <button disabled={loading !== "" || !douyinText.trim()} onClick={() => submitDouyinImport("text")} type="button">
              {loading === "douyin-text" ? "导入中..." : "导入当前内容"}
            </button>
            <button className="secondary-button" disabled={loading !== ""} onClick={() => submitDouyinImport("latest")} type="button">
              {loading === "douyin-latest" ? "读取中..." : "一键导入最新采集结果"}
            </button>
          </div>

          {douyinResult ? <ResultBox result={douyinResult} /> : null}
        </div>
      </section>

      <div className="import-grid">
        <section className="panel import-panel">
          <div className="panel-header">
            <div>
              <h2>普通达人 CSV 导入</h2>
              <p>适合星图、蒲公英、官方平台或人工名单整理后的表格。</p>
            </div>
          </div>

          <div className="import-body">
            <label className="upload-box">
              <span>选择 CSV 文件</span>
              <input accept=".csv,text/csv" onChange={handleManualFile} type="file" />
            </label>

            <label className="text-area-label">
              CSV 内容
              <textarea onChange={(event) => setCsvText(event.target.value)} spellCheck={false} value={csvText} />
            </label>

            <div className="import-actions">
              <button className="secondary-button" onClick={() => setCsvText(sampleCsv)} type="button">
                填入示例数据
              </button>
              <button disabled={loading !== ""} onClick={submitManualImport} type="button">
                {loading === "manual" ? "导入中..." : "导入 MySQL"}
              </button>
            </div>

            {manualResult ? <ResultBox result={manualResult} /> : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>字段预览</h2>
              <p>普通 CSV 的前 6 行会显示在这里，先确认列名和内容没有错位。</p>
            </div>
          </div>

          <div className="preview-wrap">
            {previewRows.length === 0 ? (
              <p className="empty-state">还没有识别到数据行</p>
            ) : (
              <table className="preview-table">
                <thead>
                  <tr>
                    {previewHeaders.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={`${row["达人ID"] || row["达人昵称"]}-${index}`}>
                      {previewHeaders.map((header) => (
                        <td key={header}>{row[header] || "-"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="template-note">
            <strong>推荐模板字段</strong>
            <p>达人ID、达人昵称、平台、主页链接、类目、粉丝数、播放1-5、报价、建联状态、合作状态、联系方式、备注。</p>
            <a href="/templates/creator-template.csv" download>
              下载示例 CSV
            </a>
          </div>
        </section>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
