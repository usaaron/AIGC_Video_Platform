const state = {
  config: null,
  activeStage: null,
  stages: {},
  busy: false,
};

const elements = {
  serviceStatus: document.querySelector("#service-status"),
  tabs: document.querySelector("#stage-tabs"),
  title: document.querySelector("#stage-title"),
  description: document.querySelector("#stage-description"),
  input: document.querySelector("#stage-input"),
  inputCount: document.querySelector("#input-count"),
  fileInput: document.querySelector("#file-input"),
  uploadZone: document.querySelector("#upload-zone"),
  fileList: document.querySelector("#file-list"),
  modelList: document.querySelector("#model-list"),
  selectionCount: document.querySelector("#selection-count"),
  run: document.querySelector("#run-evaluation"),
  clear: document.querySelector("#clear-stage"),
  message: document.querySelector("#action-message"),
  emptyResults: document.querySelector("#empty-results"),
  resultGrid: document.querySelector("#result-grid"),
  runMeta: document.querySelector("#run-meta"),
};

async function initialize() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("配置读取失败");
    state.config = await response.json();
    for (const stage of state.config.stages) {
      state.stages[stage.id] = {
        input: "",
        files: [],
        run: null,
      };
    }
    state.activeStage = state.config.stages[0]?.id ?? null;
    elements.serviceStatus.classList.add("online");
    render();
  } catch (error) {
    elements.serviceStatus.classList.add("offline");
    elements.message.textContent = error instanceof Error ? error.message : "本地服务不可用";
  }
}

function currentDefinition() {
  return state.config.stages.find((stage) => stage.id === state.activeStage);
}

function currentState() {
  return state.stages[state.activeStage];
}

function render() {
  const definition = currentDefinition();
  const stage = currentState();
  if (!definition || !stage) return;
  renderTabs();
  elements.title.textContent = definition.label;
  elements.description.textContent = definition.description;
  elements.input.placeholder = definition.placeholder;
  elements.input.value = stage.input;
  renderInputCount();
  renderFiles();
  renderModels();
  renderResults();
  syncRunButton();
}

function renderTabs() {
  elements.tabs.replaceChildren(...state.config.stages.map((stage) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `stage-tab${stage.id === state.activeStage ? " active" : ""}`;
    button.textContent = stage.short_label;
    button.addEventListener("click", () => switchStage(stage.id));
    return button;
  }));
}

function switchStage(stageId) {
  currentState().input = elements.input.value;
  state.activeStage = stageId;
  elements.message.textContent = "";
  render();
}

function renderInputCount() {
  const stage = currentState();
  const fileCharacters = stage.files.reduce((total, file) => total + (file.estimatedCharacters ?? 0), 0);
  elements.inputCount.textContent = (stage.input.length + fileCharacters).toLocaleString("zh-CN");
}

