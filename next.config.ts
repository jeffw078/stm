import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg", "sharp"],
  outputFileTracingExcludes: {
    "/*": ["./data/private/**/*", "./manut.xlsx", "./.env*", "./test-results/**/*", "./playwright-report/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" }
    ] }];
  }
};
export default config;
