import type {AutoProfile} from './localMcpConnection';

// A verification window only relays the broker's one-time proof inside this
// origin and browser profile. It must never start an ordinary MCP session.
export function relayProfileProof(): boolean {
  const match = /^#mkb-verify=([a-f0-9-]{36})\.([a-f0-9-]{36})$/.exec(location.hash);
  if (!match) return false;
  history.replaceState(null, '', location.pathname);
  const channel = new BroadcastChannel('mkb-profile-' + match[1]);
  channel.postMessage(match[2]);
  channel.close();
  document.body.textContent = 'Profile check finished. You can close this window and return to MKB.';
  window.close();
  return true;
}
type Destination=Pick<AutoProfile,'browser'|'profile'|'paused'> & {origin:string};
export type ProfileOptions={profiles:string[]; revision:string; destination:Destination|null; owner:boolean};
export function currentBrowser():AutoProfile['browser'] {
  return navigator.userAgent.includes('Edg/')?'edge':'chrome';
}
export function destinationLabel(value:Pick<AutoProfile,'browser'|'profile'>) {
  return (value.browser==='edge'?'Edge':'Chrome')+' / '+value.profile;
}
