/** @type {import('next').NextConfig} */

// STATIC_DEMO=true 환경변수 설정 시에만 정적 내보내기 모드
// → 일반 개발/배포 환경에서는 API 라우트(/api/parse-portfolio, /api/auto-valuate) 활성화됨
const isStaticDemo = process.env.STATIC_DEMO === 'true';

const nextConfig = {
  ...(isStaticDemo ? { output: "export", assetPrefix: "./", trailingSlash: true } : {}),
};

export default nextConfig;
