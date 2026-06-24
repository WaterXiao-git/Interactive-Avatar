import { Navigate, useLocation } from "react-router-dom";
import ShellLayout from "../components/ShellLayout";
import { useFlow } from "../context/FlowContext";
import InteractiveAvatarScene from "../components/avatar/InteractiveAvatarScene";
import { DEV_BYPASS_FLOW } from "../lib/devMode";

export default function InteractPage() {
  const location = useLocation();
  const { modelResult, presetName, modelId } = useFlow();
  const activeModelId = modelId || location.state?.modelId || null;

  if (!modelResult?.output_model_url && !DEV_BYPASS_FLOW) {
    return <Navigate to="/create" replace />;
  }

  return (
    <ShellLayout
      title="交互会话"
      subtitle="可通过挥手或手动按钮进入语音会话。"
    >
      <section className="glass-panel full-stage">
        {!modelResult?.output_model_url && DEV_BYPASS_FLOW ? (
          <p className="muted">开发模式：已绕过流程前置条件，可直接调试交互页。</p>
        ) : null}
        <InteractiveAvatarScene
          avatarModelUrl={modelResult?.output_model_url || "/models/avatar.fbx"}
          actionBasePath={presetName ? `/assets/presets/${presetName}/animations` : "/animations"}
          modelId={activeModelId}
        />
      </section>
    </ShellLayout>
  );
}
