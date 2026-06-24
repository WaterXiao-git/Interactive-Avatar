import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  HiOutlineArrowRight,
  HiOutlineBolt,
  HiOutlineChatBubbleLeftRight,
  HiOutlineCommandLine,
  HiOutlinePhoto,
  HiOutlineSparkles,
} from "react-icons/hi2";
import {
  SiDocker,
  SiGithub,
  SiMysql,
  SiOpenai,
  SiPostgresql,
  SiReact,
  SiSqlite,
  SiVite,
  SiVuedotjs,
} from "react-icons/si";
import { useAuth } from "../../context/AuthContext";
import "./IntroDirectusPage.refine.css";

const TRUST_LOGOS = [
  { name: "PostgreSQL", icon: SiPostgresql },
  { name: "MySQL", icon: SiMysql },
  { name: "SQLite", icon: SiSqlite },
  { name: "Docker", icon: SiDocker },
  { name: "React", icon: SiReact },
  { name: "Vue", icon: SiVuedotjs },
  { name: "OpenAI", icon: SiOpenai },
  { name: "Vite", icon: SiVite },
  { name: "GitHub", icon: SiGithub },
];

const SOCIAL_PROOF = [
  { value: "4 条", label: "核心工作流" },
  { value: "10 分钟", label: "首个角色落地" },
  { value: "24 ms", label: "语音响应时间" },
  { value: "100 %", label: "交互成功率" },
];

const HERO_ANCHORS = ["端到端工作流", "形象生成", "实时交互", "数据回流", "团队协作", "稳定可靠"];

const USE_CASES = [
  {
    title: "展会讲解",
    description: "快速生成品牌讲解员，接入场景模板和实时对话，适合线下接待与产品演示。",
    stat: "场景模板 12 套",
    image: "/intro-real/full-interact.png",
    alt: "展会讲解场景占位图",
  },
  {
    title: "趣味教育",
    description: "把知识和互动结合起来，在交互中学习知识，让学习过程更有趣 。",
    stat: "课程互动 100%",
    image: "/intro-real/education.png",
    alt: "趣味教育场景占位图",
  },
  {
    title: "数字导购",
    description: "角色、知识和交互脚本结构化管理，更容易持续迭代，不会停留在单次 Demo。",
    stat: "商品信息自动回复",
    image: "/intro-real/shopping.png",
    alt: "数字导购场景占位图",
  },
  {
    title: "在线客服",
    description: "把 AI 回复、动作反馈和会话历史连在一起，让体验更像产品系统。",
    stat: "接口层已就绪",
    image: "/intro-real/service.png",
    alt: "在线客服场景占位图",
  },
];

const WORKSPACE_STAGES = [
  {
    key: "create",
    label: "形象生成",
    eyebrow: "角色创建工作台",
    title: "从一句描述开始生成可用数字人",
    description: "支持文本描述、图片参考与预设模板，多种输入汇聚统一入口，即刻生成可用角色。",
    chips: ["文本生成", "图片参考", "预设模板"],
    status: "当前产物：基础角色模型",
    command: "ia create --prompt \"品牌讲解员，科技展会风格\"",
    metrics: [
      { label: "资产草稿", value: "12" },
      { label: "生成耗时", value: "02:18" },
      { label: "通过率", value: "91%" },
    ],
    outputs: ["角色设定稿已锁定", "封面草图 3 版已生成", "准备进入骨骼与动作阶段"],
    icon: HiOutlineSparkles,
  },
  {
    key: "rig",
    label: "辅助绑定",
    eyebrow: "动作准备面板",
    title: "在交互前完成骨骼、动作和稳定性确认",
    description: "骨骼映射、动作预览与质量校验集成一处，技术准备像产品流程一样顺畅。",
    chips: ["点位检查", "动作预览", "质量校验"],
    status: "当前产物：会“动”的角色",
    command: "ia rig --preset expo-host --validate motion",
    metrics: [
      { label: "绑定点位", value: "24" },
      { label: "异常动作", value: "2" },
      { label: "稳定评分", value: "96%" },
    ],
    outputs: ["骨骼映射已自动完成", "口型与挥手动作通过预检", "已准备进入场景排布"],
    icon: HiOutlineBolt,
  },
  {
    key: "scene",
    label: "场景预览",
    eyebrow: "场景布局预览",
    title: "先确认展示效果，再开放实时对话",
    description: "背景、灯光、镜头和站位先在场景层预先排布，首轮体验更稳定。",
    chips: ["场景生成", "镜头预览", "展示布局"],
    status: "当前产物：完整展示场景",
    command: "ia scene --template tech-expo --camera medium-shot",
    metrics: [
      { label: "可选镜头", value: "08" },
      { label: "场景版本", value: "14+" },
      { label: "渲染评分", value: "94%" },
    ],
    outputs: ["科技展厅模板已应用", "角色、灯光与背景层已对齐", "等待打开实时语音入口"],
    icon: HiOutlinePhoto,
  },
  {
    key: "interact",
    label: "交互会话",
    eyebrow: "实时交互与记录",
    title: "语音、动作和结果沉淀同步发生",
    description: "交互中支持挥手触发、自动结束、摘要提炼和录屏归档，形成闭环。",
    chips: ["语音流", "动作反馈", "总结回流"],
    status: "当前产物：实时交互畅聊",
    command: "ia interact --stream voice --gesture wave --summary auto",
    metrics: [
      { label: "在线会话", value: "03" },
      { label: "平均时长", value: "06:42" },
      { label: "总结完成", value: "100%" },
    ],
    outputs: ["挥手触发已联动语音流", "会话摘要自动回流看板", "录屏与历史记录可直接复盘"],
    icon: HiOutlineChatBubbleLeftRight,
  },
];

