import { create } from "zustand";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface LogsState {
  logs: LogEntry[];
  visible: boolean;
  addLog: (entry: LogEntry) => void;
  setVisible: (v: boolean) => void;
  clear: () => void;
}

export const useLogsStore = create<LogsState>((set) => ({
  logs: [],
  visible: false,
  addLog: (entry) => set((s) => ({ logs: [...s.logs.slice(-499), entry] })),
  setVisible: (v) => set({ visible: v }),
  clear: () => set({ logs: [] }),
}));
