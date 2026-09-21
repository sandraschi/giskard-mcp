import { create } from "zustand";
import { type ScanJob, type ScanRecord, api } from "../api/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScansState {
  scans: ScanRecord[];
  loading: boolean;
  error: string | null;
  running: boolean;
  activeJob: ScanJob | null;
  lastResult: ScanRecord | null;
  fetchScans: () => Promise<void>;
  runScan: (mcp_url: string, agent_description?: string, profiles?: string) => Promise<ScanRecord>;
  cancelActiveJob: () => Promise<void>;
  removeScan: (agent_name: string) => Promise<void>;
}

export const useScansStore = create<ScansState>((set, get) => ({
  scans: [],
  loading: false,
  error: null,
  running: false,
  activeJob: null,
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
  runScan: async (mcp_url, agent_description, profiles) => {
    set({ running: true, error: null, lastResult: null, activeJob: null });
    try {
      const started = await api.scans.run(mcp_url, agent_description, profiles);
      // Poll the background job until it reaches a terminal state.
      for (;;) {
        const { job } = await api.jobs.get(started.job_id);
        set({ activeJob: job });
        if (job.status === "complete" && job.result) {
          set({ running: false, lastResult: job.result, activeJob: null });
          get().fetchScans();
          return job.result;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          const msg = job.status === "cancelled" ? "Scan cancelled." : job.error || "Scan failed.";
          set({ running: false, error: msg, activeJob: null });
          get().fetchScans();
          throw new Error(msg);
        }
        await sleep(2000);
      }
    } catch (e: any) {
      if (!get().error) set({ running: false, error: e.message });
      else set({ running: false });
      set({ activeJob: null });
      throw e;
    }
  },
  cancelActiveJob: async () => {
    const { activeJob } = get();
    if (!activeJob) return;
    try {
      const { job } = await api.jobs.cancel(activeJob.job_id);
      set({ activeJob: job, running: false });
    } catch (e: any) {
      set({ error: e.message });
    }
  },
  removeScan: async (agent_name) => {
    await api.scans.remove(agent_name);
    get().fetchScans();
  },
}));
