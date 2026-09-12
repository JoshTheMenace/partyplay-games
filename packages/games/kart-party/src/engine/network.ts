export function partyOrigins(currentOrigin:string,advertised:readonly string[]):string[] {
  const origins=[currentOrigin,...advertised].flatMap(value=>{
    try {
      const url=new URL(value),host=url.hostname;
      return /^https?:$/.test(url.protocol)&&host!=='localhost'&&host!=='[::1]'&&host!=='0.0.0.0'&&!host.startsWith('127.')?[url.origin]:[];
    }catch{return [];}
  });
  return [...new Set(origins)];
}
