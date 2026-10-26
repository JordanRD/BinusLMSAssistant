const path = require("path");

module.exports = {
  apps: [
    {
      name: "lms-forum",
      script: "server.py",
      interpreter: path.resolve(__dirname, ".venv/Scripts/python.exe"),
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
