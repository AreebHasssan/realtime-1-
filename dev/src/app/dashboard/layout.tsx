"use client";

import { ReactNode } from "react";
import { DashboardProvider, useDashboard } from "../../providers/DashboardContext";
import Sidebar from "@/components/Sidebar";

function DashboardLayoutContent({ children }: { children: ReactNode }) {
  const { loadingUser, toast } = useDashboard();

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium">Loading Dashboard...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-sans">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-5xl w-full mx-auto">
          {children}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-indigo-500/50 text-slate-100 px-4 py-2.5 rounded-xl shadow-2xl text-sm flex items-center gap-2 backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="font-medium">{toast}</span>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </DashboardProvider>
  );
}
