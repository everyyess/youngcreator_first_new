import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "삼성증권 VVIP 지능형 입력부",
  description: "VVIP 고객 상담을 위한 재무 정보 및 RRTTLLU 입력 화면"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
