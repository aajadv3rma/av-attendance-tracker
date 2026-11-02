import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import ServiceWorkerRegister from "@/components/workspace/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: {
    default: "AV Attendance Tracker — Make every hour count",
    template: "%s | AV Attendance Tracker",
  },
  description: "A private, flexible attendance and work-time tracker for students, employees, and independent professionals.",
  applicationName: "AV Attendance Tracker",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#203f2e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<ServiceWorkerRegister /></body>
    </html>
  );
}
