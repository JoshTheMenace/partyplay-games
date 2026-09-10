// Estimate server epoch time against the monotonic browser clock. Prefer the
// shortest round trip so a delayed packet cannot move the countdown backwards.
export function createNetworkClock(){
  let offset:number|null=null,best=Infinity;
  return {
    reset(){offset=null;best=Infinity;},
    receive(serverTime:number,received:number,sent?:number){
      if(!Number.isFinite(serverTime))return;
      if(sent===undefined){if(offset===null)offset=serverTime-received;return;}
      const rtt=received-sent;if(rtt<0||rtt>5000||rtt>best)return;
      best=rtt;offset=serverTime-(sent+received)/2;
    },
    now(local:number){return local+(offset??0);},
  };
}
