import { create } from "zustand";
import {
  fetchGpus,
  fetchLlmSettings,
  fetchModels,
  fetchProviders,
  loadGpuIndex,
  loadSelection,
  pickChatModel,
  saveGpuIndex,
  saveLlmSettings,
  saveSelection,
  subscribeSelection,
  type GpuInfo,
  type ProviderInfo,
  type ProviderStatus,
} from "../lib/provider";

/** Default priority when nothing is saved: Ollama > LM Studio > vLLM. */
const LOCAL_PRIORITY = ["ollama", "lmstudio", "vllm"];

interface LlmState {
  providers: ProviderInfo[];
  providerStatus: Record<string, ProviderStatus>;
  selectedProvider: string;
  selectedModel: string;
  models: string[];
  modelsSource: string;
  modelsNote: string;
  probing: boolean;
  modelsLoading: boolean;
  gpus: GpuInfo[];
  gpuIndex: number;
  error: string | null;
  probeAll: () => Promise<void>;
  refreshModels: () => Promise<void>;
  selectProvider: (id: string) => Promise<void>;
  selectModel: (model: string) => void;
  selectGpu: (index: number) => void;
  persistSelection: (apiKey?: string) => Promise<boolean>;
}

export const useLlmStore = create<LlmState>((set, get) => ({
  providers: [],
  providerStatus: {},
  selectedProvider: "",
  selectedModel: "",
  models: [],
  modelsSource: "none",
  modelsNote: "",
  probing: false,
  modelsLoading: false,
  gpus: [],
  gpuIndex: loadGpuIndex(),
  error: null,

  probeAll: async () => {
    set({ probing: true, error: null });
    try {
      const [provData, saved] = await Promise.all([
        fetchProviders(),
        fetchLlmSettings().catch(() => ({ provider: "", endpoint: "", model: "", keys_configured: {} })),
      ]);
      const providers = provData.providers;
      const status: Record<string, ProviderStatus> = {};
      for (const p of providers) {
        status[p.id] = p.kind === "local" ? (p.detected ? "detected" : "not_found") : p.configured ? "detected" : "not_found";
      }
      const stored = loadSelection();
      const savedProvider = saved.provider || stored.provider;
      const detectedLocal = LOCAL_PRIORITY.find((id) => status[id] === "detected");
      const selectedProvider =
        (savedProvider && providers.some((p) => p.id === savedProvider) && savedProvider) ||
        (stored.provider && status[stored.provider] === "detected" && stored.provider) ||
        detectedLocal ||
        "";
      set({ providers, providerStatus: status, selectedProvider });
      // Resolve the model: saved (server, then localStorage) wins if still listed, else first chat-capable.
      const { models, source, note } = selectedProvider
        ? await fetchModels(selectedProvider).catch(() => ({ models: [] as string[], source: "none", note: "" }))
        : { models: [] as string[], source: "none", note: "" };
      const wanted = saved.model || stored.model;
      const selectedModel = wanted && models.includes(wanted) ? wanted : pickChatModel(models);
      set({
        models,
        modelsSource: source,
        modelsNote: note || "",
        selectedModel,
        probing: false,
      });
      const gpus = await fetchGpus();
      set({ gpus });
    } catch (e: any) {
      set({ error: e.message, probing: false });
    }
  },

  refreshModels: async () => {
    const { selectedProvider, selectedModel } = get();
    if (!selectedProvider) {
      set({ models: [], modelsSource: "none", modelsNote: "" });
      return;
    }
    set({ modelsLoading: true });
    try {
      const data = await fetchModels(selectedProvider);
      const models = data.models || [];
      const next = selectedModel && models.includes(selectedModel) ? selectedModel : pickChatModel(models);
      set({ models, modelsSource: data.source, modelsNote: data.note || "", selectedModel: next, modelsLoading: false });
    } catch {
      set({ models: [], modelsSource: "none", modelsLoading: false });
    }
  },

  selectProvider: async (id) => {
    set({ selectedProvider: id, selectedModel: "", models: [] });
    saveSelection(id, "");
    await get().refreshModels();
  },

  selectModel: (model) => {
    set({ selectedModel: model });
    saveSelection(get().selectedProvider, model);
  },

  selectGpu: (index) => {
    set({ gpuIndex: index });
    saveGpuIndex(index);
  },

  persistSelection: async (apiKey) => {
    const { selectedProvider, selectedModel } = get();
    try {
      await saveLlmSettings({
        provider: selectedProvider,
        model: selectedModel,
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      saveSelection(selectedProvider, selectedModel);
      return true;
    } catch {
      return false;
    }
  },
}));

/** Keep every page in sync when the selection changes anywhere. */
export function subscribeLlmSelectionSync() {
  return subscribeSelection(({ provider, model }) => {
    useLlmStore.setState({ selectedProvider: provider, selectedModel: model });
  });
}