function renderFiles() {
  const rows = currentState().files.map((file, index) => {
    const row = document.createElement("div");
    row.className = "file-row";
    const name = document.createElement("span");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = formatBytes(file.size_bytes);
    const remove = document.createElement("button");
    remove.className = "remove-file";
    remove.type = "button";
    remove.title = "移除文件";
    remove.setAttribute("aria-label", `移除 ${file.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      currentState().files.splice(index, 1);
      renderFiles();
      renderInputCount();
      syncRunButton();
    });
    row.append(name, size, remove);
    return row;
  });
  elements.fileList.replaceChildren(...rows);
}

function renderModels() {
  const definition = currentDefinition();
  const configuredModels = definition.models.filter((model) => model.configured);
  if (!definition.models.length) {
    const empty = document.createElement("p");
    empty.className = "action-message";
    empty.textContent = "本阶段还没有模型配置。";
    elements.modelList.replaceChildren(empty);
    elements.selectionCount.textContent = "0 个并行";
    return;
  }
  const options = definition.models.map((model) => {
    const label = document.createElement("div");
    label.className = `model-option${model.configured ? " configured" : " unconfigured"}`;
    const status = document.createElement("span");
    status.className = "model-status-dot";
    status.title = model.configured ? "将参加本次并行测试" : "请先完成配置";
    const detail = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = model.label;
    const modelName = document.createElement("small");
    modelName.textContent = `${model.model} · ${model.route}`;
    const runtime = document.createElement("small");
    runtime.textContent = [model.wire_api, model.reasoning_effort, model.thinking_mode].filter(Boolean).join(" · ");
    detail.append(name, modelName, runtime);
    label.append(status, detail);
    return label;
  });
  elements.modelList.replaceChildren(...options);
  elements.selectionCount.textContent = `${configuredModels.length} 个并行`;
}

function renderResults() {
  const run = currentState().run;
  elements.emptyResults.hidden = Boolean(run);
  elements.runMeta.textContent = run
    ? `${formatTimestamp(run.submitted_at)} · ${run.parallel_model_count} 个模型 · 同一输入 ${run.shared_input_fingerprint}`
    : "";
  if (!run) {
    elements.resultGrid.replaceChildren();
    return;
  }
  elements.resultGrid.replaceChildren(...run.results.map((result) => resultCard(result, run)));
}

function resultCard(result, run) {
  const card = document.createElement("article");
  card.className = "result-card";
  const header = document.createElement("header");
  header.className = "result-header";
  const title = document.createElement("div");
  title.className = "result-title";
  const label = document.createElement("strong");
  label.textContent = result.label;
  const model = document.createElement("span");
  model.textContent = result.model;
  title.append(label, model);
  const actions = document.createElement("div");
  actions.className = "result-actions";
  const stats = document.createElement("span");
  stats.className = `result-stats status-${result.status}`;
  stats.textContent = result.status === "completed"
    ? `${formatDuration(result.latency_ms)} · ${result.character_count.toLocaleString("zh-CN")} 字`
    : result.status === "partial"
      ? `${formatDuration(result.latency_ms)} · ${result.character_count.toLocaleString("zh-CN")} 字 · 部分结果`
      : "生成失败";
  actions.append(stats);
  if (result.output) {
    const download = document.createElement("button");
    download.type = "button";
    download.className = "download-button";
    download.textContent = "下载";
    download.addEventListener("click", () => downloadResult(result, run));
    actions.append(download);
  }
  header.append(title, actions);
  card.append(header);
  if (result.output) {
    const output = document.createElement("pre");
    output.className = "result-output";
    output.textContent = result.output;
    card.append(output);
    if (result.error) {
      const notice = document.createElement("div");
      notice.className = "result-error result-partial-notice";
      notice.textContent = result.error;
      card.append(notice);
    }
  } else {
    const error = document.createElement("div");
    error.className = "result-error";
    error.textContent = result.error || "模型没有返回可读取结果。";
    card.append(error);
  }
  return card;
}

function syncRunButton() {
  const stage = currentState();
  const configuredCount = currentDefinition()?.models.filter((model) => model.configured).length ?? 0;
  const hasInput = Boolean(stage?.input.trim() || stage?.files.length);
  elements.run.disabled = state.busy || !hasInput || configuredCount === 0;
  elements.run.textContent = state.busy
    ? `正在并行生成 ${configuredCount} 个结果…`
    : `并行生成 ${configuredCount} 个结果`;
}

async function addFiles(fileList) {
  const stage = currentState();
  const allowed = new Set(state.config.accepted_extensions);
  elements.message.textContent = "";
  for (const file of [...fileList]) {
    const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!allowed.has(extension)) {
      elements.message.textContent = `${file.name} 的格式暂不支持。`;
      continue;
    }
    if (file.size > state.config.max_attachment_bytes) {
      elements.message.textContent = `${file.name} 超过 8 MB。`;
      continue;
    }
    if (stage.files.length >= 8) {
      elements.message.textContent = "单次最多上传 8 个文件。";
      break;
    }
    const buffer = await file.arrayBuffer();
    stage.files.push({
      name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      content_base64: arrayBufferToBase64(buffer),
      estimatedCharacters: extension === ".docx" ? 0 : Math.min(file.size, 30000),
    });
  }
  elements.fileInput.value = "";
  renderFiles();
  renderInputCount();
  syncRunButton();
}

async function runEvaluation() {
  const stage = currentState();
  stage.input = elements.input.value;
  state.busy = true;
  elements.message.textContent = "";
  renderModels();
  syncRunButton();
  try {
    const response = await fetch("/api/evaluations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: state.activeStage,
        input_text: stage.input,
        attachments: stage.files.map(({ estimatedCharacters, ...file }) => file),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload));
    stage.run = payload;
    renderResults();
  } catch (error) {
    elements.message.textContent = error instanceof Error ? error.message : "测试请求失败。";
  } finally {
    state.busy = false;
    renderModels();
    syncRunButton();
  }
}

function clearStage() {
  const stage = currentState();
  stage.input = "";
  stage.files = [];
  stage.run = null;
  elements.message.textContent = "";
  render();
}

function downloadResult(result, run) {
  const definition = currentDefinition();
  const content = [
    `# ${definition.label} · ${result.label}`,
    "",
    `- 模型：${result.model}`,
    `- 生成时间：${result.completed_at}`,
    `- 耗时：${formatDuration(result.latency_ms)}`,
    `- 本次输入字数：${run.input_character_count}`,
    "",
    result.output,
  ].join("\n");
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${state.activeStage}-${safeFilename(result.label)}-${safeFilename(result.model)}.md`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function errorMessage(payload) {
  if (typeof payload?.detail === "string") return payload.detail;
  if (Array.isArray(payload?.detail)) return payload.detail.map((item) => item.msg).join("；");
  return "测试请求失败。";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(milliseconds) {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function safeFilename(value) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80);
}

elements.input.addEventListener("input", () => {
  currentState().input = elements.input.value;
  renderInputCount();
  syncRunButton();
});
elements.fileInput.addEventListener("change", (event) => void addFiles(event.target.files));
elements.uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.uploadZone.classList.add("dragging");
});
elements.uploadZone.addEventListener("dragleave", () => elements.uploadZone.classList.remove("dragging"));
elements.uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.uploadZone.classList.remove("dragging");
  void addFiles(event.dataTransfer.files);
});
elements.run.addEventListener("click", () => void runEvaluation());
elements.clear.addEventListener("click", clearStage);

void initialize();
