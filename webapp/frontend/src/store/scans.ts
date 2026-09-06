import { create } from "zustand";
import { type ScanRecord, type ScanResult, api } from "../api/client";

interface ScansState {
  scans: ScanRecord[];
  loading: boolean;
  error: string | null;
  running: boolean;
  lastResult: ScanResult | null;
  fetchScans: () => Promise<void>;
  runScan: (agent_name: string, agent_description: string) => Promise<ScanResult>;
}

export const useScansStore = create<ScansState>((set, get) => ({
  scans: [],
  loading: false,
  error: null,
  running: false,
  lastResult: null,
  fetchScans: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.scans.list();
      set({ scans: data.scans, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },
  runScan: async (agent_name, agent_description) => {
    set({ running: true, error: null, lastResult: null });
    try {
      const result = await api.scans.run(agent_name, agent_description);
      set({ running: false, lastResult: result });
      get().fetchScans();
      return result;
    } catch (e: any) {
      set({ running: false, error: e.message });
      throw e;
    }
  },
}));
