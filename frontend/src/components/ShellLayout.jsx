import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const steps = [
  { path: "/create", title: "1. 形象生成" },
  { path: "/rig-preview", title: "2. 辅助绑定" },
  { path: "/interact", title: "3. 交互会话" },
];

export default function ShellLayout({ title, subtitle, children }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-tag">互动数字人</p>
          <h1>{title}</h1>
          <p className="app-subtitle">{subtitle}</p>
        </div>
        <nav className="step-nav" aria-label="流程步骤">
          <Link to="/dashboard" className={location.pathname === "/dashboard" ? "step-link active" : "step-link"}>
            数据看板
          </Link>
          {steps.map((step) => {
            const active = location.pathname === step.path;
            return (
              <Link key={step.path} to={step.path} className={active ? "step-link active" : "step-link"}>
                {step.title}
              </Link>
            );
          })}
          {user ? <span className="step-link">@{user.username}</span> : null}
          {user ? (
            <button type="button" className="step-link" onClick={logout}>
              退出
            </button>
          ) : null}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
