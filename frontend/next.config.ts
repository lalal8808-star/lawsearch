import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.IS_DOCKER === "true" ? "standalone" : undefined,
  serverExternalPackages: ["pdf-parse"],
  // 오래된 next-pwa 서비스워커는 CacheCleanup이 한 번 제거한다. 인증·히스토리 API는
  // 브라우저/서비스워커 캐시에 저장하지 않고 항상 네트워크에서 읽는다.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
