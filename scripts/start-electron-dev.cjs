const { spawn } = require('node:child_process');
const electron = require('electron');

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
};

delete env.ELECTRON_RUN_AS_NODE;

if (process.platform === "linux" && process.env.SECOND_BRAIN_HEADLESS === "1") {
  env.NO_AT_BRIDGE = "1";
}

const electronArgs = ['.'];

if (process.platform === 'linux' && process.env.SECOND_BRAIN_HEADLESS === '1') {
  electronArgs.unshift(
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--ozone-platform=x11'
  );
}

if (process.platform === 'linux' && process.env.SECOND_BRAIN_DEV_CHROMIUM_SANDBOX !== '1') {
  electronArgs.unshift('--no-sandbox');
}

const child = spawn(electron, electronArgs, {
  stdio: 'inherit',
  env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
