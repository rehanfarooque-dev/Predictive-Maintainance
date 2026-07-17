import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { Sidebar } from "@/components/layout/Sidebar";
import { ControlBar } from "@/components/layout/ControlBar";

export const metadata: Metadata = {
  title: "Sentinel — Predictive Maintenance",
  description: "Fleet failure prediction, risk scoring & remaining useful life",
};

// Apply the saved theme before paint to avoid a flash. Default is light.
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-full">
        {/* Theme-before-paint. Emitted as raw HTML so React never renders a <script> element
            itself — React 19 warns about (and won't execute) inline scripts in the component
            tree. The browser runs this while parsing the SSR stream, before anything below
            it paints, so the saved dark theme applies with no flash. */}
        <div hidden dangerouslySetInnerHTML={{ __html: `<script>${themeScript}</script>` }} />
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <ControlBar />
              <main className="flex-1 p-6">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
