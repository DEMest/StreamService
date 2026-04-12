const hlsUpstream = process.env.HLS_UPSTREAM ?? "http://localhost:8888";
const apiUpstream = process.env.API_UPSTREAM ?? "http://localhost:3001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/hls/:path*",
        destination: `${hlsUpstream}/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${apiUpstream}/:path*`,
      },
    ];
  },
};

export default nextConfig;
