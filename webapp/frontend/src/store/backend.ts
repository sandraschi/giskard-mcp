import { create } from "zustand";

interface BackendState {
  connected: boolean | null;
  checking: boolean;
  error: string | null;
  scanCount: number;
  uptime: number;
  checkHealth: () => Promise<void>;
  setConnected: (v: boolean | null) => void;
  setScanCount: (n: number) => void;
}

export const useBackendStore = create<BackendState>((set) => ({
  connected: null,
  checking: false,
  error: null,
  scanCount: 0,
  uptime: 0,
  checkHealth: async () => {
    set({ checking: true });
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      set({
        connected: data.ok === true,
        checking: false,
        error: null,
        uptime: data.uptime_seconds || 0,
      });
    } catch {
      set({ connected: false, checking: false, error: "Cannot reach backend" });
    }
  },
  setConnected: (v) => set({ connected: v }),
  setScanCount: (n) => set({ scanCount: n }),
}));
