/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@teep/shared"],
  poweredByHeader: false,
  // Docker: o pack do webpack no disco estoura o overlay (ENOSPC).
  webpack: (config) => {
    if (process.env.NEXT_WEBPACK_CACHE === "0") {
      config.cache = false;
    }
    return config;
  },
  // Evita cobrir o botão "Sair" do menu (padrão do Next é bottom-left).
  devIndicators: {
    position: "bottom-right",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
