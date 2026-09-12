import test from 'node:test';
import assert from 'node:assert/strict';
import { partyOrigins } from '../src/engine/network';

void test('localhost uses the discovered server LAN and changes with the network',()=>{
  assert.deepEqual(partyOrigins('http://localhost:4317',['http://10.0.0.5:4317']),['http://10.0.0.5:4317']);
  assert.deepEqual(partyOrigins('http://localhost:4317',['http://192.168.1.9:4317']),['http://192.168.1.9:4317']);
  assert.deepEqual(partyOrigins('http://127.0.0.1:4317',[]),[]);
});
void test('a phone or public-domain host keeps the already reachable origin and HTTPS',()=>{
  assert.deepEqual(partyOrigins('https://race.example.com',['http://10.0.0.5:4317']),['https://race.example.com','http://10.0.0.5:4317']);
  assert.deepEqual(partyOrigins('http://192.168.1.9:4317',['http://192.168.1.9:4317']),['http://192.168.1.9:4317']);
});
void test('invalid protocols and loopback addresses never become phone links',()=>{
  assert.deepEqual(partyOrigins('http://[::1]:4317',['file:///tmp/index.html','nope','http://0.0.0.0:4317','http://127.0.0.2:4317']),[]);
});