const ACTIVITY_FEED = [
  "新角色「品牌讲解员」已生成",
  "动作预览已通过，等待进入场景配置",
  "场景「科技展厅」已保存",
  "用户挥手触发成功，语音流已连接",
  "会话摘要已回流到数据看板",
  "录屏已生成，可用于复盘与分享",
];

const STAGE_ART = {
  create: "/intro-real/create_small.png",
  rig: "/intro-real/rig_small.png",
  scene: "/intro-real/scene_small.png",
  interact: "/intro-real/full-interact.png",
  full_interact: "/intro-real/full-interact.png",
};

const PRODUCT_SURFACES = [
  {
    title: "数据回流看板",
    description: "会话记录、模型资产与操作日志一站式沉淀，助力运营高效复盘与持续优化。",
    image: "/intro-real/dashboard.png",
    secondaryImage: "/intro-real/dashboard2.png",
    alt: "数据看板预览",
    secondaryAlt: "数据看板补充视图",
    tone: "desktop",
  },
  {
    title: "移动端会话入口",
    description: "适配移动设备的交互页面，随时随地开启展会接待或移动场景下的数字人对话。",
    image: "/intro-real/mobile-1.png",
    alt: "移动端交互预览",
    tone: "mobile",
  },
  {
    title: "移动端结果查看",
    description: "在手机上查看模型资产与结果卡片，打通从创建到回看的完整移动体验。",
    image: "/intro-real/mobile-2.png",
    alt: "移动端结果预览",
    tone: "mobile",
  },
];

