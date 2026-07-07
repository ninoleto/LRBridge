const state = {
  activeModule: "unknown",
  selectedPhotoKey: null,
  contextCounter: 0,
  contextChangedAt: null,
  developCounter: 0,
  developChangedAt: null,
  lastHeartbeatAt: null,
  developFingerprint: null
};

function normalizeNullable(value) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  if (text.length === 0 || text === "null" || text === "undefined") return null;
  return text;
}

function normalizeModule(value) {
  return normalizeNullable(value) || "unknown";
}

function updateContext(input) {
  const now = Date.now();
  const nextActiveModule = normalizeModule(input.activeModule);
  const nextSelectedPhotoKey = normalizeNullable(input.selectedPhotoKey);
  const nextDevelopFingerprint = normalizeNullable(input.developFingerprint);

  if (state.activeModule !== nextActiveModule || state.selectedPhotoKey !== nextSelectedPhotoKey) {
    state.activeModule = nextActiveModule;
    state.selectedPhotoKey = nextSelectedPhotoKey;
    state.contextCounter += 1;
    state.contextChangedAt = now;
  }

  if (nextDevelopFingerprint !== null && state.developFingerprint !== nextDevelopFingerprint) {
    state.developFingerprint = nextDevelopFingerprint;
    state.developCounter += 1;
    state.developChangedAt = now;
  }

  state.lastHeartbeatAt = now;
  return getContextFields();
}

function getContextFields() {
  return {
    activeModule: state.activeModule,
    selectedPhotoKey: state.selectedPhotoKey,
    contextCounter: state.contextCounter,
    contextChangedAt: state.contextChangedAt,
    developCounter: state.developCounter,
    developChangedAt: state.developChangedAt,
    lastHeartbeatAt: state.lastHeartbeatAt
  };
}

function getContext(queueLength) {
  return Object.assign({ ok: true, queueLength: queueLength || 0 }, getContextFields());
}

module.exports = {
  updateContext,
  getContext,
  getContextFields
};
