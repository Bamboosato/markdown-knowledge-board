// Private stdout is captured by the local setup window, never printed to a console.
import { loadIdentity } from './identity.mjs';

try {
  const identity = await loadIdentity();
  process.stdout.write(`MKB1|http://127.0.0.1:${identity.port}|${identity.browserToken}`);
} catch {
  process.stderr.write('Could not read connection settings.');
  process.exitCode = 1;
}