export default function IntroDirectusPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [activeStage, setActiveStage] = useState(0);
  const [heroWorkspaceHeight, setHeroWorkspaceHeight] = useState(null);
  const heroCopyRef = useRef(null);

  const primaryLabel = useMemo(() => {
    if (loading) return "加载中...";
    return user ? "开启创作之旅" : "注册并开始体验";
  }, [loading, user]);

  const advanceStage = useEffectEvent(() => {
    setActiveStage((current) => (current + 1) % WORKSPACE_STAGES.length);
  });

  useEffect(() => {
    const timerId = window.setInterval(() => {
      advanceStage();
    }, 4200);

    return () => window.clearInterval(timerId);
  }, []);
  useEffect(() => {
    function syncHeroWorkspaceHeight() {
      if (window.innerWidth <= 1220) {
        setHeroWorkspaceHeight(null);
        return;
      }
      const heroCopy = heroCopyRef.current;
      if (!heroCopy) return;
      const nextHeight = Math.ceil(heroCopy.getBoundingClientRect().height);
      setHeroWorkspaceHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    }

    syncHeroWorkspaceHeight();

    const heroCopy = heroCopyRef.current;
    const resizeObserver =
      heroCopy && typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncHeroWorkspaceHeight) : null;

    if (heroCopy && resizeObserver) {
      resizeObserver.observe(heroCopy);
    }

    window.addEventListener("resize", syncHeroWorkspaceHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncHeroWorkspaceHeight);
    };
  }, []);

  function handlePrimary() {
    if (loading) return;
    navigate(user ? "/create" : "/register");
  }

  function renderStageCanvas(stage) {
    return (
      <div className={`dx-stage-screen dx-stage-screen-${stage.key}`}>
        <div className="dx-stage-art-shell">
          <img className="dx-stage-screenshot" src={STAGE_ART[stage.key]} alt={`${stage.label} workspace preview`} />
        </div>
        <div className="dx-stage-preview-notes">
          {stage.chips.map((chip) => (
            <span key={chip} className="dx-stage-preview-note">{chip}</span>
          ))}
          <span className="dx-stage-preview-status">{stage.status}</span>
        </div>
      </div>
    );
  }

  const currentStage = WORKSPACE_STAGES[activeStage];
  const CurrentStageIcon = currentStage.icon;

  return (
    <div className="dx-directus dx-hybrid-page">
      <section className="page-section first-section nav-offset-normal dx-hero-section">
        <div className="base-container space-small">
          <div className="dx-hero-announcement">
            <span>数字人工作流与实时互动平台</span>
            <Link to={user ? "/create" : "/register"}>开始搭建工作台</Link>
          </div>
        </div>

        <div className="base-container space-small">
          <div className="dx-nav">
            <div className="dx-nav-brand">
              <div className="dx-logo">AI</div>
              <div>
                <p>互动数字人平台</p>
                <h1>数字人工作台系统</h1>
              </div>
            </div>

            <div className="dx-nav-actions">
              <Link to="/intro" className="dx-nav-link">首页</Link>
              {user ? (
                <Link to="/dashboard" className="dx-nav-link">数据看板</Link>
              ) : (
                <Link to="/login" className="dx-nav-link">登录</Link>
              )}
            </div>
          </div>
        </div>

        <div className="base-container space-medium">
          <div className="dx-hero-grid">
            <div className="dx-hero-copy" ref={heroCopyRef}>
              <p className="badge">形象生成、辅助绑定、场景预览、实时会话</p>
              <h2 className="dx-display-title">
                你的数字人平台，
                <span>团队共享工作台。</span>
              </h2>
              <p className="dx-lead">
                从形象生成到数据看板，直观展示数字人创作全链路。让创意落地，使互动高效。
              </p>

              <div className="dx-command-bar">
                <span>npx</span>
                <code>ia-studio init --template expo-host</code>
                <button type="button" aria-label="Copy command">
                  <HiOutlineCommandLine />
                </button>
              </div>

              <div className="buttons dx-hero-actions">
                <button type="button" className="dx-main-btn" onClick={handlePrimary} disabled={loading}>
                  {primaryLabel}
                  <HiOutlineArrowRight />
                </button>
                {user ? (
                  <Link to="/dashboard" className="dx-secondary-btn">查看数据看板</Link>
                ) : (
                  <Link to="/login" className="dx-secondary-btn">已有账号，去登录</Link>
                )}
              </div>

              <div className="dx-anchor-row">
                {HERO_ANCHORS.map((item) => (
                  <span key={item} className="dx-anchor-pill">{item}</span>
                ))}
              </div>

              <div className="dx-social-proof dx-social-proof--hero">
                {SOCIAL_PROOF.map((item) => (
                  <article key={item.label} className="dx-social-proof-item">
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </article>
                ))}
              </div>
            </div>

            <div className="dx-hero-visual" style={heroWorkspaceHeight ? { height: `${heroWorkspaceHeight}px` } : undefined}>
              <div className="dx-hero-visual-frame">
                <div className="dx-hero-visual-head">
                  <div>
                    <p>互动数字人工作台</p>
                    <strong>实时运行看板</strong>
                  </div>
                  <div className="dx-hero-visual-head-tags">
                    <span>实时同步</span>
                    <span>团队协作</span>
                  </div>
                </div>

                <div className="dx-stage-tab-row">
                  {WORKSPACE_STAGES.map((stage, index) => (
                    <button
                      key={stage.key}
                      type="button"
                      className={index === activeStage ? "is-active" : ""}
                      onClick={() => setActiveStage(index)}
                    >
                      {stage.label}
                    </button>
                  ))}
                </div>

                <div className="dx-hero-visual-grid">
                  <div className="dx-hero-main-panel">
                    <div className="dx-stage-overlay-label">{currentStage.eyebrow}</div>
                    <div className="dx-stage-preview-card">{renderStageCanvas(currentStage)}</div>
                  </div>

                  <aside className="dx-hero-side-panel">
                    <div className="dx-panel-dark dx-side-status-board">
                      <div className="dx-side-status-head">
                        <span>运行状态</span>
                        <strong>在线</strong>
                      </div>
                      <div className="dx-side-status-grid">
                        <article>
                          <span>语音流</span>
                          <strong>24ms</strong>
                        </article>
                        <article>
                          <span>动作同步</span>
                          <strong>正常</strong>
                        </article>
                        <article>
                          <span>会话处理</span>
                          <strong>118</strong>
                        </article>
                        <article>
                          <span>数据回流</span>
                          <strong>100%</strong>
                        </article>
                      </div>
                    </div>

                    <div className="dx-stage-bottom-copy dx-stage-bottom-copy-side">
                      <CurrentStageIcon />
                      <div>
                        <strong>{currentStage.title}</strong>
                        <span>{currentStage.description}</span>
                      </div>
                    </div>

                    <div className="dx-stage-metric-strip dx-stage-metric-strip-side">
                      {currentStage.metrics.map((item) => (
                        <article key={item.label} className="dx-stage-metric">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </article>
                      ))}
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="base-container space-small">
          <div className="dx-logo-marquee-shell">
            <p>兼容技术栈</p>
            <div className="dx-logo-marquee">
              <div className="dx-logo-marquee-track">
                {[...TRUST_LOGOS, ...TRUST_LOGOS].map((item, index) => (
                  <span key={`${item.name}-${index}`} className="dx-logo-marquee-item">
                    {item.icon({})}
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section bg-pristine-white-lines space-medium nav-offset-none">
        <div className="base-container space-small">
          <div className="header align-left size-large dx-story-header">
            <p className="badge">产品架构</p>
            <h3 className="heading">用清晰的架构展示，把数字人的价值讲完整</h3>
            <p className="text">
              我们将产品叙事、真实界面与运行状态分层呈现，帮助用户在短时间内全面理解数字人系统的核心能力。
            </p>
          </div>
        </div>

        <div className="base-container space-small">
          <div className="dx-story-grid">
            <article className="dx-story-card dx-story-card-large">
              <div className="dx-story-copy">
                <p>01 / 产品叙事</p>
                <h4>工作台驱动核心创作流程</h4>
                <span>
                  集成创建、交互与回流链路，提供实时可切换的运行视图，直观呈现系统完整工作流。
                </span>
              </div>
              <div className="dx-process-board">
                <div className="dx-process-rail" />
                {WORKSPACE_STAGES.map((stage, index) => (
                  <article key={stage.key} className={`dx-process-node ${index === activeStage ? "is-active" : ""}`}>
                    <strong>{stage.label}</strong>
                    <span>{stage.eyebrow}</span>
                  </article>
                ))}
              </div>
            </article>

            <article className="dx-story-card dx-story-card-dark">
              <div className="dx-story-copy">
                <p>02 / 真实界面展示</p>
                <h4>真实界面截图，所见即所得</h4>
                <span>内容编辑、素材管理、交互预览与结果回放以分层画面呈现，让产品功能一目了然。</span>
              </div>
              <div className="dx-window-stack">
                <figure className="dx-window-shot window-a">
                  <img src={STAGE_ART.full_interact} alt="形象生成页面预览" />
                </figure>
                <figure className="dx-window-shot window-b">
                  <img src={STAGE_ART.scene} alt="场景预览页面预览" />
                </figure>
                <figure className="dx-window-shot window-c">
                  <img src="/intro-real/dashboard.png" alt="数据看板页面预览" />
                </figure>
              </div>
            </article>

            <article className="dx-story-card dx-story-card-monitor">
              <div className="dx-story-copy">
                <p>03 / 运行状态层</p>
                <h4>实时运行状态，彰显系统可靠性</h4>
                <span>实时状态、吞吐数据与命令反馈直观展示，准确传达系统的稳定性与性能。</span>
              </div>
              <div className="dx-monitor-board">
                <div className="dx-monitor-grid" />
                <div className="dx-monitor-glow" />
                <div className="dx-monitor-stats">
                  <article>
                    <span>实时响应</span>
                    <strong>24 ms</strong>
                  </article>
                  <article>
                    <span>会话记录</span>
                    <strong>118</strong>
                  </article>
                  <article>
                    <span>摘要完成</span>
                    <strong>100%</strong>
                  </article>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="page-section bg-simple-gray space-medium nav-offset-none">
        <div className="base-container space-small">
          <div className="header align-left size-large dx-story-header">
            <p className="badge">业务场景应用</p>
            <h3 className="heading">将数字人能力落到真实场景</h3>
            <p className="text">
              覆盖展会讲解、企业培训、数字导购与在线客服等典型场景，直观展示数字人如何创造实际价值。
            </p>
          </div>
        </div>

        <div className="base-container space-small">
          <div className="dx-usecase-grid dx-usecase-grid-showcase">
            {USE_CASES.map((item) => (
              <article key={item.title} className="dx-usecase-card dx-usecase-card-showcase">
                <figure className="dx-usecase-shot">
                  <img src={item.image} alt={item.alt} />
                </figure>
                <div className="dx-usecase-copy">
                  <h4>{item.title}</h4>
                  <p>{item.description}</p>
                  <span>{item.stat}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="base-container space-small">
          <div className="dx-activity-shell">
            <div className="dx-activity-column dx-activity-column-flow">
              <div className="dx-activity-head">
                <p>流程状态</p>
                <span>实时播放中</span>
              </div>
              <div className="dx-flow-graph">
                <div className="dx-flow-node node-a">形象生成</div>
                <div className="dx-flow-node node-b">辅助绑定</div>
                <div className="dx-flow-node node-c">场景预览</div>
                <div className="dx-flow-node node-d">交互会话</div>
                <div className="dx-flow-line line-ab" />
                <div className="dx-flow-line line-bc" />
                <div className="dx-flow-line line-cd" />
              </div>
            </div>

            <div className="dx-activity-column dx-activity-column-feed">
              <div className="dx-activity-head">
                <p>运行动态</p>
                <span>状态可追踪</span>
              </div>
              <div className="dx-activity-list">
                <div className="dx-activity-track">
                  {[...ACTIVITY_FEED, ...ACTIVITY_FEED].map((item, index) => (
                    <article key={`${item}-${index}`} className="dx-activity-item">
                      <HiOutlineSparkles />
                      <span>{item}</span>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section bg-pristine-white-lines space-medium nav-offset-none">
        <div className="base-container space-small">
          <div className="header align-left size-large dx-story-header">
            <p className="badge">桌面端、移动端与看板</p>
            <h3 className="heading">支持桌面工作台、移动看板，构建完整产品矩阵</h3>
            <p className="text">
              采用真实业务页面截图，直观呈现从创作到数据回流的多端协同体验。
            </p>
          </div>
        </div>

        <div className="base-container space-small">
          <div className="dx-surface-grid">
            <article className="dx-surface-card dx-surface-card-desktop">
              <div className="dx-surface-copy">
                <p>桌面工作台</p>
                <h4>{PRODUCT_SURFACES[0].title}</h4>
                <span>{PRODUCT_SURFACES[0].description}</span>
              </div>
              <div className="dx-surface-desktop-stack">
                <figure className="dx-surface-shot dx-surface-shot-desktop">
                  <img src={PRODUCT_SURFACES[0].image} alt={PRODUCT_SURFACES[0].alt} />
                </figure>
                <figure className="dx-surface-shot dx-surface-shot-desktop dx-surface-shot-desktop-secondary">
                  <img
                    src={PRODUCT_SURFACES[0].secondaryImage}
                    alt={PRODUCT_SURFACES[0].secondaryAlt}
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = PRODUCT_SURFACES[0].image;
                    }}
                  />
                </figure>
              </div>
            </article>

            <div className="dx-surface-mobile-column">
              {PRODUCT_SURFACES.slice(1).map((item) => (
                <article key={item.title} className="dx-surface-card dx-surface-card-mobile">
                  <div className="dx-surface-copy">
                    <p>移动端入口</p>
                    <h4>{item.title}</h4>
                    <span>{item.description}</span>
                  </div>
                  <figure className="dx-surface-shot dx-surface-shot-mobile">
                    <img src={item.image} alt={item.alt} />
                  </figure>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="page-section bg-simple-gray space-medium nav-offset-none">
        <div className="base-container space-medium">
          <div className="base-panel-container dx-cta-shell">
            <div className="base-panel dx-cta-panel dx-cta-panel-rich">
              <div className="base-panel-content">
                <p className="badge">开始使用</p>
                <h3 className="heading">立即体验，开启数字人创作之旅</h3>
                <p className="text">
                  首页已集成真实业务页面、关键流程与数据回流，呈现完整产品体验。我们将持续围绕实际场景打磨，加速您的业务落地。
                </p>
              </div>
              <div className="base-panel-footer dx-cta-actions">
                <button type="button" className="dx-main-btn" onClick={handlePrimary} disabled={loading}>
                  {primaryLabel}
                  <HiOutlineArrowRight />
                </button>
                {user ? (
                  <Link to="/create" className="dx-secondary-btn">直接进入创建页</Link>
                ) : (
                  <Link to="/register" className="dx-secondary-btn">先注册账号</Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
