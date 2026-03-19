module.exports = {
  apps: [
    {
      name: "ApiChatapp",
      script: "index.js",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
