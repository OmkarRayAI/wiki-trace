"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { MarketingNav } from "./MarketingNav";
import SearchPanel from "./SearchPanel";
import { FirstLoadTour } from "./FirstLoadTour";

const MARKETING_ROUTES = new Set(["/", "/manifesto", "/security", "/pricing"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMarketing = MARKETING_ROUTES.has(pathname);

  if (isMarketing) {
    return (
      <>
        <MarketingNav />
        <main className="pt-20">{children}</main>
        <SearchPanel />
      </>
    );
  }

  return (
    <>
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 ml-[252px] px-10 py-8 max-w-[1280px]">
          {children}
        </main>
      </div>
      <SearchPanel />
      <FirstLoadTour />
    </>
  );
}
