module.exports = {
  apps: [{
    name: 'akipoly-game',
    script: 'src/index.js',
    cwd: '/opt/akipoly-game',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
