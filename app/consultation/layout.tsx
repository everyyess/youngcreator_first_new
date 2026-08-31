import type { Metadata } from "next";
import MainTabShell from "../maintab/MainTabShell";

export const metadata: Metadata = {
  title: "삼성증권 VVIP 상담실",
  description: "VVIP 고객 상담을 위한 재무 정보 및 RRTTLLU 입력 화면",
};

export default function ConsultationLayout({ children }: { children: React.ReactNode }) {
  return <MainTabShell>{children}</MainTabShell>;
}
