import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      navigate("/create", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell auth-shell">
      <section className="glass-panel auth-panel">
        <h2>登录</h2>
        <form onSubmit={onSubmit}>
          <label className="field-label">用户名</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" />
          <label className="field-label">密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
          {error ? <div className="status-box">{error}</div> : null}
          <button type="submit" className="confirm-btn" disabled={busy}>
            {busy ? "登录中..." : "登录"}
          </button>
        </form>
        <p className="muted">没有账号？<Link to="/register">去注册</Link></p>
      </section>
    </div>
  );
}
