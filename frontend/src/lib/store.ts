import { create } from "zustand";

// --- Sidebar collapse ---
function readSidebarCollapsed(): boolean {
  if (typeof window !== "undefined") {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { /* */ }
  }
  return false;
}

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebar = create<SidebarState>((set, get) => ({
  collapsed: readSidebarCollapsed(),
  toggle: () => {
    const next = !get().collapsed;
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* */ }
    set({ collapsed: next });
  },
}));

// Global controls shared across views: the "as-of" timestamp and decision threshold.
interface ControlsState {
  asOf: string | undefined;
  threshold: number;
  setAsOf: (asOf: string | undefined) => void;
  setThreshold: (threshold: number) => void;
}

export const useControls = create<ControlsState>((set) => ({
  asOf: undefined, // undefined => backend uses the latest timestamp
  threshold: 0.5,
  setAsOf: (asOf) => set({ asOf }),
  setThreshold: (threshold) => set({ threshold }),
}));

// --- Theme (light / dark) ---
type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }
  return "light";
}

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }
}

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readInitialTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
