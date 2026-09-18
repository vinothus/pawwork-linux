// When the OpenCode sidecar is active, free-tier requests go through the real
// opencode binary and must not carry PawWork's Zen header spoofing.
if (!process.env.PAWWORK_OPENCODE_ZEN_BASE_URL) {
  const { apply } = await import('./zen-identity.mjs');
  apply();
}

// Windows cannot deliver SIGTERM through ChildProcess.kill(). The owned IPC
// channel asks this Node process to enter DSH's existing graceful signal path.
process.on('message', (message) => {
  if (message !== 'SIGTERM') return;
  if (process.connected) process.disconnect();
  process.emit('SIGTERM');
});
