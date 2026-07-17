import { create } from "zustand";

// --- Sidebar collapse ---
// NOTE: initial state must be identical on server and client — the first client render
// participates in hydration, so reading localStorage here causes a hydration mismatch.
// The saved value is applied post-mount by hydrateClientState() (called from Providers).
interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebar = create<SidebarState>((set, get) => ({
  collapsed: false,
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

// Same rule as the sidebar: start with the server value ("light"); the real theme (already
// applied to <html> before paint by the layout's inline script) is synced in after mount.
export const useTheme = create<ThemeState>((set, get) => ({
  theme: "light",
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

// --- Post-hydration sync ---
// Runs once after mount (from Providers). Effects fire after hydration completes, so these
// updates are ordinary re-renders — never a server/client mismatch.
export function hydrateClientState() {
  try {
    if (localStorage.getItem("sidebar-collapsed") === "true") {
      useSidebar.setState({ collapsed: true });
    }
  } catch { /* ignore */ }
  const dark = document.documentElement.classList.contains("dark");
  if (dark) useTheme.setState({ theme: "dark" });
}
