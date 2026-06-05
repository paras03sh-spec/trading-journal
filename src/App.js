import { useState, useRef, useEffect, useCallback } from 'react';
import { loadDay, saveDay, loadIndex, saveIndex } from './supabase';

const POINT_VALUES = { ES: 50, NQ: 20, MES: 5, MNQ: 2 };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_HDR = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const TABS = ["Pre-Market", "Trades", "EOD Review"];

const C = {
  bg:'#0e0e0e', surface:'#161616', surface2:'#1c1c1c',
  border:'#2a2a2a', border2:'#3a3a3a',
  text:'#e8e8e8', textSub:'#999', textMut:'#555', textDim:'#333',
  green:'#4ade80', red:'#f87171', yellow:'#fbbf24',
  blue:'#60a5fa', purple:'#a78bfa', teal:'#34d399', orange:'#fb923c',
};

function calcPnL(ticker,contracts,points){return(parseFloat(points)||0)*(POINT_VALUES[ticker]||0)*(parseFloat(contracts)||0);}
function calcRisk(ticker,contracts,sl){return(parseFloat(sl)||0)*(POINT_VALUES[ticker]||0)*(parseFloat(contracts)||0);}
function fmtDate(d){return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}
function todayStr(){return new Date().toLocaleDateString('en-CA');}
function getMonthDays(year,month){
  const days=[];
  const first=new Date(year,month,1).getDay();
  const total=new Date(year,month+1,0).getDate();
  for(let i=0;i<first;i++)days.push(null);
  for(let d=1;d<=total;d++){
    const mm=String(month+1).padStart(2,'0');
    const dd=String(d).padStart(2,'0');
    days.push(`${year}-${mm}-${dd}`);
  }
  return days;
}
function emptyDay(){
  return{
    pre:{dailyBias:'',bigPicture:'',plan:'',feelings:'',
      esImgFractal:'',esImgTPO:'',esImg15:'',
      nqImgFractal:'',nqImgTPO:'',nqImg15:''},
    trades:[newTrade()],
    eod:{emotions:'',well:'',fix:'',review:'',
      img15ES:'',imgTPOES:'',img15NQ:'',imgTPONQ:''},
  };
}
function newTrade(){return{ticker:'',direction:'',contracts:'',sl:'',plan:'',candle:'',result:'',points:'',emotions:'',notes:'',img1:'',img15:'',open:true};}
function useIsMobile(){
  const[mobile,setMobile]=useState(window.innerWidth<768);
  useEffect(()=>{
    const h=()=>setMobile(window.innerWidth<768);
    window.addEventListener('resize',h);
    return()=>window.removeEventListener('resize',h);
  },[]);
  return mobile;
}

