import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreferences} from '../src/engine/preferences';
void test('corrupt or outdated preferences cannot select an invalid driver or inject non-string names',()=>{
  const defaults=readPreferences(null);
  for(const raw of ['','{','null','42','true','[]','"text"'])assert.deepEqual(readPreferences(raw),defaults);
  for(const driver of [-1,10,12,.5,'2',null])assert.equal(readPreferences(JSON.stringify({driver})).driver,0);
  assert.deepEqual(readPreferences(JSON.stringify({name:{text:'Racer'},muted:'false',quality:'ultra'})),defaults);
  assert.equal(readPreferences(JSON.stringify({name:'   '})).name,'Racer');
});
void test('valid saved preferences survive reload with bounded names',()=>{
  const preferences={name:'Nova',driver:3,muted:true,quality:'performance' as const,qualityChosen:true};
  assert.deepEqual(readPreferences(JSON.stringify(preferences)),preferences);
  assert.equal(readPreferences(JSON.stringify({name:'a'.repeat(80)})).name.length,20);
});

void test('phone defaults migrate old automatic high graphics while preserving an explicit choice',()=>{
 assert.equal(readPreferences(null,'performance').quality,'performance');
 assert.equal(readPreferences(JSON.stringify({quality:'high'}),'performance').quality,'performance');
 assert.equal(readPreferences(JSON.stringify({quality:'high',qualityChosen:true}),'performance').quality,'high');
});
