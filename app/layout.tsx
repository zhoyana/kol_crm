import type { ReactNode } from "react";
import type { Viewport } from "next";
import "./styles.css";
import { AppSidebar } from "./AppSidebar";

export const metadata = {
  title: "KOL CRM",
  description: "Creator screening and outreach workspace"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="shell">
          <AppSidebar />
          {children}
        </main>
      </body>
    </html>
  );
}