// ─── Discord-style Lightbox ───────────────────────────────────────────────────
function Lightbox({src,onClose}){
  const[zoom,setZoom]=useState(1);
  const[pos,setPos]=useState({x:0,y:0});
  const[dragging,setDragging]=useState(false);
  const dragStart=useRef(null);
  const imgRef=useRef();

  useEffect(()=>{
    document.body.style.overflow='hidden';
    const esc=(e)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('keydown',esc);
    return()=>{document.body.style.overflow='';window.removeEventListener('keydown',esc);};
  },[onClose]);

  // scroll wheel zoom like Discord
  const onWheel=useCallback((e)=>{
    e.preventDefault();
    const delta=e.deltaY>0?-0.15:0.15;
    setZoom(z=>Math.min(8,Math.max(1,z+delta)));
    if(zoom+delta<=1)setPos({x:0,y:0});
  },[zoom]);

  useEffect(()=>{
    const el=imgRef.current;
    if(!el)return;
    el.addEventListener('wheel',onWheel,{passive:false});
    return()=>el.removeEventListener('wheel',onWheel);
  },[onWheel]);

  const onMouseDown=(e)=>{
    if(zoom<=1)return;
    e.preventDefault();
    setDragging(true);
    dragStart.current={mx:e.clientX-pos.x,my:e.clientY-pos.y};
  };
  const onMouseMove=(e)=>{if(!dragging)return;setPos({x:e.clientX-dragStart.current.mx,y:e.clientY-dragStart.current.my});};
  const onMouseUp=()=>setDragging(false);

  // touch pinch zoom
  const lastTouch=useRef(null);
  const onTouchStart=(e)=>{
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      lastTouch.current=Math.hypot(dx,dy);
    }
  };
  const onTouchMove=(e)=>{
    if(e.touches.length===2&&lastTouch.current){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const dist=Math.hypot(dx,dy);
      const delta=(dist-lastTouch.current)*0.01;
      setZoom(z=>Math.min(8,Math.max(1,z+delta)));
      lastTouch.current=dist;
    }
  };

  const zoomPct=Math.round(zoom*100);

  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'#000000ee',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
      {/* top bar */}
      <div onClick={e=>e.stopPropagation()} style={{position:'fixed',top:0,left:0,right:0,height:52,background:'#111111cc',backdropFilter:'blur(12px)',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',zIndex:10000,borderBottom:`1px solid ${C.border}`}}>
        <span style={{fontSize:13,color:C.textSub,fontFamily:'inherit'}}>📷 Chart Preview</span>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>{setZoom(z=>Math.max(1,+(z-0.25).toFixed(2)));}} style={btnStyle}>−</button>
          <span style={{fontSize:12,color:C.textSub,minWidth:40,textAlign:'center',fontVariantNumeric:'tabular-nums'}}>{zoomPct}%</span>
          <button onClick={()=>setZoom(z=>Math.min(8,+(z+0.25).toFixed(2)))} style={btnStyle}>+</button>
          <button onClick={()=>{setZoom(1);setPos({x:0,y:0});}} style={{...btnStyle,fontSize:11,padding:'0 10px',width:'auto'}}>Reset</button>
          <div style={{width:1,height:24,background:C.border,margin:'0 4px'}}/>
          <button onClick={onClose} style={{...btnStyle,color:C.red}}>✕</button>
        </div>
      </div>
      {/* image */}
      <div
        ref={imgRef}
        onClick={e=>e.stopPropagation()}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        style={{
          marginTop:52,
          transform:`scale(${zoom}) translate(${pos.x/zoom}px,${pos.y/zoom}px)`,
          transformOrigin:'center center',
          cursor:zoom>1?(dragging?'grabbing':'grab'):'zoom-in',
          transition:dragging?'none':'transform 0.1s',
        }}
      >
        <img src={src} alt="chart" style={{maxWidth:'92vw',maxHeight:'calc(92vh - 52px)',borderRadius:6,display:'block',boxShadow:'0 8px 40px #00000088'}}/>
      </div>
      {/* zoom hint */}
      {zoom===1&&<div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',fontSize:11,color:C.textMut,background:'#111111cc',padding:'6px 14px',borderRadius:20,backdropFilter:'blur(8px)'}}>
        Scroll to zoom · Drag to pan · Esc to close
      </div>}
    </div>
  );
}
const btnStyle={background:'#1e1e1e',border:`1px solid ${C.border}`,borderRadius:7,color:C.textSub,width:34,height:34,cursor:'pointer',fontSize:16,fontFamily:'inherit',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'};

// ─── Image Slot — with working Ctrl+V paste ───────────────────────────────────
// Each slot listens on its own div for paste via a hidden textarea trick
function ImageSlot({label,value,onChange,accent}){
  const[drag,setDrag]=useState(false);
  const[lightbox,setLightbox]=useState(false);
  const[pasteActive,setPasteActive]=useState(false);
  const fileRef=useRef();
  const zoneRef=useRef();

  const processFile=useCallback((file)=>{
    if(!file||!file.type.startsWith('image/'))return;
    const reader=new FileReader();
    reader.onload=(e)=>onChange(e.target.result);
    reader.readAsDataURL(file);
  },[onChange]);

  const processClipboard=useCallback((clipData)=>{
    if(!clipData?.items)return;
    for(const item of clipData.items){
      if(item.type.startsWith('image/')){processFile(item.getAsFile());break;}
    }
  },[processFile]);

  // When zone is "focused" (user clicked it), listen for paste on window
  useEffect(()=>{
    if(!pasteActive)return;
    const handler=(e)=>{
      e.preventDefault();
      e.stopPropagation();
      processClipboard(e.clipboardData);
      setPasteActive(false);
    };
    window.addEventListener('paste',handler,true);
    // click outside deactivates
    const outside=(e)=>{if(zoneRef.current&&!zoneRef.current.contains(e.target))setPasteActive(false);};
    window.addEventListener('mousedown',outside);
    return()=>{window.removeEventListener('paste',handler,true);window.removeEventListener('mousedown',outside);};
  },[pasteActive,processClipboard]);

  const borderCol=pasteActive?C.yellow:drag?C.green:value?C.border:`${C.border}`;
  const accentCol=accent||C.blue;

  return(
    <>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,color:C.textSub,marginBottom:6,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
          <span style={{width:6,height:6,borderRadius:'50%',background:accentCol,display:'inline-block'}}/>
          {label}
        </div>
        <div
          ref={zoneRef}
          onClick={()=>{
            if(value){return;}
            // toggle paste mode on click so user can then Ctrl+V
            setPasteActive(true);
          }}
          onDragOver={(e)=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={(e)=>{e.preventDefault();setDrag(false);processFile(e.dataTransfer.files[0]);}}
          style={{
            border:`1.5px ${value?'solid':'dashed'} ${borderCol}`,
            borderRadius:10,minHeight:value?'auto':82,
            display:'flex',alignItems:'center',justifyContent:'center',
            cursor:value?'default':'pointer',overflow:'hidden',
            background:pasteActive?C.yellow+'08':drag?C.green+'08':C.surface,
            transition:'all 0.15s',position:'relative',
          }}
        >
          {value?(
            <>
              <img src={value} alt={label} onClick={(e)=>{e.stopPropagation();setLightbox(true);}}
                style={{width:'100%',display:'block',borderRadius:9,cursor:'zoom-in'}}/>
              <div style={{position:'absolute',top:7,right:7,display:'flex',gap:6}}>
                <button onClick={(e)=>{e.stopPropagation();setLightbox(true);}}
                  style={{background:'#000000bb',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSub,fontSize:11,padding:'4px 9px',cursor:'pointer'}}>⤢</button>
                <button onClick={(e)=>{e.stopPropagation();onChange('');}}
                  style={{background:'#000000bb',border:`1px solid ${C.border}`,borderRadius:6,color:C.red,fontSize:11,padding:'4px 8px',cursor:'pointer'}}>✕</button>
              </div>
            </>
          ):(
            <div style={{textAlign:'center',padding:'14px 10px'}}>
              {pasteActive?(
                <>
                  <div style={{fontSize:20,marginBottom:6}}>📋</div>
                  <div style={{color:C.yellow,fontSize:12,fontWeight:700}}>Ready — press Ctrl+V</div>
                  <div style={{color:C.textDim,fontSize:10,marginTop:3}}>or click elsewhere to cancel</div>
                </>
              ):(
                <>
                  <div style={{fontSize:18,marginBottom:5}}>📎</div>
                  <div style={{color:C.textMut,fontSize:11,lineHeight:1.6}}>
                    Drop · Browse · <span style={{color:accentCol}}>Click then Ctrl+V</span>
                  </div>
                </>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={(e)=>processFile(e.target.files[0])}/>
        </div>
        {!value&&!pasteActive&&(
          <button onClick={()=>fileRef.current.click()} style={{marginTop:4,background:'none',border:'none',color:C.textDim,fontSize:10,cursor:'pointer',fontFamily:'inherit',padding:'2px 0'}}>browse files</button>
        )}
      </div>
      {lightbox&&<Lightbox src={value} onClose={()=>setLightbox(false)}/>}
    </>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
function Pills({options,value,onChange,colors}){
  return(
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      {options.map((o)=>{
        const active=value===o.value;
        const col=colors?.[o.value]||C.text;
        return(
          <button key={o.value} onClick={()=>onChange(active?'':o.value)} style={{
            padding:'7px 18px',borderRadius:20,
            border:active?`1.5px solid ${col}`:`1.5px solid ${C.border}`,
            background:active?col+'22':'transparent',
            color:active?col:C.textMut,fontSize:13,fontFamily:'inherit',
            cursor:'pointer',fontWeight:active?700:400,
            letterSpacing:'0.03em',transition:'all 0.15s',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function Field({label,placeholder,value,onChange,rows=3}){
  return(
    <div style={{marginBottom:20}}>
      <div style={{fontSize:11,color:C.textSub,marginBottom:7,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>{label}</div>
      <textarea value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{
        width:'100%',background:C.surface,border:`1.5px solid ${C.border}`,
        borderRadius:10,color:C.text,fontSize:14,padding:'11px 14px',
        resize:'vertical',fontFamily:'inherit',lineHeight:1.7,outline:'none',boxSizing:'border-box',
      }} onFocus={(e)=>e.target.style.borderColor=C.border2} onBlur={(e)=>e.target.style.borderColor=C.border}/>
    </div>
  );
}

function Input({label,value,onChange,type='text'}){
  return(
    <div style={{marginBottom:16}}>
      <div style={{fontSize:11,color:C.textSub,marginBottom:7,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>{label}</div>
      <input type={type} value={value} onChange={(e)=>onChange(e.target.value)} style={{
        width:'100%',background:C.surface,border:`1.5px solid ${C.border}`,
        borderRadius:10,color:C.text,fontSize:14,padding:'10px 14px',
        fontFamily:'inherit',outline:'none',boxSizing:'border-box',
      }} onFocus={(e)=>e.target.style.borderColor=C.border2} onBlur={(e)=>e.target.style.borderColor=C.border}/>
    </div>
  );
}

function Divider({label}){
  return(
    <div style={{display:'flex',alignItems:'center',gap:12,margin:'26px 0 20px'}}>
      <div style={{flex:1,height:1,background:C.surface2}}/>
      {label&&<span style={{fontSize:10,color:C.textMut,letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:600}}>{label}</span>}
      <div style={{flex:1,height:1,background:C.surface2}}/>
    </div>
  );
}

function StatBox({label,val,color}){
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'11px 12px',textAlign:'center'}}>
      <div style={{fontSize:10,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:5}}>{label}</div>
      <div style={{fontSize:15,fontWeight:700,color:color||C.text,fontVariantNumeric:'tabular-nums'}}>{val}</div>
    </div>
  );
}

// ─── Instrument section label ─────────────────────────────────────────────────
function InstrumentLabel({name,color}){
  return(
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,marginTop:4}}>
      <div style={{width:3,height:32,background:color,borderRadius:2}}/>
      <div>
        <div style={{fontSize:14,fontWeight:800,color:color}}>{name}</div>
        <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.08em'}}>CHARTS</div>
      </div>
    </div>
  );
}

// ─── Trade Card ───────────────────────────────────────────────────────────────
function TradeCard({index,trade,onChange,onRemove,isMobile}){
  const pnl=calcPnL(trade.ticker,trade.contracts,trade.points);
  const risk=calcRisk(trade.ticker,trade.contracts,trade.sl);
  const rr=risk>0?(Math.abs(pnl)/risk).toFixed(2):'—';
  const set=(k)=>(v)=>onChange({...trade,[k]:v});
  const dot=trade.result==='W'?C.green:trade.result==='L'?C.red:trade.result==='BE'?C.yellow:C.border;

  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:10,overflow:'hidden'}}>
      <div onClick={()=>set('open')(!trade.open)} style={{padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',background:trade.open?C.surface2:C.surface}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:dot,flexShrink:0}}/>
          <span style={{fontSize:13,color:C.text,fontWeight:700}}>Trade {index+1}</span>
          {trade.ticker&&<span style={{fontSize:12,color:C.blue,background:C.surface,padding:'2px 8px',borderRadius:5,border:`1px solid ${C.border}`}}>{trade.ticker}</span>}
          {trade.direction&&<span style={{fontSize:11,color:trade.direction==='long'?C.green:C.red,fontWeight:700}}>{trade.direction==='long'?'⬆ L':'⬇ S'}</span>}
          {trade.plan&&<span style={{fontSize:11,color:C.textMut}}>{({balance:'balance',failedexp:'failed exp',reclaim:'reclaim',breakout:'breakout'})[trade.plan]||trade.plan}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {trade.points!==''&&<span style={{fontSize:13,fontWeight:700,color:parseFloat(trade.points)>=0?C.green:C.red,fontVariantNumeric:'tabular-nums'}}>{parseFloat(trade.points)>=0?'+':''}{trade.points}pts</span>}
          <span style={{color:C.textMut,fontSize:13}}>{trade.open?'▲':'▼'}</span>
          <button onClick={(e)=>{e.stopPropagation();onRemove();}} style={{background:'none',border:'none',color:C.textMut,fontSize:16,cursor:'pointer',padding:0,lineHeight:1}}>✕</button>
        </div>
      </div>
      {trade.open&&(
        <div style={{padding:'4px 16px 20px'}}>
          <Divider label="Setup"/>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Ticker</div>
            <Pills options={[{label:'ES',value:'ES'},{label:'NQ',value:'NQ'},{label:'MES',value:'MES'},{label:'MNQ',value:'MNQ'}]}
              value={trade.ticker} onChange={set('ticker')}
              colors={{ES:C.blue,NQ:C.purple,MES:C.teal,MNQ:C.orange}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <Input label="Contracts" type="number" value={trade.contracts} onChange={set('contracts')}/>
            <Input label="SL Points" type="number" value={trade.sl} onChange={set('sl')}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Direction</div>
            <Pills options={[{label:'⬆ Long',value:'long'},{label:'⬇ Short',value:'short'}]}
              value={trade.direction} onChange={set('direction')} colors={{long:C.green,short:C.red}}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Setup Type</div>
            <Pills options={[
              {label:'Balance Trade',value:'balance'},
              {label:'Failed Expansion',value:'failedexp'},
              {label:'Balance Reclaim',value:'reclaim'},
              {label:'Balance Breakout',value:'breakout'},
            ]} value={trade.plan} onChange={set('plan')} colors={{
              balance:C.blue,
              failedexp:C.orange,
              reclaim:C.teal,
              breakout:C.yellow,
            }}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Reversal Candle</div>
            <Pills options={[{label:'✓ Confirmed',value:'yes'},{label:'✗ No confirmation',value:'no'}]}
              value={trade.candle} onChange={set('candle')} colors={{yes:C.green,no:C.red}}/>
          </div>
          <Divider label="Entry Charts"/>
          <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <ImageSlot label="1min Chart" value={trade.img1} onChange={set('img1')} accent={C.teal}/>
            <ImageSlot label="15min Chart" value={trade.img15} onChange={set('img15')} accent={C.blue}/>
          </div>
          <Divider label="Result"/>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Result</div>
            <Pills options={[{label:'Win',value:'W'},{label:'Loss',value:'L'},{label:'Break Even',value:'BE'}]}
              value={trade.result} onChange={set('result')} colors={{W:C.green,L:C.red,BE:C.yellow}}/>
          </div>
          <Input label="Points Gained / Lost" type="number" value={trade.points} onChange={set('points')}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:20}}>
            <StatBox label="P&L $" val={`${pnl>=0?'+':''}$${pnl.toFixed(0)}`} color={pnl>=0?C.green:C.red}/>
            <StatBox label="Risk $" val={`$${risk.toFixed(0)}`} color={C.yellow}/>
            <StatBox label="RR" val={`${rr}R`} color={C.textSub}/>
          </div>
          <Divider label="Notes"/>
          <Field label="Emotions" placeholder="Entry · during · exit..." value={trade.emotions} onChange={set('emotions')} rows={2}/>
          <Field label="Trade Notes" placeholder="Plan followed? Deviations? Key observations..." value={trade.notes} onChange={set('notes')} rows={2}/>
        </div>
      )}
    </div>
  );
}

function SummaryBar({trades}){
  const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points),0);
  const totalPts=trades.reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const wins=trades.filter(t=>t.result==='W').length;
  const losses=trades.filter(t=>t.result==='L').length;
  const counted=trades.filter(t=>t.result).length;
  const wr=counted>0?Math.round((wins/counted)*100):0;
  return(
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
      <StatBox label="P&L" val={`${total>=0?'+':''}$${total.toFixed(0)}`} color={total>=0?C.green:C.red}/>
      <StatBox label="Points" val={`${totalPts>=0?'+':''}${totalPts.toFixed(1)}`} color={totalPts>=0?C.green:C.red}/>
      <StatBox label="W Rate" val={`${wr}%`} color={C.yellow}/>
      <StatBox label="Trades" val={`${wins}W ${losses}L`} color={C.textSub}/>
    </div>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function CalendarModal({selectedDate,onSelect,onClose,index}){
  const now=new Date(selectedDate+'T12:00:00');
  const[year,setYear]=useState(now.getFullYear());
  const[month,setMonth]=useState(now.getMonth());
  const days=getMonthDays(year,month);
  const today=todayStr();
  const prevM=()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);};
  const nextM=()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);};
  return(
    <div style={{position:'fixed',inset:0,background:'#000000cc',zIndex:100,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#111',border:`1px solid ${C.border}`,borderRadius:'18px 18px 0 0',padding:'22px 18px 36px',width:'100%',maxWidth:560}}>
        <div style={{width:36,height:4,background:C.border,borderRadius:2,margin:'0 auto 20px'}}/>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
          <button onClick={prevM} style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:36,height:36,cursor:'pointer',fontSize:18}}>‹</button>
          <span style={{fontSize:15,color:C.text,fontWeight:700}}>{MONTHS[month]} {year}</span>
          <button onClick={nextM} style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:36,height:36,cursor:'pointer',fontSize:18}}>›</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:8}}>
          {DAYS_HDR.map(d=><div key={d} style={{textAlign:'center',fontSize:11,color:C.textMut,padding:'4px 0'}}>{d}</div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
          {days.map((d,i)=>{
            if(!d)return<div key={i}/>;
            const isSel=d===selectedDate;
            const isTod=d===today;
            const dayIdx=index[d];
            const dotColor=dayIdx?.pnl>0?C.green:dayIdx?.pnl<0?C.red:dayIdx?C.yellow:null;
            return(
              <button key={d} onClick={()=>{onSelect(d);onClose();}} style={{
                padding:'9px 0',borderRadius:9,
                border:isSel?`1.5px solid ${C.border2}`:'1.5px solid transparent',
                background:isSel?C.surface2:'transparent',
                color:isTod?'#fff':dayIdx?C.textSub:C.textDim,
                fontSize:13,fontFamily:'inherit',cursor:'pointer',
                fontWeight:isTod?800:400,display:'flex',flexDirection:'column',alignItems:'center',gap:3,
              }}>
                {String(new Date(d+'T12:00:00').getDate())}
                {dotColor&&<div style={{width:4,height:4,borderRadius:'50%',background:dotColor}}/>}
              </button>
            );
          })}
        </div>
        <div style={{display:'flex',gap:18,justifyContent:'center',marginTop:18}}>
          {[[C.green,'Profit'],[C.red,'Loss'],[C.yellow,'Breakeven']].map(([col,lbl])=>(
            <div key={lbl} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:C.textMut}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:col}}/>{lbl}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Pre-Market Tab — 6 images: ES (Fractal, TPO, 15min) + NQ (Fractal, TPO, 15min) ──
function PreMarketTab({data,onChange,isMobile}){
  const set=k=>v=>onChange({...data,[k]:v});
  return(
    <div>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:11,color:C.textSub,marginBottom:10,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Daily Bias</div>
        <Pills options={[{label:'🟢 Bullish',value:'bullish'},{label:'⚪ Neutral',value:'neutral'},{label:'🔴 Bearish',value:'bearish'}]}
          value={data.dailyBias} onChange={set('dailyBias')}
          colors={{bullish:C.green,neutral:'#aaa',bearish:C.red}}/>
      </div>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:11,color:C.textSub,marginBottom:10,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Big Picture</div>
        <Pills options={[{label:'🐂 Bull',value:'bull'},{label:'⚪ Neutral',value:'neutral'},{label:'🐻 Bear',value:'bear'}]}
          value={data.bigPicture} onChange={set('bigPicture')}
          colors={{bull:C.green,neutral:'#aaa',bear:C.red}}/>
      </div>

      <Divider label="Charts"/>

      {/* ES Section */}
      <InstrumentLabel name="ES" color={C.blue}/>
      <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:20}}>
        <ImageSlot label="Fractal" value={data.esImgFractal} onChange={set('esImgFractal')} accent={C.blue}/>
        <ImageSlot label="TPO" value={data.esImgTPO} onChange={set('esImgTPO')} accent={C.blue}/>
        <ImageSlot label="15min" value={data.esImg15} onChange={set('esImg15')} accent={C.blue}/>
      </div>

      {/* NQ Section */}
      <InstrumentLabel name="NQ" color={C.purple}/>
      <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:8}}>
        <ImageSlot label="Fractal" value={data.nqImgFractal} onChange={set('nqImgFractal')} accent={C.purple}/>
        <ImageSlot label="TPO" value={data.nqImgTPO} onChange={set('nqImgTPO')} accent={C.purple}/>
        <ImageSlot label="15min" value={data.nqImg15} onChange={set('nqImg15')} accent={C.purple}/>
      </div>

      <Divider label="Plan"/>
      <Field label="Daily Operating Plan" placeholder="Key levels · VAH/VAL/POC · Setups · Max loss · Risk rules..." value={data.plan} onChange={set('plan')} rows={4}/>
      <Field label="Pre-Market Feelings" placeholder="Mindset · Sleep · Confidence · Anything affecting edge..." value={data.feelings} onChange={set('feelings')} rows={3}/>
    </div>
  );
}

function TradesTab({trades,onChange,isMobile}){
  const update=(i,t)=>onChange(trades.map((x,j)=>j===i?t:x));
  const remove=(i)=>onChange(trades.filter((_,j)=>j!==i));
  const add=()=>onChange([...trades,newTrade()]);
  return(
    <div>
      <SummaryBar trades={trades}/>
      {trades.map((t,i)=>(
        <TradeCard key={i} index={i} trade={t} onChange={nt=>update(i,nt)} onRemove={()=>remove(i)} isMobile={isMobile}/>
      ))}
      <button onClick={add} style={{
        width:'100%',padding:'13px',marginTop:8,
        background:'transparent',border:`1.5px dashed ${C.border}`,
        borderRadius:12,color:C.textMut,fontSize:13,
        fontFamily:'inherit',cursor:'pointer',letterSpacing:'0.04em',transition:'all 0.15s',
      }}
        onMouseEnter={e=>{e.target.style.borderColor=C.border2;e.target.style.color=C.textSub;}}
        onMouseLeave={e=>{e.target.style.borderColor=C.border;e.target.style.color=C.textMut;}}
      >+ Add Trade</button>
    </div>
  );
}

// ─── EOD Tab — 4 images: ES 15min, ES TPO, NQ 15min, NQ TPO ─────────────────
function EODTab({data,onChange,trades,date,isMobile}){
  const set=k=>v=>onChange({...data,[k]:v});
  const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points),0);
  const totalPts=trades.reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const[copied,setCopied]=useState(false);

  const prompt=`Review my trading journal for ${date}.
Daily Bias: ${data.dailyBias||'—'} | Big Picture: ${data.bigPicture||'—'}
Plan: ${data.plan||'—'}
Pre-Market Feelings: ${data.feelings||'—'}
Trades (${trades.length}):
${trades.map((t,i)=>`Trade ${i+1}: ${t.ticker}|${t.direction||'—'}|${t.contracts}c|SL ${t.sl}pts|Setup:${t.plan}|Candle:${t.candle}|Result:${t.result}|Points:${t.points}|P&L:$${calcPnL(t.ticker,t.contracts,t.points).toFixed(0)}|Notes:${t.notes}`).join('\n')}
Total P&L: $${total.toFixed(0)} | Total Points: ${totalPts.toFixed(1)}
EOD Emotions: ${data.emotions||'—'}
What I Did Well: ${data.well||'—'}
What I Must Fix: ${data.fix||'—'}
General Review: ${data.review||'—'}
Please: 1. Bias accuracy. 2. Trade-by-trade breakdown. 3. What I did well (specific). 4. Top 1-2 fixes. 5. Confirm P&L math (ES=$50 NQ=$20 MES=$5 MNQ=$2). 6. Daily review. 7. Tradeable day verdict. 8. One edge to build on. Direct, no padding.`;

  const copy=()=>{navigator.clipboard.writeText(prompt);setCopied(true);setTimeout(()=>setCopied(false),2500);};

  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:24}}>
        {[
          {label:'Day P&L',val:`${total>=0?'+':''}$${total.toFixed(0)}`,col:total>=0?C.green:C.red},
          {label:'Total Points',val:`${totalPts>=0?'+':''}${totalPts.toFixed(1)}`,col:totalPts>=0?C.green:C.red},
        ].map(s=>(
          <div key={s.label} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'16px'}}>
            <div style={{fontSize:11,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>{s.label}</div>
            <div style={{fontSize:30,fontWeight:800,color:s.col,fontVariantNumeric:'tabular-nums'}}>{s.val}</div>
          </div>
        ))}
      </div>

      <Divider label="End of Day Charts"/>

      {/* ES EOD charts */}
      <InstrumentLabel name="ES" color={C.blue}/>
      <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
        <ImageSlot label="15min — Full Day" value={data.img15ES} onChange={set('img15ES')} accent={C.blue}/>
        <ImageSlot label="TPO — Full Day" value={data.imgTPOES} onChange={set('imgTPOES')} accent={C.blue}/>
      </div>

      {/* NQ EOD charts */}
      <InstrumentLabel name="NQ" color={C.purple}/>
      <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:8}}>
        <ImageSlot label="15min — Full Day" value={data.img15NQ} onChange={set('img15NQ')} accent={C.purple}/>
        <ImageSlot label="TPO — Full Day" value={data.imgTPONQ} onChange={set('imgTPONQ')} accent={C.purple}/>
      </div>

      <Divider label="Review"/>
      <Field label="Overall Emotions & Summary" placeholder="In control? Reactive? Overtraded?" value={data.emotions} onChange={set('emotions')} rows={3}/>
      <Field label="✅ What I Did Well" placeholder="Specific — clean executions, rules, reads..." value={data.well} onChange={set('well')} rows={2}/>
      <Field label="❌ What I Must Fix" placeholder="Honest — rules broken, bad entries, oversized..." value={data.fix} onChange={set('fix')} rows={2}/>
      <Field label="General Review" placeholder="Market narrative, levels, notes for tomorrow..." value={data.review} onChange={set('review')} rows={3}/>

      <Divider label="Claude Analysis Prompt"/>
      <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px 16px',fontSize:11,color:C.textMut,lineHeight:1.8,fontFamily:'monospace',marginBottom:12,whiteSpace:'pre-wrap',maxHeight:140,overflowY:'auto'}}>{prompt}</div>
      <button onClick={copy} style={{
        width:'100%',padding:'13px',
        background:copied?C.green+'18':'transparent',
        border:`1.5px solid ${copied?C.green:C.border}`,
        borderRadius:12,color:copied?C.green:C.textSub,
        fontSize:13,fontFamily:'inherit',cursor:'pointer',fontWeight:700,transition:'all 0.2s',
      }}>{copied?'✓ Copied — paste into Claude':'Copy Claude Prompt'}</button>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App(){
  const today=todayStr();
  const isMobile=useIsMobile();
  const[selectedDate,setSelectedDate]=useState(today);
  const[tab,setTab]=useState(0);
  const[dayData,setDayData]=useState(null);
  const[index,setIndex]=useState({});
  const[loading,setLoading]=useState(true);
  const[saveStatus,setSaveStatus]=useState('idle');
  const[showCal,setShowCal]=useState(false);
  const saveTimer=useRef(null);

  useEffect(()=>{loadIndex().then(idx=>setIndex(idx||{}));},[]);
  useEffect(()=>{
    setLoading(true);
    loadDay(selectedDate).then(d=>{setDayData(d||emptyDay());setLoading(false);});
  },[selectedDate]);

  useEffect(()=>{
    if(!dayData||loading)return;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      await saveDay(selectedDate,dayData);
      const trades=dayData.trades||[];
      const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points),0);
      const totalPts=trades.reduce((s,t)=>s+(parseFloat(t.points)||0),0);
      const wins=trades.filter(t=>t.result==='W').length;
      const summary={pnl:total,pts:totalPts,wins,trades:trades.length,bias:dayData.pre?.dailyBias||''};
      await saveIndex(selectedDate,summary);
      setIndex(prev=>({...prev,[selectedDate]:summary}));
      setSaveStatus('saved');
      setTimeout(()=>setSaveStatus('idle'),3000);
    },1000);
    return()=>clearTimeout(saveTimer.current);
  },[dayData]);

  const updatePre=pre=>setDayData(d=>({...d,pre}));
  const updateTrades=trades=>setDayData(d=>({...d,trades}));
  const updateEod=eod=>setDayData(d=>({...d,eod}));

  const goDay=(offset)=>{
    const d=new Date(selectedDate+'T12:00:00');
    d.setDate(d.getDate()+offset);
    setSelectedDate(d.toLocaleDateString('en-CA'));
    setTab(0);
  };

  const biasColor=dayData?.pre?.dailyBias==='bullish'?C.green:dayData?.pre?.dailyBias==='bearish'?C.red:null;
  const isToday=selectedDate===today;
  const dayIdx=index[selectedDate];
  const sideW=260;

  return(
    <div style={{minHeight:'100vh',background:C.bg,fontFamily:"'Inter','DM Sans','Helvetica Neue',sans-serif",color:C.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px;}
        textarea::placeholder,input::placeholder{color:${C.textDim};}
        textarea,input{transition:border-color 0.15s;}
      `}</style>

      <div style={{maxWidth:isMobile?'100%':940,margin:'0 auto',display:isMobile?'block':'flex',minHeight:'100vh'}}>

        {/* Desktop Sidebar */}
        {!isMobile&&(
          <div style={{width:sideW,flexShrink:0,borderRight:`1px solid ${C.surface2}`,padding:'28px 20px',display:'flex',flexDirection:'column',gap:24,position:'sticky',top:0,height:'100vh',overflowY:'auto'}}>
            <div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.14em',textTransform:'uppercase',marginBottom:6}}>Trading Journal</div>
              <div style={{fontSize:24,fontWeight:800,color:C.text}}>📈</div>
            </div>
            <div style={{fontSize:12,color:saveStatus==='saving'?C.yellow:saveStatus==='saved'?C.green:C.textDim}}>
              {saveStatus==='saving'?'● Saving...':saveStatus==='saved'?'✓ Saved':'○ Auto-save on'}
            </div>
            <div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Date</div>
              <button onClick={()=>setShowCal(true)} style={{width:'100%',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',cursor:'pointer',textAlign:'left',fontFamily:'inherit',marginBottom:8}}>
                <div style={{fontSize:14,color:C.text,fontWeight:700}}>{fmtDate(selectedDate)}</div>
                {dayIdx?<div style={{fontSize:12,color:dayIdx.pnl>=0?C.green:C.red,marginTop:3,fontVariantNumeric:'tabular-nums'}}>{dayIdx.pnl>=0?'+':''}${dayIdx.pnl.toFixed(0)} · {dayIdx.trades} trade{dayIdx.trades!==1?'s':''}</div>
                  :<div style={{fontSize:12,color:C.textDim,marginTop:3}}>no entries yet</div>}
              </button>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>goDay(-1)} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,height:34,cursor:'pointer',fontSize:16}}>‹</button>
                <button onClick={()=>goDay(1)} disabled={selectedDate>=today} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:selectedDate>=today?C.textDim:C.textSub,height:34,cursor:selectedDate>=today?'default':'pointer',fontSize:16}}>›</button>
                {!isToday&&<button onClick={()=>{setSelectedDate(today);setTab(0);}} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,height:34,cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>Today</button>}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Section</div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                {TABS.map((t,i)=>(
                  <button key={t} onClick={()=>setTab(i)} style={{padding:'10px 14px',borderRadius:9,textAlign:'left',background:tab===i?C.surface2:'transparent',border:tab===i?`1px solid ${C.border}`:'1px solid transparent',color:tab===i?C.text:C.textMut,fontSize:13,fontFamily:'inherit',cursor:'pointer',fontWeight:tab===i?700:400,transition:'all 0.15s'}}>
                    {i===0?'📋 ':i===1?'📊 ':'🔚 '}{t}
                  </button>
                ))}
              </div>
            </div>
            {biasColor&&(
              <div style={{padding:'10px 14px',borderRadius:10,border:`1px solid ${biasColor}44`,background:biasColor+'10',fontSize:13,color:biasColor,fontWeight:700,textTransform:'capitalize'}}>
                {dayData?.pre?.dailyBias==='bullish'?'🟢':'🔴'} {dayData?.pre?.dailyBias}
              </div>
            )}
            {dayIdx&&(
              <div style={{marginTop:'auto',paddingTop:20,borderTop:`1px solid ${C.surface2}`}}>
                <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:8}}>Day P&L</div>
                <div style={{fontSize:28,fontWeight:800,color:dayIdx.pnl>=0?C.green:C.red,fontVariantNumeric:'tabular-nums'}}>{dayIdx.pnl>=0?'+':''}${dayIdx.pnl.toFixed(0)}</div>
              </div>
            )}
          </div>
        )}

        {/* Main content */}
        <div style={{flex:1,padding:isMobile?'16px 16px 80px':'28px 32px 60px',overflowY:'auto'}}>

          {/* Mobile header */}
          {isMobile&&(
            <div style={{marginBottom:18}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <div style={{fontSize:11,color:C.textMut,letterSpacing:'0.12em',textTransform:'uppercase'}}>Trading Journal</div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontSize:11,color:saveStatus==='saving'?C.yellow:saveStatus==='saved'?C.green:'transparent'}}>{saveStatus==='saving'?'saving...':'✓ saved'}</span>
                  {biasColor&&<div style={{padding:'4px 10px',borderRadius:20,border:`1px solid ${biasColor}44`,background:biasColor+'12',fontSize:11,color:biasColor,fontWeight:700,textTransform:'uppercase'}}>{dayData?.pre?.dailyBias}</div>}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                <button onClick={()=>goDay(-1)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:36,height:36,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>‹</button>
                <button onClick={()=>setShowCal(true)} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 12px',cursor:'pointer',textAlign:'left',fontFamily:'inherit'}}>
                  <div style={{fontSize:14,color:C.text,fontWeight:700}}>{fmtDate(selectedDate)}{isToday?' · Today':''}</div>
                  {dayIdx?<div style={{fontSize:11,color:dayIdx.pnl>=0?C.green:C.red,marginTop:2,fontVariantNumeric:'tabular-nums'}}>{dayIdx.pnl>=0?'+':''}${dayIdx.pnl.toFixed(0)} · {dayIdx.trades} trade{dayIdx.trades!==1?'s':''}</div>
                    :<div style={{fontSize:11,color:C.textDim,marginTop:2}}>no entries yet</div>}
                </button>
                <button onClick={()=>goDay(1)} disabled={selectedDate>=today} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:selectedDate>=today?C.textDim:C.textSub,width:36,height:36,cursor:selectedDate>=today?'default':'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>›</button>
                {!isToday&&<button onClick={()=>{setSelectedDate(today);setTab(0);}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,padding:'0 10px',height:36,cursor:'pointer',fontSize:12,fontFamily:'inherit',flexShrink:0}}>Today</button>}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4,background:C.surface,borderRadius:12,padding:4,border:`1px solid ${C.border}`}}>
                {TABS.map((t,i)=>(
                  <button key={t} onClick={()=>setTab(i)} style={{padding:'10px 4px',borderRadius:9,background:tab===i?C.surface2:'transparent',border:'none',color:tab===i?C.text:C.textMut,fontSize:11,fontFamily:'inherit',cursor:'pointer',fontWeight:tab===i?700:400,letterSpacing:'0.03em',transition:'all 0.15s'}}>{t}</button>
                ))}
              </div>
            </div>
          )}

          {!isMobile&&(
            <div style={{marginBottom:28}}>
              <div style={{fontSize:22,fontWeight:800,color:C.text,marginBottom:4}}>
                {tab===0?'📋 Pre-Market Bias':tab===1?'📊 Trades':'🔚 End of Day Review'}
              </div>
              <div style={{fontSize:14,color:C.textMut}}>{fmtDate(selectedDate)}{isToday?' · Today':''}</div>
            </div>
          )}

          {loading?(
            <div style={{textAlign:'center',color:C.textMut,fontSize:13,padding:'60px 0'}}>Loading...</div>
          ):(
            <>
              {tab===0&&<PreMarketTab data={dayData.pre} onChange={updatePre} isMobile={isMobile}/>}
              {tab===1&&<TradesTab trades={dayData.trades} onChange={updateTrades} isMobile={isMobile}/>}
              {tab===2&&<EODTab data={{...dayData.eod,dailyBias:dayData.pre.dailyBias,bigPicture:dayData.pre.bigPicture,plan:dayData.pre.plan,feelings:dayData.pre.feelings}} onChange={updateEod} trades={dayData.trades} date={selectedDate} isMobile={isMobile}/>}
            </>
          )}
        </div>
      </div>
      {showCal&&<CalendarModal selectedDate={selectedDate} onSelect={d=>{setSelectedDate(d);setTab(0);}} onClose={()=>setShowCal(false)} index={index}/>}
    </div>
  );
}
