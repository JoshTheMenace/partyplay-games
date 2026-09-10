import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

export type NetworkInterfacesProvider = typeof networkInterfaces;
const normalize=(address:string)=>address.startsWith('::ffff:')?address.slice(7):address;
const usable=(address:string)=>isIPv4(address)&&!address.startsWith('127.')&&!address.startsWith('0.')&&Number(address.split('.')[0])<224;
const linkLocal=(address:string)=>address.startsWith('169.254.');
function priority(name:string) {
  if(/^(utun|tun|tap|wg|vpn|tailscale|docker|veth|virbr|vmnet|bridge|br-|awdl|llw|gif|stf|zt)/i.test(name)) return 2;
  return /^(en\d|eth\d|wlan|wlp|eno|ens|enp|wi-?fi|ethernet)/i.test(name)?0:1;
}
export function discoverPartyAddresses(port:number,provider:NetworkInterfacesProvider=networkInterfaces,requestHost?:string,localAddress?:string) {
  const addresses=Object.entries(provider()).flatMap(([name,entries])=>(entries??[])
    .filter(entry=>entry.family==='IPv4'&&!entry.internal&&usable(entry.address))
    .map(entry=>({address:entry.address,priority:priority(name),name})))
    .sort((a,b)=>Number(linkLocal(a.address))-Number(linkLocal(b.address))||a.priority-b.priority||a.name.localeCompare(b.name)||a.address.localeCompare(b.address));
  const socketAddress=normalize(localAddress??'');
  // The destination socket proves this address belongs to the server, even during interface changes.
  if(usable(socketAddress)&&!addresses.some(entry=>entry.address===socketAddress)) addresses.push({address:socketAddress,priority:0,name:''});
  const candidates=addresses.some(entry=>!linkLocal(entry.address))?addresses.filter(entry=>!linkLocal(entry.address)):addresses;
  let requested='';try {requested=new URL(`http://${requestHost??''}`).hostname;} catch { /* Invalid or absent Host falls back to discovery. */ }
  const preferred=candidates.find(entry=>entry.address===requested)?.address??candidates.find(entry=>entry.address===socketAddress)?.address??candidates[0]?.address;
  const ordered=[...(preferred?[preferred]:[]),...candidates.map(entry=>entry.address)];
  const urls=[...new Set(ordered)].map(address=>`http://${address}:${port}`);
  return {urls,preferredUrl:urls[0]??null};
}
