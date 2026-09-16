import test from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkInterfaceInfo } from 'node:os';
import { get } from 'node:http';
import QRCode from 'qrcode';
import { discoverPartyAddresses } from '../src/standalone-server/network-address';
import { createPartyServer } from '../src/standalone-server/party-server';

function address(ip:string,internal=false):NetworkInterfaceInfo {
  return {address:ip,family:'IPv4',netmask:'255.255.255.0',mac:'00:00:00:00:00:00',internal,cidr:`${ip}/24`};
}
function requestWithHost(url:string,host:string) {
  return new Promise<string>((resolve,reject)=>{
    get(url,{headers:{Host:host}},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});response.on('end',()=>resolve(body));response.on('error',reject);}).on('error',reject);
  });
}
void test('physical LAN addresses outrank VPN/container interfaces and exclude loopback and link-local alternatives',()=>{
  const interfaces={utun0:[address('10.8.0.2')],docker0:[address('172.17.0.1')],en0:[address('192.168.1.20')],lo0:[address('127.0.0.1')],en1:[address('169.254.1.2')],lo:[address('192.168.1.30',true)]};
  const data=discoverPartyAddresses(4317,()=>interfaces);
  assert.equal(data.preferredUrl,'http://192.168.1.20:4317');
  assert.equal(data.urls.length,3);assert.ok(data.urls.every(url=>!url.includes('127.0.')&&!url.includes('169.254.')));
  assert.deepEqual(discoverPartyAddresses(4317,()=>({en0:[address('169.254.1.2')]})).urls,['http://169.254.1.2:4317']);
});
void test('known request Host and current destination socket preserve the reachable LAN address',()=>{
  const interfaces=()=>({en0:[address('192.168.1.20')],en1:[address('192.168.2.20')]});
  assert.equal(discoverPartyAddresses(4317,interfaces,'192.168.2.20:9999','::ffff:192.168.1.20').preferredUrl,'http://192.168.2.20:4317');
  assert.equal(discoverPartyAddresses(4317,interfaces,'localhost:4317','::ffff:192.168.2.20').preferredUrl,'http://192.168.2.20:4317');
  assert.equal(discoverPartyAddresses(4317,()=>({}),'localhost:4317','192.168.3.20').preferredUrl,'http://192.168.3.20:4317');
  assert.equal(discoverPartyAddresses(4317,interfaces,'malicious.example:4317','127.0.0.1').preferredUrl,'http://192.168.1.20:4317');
});
void test('the same running server refreshes API and QR addresses after the LAN changes',async()=>{
  let ip='192.168.1.20';const server=createPartyServer({port:0,networkInterfacesProvider:()=>({en0:[address(ip)],lo0:[address('127.0.0.1',true)]})});
  const port=await server.listen(),origin=`http://127.0.0.1:${port}`;
  try {
    for(const newIP of ['192.168.1.20','10.0.0.43']) {
      ip=newIP;const response=await fetch(`${origin}/api/party`),data=await response.json();
      assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(data,{available:true,urls:[`http://${ip}:${port}`],preferredUrl:`http://${ip}:${port}`,version:1});
      const qr=await fetch(`${origin}/api/party/qr.svg`);assert.equal(qr.status,200);assert.equal(qr.headers.get('cache-control'),'no-store');assert.match(qr.headers.get('content-type')??'',/image\/svg\+xml/);
      assert.equal(await qr.text(),await QRCode.toString(`http://${ip}:${port}/`,{type:'svg'}));assert.deepEqual(server.urls(),[`http://${ip}:${port}`]);
    }
  } finally {await server.close();}
});
void test('QR retains a valid join code and uses a known LAN request Host with the actual bound port',async()=>{
  const server=createPartyServer({port:0,networkInterfacesProvider:()=>({en0:[address('192.168.1.20')],en1:[address('192.168.2.20')]})}),port=await server.listen(),origin=`http://127.0.0.1:${port}`;
  try {
    const host='192.168.2.20:9999',data=JSON.parse(await requestWithHost(`${origin}/api/party`,host)) as {preferredUrl:string};
    assert.equal(data.preferredUrl,`http://192.168.2.20:${port}`);
    const qr=await requestWithHost(`${origin}/api/party/qr.svg?join=abc234`,host);
    assert.equal(qr,await QRCode.toString(`http://192.168.2.20:${port}/?join=ABC234`,{type:'svg'}));
    for(const code of ['', 'INVALID', 'ABC%26XX','AAAAA0']) {const invalid=await fetch(`${origin}/api/party/qr.svg?join=${code}`);assert.equal(invalid.status,400);assert.equal(invalid.headers.get('cache-control'),'no-store');}
  } finally {await server.close();}
});
void test('without usable LAN discovery, API is empty and QR returns an uncached explanatory 503',async()=>{
  const server=createPartyServer({port:0,networkInterfacesProvider:()=>({lo0:[address('127.0.0.1',true)],bad:[address('0.0.0.0')]})}),port=await server.listen();
  try {
    const data=await (await fetch(`http://127.0.0.1:${port}/api/party`)).json() as {urls:string[];preferredUrl:string|null};assert.deepEqual(data.urls,[]);assert.equal(data.preferredUrl,null);
    const qr=await fetch(`http://127.0.0.1:${port}/api/party/qr.svg`);assert.equal(qr.status,503);assert.equal(qr.headers.get('cache-control'),'no-store');assert.match(await qr.text(),/No LAN address/);
  } finally {await server.close();}
});
