import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Nexus — Orchestrate your revenue engine",
  description: "Stop wrestling with disconnected tools. Nexus provides the infrastructure to build, measure, and scale your digital products.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>{children}</body>
    </html>
  )
}
