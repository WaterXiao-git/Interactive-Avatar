const PRESET_NAME_MAP = {
  male: "男人",
  man: "男人",
  female: "女人",
  women: "女人",
  woman: "女人",
  doctor: "医生",
  worker: "工人",
  mummy: "木乃伊",
  sammy: "萨米",
};

const ACTION_NAME_MAP = {
  "Standing Idle": "站立待机",
  Waving: "挥手",
  Listening: "倾听",
  Talking1: "说话动作1",
  Talking2: "说话动作2",
  Talking3: "说话动作3",
  "Opening": "开场动作",
  "Dismissing Gesture": "示意动作",
  "Pick Fruit": "摘取动作",
  "Pulling Lever": "拉杆动作",
  Salute: "敬礼",
};

function normalizeName(value) {
  return String(value || "").trim();
}

export function toChinesePresetName(name) {
  const raw = normalizeName(name);
  if (!raw) return "";
  const key = raw.toLowerCase();
  return PRESET_NAME_MAP[key] || raw;
}

export function toChineseAnimationName(name) {
  const raw = normalizeName(name);
  if (!raw) return "";
  return ACTION_NAME_MAP[raw] || raw;
}
