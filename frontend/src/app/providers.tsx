"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { hydrateClientState } from "@/lib/store";

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  // Apply persisted UI state (sidebar collapse, theme) AFTER hydration — the server can't
  // know localStorage, so the first client render must match the server-rendered defaults.
  useEffect(() => {
    hydrateClientState();
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
