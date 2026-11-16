export type LocalMcpConnection = { origin: string; token: string };

export const LOCAL_MCP_CONNECTION_KEY = 'mkb-local-mcp-connection-v1';

export function validateLocalMcpConnection(address: string, token: string): LocalMcpConnection {
  const trimmed = address.trim();
  // Match the literal loopback address before URL normalization (no alternate IP forms).
  if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/?$/.test(trimmed)) {
    throw new Error('Use the http://127.0.0.1:port address from this chat.');
  }
  const url = new URL(trimmed);
  if (!url.port || Number(url.port) < 1024 || Number(url.port) > 65535 || !/^[a-f0-9]{64}$/.test(token.trim())) {
    throw new Error('Invalid connection details. Get a new code from this chat.');
  }
  return { origin: url.origin, token: token.trim() };
}

export function parseLocalMcpCode(code: string): LocalMcpConnection {
  const parts = code.trim().split('|');
  if (parts.length !== 3 || parts[0] !== 'MKB1') {
    throw new Error('Paste the full connection code starting with MKB1|.');
  }
  return validateLocalMcpConnection(parts[1], parts[2]);
}

export function readLocalMcpConnection(): LocalMcpConnection | null {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_MCP_CONNECTION_KEY) ?? 'null');
    if (typeof value?.origin !== 'string' || typeof value?.token !== 'string') return null;
    return validateLocalMcpConnection(value.origin, value.token);
  } catch {
    return null;
  }
}
