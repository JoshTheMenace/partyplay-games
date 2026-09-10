import { parseCommand, type Command } from './model';
type StorageLike = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function recoverCommand(raw:string|null,ack:number):Command|null {
  try {const c=parseCommand(JSON.parse(raw??'null'));return c?.seq===ack+1?c:null;}catch{return null;}
}
export function storeCommand(key:string,command:Command|null,storage?:StorageLike) {try{const target=storage??sessionStorage;if(command)target.setItem(key,JSON.stringify(command));else target.removeItem(key);}catch{/* Live commands remain available when browser storage is disabled. */}}
export function loadCommand(key:string,ack:number,storage?:StorageLike) {try{const target=storage??sessionStorage,command=recoverCommand(target.getItem(key),ack);if(!command)storeCommand(key,null,target);return command;}catch{return null;}}
