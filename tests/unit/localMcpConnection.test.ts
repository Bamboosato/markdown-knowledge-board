import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_MCP_CONNECTION_KEY, parseLocalMcpCode, readLocalMcpConnection } from '../../src/lib/localMcpConnection';

const token = 'a'.repeat(64);
afterEach(() => vi.unstubAllGlobals());

describe('local MCP reconnect credentials', () => {
  it('accepts a pasted code but rejects non-loopback and malformed destinations before transmission', () => {
    expect(parseLocalMcpCode(` MKB1|http://127.0.0.1:5186|${token}\n`)).toEqual({ origin: 'http://127.0.0.1:5186', token });
    for (const address of ['https://example.com', 'http://localhost:5186', 'http://127.1:5186',
      'http://127.0.0.1:5186@evil.example', 'http://127.0.0.1:5186/path',
      'http://127.0.0.1:5186?token=x', 'http://127.0.0.1:80', 'http://127.0.0.1:99999']) {
      expect(() => parseLocalMcpCode(`MKB1|${address}|${token}`)).toThrow();
    }
    expect(() => parseLocalMcpCode(`MKB1|http://127.0.0.1:5186|${token}|extra`)).toThrow();
    expect(() => parseLocalMcpCode('MKB1|http://127.0.0.1:5186|short')).toThrow();
  });

  it('treats unavailable, corrupt, or unsafe stored settings as no remembered connection', () => {
    const getItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem });
    for (const raw of [null, 'broken', '{}', JSON.stringify({ origin: 'https://example.com', token })]) {
      getItem.mockReturnValue(raw);
      expect(readLocalMcpConnection()).toBeNull();
    }
    getItem.mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(readLocalMcpConnection()).toBeNull();
    getItem.mockReturnValue(JSON.stringify({ origin: 'http://127.0.0.1:5186', token }));
    expect(readLocalMcpConnection()).toEqual({ origin: 'http://127.0.0.1:5186', token });
    expect(getItem).toHaveBeenLastCalledWith(LOCAL_MCP_CONNECTION_KEY);
  });
});
