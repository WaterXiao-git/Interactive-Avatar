import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HiOutlineArrowRight,
  HiOutlineBolt,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineLockClosed,
  HiOutlineShieldCheck,
  HiOutlineUser,
} from "react-icons/hi2";
import AuthLayout from "../components/AuthLayout";
import TurnstileWidget from "../components/TurnstileWidget";
import { authRequestCaptcha, authResetPassword, authSendResetCode } from "../lib/api";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [captcha, setCaptcha] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [widgetSeed, setWidgetSeed] = useState(0);
  const [smsCode, setSmsCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  const isTurnstile = captcha?.provider === "turnstile";

  useEffect(() => {
    refreshCaptcha();
  }, []);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCountdown((current) => (current > 1 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function refreshCaptcha() {
    try {
      const data = await authRequestCaptcha("reset_password");
      setCaptcha(data);
      setCaptchaAnswer("");
      setTurnstileToken("");
      setWidgetSeed((current) => current + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  function ensureHumanVerificationReady() {
    if (isTurnstile) {
      if (!turnstileToken) {
        setError("请先完成人机验证");
        return false;
      }
      return true;
    }

    if (!captchaAnswer.trim()) {
      setError("请先完成人机验证");
      return false;
    }
    if (!captcha?.challenge_id) {
      setError("人机验证已失效，请刷新后重试");
      return false;
    }
    return true;
  }

  async function handleSendCode() {
    if (!phoneNumber.trim()) {
      setError("请输入手机号");
      return;
    }
    if (!ensureHumanVerificationReady()) {
      return;
    }

    setSendingCode(true);
    setError("");
    setHint("");
    try {
      const data = await authSendResetCode(
        phoneNumber.trim(),
        captcha?.challenge_id || "",
        captchaAnswer.trim(),
        turnstileToken,
      );
      setCountdown(data.retry_after_seconds || 60);
      setHint(`验证码已发送至 ${data.masked_phone_number}`);
      await refreshCaptcha();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingCode(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setHint("");
    try {
      const data = await authResetPassword(phoneNumber.trim(), smsCode.trim(), newPassword);
      setHint(data.message || "密码已重置");
      window.setTimeout(() => navigate("/login", { replace: true }), 900);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      mode="login"
      formTitle="重置密码"
      formSubtitle="通过手机号和短信验证码完成密码重置，成功后返回登录页。"
      footerPrompt="想起密码了？"
      footerLinkText="返回登录"
      footerLinkTo="/login"
    >
      <form className="auth-form-grid" onSubmit={onSubmit}>
        <label className="auth-field">
          <span className="auth-field-label">手机号</span>
          <span className="auth-input-wrap">
            <HiOutlineUser />
            <input
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="请输入绑定的中国大陆手机号"
              autoComplete="tel"
            />
          </span>
        </label>

        <div className="auth-field auth-captcha-stack">
          <span className="auth-field-label">人机验证</span>
          {isTurnstile ? (
            <>
              <div className="auth-inline-row auth-inline-row--captcha">
                <div className="auth-turnstile-panel">
                  <TurnstileWidget
                    siteKey={captcha?.site_key}
                    action={captcha?.action || "reset_password"}
                    resetKey={widgetSeed}
                    onVerify={(token) => {
                      setTurnstileToken(token);
                      setError("");
                    }}
                    onExpire={() => setTurnstileToken("")}
                    onError={() => setError("人机验证加载失败，请刷新后重试")}
                  />
                </div>
                <button type="button" className="auth-ghost-btn" onClick={refreshCaptcha}>
                  重新加载验证
                </button>
              </div>
              <div className="auth-submit-meta">
                已配置 Cloudflare Turnstile，将优先使用正式人机验证。
              </div>
            </>
          ) : (
            <>
              <div className="auth-inline-row auth-inline-row--captcha">
                <span className="auth-captcha-prompt">
                  <HiOutlineShieldCheck />
                  <strong>{captcha?.prompt || "加载中..."}</strong>
                </span>
                <button type="button" className="auth-ghost-btn" onClick={refreshCaptcha}>
                  刷新题目
                </button>
              </div>
              <span className="auth-input-wrap">
                <HiOutlineShieldCheck />
                <input
                  value={captchaAnswer}
                  onChange={(event) => setCaptchaAnswer(event.target.value)}
                  placeholder="请输入上方答案"
                />
              </span>
            </>
          )}
        </div>

        <div className="auth-field">
          <span className="auth-field-label">短信验证码</span>
          <div className="auth-inline-row">
            <span className="auth-input-wrap">
              <HiOutlineBolt />
              <input
                value={smsCode}
                onChange={(event) => setSmsCode(event.target.value)}
                placeholder="请输入 6 位验证码"
                inputMode="numeric"
              />
            </span>
            <button
              type="button"
              className="auth-send-code-btn"
              onClick={handleSendCode}
              disabled={sendingCode || countdown > 0}
            >
              {countdown > 0 ? `${countdown}s 后重试` : sendingCode ? "发送中..." : "获取验证码"}
            </button>
          </div>
        </div>

        <label className="auth-field">
          <span className="auth-field-label">新密码</span>
          <span className="auth-input-wrap auth-input-wrap-password">
            <HiOutlineLockClosed />
            <input
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="至少 8 位，建议包含字母和数字"
              autoComplete="new-password"
            />
            <button
              type="button"
              className="auth-input-toggle"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
            >
              {showPassword ? <HiOutlineEyeSlash /> : <HiOutlineEye />}
            </button>
          </span>
        </label>

        {hint ? <div className="auth-submit-meta">{hint}</div> : null}
        {error ? <div className="auth-error-box">{error}</div> : null}

        <button type="submit" className="auth-submit-btn" disabled={busy}>
          <span>{busy ? "重置中..." : "重置密码"}</span>
          <HiOutlineArrowRight />
        </button>
      </form>
    </AuthLayout>
  );
}
