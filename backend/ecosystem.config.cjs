// pm2 process file. Deploy: npm ci && npm run build && npm run migrate && pm2 reload ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'akipoly-game',
      script: 'dist/index.js',
      cwd: '/opt/akipoly-game',
      node_args: '--enable-source-maps',
      // One instance: the payout worker must be the only signer of the treasury.
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
