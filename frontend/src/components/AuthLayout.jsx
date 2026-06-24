import { Link } from "react-router-dom";

const AUTH_CONTENT = {
  login: {
    eyebrow: "账号登录",
    heroTitle: "登录后继续创作流程",
    heroText:
      "统一的账号入口，让各个步骤环环相扣，确保你的创作思路连贯顺畅。",
    previewLabel: "实时交互",
    previewTitle: "丰富场景，各类角色，多种动作，任你自由创作",
    previewText:
      "登录后可以继续编辑角色、查看会话摘要与数据回流，也可以直接进入交互页面进行演示和调试。",
    previewImage: "/intro-real/full-interact.png",
    previewAlt: "实时交互预览",
    metrics: [
      { value: "24 ms", label: "实时响应" },
      { value: "4 步", label: "完整流程" },
      { value: "100%", label: "结果回流" },
    ],
  },
  register: {
    eyebrow: "创建账号",
    heroTitle: "注册后开始创作之旅",
    heroText:
      "以账号注册为起点，角色、素材与场景配置同步开启。",
    previewLabel: "数据看板",
    previewTitle: "实时记录交互历史，捕捉精彩瞬间，呈现精彩看板",
    previewText:
      "注册成功后可以直接进入角色创建、选择模板、上传参考图，再推进到场景预览与交互阶段。",
    previewImage: "/intro-real/dashboard.png",
    previewAlt: "角色创建工作台预览",
    metrics: [
      { value: "10 分钟", label: "首个角色落地" },
      { value: "模板 + 图片", label: "多入口创建" },
      { value: "1 个账号", label: "统一工作台" },
    ],
  },
};

export default function AuthLayout({
  mode,
  formTitle,
  formSubtitle,
  children,
  footerPrompt,
  footerLinkText,
  footerLinkTo,
}) {
  const content = AUTH_CONTENT[mode] || AUTH_CONTENT.login;

  return (
    <div className={`auth-page auth-page--${mode}`}>
      <div className="auth-page-shell">
        <section className="auth-showcase-panel">
          <Link to="/intro" className="auth-brand-lockup">
            <span className="auth-brand-mark">AI</span>
            <span className="auth-brand-copy">
              <strong>互动数字人平台</strong>
              <small>Digital Human Studio</small>
            </span>
          </Link>

          <div className="auth-showcase-copy">
            <p className="auth-kicker">{content.eyebrow}</p>
            <h1>{content.heroTitle}</h1>
            <p>{content.heroText}</p>
          </div>

          <div className="auth-preview-card">
            <div className="auth-preview-head">
              <div>
                <p>{content.previewLabel}</p>
                <strong>{content.previewTitle}</strong>
              </div>
              <span>产品视图</span>
            </div>
            <figure className="auth-preview-shot">
              <img src={content.previewImage} alt={content.previewAlt} />
            </figure>
            <p className="auth-preview-text">{content.previewText}</p>
          </div>

          <div className="auth-metric-row">
            {content.metrics.map((item) => (
              <article key={item.label} className="auth-metric-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="auth-form-panel">
          <div className="auth-form-card">
            <div className="auth-form-topbar">
              <Link to="/intro">返回首页</Link>
              <span>统一账号入口</span>
            </div>

            <div className="auth-form-copy">
              <p className="auth-kicker">{content.eyebrow}</p>
              <h2>{formTitle}</h2>
              <span>{formSubtitle}</span>
            </div>

            <div className="auth-mode-switch" role="tablist" aria-label="认证模式切换">
              <Link to="/login" className={mode === "login" ? "is-active" : ""}>
                登录
              </Link>
              <Link to="/register" className={mode === "register" ? "is-active" : ""}>
                注册
              </Link>
            </div>

            {children}

            <p className="auth-inline-foot">
              {footerPrompt}
              <Link to={footerLinkTo}>{footerLinkText}</Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
