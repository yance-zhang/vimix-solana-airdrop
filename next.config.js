/** @type {import('next').NextConfig}  */

const nextConfig = {
  // optimize development mode performance
  reactStrictMode: true,
  swcMinify: true,

  // reduce bundle size
  experimental: {
    optimizePackageImports: [
      '@solana/wallet-adapter-react',
      '@solana/wallet-adapter-react-ui',
    ],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
  webpack(config, options) {
    // optimize development mode performance
    if (options.dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    config.module.rules.push({
      test: /\.mp3$/,
      use: {
        loader: 'file-loader',
      },
    });

    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg'),
    );
    config.module.rules.push(
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/,
      },
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] },
        use: ['@svgr/webpack'],
      },
    );

    fileLoaderRule.exclude = /\.svg$/i;

    // optimize caching
    config.cache = options.dev
      ? {
          type: 'filesystem',
        }
      : config.cache;

    return config;
  },
};

module.exports = nextConfig;
