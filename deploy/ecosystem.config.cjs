module.exports = {
  apps: [
    {
      name: "kol-crm-web",
      cwd: __dirname + "/..",
      script: "node",
      args: "--env-file=.env.production node_modules/next/dist/bin/next start -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      env: { NODE_ENV: "production" }
    },
    {
      name: "kol-crm-worker",
      cwd: __dirname + "/..",
      script: "node",
      args: "--env-file=.env.production worker/agent-worker.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "768M",
      env: { NODE_ENV: "production" }
    }
  ]
};
