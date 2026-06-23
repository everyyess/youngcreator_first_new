import type { Metadata } from "next";
import MainTabShell from "../maintab/MainTabShell";

export const metadata: Metadata = {
  title: "고객 상담 화면",
  description: "고객 전용 상담 진행 화면",
};

export default function CustomerMaintabLayout({ children }: { children: React.ReactNode }) {
  return <MainTabShell appMode="customer">{children}</MainTabShell>;
}
