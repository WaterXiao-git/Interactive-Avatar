import { useEffect, useState } from "react";
import ShellLayout from "../components/ShellLayout";
import { getHistoryDetail, myHistory, myModels } from "../lib/api";

export default function DashboardPage() {
  const [models, setModels] = useState([]);
  const [history, setHistory] = useState([]);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [sessionDetails, setSessionDetails] = useState({});
  const [q, setQ] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [modelPage, setModelPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [modelMeta, setModelMeta] = useState({ total: 0, pageSize: 20 });
  const [historyMeta, setHistoryMeta] = useState({ total: 0, pageSize: 20 });

  async function loadAll(nextModelPage = modelPage, nextHistoryPage = historyPage) {
    const [m, h] = await Promise.all([
      myModels({ page: nextModelPage, pageSize: modelMeta.pageSize }),
      myHistory({
        q,
        start: start ? `${start}T00:00:00` : "",
        end: end ? `${end}T23:59:59` : "",
        page: nextHistoryPage,
        pageSize: historyMeta.pageSize,
      }),
    ]);
    setModels(m.items || []);
    setHistory(h.items || []);
    setModelMeta({ total: m.total || 0, pageSize: m.page_size || 20 });
    setHistoryMeta({ total: h.total || 0, pageSize: h.page_size || 20 });
    setModelPage(m.page || nextModelPage);
    setHistoryPage(h.page || nextHistoryPage);
  }

  useEffect(() => {
    loadAll(1, 1).catch(() => {});
  }, []);

  async function openSession(id) {
    if (expandedSessionId === id) {
      setExpandedSessionId(null);
      return;
    }

    if (!sessionDetails[id]) {
      const detail = await getHistoryDetail(id);
      setSessionDetails((prev) => ({ ...prev, [id]: detail }));
    }
    setExpandedSessionId(id);
  }

  function buildKeyMoments(detail) {
    const events = detail?.events || [];
    if (!events.length) {
      return [{ key: "none", label: "无有效语音文本", role: "system", text: "本次会话没有可提炼的文本节点。" }];
    }

    const users = events.filter((evt) => evt.role === "user");
    const assistants = events.filter((evt) => evt.role === "assistant");

    const moments = [];
    const firstUser = users[0];
    const firstAssistant = assistants[0];
    const lastUser = users[users.length - 1];
    const lastAssistant = assistants[assistants.length - 1];

    if (firstUser) moments.push({ key: `fu-${firstUser.id}`, label: "开场输入", role: "user", text: firstUser.text, at: firstUser.created_at });
    if (firstAssistant) moments.push({ key: `fa-${firstAssistant.id}`, label: "首次响应", role: "assistant", text: firstAssistant.text, at: firstAssistant.created_at });
    if (lastUser && lastUser.id !== firstUser?.id) {
      moments.push({ key: `lu-${lastUser.id}`, label: "结束前输入", role: "user", text: lastUser.text, at: lastUser.created_at });
    }
    if (lastAssistant && lastAssistant.id !== firstAssistant?.id) {
      moments.push({ key: `la-${lastAssistant.id}`, label: "结束前响应", role: "assistant", text: lastAssistant.text, at: lastAssistant.created_at });
    }
    return moments;
  }

  function formatTime(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  }

  return (
    <ShellLayout title="数据看板" subtitle="查看我的模型、历史记录，并按时间和关键词搜索。">
      <div className="single-column">
        <section className="glass-panel">
          <h2>历史筛选</h2>
          <div className="dashboard-filter-wrap">
            <div className="dashboard-filter-grid">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="关键词（摘要内容）" />
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="dashboard-filter-actions">
              <button type="button" className="secondary-btn" onClick={() => loadAll(1, 1)}>
                应用筛选
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setQ("");
                  setStart("");
                  setEnd("");
                  loadAll(1, 1);
                }}
              >
                清空
              </button>
            </div>
          </div>
        </section>

        <section className="glass-panel" style={{ marginTop: 12 }}>
          <h2>我的模型</h2>
          {models.length === 0 ? <p className="muted">暂无模型记录</p> : null}
          {models.map((item) => (
            <div key={item.id} className="dashboard-card">
              <div className="dashboard-card-title">模型 #{item.id}</div>
              <div className="dashboard-card-meta">
                来源：{item.source_type} / 预设：{item.preset_name || "-"}
              </div>
              <div className="dashboard-card-meta">创建时间：{formatTime(item.created_at)}</div>
            </div>
          ))}
          <div className="row-btns" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="secondary-btn"
              disabled={modelPage <= 1}
              onClick={() => loadAll(modelPage - 1, historyPage)}
            >
              模型上一页
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={modelPage * modelMeta.pageSize >= modelMeta.total}
              onClick={() => loadAll(modelPage + 1, historyPage)}
            >
              模型下一页
            </button>
          </div>
        </section>

        <section className="glass-panel" style={{ marginTop: 12 }}>
          <h2>交互历史</h2>
          {history.length === 0 ? <p className="muted">暂无交互历史</p> : null}
          {history.map((item) => (
            <div key={item.id} className="dashboard-card">
              <div className="dashboard-card-title">对话会话 #{item.id}</div>
              <div className="dashboard-card-meta">开始：{formatTime(item.started_at)}</div>
              <div className="dashboard-card-meta">结束：{formatTime(item.ended_at)}</div>
              <div className="dashboard-card-meta">
                轮次：{item.turns} / 输入：{item.input_count} / 输出：{item.output_count}
              </div>
              <div className="dashboard-summary">{item.summary_text || "本次会话暂无可提炼摘要。"}</div>
              <button type="button" className="secondary-btn" onClick={() => openSession(item.id)}>
                {expandedSessionId === item.id ? "收起关键节点" : "展开关键节点"}
              </button>

              {expandedSessionId === item.id ? (
                <div className="timeline-wrap">
                  {buildKeyMoments(sessionDetails[item.id]).map((moment) => (
                    <div key={moment.key} className="timeline-item">
                      <div className={moment.role === "assistant" ? "timeline-dot assistant" : "timeline-dot"} />
                      <div className="timeline-content">
                        <div className="timeline-title">
                          {moment.label}
                          {moment.at ? <span>{formatTime(moment.at)}</span> : null}
                        </div>
                        <div className="timeline-text">{moment.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <div className="row-btns" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="secondary-btn"
              disabled={historyPage <= 1}
              onClick={() => loadAll(modelPage, historyPage - 1)}
            >
              历史上一页
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={historyPage * historyMeta.pageSize >= historyMeta.total}
              onClick={() => loadAll(modelPage, historyPage + 1)}
            >
              历史下一页
            </button>
          </div>
        </section>

      </div>
    </ShellLayout>
  );
}
