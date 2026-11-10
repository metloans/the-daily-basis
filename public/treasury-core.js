(function(root){
  'use strict';
  const number=v=>v==null||v===''?NaN:Number(v);
  const etDate=ts=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts*1000));
  function validCandle(p){
    const [o,h,l,c]=['open','high','low','close'].map(k=>number(p?.[k]));
    return [o,h,l,c].every(Number.isFinite)&&l>0&&l<=Math.min(o,c)&&h>=Math.max(o,c);
  }
  function watch(meta,now=Date.now(),thresholds={watch:2,elevated:4,zone:6}){
    const open=number(meta?.open),current=number(meta?.current),ts=number(meta?.regularMarketTime);
    if(![open,current,ts].every(Number.isFinite)) return {state:'Unavailable',move:NaN,stale:true,tone:'flat',message:'Waiting for intraday session data'};
    const move=(current-open)*100,magnitude=Math.round(Math.abs(move)*1e8)/1e8;
    const state=magnitude>=thresholds.zone?(move>0?'RED ZONE':'GREEN ZONE'):magnitude>=thresholds.elevated?'Elevated':magnitude>=thresholds.watch?'Watch':'Normal';
    const stale=now-ts*1000>20*60000||etDate(ts)!==etDate(now/1000)||ts*1000>now+60000;
    const message=state==='GREEN ZONE'?'Potential for improved pricing if the move holds':state==='RED ZONE'?'Increased risk of lender pricing deterioration':state==='Normal'?'Limited movement from session open':move>0?'Rising yields · pricing pressure building':'Falling yields · potential pricing support';
    return {state,move,stale,tone:state==='Normal'?'flat':move>0?'down':'up',message};
  }
  function yieldDomain(data,{range='day',mode='line',current}={}){
    const values=data.flatMap(p=>mode==='candle'?[number(p.low),number(p.high)]:[number(p.value)]).filter(Number.isFinite);
    const active=number(current),last=number(data.at(-1)?.value);
    if(!values.length)values.push(Number.isFinite(active)?active:0);
    const min=Math.min(...values),max=Math.max(...values);
    if(range==='day'){
      // A 10 bp total window, centered in half-bp steps to reduce axis jitter.
      // Only market observations can expand it; guides/zones never set the scale.
      const center=Math.round((Number.isFinite(active)?active:Number.isFinite(last)?last:(min+max)/2)/.005)*.005;
      const step=.005,buffer=.003;
      const lo=Math.floor((Math.min(center-.05,min-buffer)+1e-10)/step)*step;
      const hi=Math.ceil((Math.max(center+.05,max+buffer)-1e-10)/step)*step;
      return {lo,hi};
    }
    const pad=Math.max((max-min)*.08,.003),mid=(min+max)/2;
    return {lo:Math.min(min-pad,mid-.01),hi:Math.max(max+pad,mid+.01)};
  }
  const api={number,etDate,validCandle,watch,yieldDomain};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.TDBTreasuryCore=api;
})(globalThis);
