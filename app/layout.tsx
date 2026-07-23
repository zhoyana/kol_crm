import type { ReactNode } from "react";
import "./styles.css";

export const metadata = {
  title: "KOL CRM",
  description: "Creator screening and outreach workspace"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
