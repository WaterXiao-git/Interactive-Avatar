const explicit = import.meta.env.VITE_DEV_BYPASS_FLOW;

export const DEV_BYPASS_FLOW =
  explicit === "1" || (import.meta.env.DEV && explicit !== "0");
