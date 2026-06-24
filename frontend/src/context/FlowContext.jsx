import { createContext, useContext, useMemo, useState } from "react";

const FlowContext = createContext(null);

const initialMarkers = {
  chin: null,
  groin: null,
  wrist_left: null,
  wrist_right: null,
  elbow_left: null,
  elbow_right: null,
  knee_left: null,
  knee_right: null,
};

export function FlowProvider({ children }) {
  const [modelResult, setModelResult] = useState(null);
  const [markers, setMarkers] = useState(initialMarkers);
  const [selectedAnimation, setSelectedAnimation] = useState(null);
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [presetName, setPresetName] = useState("");
  const [modelId, setModelId] = useState(null);
  const [actionMap, setActionMap] = useState(null);

  const resetMarkers = () => setMarkers(initialMarkers);

  const value = useMemo(
    () => ({
      modelResult,
      setModelResult,
      markers,
      setMarkers,
      resetMarkers,
      selectedAnimation,
      setSelectedAnimation,
      sourceImageUrl,
      setSourceImageUrl,
      presetName,
      setPresetName,
      modelId,
      setModelId,
      actionMap,
      setActionMap,
    }),
    [modelResult, markers, selectedAnimation, sourceImageUrl, presetName, modelId, actionMap],
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const context = useContext(FlowContext);
  if (!context) {
    throw new Error("useFlow must be used inside FlowProvider");
  }
  return context;
}

export const MARKER_ORDER = [
  "chin",
  "groin",
  "wrist_left",
  "wrist_right",
  "elbow_left",
  "elbow_right",
  "knee_left",
  "knee_right",
];

export const MARKER_LABELS = {
  chin: "下巴",
  groin: "胯部",
  wrist_left: "左手腕",
  wrist_right: "右手腕",
  elbow_left: "左手肘",
  elbow_right: "右手肘",
  knee_left: "左膝盖",
  knee_right: "右膝盖",
};
