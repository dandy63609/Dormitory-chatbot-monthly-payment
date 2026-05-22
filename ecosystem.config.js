module.exports = {
  apps: [
    {
      name: 'Dormitory-chatbot-monthly-payment',
      script: 'src/index.js',
      cwd: '/home/Dandy/Dormitory-chatbot-monthly-payment',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 10,
      min_uptime: '30s',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
