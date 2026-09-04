import React, { useState, useRef, useEffect, useCallback } from 'react';
import { supabase, loadDay, saveDay, loadIndex, saveIndex, loadAllDays, getCurrentUser, signIn, signUp, signOut } from './supabase';

const POINT_VALUES = { ES: 50, NQ: 20, MES: 5, MNQ: 2 };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_HDR = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const TABS = ["Trades", "Analytics", "Ask Claude"];

const THEMES = {
  dark:{
    bg:'#0e0e0e', surface:'#161616', surface2:'#1c1c1c',
    border:'#2a2a2a', border2:'#3a3a3a',
    text:'#e8e8e8', textSub:'#999', textMut:'#555', textDim:'#333',
    green:'#4ade80', red:'#f87171', yellow:'#fbbf24',
    blue:'#60a5fa', purple:'#a78bfa', teal:'#34d399', orange:'#fb923c',
  },
  light:{
    bg:'#f5f6f8', surface:'#ffffff', surface2:'#edeff2',
    border:'#dfe2e7', border2:'#c9cdd4',
    text:'#17181a', textSub:'#565b63', textMut:'#9aa0a8', textDim:'#c9cdd3',
    green:'#15803d', red:'#dc2626', yellow:'#b45309',
    blue:'#2563eb', purple:'#7c3aed', teal:'#0f766e', orange:'#ea580c',
  },
};
const C = {...THEMES.dark};
function applyTheme(mode){
  Object.assign(C, THEMES[mode]||THEMES.dark);
  try{document.body.style.background=C.bg;}catch(_){}
}
function initialTheme(){
  try{
    const saved=localStorage.getItem('journal_theme');
    if(saved==='light'||saved==='dark')return saved;
    if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)return 'light';
  }catch(_){}
  return 'dark';
}

function calcPnL(ticker,contracts,points){return(parseFloat(points)||0)*(POINT_VALUES[ticker]||0);}
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
    pre:{},
    trades:[newTrade()],
    eod:{emotions:'',well:'',fix:'',review:''},
  };
}
const SETUP_OPTIONS = [
  {label:'BPB', value:'BPB'}, {label:'RPB', value:'RPB'}, {label:'ROT', value:'ROT'}, {label:'Fade', value:'FADE'},
];
const TRIGGER_OPTIONS = [
  {label:'b shape FP', value:'b_shape_FP'}, {label:'P shape FP', value:'P_shape_FP'},
  {label:'Exhaustion', value:'exhaustion'}, {label:'Absorption', value:'absorption'},
  {label:'Volume Spike', value:'volume_spike'}, {label:'Initiative Participants', value:'initiative_participants'},
];
const ATTEMPT_OPTIONS = [
  {label:'Entry 1', value:'entry_1'}, {label:'Entry 2', value:'entry_2'}, {label:'Entry 3', value:'entry_3'},
];
const ST_OPTIONS = [
  {label:'Bullish Short Term', value:'bullish_st'}, {label:'Bearish Short Term', value:'bearish_st'}, {label:'Balanced Short Term', value:'balanced_st'},
];
const HTF_OPTIONS = [
  {label:'Bullish HTF', value:'bullish_htf'}, {label:'Bearish HTF', value:'bearish_htf'},
];
const OPENING_OPTIONS = [
  {label:'In Range In Value', value:'ir_iv'}, {label:'In Range Out of Value', value:'ir_ov'}, {label:'Out of Range Out of Value', value:'or_ov'},
];
const DIRECTION_OPTIONS = [
  {label:'Long', value:'long'}, {label:'Short', value:'short'},
];
const COMPOSITE_BALANCE_EXTREME = [
  {label:'M DVAH', value:'m_dvah'}, {label:'M DVAL', value:'m_dval'},
  {label:'M PVAH', value:'m_pvah'}, {label:'M PVAL', value:'m_pval'},
];
const M_EXTREME_DEV_BAND = [
  {label:'W DVAH', value:'w_dvah'}, {label:'W DVAL', value:'w_dval'},
  {label:'W PVAH', value:'w_pvah'}, {label:'W PVAL', value:'w_pval'},
];
const W_EXTREME_DEV_BAND = [
  {label:'PDVAH', value:'pdvah'}, {label:'PDVAL', value:'pdval'},
];

function newTrade(){return{ticker:'',direction:'',contracts:'',sl:'',plan:'',confluences:[],triggers:[],attempt:'',stContext:'',htfContext:'',openingType:'',compositeBalanceExtreme:[],mExtremeDevBand:[],wExtremeDevBand:[],mfe:'',mae:'',commission:'',result:'',points:'',entryTime:'',exitTime:'',emotions:'',notes:'',img1:'',img15:'',partials:[],avgEntry:'',multiEntry:false,open:true};}

// Generate 5-min interval time options for 10:30am - 4:00pm EST
function timeOptions(){
  const opts=[];
  for(let h=9;h<=16;h++){
    for(let m=0;m<60;m+=5){
      if(h===9&&m<30)continue; // start at 9:30 — full RTH open
      if(h===16&&m>0)break;     // end at 16:00
      const hh=String(h).padStart(2,'0');
      const mm=String(m).padStart(2,'0');
      const period=h<12?'AM':h===12?'PM':'PM';
      const h12=h>12?h-12:h===0?12:h;
      opts.push({value:`${hh}:${mm}`,label:`${h12}:${mm} ${period}`});
    }
  }
  return opts;
}
const TIME_OPTIONS=timeOptions();

function calcHoldTime(entry,exit){
  if(!entry||!exit)return null;
  const [eh,em]=entry.split(':').map(Number);
  const [xh,xm]=exit.split(':').map(Number);
  const mins=(xh*60+xm)-(eh*60+em);
  if(mins<=0)return null;
  if(mins<60)return `${mins}m`;
  return `${Math.floor(mins/60)}h ${mins%60>0?`${mins%60}m`:''}`.trim();
}

function sessionWindow(time){
  if(!time)return null;
  const [h,m]=time.split(':').map(Number);
  const total=h*60+m;
  if(total>=570&&total<630)return 'IB Period';  // 9:30-10:30 — initial balance forming
  if(total>=630&&total<660)return 'C-period';   // 10:30-11:00 — highest-stat break window
  if(total>=660&&total<720)return 'D-period';   // 11:00-12:00
  if(total>=720&&total<=960)return 'Afternoon'; // 12:00-4:00pm — Noon folded in, one combined window
  return 'Other';                                // anything outside 9:30-4:00
}
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
      {zoom===1&&<div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',fontSize:11,color:C.textMut,background:'#111111cc',padding:'6px 14px',borderRadius:20,backdropFilter:'blur(8px)'}}>
        Scroll to zoom · Drag to pan · Esc to close
      </div>}
    </div>
  );
}
const btnStyle={background:'#1e1e1e',border:`1px solid ${C.border}`,borderRadius:7,color:C.textSub,width:34,height:34,cursor:'pointer',fontSize:16,fontFamily:'inherit',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'};

// ─── Image Slot ───────────────────────────────────────────────────────────────
function ImageSlot({label,value,onChange,accent,userId}){
  const[drag,setDrag]=useState(false);
  const[lightbox,setLightbox]=useState(false);
  const[pasteActive,setPasteActive]=useState(false);
  const[uploading,setUploading]=useState(false);
  const fileRef=useRef();
  const zoneRef=useRef();

  const uploadFile=useCallback(async(file)=>{
    if(!file||!file.type.startsWith('image/'))return;
    setUploading(true);
    try{
      // Delete old image from storage if it's a storage URL
      if(value&&value.includes('journal-images')){
        const path=value.split('/journal-images/')[1];
        if(path)await supabase.storage.from('journal-images').remove([path]);
      }
      const ext=file.name.split('.').pop()||'jpg';
      const uid=userId||'anon';
      const path=`${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const{error}=await supabase.storage.from('journal-images').upload(path,file,{upsert:false,contentType:file.type});
      if(error){console.error('Upload error:',error);return;}
      const{data}=supabase.storage.from('journal-images').getPublicUrl(path);
      onChange(data.publicUrl);
    }catch(e){console.error(e);}
    finally{setUploading(false);}
  },[onChange,value,userId]);

  const processClipboard=useCallback((clipData)=>{
    if(!clipData?.items)return;
    for(const item of clipData.items){
      if(item.type.startsWith('image/')){uploadFile(item.getAsFile());break;}
    }
  },[uploadFile]);

  useEffect(()=>{
    if(!pasteActive)return;
    const handler=(e)=>{
      e.preventDefault();
      e.stopPropagation();
      processClipboard(e.clipboardData);
      setPasteActive(false);
    };
    window.addEventListener('paste',handler,true);
    const outside=(e)=>{if(zoneRef.current&&!zoneRef.current.contains(e.target))setPasteActive(false);};
    window.addEventListener('mousedown',outside);
    return()=>{window.removeEventListener('paste',handler,true);window.removeEventListener('mousedown',outside);};
  },[pasteActive,processClipboard]);

  const handleDelete=async(e)=>{
    e.stopPropagation();
    if(value&&value.includes('journal-images')){
      const path=value.split('/journal-images/')[1];
      if(path)await supabase.storage.from('journal-images').remove([path]);
    }
    onChange('');
  };

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
          onClick={()=>{if(value||uploading){return;}setPasteActive(true);}}
          onDragOver={(e)=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={(e)=>{e.preventDefault();setDrag(false);uploadFile(e.dataTransfer.files[0]);}}
          style={{
            border:`1.5px ${value?'solid':'dashed'} ${borderCol}`,
            borderRadius:10,minHeight:value?'auto':82,
            display:'flex',alignItems:'center',justifyContent:'center',
            cursor:value?'default':'pointer',overflow:'hidden',
            background:pasteActive?C.yellow+'08':drag?C.green+'08':C.surface,
            transition:'all 0.15s',position:'relative',
          }}
        >
          {uploading?(
            <div style={{textAlign:'center',padding:'14px 10px'}}>
              <div style={{fontSize:18,marginBottom:5}}>⏳</div>
              <div style={{color:C.textMut,fontSize:11}}>Uploading...</div>
            </div>
          ):value?(
            <>
              <img src={value} alt={label} onClick={(e)=>{e.stopPropagation();setLightbox(true);}}
                style={{width:'100%',display:'block',borderRadius:9,cursor:'zoom-in'}}/>
              <div style={{position:'absolute',top:7,right:7,display:'flex',gap:6}}>
                <button onClick={(e)=>{e.stopPropagation();setLightbox(true);}}
                  style={{background:'#000000bb',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSub,fontSize:11,padding:'4px 9px',cursor:'pointer'}}>⤢</button>
                <button onClick={handleDelete}
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
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={(e)=>uploadFile(e.target.files[0])}/>
        </div>
        {!value&&!pasteActive&&!uploading&&(
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

function TradeCard({index,trade,onChange,onRemove,isMobile,userId}){
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
          {!trade.sl && trade.ticker && <span title="No SL entered — R-multiples and MFE capture can't compute without it" style={{fontSize:10,color:C.red,background:C.red+'15',padding:'2px 7px',borderRadius:10,fontWeight:700}}>⚠ NO SL</span>}
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
            <Input label="SL Points (per contract)" type="number" value={trade.sl} onChange={set('sl')}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Direction</div>
            <Pills options={[{label:'⬆ Long',value:'long'},{label:'⬇ Short',value:'short'}]}
              value={trade.direction} onChange={set('direction')} colors={{long:C.green,short:C.red}}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Setup Type</div>
            <Pills options={[
              {label:'BPB',value:'BPB'},
              {label:'RPB',value:'RPB'},
              {label:'ROT',value:'ROT'},
              {label:'Fade',value:'FADE'},
            ]} value={trade.plan} onChange={set('plan')} colors={{
              BPB:C.blue,RPB:C.teal,ROT:C.yellow,FADE:C.orange,
            }}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Entry Trigger</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {[
                {label:'b shape FP',value:'b_shape_FP',col:C.green},
                {label:'P shape FP',value:'P_shape_FP',col:C.red},
                {label:'Exhaustion',value:'exhaustion',col:C.orange},
                {label:'Absorption',value:'absorption',col:C.teal},
                {label:'Volume Spike',value:'volume_spike',col:C.yellow},
                {label:'Initiative Participants',value:'initiative_participants',col:C.purple},
              ].map(o=>{
                const active=(trade.triggers||[]).includes(o.value);
                const toggle=()=>{
                  const cur=trade.triggers||[];
                  set('triggers')(active?cur.filter(x=>x!==o.value):[...cur,o.value]);
                };
                return(
                  <button key={o.value} onClick={toggle} style={{
                    padding:'5px 11px',borderRadius:20,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                    border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                    background:active?o.col+'22':'transparent',
                    color:active?o.col:C.textMut,fontWeight:active?700:400,transition:'all 0.15s',
                  }}>{o.label}</button>
                );
              })}
            </div>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Entry Attempt</div>
            <Pills options={[
              {label:'Entry 1',value:'entry_1'},
              {label:'Entry 2',value:'entry_2'},
              {label:'Entry 3',value:'entry_3'},
            ]} value={trade.attempt} onChange={set('attempt')} colors={{
              entry_1:C.green,entry_2:C.yellow,entry_3:C.orange,
            }}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Short-Term Context</div>
            <Pills options={[
              {label:'Bullish Short Term',value:'bullish_st'},
              {label:'Bearish Short Term',value:'bearish_st'},
              {label:'Balanced Short Term',value:'balanced_st'},
            ]} value={trade.stContext} onChange={set('stContext')} colors={{
              bullish_st:C.green,bearish_st:C.red,balanced_st:C.yellow,
            }}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>HTF Context</div>
            <Pills options={[
              {label:'Bullish HTF',value:'bullish_htf'},
              {label:'Bearish HTF',value:'bearish_htf'},
            ]} value={trade.htfContext} onChange={set('htfContext')} colors={{
              bullish_htf:C.green,bearish_htf:C.red,
            }}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Opening Type</div>
            <Pills options={[
              {label:'In Range In Value',value:'ir_iv'},
              {label:'In Range Out of Value',value:'ir_ov'},
              {label:'Out of Range Out of Value',value:'or_ov'},
            ]} value={trade.openingType} onChange={set('openingType')} colors={{
              ir_iv:C.blue,ir_ov:C.teal,or_ov:C.purple,
            }}/>
          </div>
          {[
            ['Composite Profile Balance Extreme', 'compositeBalanceExtreme', COMPOSITE_BALANCE_EXTREME],
            ['M Extreme Deviation Band', 'mExtremeDevBand', M_EXTREME_DEV_BAND],
            ['W Extreme Deviation Band', 'wExtremeDevBand', W_EXTREME_DEV_BAND],
          ].map(([label, field, opts])=>(
            <div key={field} style={{marginBottom:16}}>
              <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>{label}</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {opts.map(o=>{
                  const active=(trade[field]||[]).includes(o.value);
                  const toggle=()=>{
                    const cur=trade[field]||[];
                    set(field)(active?cur.filter(x=>x!==o.value):[...cur,o.value]);
                  };
                  return(
                    <button key={o.value} onClick={toggle} style={{
                      padding:'5px 11px',borderRadius:20,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                      border:active?`1.5px solid ${C.teal}`:`1.5px solid ${C.border}`,
                      background:active?C.teal+'18':'transparent',
                      color:active?C.teal:C.textMut,fontWeight:active?700:400,transition:'all 0.15s',
                    }}>{o.label}</button>
                  );
                })}
              </div>
            </div>
          ))}
          <Divider label="Result"/>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Result</div>
            <Pills options={[{label:'Win',value:'W'},{label:'Loss',value:'L'},{label:'Break Even',value:'BE'}]}
              value={trade.result} onChange={set('result')} colors={{W:C.green,L:C.red,BE:C.yellow}}/>
          </div>
          <Input label="Total Points (all contracts combined)" type="number" value={trade.points} onChange={set('points')}/>
          <Input label="Entry Price" type="number" value={trade.avgEntry} onChange={set('avgEntry')}/>
          <Input label="Commission ($, total for trade)" type="number" value={trade.commission} onChange={set('commission')}/>

          {trade.partials && trade.partials.length > 0 && (
            <div style={{marginBottom:16,padding:'12px 14px',background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}}>
              <div style={{fontSize:11,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:2}}>
                Partial Exits (from import{trade.multiEntry?' — scaled-in entry':''})
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
                {trade.partials.map((p,i)=>{
                  const sl=parseFloat(trade.sl);
                  const rr = sl ? (p.points/sl) : null;
                  return(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'6px 0',borderBottom:i<trade.partials.length-1?`1px solid ${C.border}`:'none'}}>
                      <span style={{color:C.textSub}}>Partial {i+1} — {p.qty} @ {p.price} ({p.time})</span>
                      <span style={{fontWeight:700,color:p.points>=0?C.green:C.red}}>
                        {p.points>=0?'+':''}{p.points.toFixed(2)}pt{rr!==null?` · ${rr>=0?'+':''}${rr.toFixed(2)}R`:''}
                      </span>
                    </div>
                  );
                })}
              </div>
              {!trade.sl && <div style={{fontSize:11,color:C.textMut,marginTop:8}}>Enter SL above to see per-partial R multiples.</div>}
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <Input label="MFE (pts per contract)" type="number" value={trade.mfe} onChange={set('mfe')}/>
            <Input label="MAE (pts per contract)" type="number" value={trade.mae} onChange={set('mae')}/>
          </div>

          {/* Entry / Exit time */}
          {(() => {
            const isOutsideRTH = (t) => {
              const m = String(t||'').match(/(\d{1,2}):(\d{2})/);
              if (!m) return false;
              const mins = (+m[1])*60 + (+m[2]);
              return mins < 570 || mins > 960; // before 9:30 or after 4:00
            };
            return (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
            <div>
              <div style={{fontSize:11,color:C.textSub,marginBottom:6,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Entry Time (EST)</div>
              <select value={trade.entryTime||''} onChange={e=>set('entryTime')(e.target.value)} style={{
                width:'100%',padding:'9px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,
                background:C.bg,color:trade.entryTime?C.text:C.textDim,fontSize:13,fontFamily:'inherit',
                cursor:'pointer',outline:'none',
              }}>
                <option value=''>-- select --</option>
                {trade.entryTime && !TIME_OPTIONS.some(o=>o.value===trade.entryTime) && (
                  isOutsideRTH(trade.entryTime)
                    ? <option value={trade.entryTime}>⚠ {trade.entryTime} (outside 9:30–4:00 — check Sierra's Global Time Zone setting)</option>
                    : <option value={trade.entryTime}>{trade.entryTime} (exact time)</option>
                )}
                {TIME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:11,color:C.textSub,marginBottom:6,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Exit Time (EST)</div>
              <select value={trade.exitTime||''} onChange={e=>set('exitTime')(e.target.value)} style={{
                width:'100%',padding:'9px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,
                background:C.bg,color:trade.exitTime?C.text:C.textDim,fontSize:13,fontFamily:'inherit',
                cursor:'pointer',outline:'none',
              }}>
                <option value=''>-- select --</option>
                {trade.exitTime && !TIME_OPTIONS.some(o=>o.value===trade.exitTime) && (
                  isOutsideRTH(trade.exitTime)
                    ? <option value={trade.exitTime}>⚠ {trade.exitTime} (outside 9:30–4:00 — check Sierra's Global Time Zone setting)</option>
                    : <option value={trade.exitTime}>{trade.exitTime} (exact time)</option>
                )}
                {TIME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
            );
          })()}

          {/* Hold time + session window auto-display */}
          {(trade.entryTime||trade.exitTime)&&(
            <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
              {trade.entryTime&&(()=>{const w=sessionWindow(trade.entryTime);return w&&(
                <div style={{padding:'4px 10px',borderRadius:6,background:C.surface2,border:`1px solid ${C.border}`,fontSize:11,color:C.textSub}}>
                  Entry: <span style={{color:C.blue,fontWeight:700}}>{w}</span>
                </div>
              );})()}
              {calcHoldTime(trade.entryTime,trade.exitTime)&&(
                <div style={{padding:'4px 10px',borderRadius:6,background:C.surface2,border:`1px solid ${C.border}`,fontSize:11,color:C.textSub}}>
                  Hold: <span style={{color:C.yellow,fontWeight:700}}>{calcHoldTime(trade.entryTime,trade.exitTime)}</span>
                </div>
              )}
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:20}}>
            <StatBox label="P&L $" val={`${pnl>=0?'+':''}$${pnl.toFixed(0)}`} color={pnl>=0?C.green:C.red}/>
            <StatBox label="Risk $" val={`$${risk.toFixed(0)}`} color={C.yellow}/>
            <StatBox label="RR" val={`${rr}R`} color={C.textSub}/>
          </div>
          <Divider label="Notes"/>
          <Field label="Trade Notes" placeholder="Plan followed? Deviations? Key observations..." value={trade.notes} onChange={set('notes')} rows={2}/>
        </div>
      )}
    </div>
  );
}

function SummaryBar({trades}){
  const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points)-(parseFloat(t.commission)||0),0);
  const totalComm=trades.reduce((s,t)=>s+(parseFloat(t.commission)||0),0);
  const wins=trades.filter(t=>t.result==='W').length;
  const losses=trades.filter(t=>t.result==='L').length;
  const counted=trades.filter(t=>t.result).length;
  const wr=counted>0?Math.round((wins/counted)*100):0;
  // Points broken down by instrument — mixing ES and NQ pts is meaningless
  const esPts=trades.filter(t=>['ES','MES'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const nqPts=trades.filter(t=>['NQ','MNQ'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const hasES=trades.some(t=>['ES','MES'].includes(t.ticker));
  const hasNQ=trades.some(t=>['NQ','MNQ'].includes(t.ticker));
  const ptsLabel=hasES&&hasNQ?`ES ${esPts>=0?'+':''}${esPts.toFixed(1)} / NQ ${nqPts>=0?'+':''}${nqPts.toFixed(1)}`:hasES?`${esPts>=0?'+':''}${esPts.toFixed(1)} ES`:hasNQ?`${nqPts>=0?'+':''}${nqPts.toFixed(1)} NQ`:'—';
  const ptsColor=hasES&&hasNQ?C.textSub:hasES?(esPts>=0?C.green:C.red):(nqPts>=0?C.green:C.red);
  return(
    <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginBottom:16}}>
      <StatBox label="Net P&L" val={`${total>=0?'+':''}$${total.toFixed(0)}`} color={total>=0?C.green:C.red}/>
      <StatBox label="Points" val={ptsLabel} color={ptsColor}/>
      <StatBox label="W Rate" val={`${wr}%`} color={C.yellow}/>
      <StatBox label="Trades" val={`${wins}W ${losses}L`} color={C.textSub}/>
      <StatBox label="Commission" val={totalComm?`-$${totalComm.toFixed(2)}`:'—'} color={C.textMut}/>
    </div>
  );
}


// ─── Tradovate Import ────────────────────────────────────────────────────────
// Calls go through our own /api/* Vercel serverless functions, not directly to
// Tradovate — browsers block direct cross-origin calls to Tradovate's API
// (CORS), but a server-to-server call from Vercel's backend is unrestricted.
async function tradovateAuth(username, password, isDemo) {
  const res = await fetch('/api/tradovate-auth', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ username, password, isDemo }),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data.accessToken) throw new Error(data.error || ('Auth failed: ' + res.status));
  return data.accessToken;
}

async function tradovateFetchFillsAndOrders(token, isDemo) {
  const res = await fetch('/api/tradovate-fills', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ token, isDemo }),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || ('Fetch failed: ' + res.status));
  return data; // { fills, orders }
}

function parseTicker(contractName) {
  if (!contractName) return '';
  let n = contractName.toUpperCase();
  // Sim/demo accounts often prefix the symbol, e.g. "[Sim]MNQU26_FUT_CME" —
  // strip any leading bracketed tag before matching the instrument root.
  n = n.replace(/^\[[^\]]*\]\s*/, '');
  if (n.startsWith('MESM') || n.startsWith('MESU') || n.startsWith('MESH') || n.startsWith('MESZ') || n === 'MES') return 'MES';
  if (n.startsWith('MNQM') || n.startsWith('MNQU') || n.startsWith('MNQH') || n.startsWith('MNQZ') || n === 'MNQ') return 'MNQ';
  if (n.startsWith('ESM') || n.startsWith('ESU') || n.startsWith('ESH') || n.startsWith('ESZ') || n === 'ES') return 'ES';
  if (n.startsWith('NQM') || n.startsWith('NQU') || n.startsWith('NQH') || n.startsWith('NQZ') || n === 'NQ') return 'NQ';
  return contractName;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  // Exact minute — no rounding. Source timestamps (Tradovate/Sierra Chart)
  // are real to the second; storing the precise minute instead of rounding
  // to a 5-min bucket means entry/exit times reflect what actually happened.
  const fh = (h % 24).toString().padStart(2,'0');
  const fm = m.toString().padStart(2,'0');
  return `${fh}:${fm}`;
}

// ═══ Position-based fill grouping ════════════════════════════════════════════
// Shared by Tradovate and Sierra Chart import. Tracks running position per
// instrument (like Tradezella/TradesViz/Edgewonk do) instead of pairing rows
// 1-to-1. A fill in the SAME direction as an open position scales the entry
// (weighted-average entry price). A fill in the OPPOSITE direction is a
// partial (or full) exit. Position hits exactly zero → trade closes. A fill
// that overshoots zero closes the current trade AND opens a new one with the
// flipped remainder, same as any professional tracker treats a reversal.
function groupFillsIntoTrades(fills) {
  // fills: [{ticker, side:'Buy'|'Sell', qty:number, price:number, time:ms-or-parseable, high?:number, low?:number}]
  // high/low (optional): Sierra Chart's HighDuringPosition/LowDuringPosition on
  // each exit fill — the price extreme reached since the previous fill/reset.
  // Chaining these across a position's fills reconstructs the true trade-level
  // MFE/MAE without needing tick data. Only present on Sierra Chart imports.
  const byTicker = {};
  fills.forEach(f => {
    if (!f.ticker || !f.qty || !f.price) return;
    (byTicker[f.ticker] = byTicker[f.ticker] || []).push(f);
  });

  const trades = [];

  Object.entries(byTicker).forEach(([ticker, list]) => {
    list.sort((a, b) => new Date(a.time) - new Date(b.time));

    let pos = null; // { direction, entryLegs:[], exitLegs:[], high, low }

    const finalize = (open) => {
      if (!pos || pos.entryLegs.length === 0) return;
      const sign = pos.direction === 'Long' ? 1 : -1;
      const totalEntryQty = pos.entryLegs.reduce((s, l) => s + l.qty, 0);
      const avgEntry = pos.entryLegs.reduce((s, l) => s + l.qty * l.price, 0) / totalEntryQty;
      const totalExitQty = pos.exitLegs.reduce((s, l) => s + l.qty, 0);
      const combinedPoints = pos.exitLegs.reduce((s, l) => s + sign * (l.price - avgEntry) * l.qty, 0);
      const partials = pos.exitLegs.map(l => ({
        qty: l.qty, price: l.price, time: formatTime(l.time),
        points: +(sign * (l.price - avgEntry)).toFixed(4), // per-contract points for this leg
      }));
      const result = totalExitQty === 0 ? '' : combinedPoints > 0 ? 'W' : combinedPoints < 0 ? 'L' : 'BE';
      // MFE/MAE from chained High/LowDuringPosition, if the source data had them
      let mfe = '', mae = '';
      if (pos.high != null && pos.low != null) {
        mfe = (sign === 1 ? pos.high - avgEntry : avgEntry - pos.low).toFixed(2);
        mae = (sign === 1 ? avgEntry - pos.low : pos.high - avgEntry).toFixed(2);
      }
      // Suggested SL: if the FINAL exit fill was a Stop order, that's where
      // the position's risk was actually defined — back it out from entry vs
      // that fill (per contract), same units as the manual SL field.
      let sl = '';
      const lastExit = pos.exitLegs[pos.exitLegs.length - 1];
      if (lastExit && lastExit.orderType && lastExit.orderType.includes('stop')) {
        sl = Math.abs(avgEntry - lastExit.price).toFixed(2);
      }
      // Real calendar date of entry — used to route this trade to the correct
      // day when saving (not just wherever the app happens to be open to).
      // Uses UTC getters to match the Date.UTC(y,mo,d,...) trick used to build
      // fill.time, avoiding any local-timezone shift.
      const entryDateObj = new Date(pos.entryLegs[0].time);
      const _importDate = `${entryDateObj.getUTCFullYear()}-${String(entryDateObj.getUTCMonth()+1).padStart(2,'0')}-${String(entryDateObj.getUTCDate()).padStart(2,'0')}`;
      trades.push({
        ...newTrade(),
        _importDate,
        ticker,
        direction: pos.direction === 'Long' ? 'long' : 'short', // matches the Direction pill values ('long'/'short')
        contracts: totalEntryQty.toString(),
        entryTime: formatTime(pos.entryLegs[0].time),
        exitTime: pos.exitLegs.length ? formatTime(pos.exitLegs[pos.exitLegs.length - 1].time) : '',
        points: totalExitQty > 0 ? combinedPoints.toFixed(2) : '',
        result,
        mfe, mae, sl,
        commission: pos.commission ? pos.commission.toFixed(2) : '',
        avgEntry: avgEntry.toFixed(2),
        multiEntry: pos.entryLegs.length > 1,
        partials,
        notes: `Imported (${pos.rawSymbol || ticker})${pos.entryLegs.length > 1 ? ` — scaled in (avg entry ${avgEntry.toFixed(2)})` : ''}${partials.length > 1 ? `, ${partials.length} partial exits` : ''}${sl ? `, SL auto-set from stop fill` : ''}${open ? ' — position still open, not closed in this data' : ''}.`,
        open: true,
      });
    };

    const trackExtremes = (pos, f) => {
      if (f.high != null) pos.high = pos.high == null ? f.high : Math.max(pos.high, f.high);
      if (f.low != null) pos.low = pos.low == null ? f.low : Math.min(pos.low, f.low);
      if (f.rawSymbol && !pos.rawSymbol) pos.rawSymbol = f.rawSymbol;
      if (f.commission) pos.commission = (pos.commission || 0) + f.commission;
    };

    list.forEach(f => {
      const isBuy = f.side === 'Buy';
      if (!pos) {
        pos = { direction: isBuy ? 'Long' : 'Short', entryLegs: [{ qty: f.qty, price: f.price, time: f.time }], exitLegs: [], remaining: f.qty, high: null, low: null, commission: 0 };
        trackExtremes(pos, f);
        return;
      }
      const sameDir = (isBuy && pos.direction === 'Long') || (!isBuy && pos.direction === 'Short');
      if (sameDir) {
        pos.entryLegs.push({ qty: f.qty, price: f.price, time: f.time });
        pos.remaining += f.qty;
        trackExtremes(pos, f);
      } else {
        trackExtremes(pos, f);
        if (f.qty <= pos.remaining) {
          pos.exitLegs.push({ qty: f.qty, price: f.price, time: f.time, orderType: f.orderType });
          pos.remaining -= f.qty;
          if (pos.remaining === 0) { finalize(false); pos = null; }
        } else {
          // Overshoot: closes current position, flips remainder into a new one
          pos.exitLegs.push({ qty: pos.remaining, price: f.price, time: f.time, orderType: f.orderType });
          const leftover = f.qty - pos.remaining;
          finalize(false);
          pos = { direction: isBuy ? 'Long' : 'Short', entryLegs: [{ qty: leftover, price: f.price, time: f.time }], exitLegs: [], remaining: leftover, high: null, low: null, commission: 0 };
        }
      }
    });
    if (pos && pos.entryLegs.length) finalize(true); // still open at end of data
  });

  return trades;
}

function fillsToTrades(fills, orders) {
  const norm = (fills || []).map(f => ({
    ticker: parseTicker(f.contractId?.name || f.contractName || ''),
    side: f.action === 'Buy' ? 'Buy' : 'Sell',
    qty: Math.abs(f.qty || 0),
    price: f.price || 0,
    time: f.timestamp,
  }));
  const trades = groupFillsIntoTrades(norm);
  return trades.length > 0 ? trades : [newTrade()];
}

// Sierra Chart CSV parser — feeds the same position-tracking engine as
// Tradovate so multi-leg entries and partial exits group into one trade.
// Parses a Sierra Chart "Trade Activity Log" export (File>>Export or File>>Save
// Log As). Real column headers confirmed from an actual export: ActivityType,
// DateTime, Symbol, Quantity, BuySell, Price, FillPrice, FilledQuantity, etc.
// Two things make this format tricky:
//  1. For Stop/Limit orders, "Price" is the trigger/order price — the actual
//     execution price is in "FillPrice". We must always read FillPrice.
//  2. File>>Export writes prices in raw exchange-native format (e.g. ES fill
//     "747075" means 7470.75) rather than the display format. The multiplier
//     isn't given in the file, so we auto-detect it per row: try dividing by
//     1/10/100/1000/10000 and keep the result that (a) falls in a plausible
//     price range for that instrument and (b) lands on a 0.25 tick.
const PRICE_RANGE = {
  ES: [3000, 12000], MES: [3000, 12000],
  NQ: [10000, 45000], MNQ: [10000, 45000],
};
function normalizeSierraPrice(ticker, raw) {
  if (!raw) return raw;
  const range = PRICE_RANGE[ticker];
  if (range) {
    for (const div of [1, 10, 100, 1000, 10000]) {
      const val = raw / div;
      if (val >= range[0] && val <= range[1] && Math.abs(val * 4 - Math.round(val * 4)) < 0.02) {
        return val;
      }
    }
  }
  // Unrecognized ticker (e.g. a sim account symbol format we haven't seen) —
  // fall back to a generic index-futures range + 0.25 tick check instead of
  // giving up and returning the raw, unscaled number.
  for (const div of [1, 10, 100, 1000, 10000]) {
    const val = raw / div;
    if (val >= 1000 && val <= 100000 && Math.abs(val * 4 - Math.round(val * 4)) < 0.02) {
      return val;
    }
  }
  return raw; // couldn't confidently detect — return as-is rather than guess wrong
}
// "2026-07-28  15:27:58.285967" -> ms timestamp, using the components AS-IS
// (no timezone conversion) so downstream formatTime()'s getUTCHours() reads
// back exactly the same H:M Sierra Chart showed, regardless of the browser's
// local timezone.
function parseSierraDateTime(str) {
  const m = String(str).match(/(\d{4})-(\d{2})-(\d{2})[ T]+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

// Converts a UTC timestamp string to US Eastern time components, correctly
// handling the EDT/EST switch via Intl (rather than a fixed offset). Returns
// the same Date.UTC-embedded-as-local-values trick used elsewhere, so it
// plugs into formatTime()/groupFillsIntoTrades unchanged.
function utcToEasternMs(utcStr) {
  const iso = String(utcStr).trim().replace(' ', 'T');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value;
  const h = get('hour') === '24' ? 0 : +get('hour');
  return Date.UTC(+get('year'), +get('month') - 1, +get('day'), h, +get('minute'), +get('second'));
}

// Parses a native Tradovate fills CSV export (columns: _timestamp, B/S,
// Quantity, Price, Product, Contract, etc.) — a different format from Sierra
// Chart's Trade Activity Log. Detected automatically by parseFillsCSV below.
// Prices here are already in display format (no exchange-native scaling
// needed). No High/LowDuringPosition equivalent, so MFE/MAE stay blank. No
// order-type column, so SL auto-fill doesn't apply to this source either.
// Parses a raw Sierra Chart intraday bar export (Date, Time, High, Low
// columns — a chart's "Graph Data" export, not a fills/trade list). Used
// only to backfill MFE/MAE on trades that already exist, by looking up the
// real high/low reached during each trade's entry-to-exit window. Some of
// these exports repeat "High"/"Low" column names later in the row for an
// unrelated study (e.g. CVD) — always take the FIRST occurrence, which is
// the real price bar.
function parseIntradayBars(csvText) {
  const lines = csvText.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return { bars: [], priceMin: null, priceMax: null };
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const splitLine = line => delim === '\t'
    ? line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''))
    : line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  const dateIdx = headers.indexOf('date');
  const timeIdx = headers.indexOf('time');
  const highIdx = headers.indexOf('high'); // first occurrence = real price bar
  const lowIdx = headers.indexOf('low');
  if (dateIdx < 0 || timeIdx < 0 || highIdx < 0 || lowIdx < 0) return { bars: [], priceMin: null, priceMax: null };

  const bars = [];
  let priceMin = Infinity, priceMax = -Infinity;
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.length <= Math.max(dateIdx, timeIdx, highIdx, lowIdx)) continue;
    const date = cols[dateIdx];
    const timeRaw = cols[timeIdx];
    const high = parseFloat(cols[highIdx]);
    const low = parseFloat(cols[lowIdx]);
    if (!date || !timeRaw || isNaN(high) || isNaN(low)) continue;
    const m = timeRaw.match(/(\d{2}):(\d{2})/);
    if (!m) continue;
    // normalize date to Y-M-D numeric parts for reliable matching regardless of leading zeros
    const dm = date.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!dm) continue;
    const dateKey = `${+dm[1]}-${+dm[2]}-${+dm[3]}`;
    const minutes = (+m[1]) * 60 + (+m[2]);
    bars.push({ dateKey, minutes, high, low });
    if (high > priceMax) priceMax = high;
    if (low < priceMin) priceMin = low;
  }
  return { bars, priceMin: bars.length ? priceMin : null, priceMax: bars.length ? priceMax : null };
}

function timeToMinutes(hhmm) {
  const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function dayKeyFromDate(dateStr) {
  // journal_days date is stored as YYYY-MM-DD — normalize to match parseIntradayBars' dateKey
  const m = String(dateStr).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${+m[1]}-${+m[2]}-${+m[3]}` : null;
}

// Parses a Tradovate "Cash History" export. This is the ONLY export that
// shows the TRUE all-in cost per fill — Fills.csv only has a "commission"
// column, but every fill actually also carries an Exchange Fee, Clearing
// Fee, and NFA Fee that don't appear there at all (confirmed: for MES on
// this account, commission alone was only 41% of the real per-fill cost).
// Each row here is one fee line item; we sum all fee-type rows (skipping
// "Trade Paired" rows, which are realized P&L, not a fee) per timestamp to
// get the true total cost of each fill.
function parseCashHistory(csvText) {
  const lines = csvText.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const splitLine = line => {
    // Amount column is quoted with a comma (e.g. "49,876.50") — can't just split on every comma
    const out = []; let cur = ''; let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(c => c.trim());
  };
  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  const dateIdx = headers.indexOf('date');
  const tsIdx = headers.indexOf('timestamp');
  const deltaIdx = headers.indexOf('delta');
  const typeIdx = headers.indexOf('cash change type');
  const contractIdx = headers.indexOf('contract');
  if (dateIdx < 0 || tsIdx < 0 || deltaIdx < 0 || typeIdx < 0) return [];

  const feeTypes = ['exchange fee', 'clearing fee', 'nfa fee', 'commission'];
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.length <= Math.max(dateIdx, tsIdx, deltaIdx, typeIdx)) continue;
    const type = (cols[typeIdx] || '').toLowerCase();
    if (!feeTypes.some(f => type.includes(f))) continue; // skip Trade Paired and anything else
    const delta = Math.abs(parseFloat(cols[deltaIdx]) || 0);
    const ts = cols[tsIdx]; // "MM/DD/YYYY HH:MM:SS" local time
    const tm = ts.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!tm) continue;
    const dm = cols[dateIdx].match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!dm) continue;
    // Raw, uncorrected time — Cash History's own timezone is not guaranteed
    // (confirmed once to be Mountain Time, not Eastern, but this could
    // change). The actual offset is auto-detected and applied by the caller
    // (applyCashHistoryToTrades) by calibrating against Fills.csv's reliable
    // UTC timestamp, rather than assumed here.
    entries.push({
      dateKey: `${+dm[1]}-${+dm[2]}-${+dm[3]}`,
      minutes: (+tm[1]) * 60 + (+tm[2]),
      ticker: parseTicker(cols[contractIdx] || ''),
      fee: delta,
    });
  }
  return entries;
}

// Applies real Cash History fees onto a freshly-parsed batch of trades,
// matching by (ticker, date, entry-exit time window) — same matching logic
// as the standalone Correct Commission backfill, but run inline at import
// time so trades come in with the TRUE commission from the start.
// Auto-detects the time offset between Cash History's local timestamps and
// the trades' already-correct Eastern times (derived from Fills.csv's
// reliable UTC timestamp). Confirmed once that Cash History uses Mountain
// Time, not Eastern — but that could change, or a different broker's export
// could use a different zone entirely. Rather than hardcode an assumption OR
// naively match each trade to its "closest" Cash History entry (which fails
// when trades are spaced closer together than the offset itself, causing
// wrong pairings), this votes: compute the rounded-to-nearest-hour gap for
// EVERY (trade, same-day-same-ticker cash entry) pair, and take the most
// common value. The correct offset aligns many pairs at once; a wrong one
// only coincidentally aligns a few — the vote finds the real signal.
function detectCashHistoryOffsetMinutes(trades, cashEntries) {
  const byDateTicker = {};
  cashEntries.forEach(en => {
    const key = `${en.dateKey}|${en.ticker}`;
    (byDateTicker[key] = byDateTicker[key] || []).push(en);
  });
  const votes = {};
  trades.forEach(t => {
    if (!t.ticker || !t.entryTime || !t._importDate) return;
    const key = `${dayKeyFromDate(t._importDate)}|${t.ticker}`;
    const dayFees = byDateTicker[key];
    if (!dayFees || dayFees.length === 0) return;
    [t.entryTime, t.exitTime].forEach(timeStr => {
      const min = timeToMinutes(timeStr);
      if (min == null) return;
      dayFees.forEach(f => {
        const roundedGap = Math.round((min - f.minutes) / 60) * 60;
        votes[roundedGap] = (votes[roundedGap] || 0) + 1;
      });
    });
  });
  const entries = Object.entries(votes);
  if (entries.length === 0) return null; // couldn't calibrate — caller must fall back safely
  entries.sort((a, b) => b[1] - a[1]); // most votes first
  return +entries[0][0];
}

function applyCashHistoryToTrades(trades, cashEntries) {
  if (!cashEntries || cashEntries.length === 0) return { trades, offsetApplied: null, calibrated: false };
  const offset = detectCashHistoryOffsetMinutes(trades, cashEntries);
  const calibrated = offset != null;
  const finalOffset = calibrated ? offset : 0; // uncalibrated: apply no shift rather than guess wrong

  const adjusted = cashEntries.map(en => ({ ...en, minutes: en.minutes + finalOffset }));
  const byDateTicker = {};
  adjusted.forEach(en => {
    const key = `${en.dateKey}|${en.ticker}`;
    (byDateTicker[key] = byDateTicker[key] || []).push(en);
  });
  const newTrades = trades.map(t => {
    if (!t.ticker || !t.entryTime || !t._importDate) return t;
    const key = `${dayKeyFromDate(t._importDate)}|${t.ticker}`;
    const dayFees = byDateTicker[key];
    if (!dayFees) return t;
    const entryMin = timeToMinutes(t.entryTime);
    const exitMin = timeToMinutes(t.exitTime) ?? entryMin;
    if (entryMin == null) return t;
    const window = dayFees.filter(f => f.minutes >= entryMin - 1 && f.minutes <= exitMin + 1);
    if (window.length === 0) return t;
    const trueFee = window.reduce((s, f) => s + f.fee, 0);
    return { ...t, commission: trueFee.toFixed(2) };
  });
  return { trades: newTrades, offsetApplied: finalOffset, calibrated };
}

function parseTradovateCSV(csvText) {
  const lines = csvText.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const splitLine = line => line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const headers = splitLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, ''));

  const fills = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.length < 3) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });

    const ticker = parseTicker(row['product'] || row['contract'] || '');
    const sideRaw = (row['b/s'] || '').toLowerCase();
    const side = sideRaw.includes('buy') ? 'Buy' : sideRaw.includes('sell') ? 'Sell' : '';
    const qty = parseFloat(row['quantity'] || row['_qty'] || '0');
    const price = parseFloat(row['price'] || row['_price'] || '0'); // already display-scale
    const time = utcToEasternMs(row['_timestamp']);
    const commission = parseFloat(row['commission'] || '0') || 0;

    if (!ticker || !side || !qty || !price || !time) continue;
    fills.push({ ticker, side, qty, price, time, high: null, low: null, orderType: '', rawSymbol: row['contract'] || '', commission });
  }
  const trades = groupFillsIntoTrades(fills);
  return trades.length > 0 ? trades : [newTrade()];
}

// Single entry point the import button calls — auto-detects which format the
// file is (Sierra Chart Trade Activity Log vs native Tradovate fills export)
// from its header row, so the person never has to pick a format manually.
function parseFillsCSV(csvText) {
  const firstLine = (csvText.trim().split('\n')[0] || '').toLowerCase();
  if (firstLine.includes('activitytype') || firstLine.includes('fillprice') || firstLine.includes('highduringposition')) {
    return parseSierraCSV(csvText);
  }
  if (firstLine.includes('b/s') || firstLine.includes('_timestamp') || firstLine.includes('fill id')) {
    return parseTradovateCSV(csvText);
  }
  return parseSierraCSV(csvText); // fall back to the more common one
}

function parseSierraCSV(csvText) {
  const lines = csvText.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  // Sierra Chart's "Save Log As" writes TAB-delimited text; File>>Export can be
  // comma or tab depending on settings. Auto-detect which one this file uses.
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const splitLine = (line) => delim === '\t'
    ? line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''))
    : line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));

  const headers = splitLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, ''));

  const fills = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.length < 3) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });

    // Only real fills — skip Order status changes / Position / Balance / Info rows
    if (row['activitytype'] && !/^fill/i.test(row['activitytype'])) continue;

    const ticker = parseTicker(row['symbol'] || row['contract'] || row['instrument'] || '');
    const sideRaw = (row['buysell'] || row['side'] || row['action'] || '').toLowerCase();
    const side = sideRaw.includes('buy') ? 'Buy' : sideRaw.includes('sell') ? 'Sell' : '';
    const qty = parseFloat(row['filledquantity'] || row['quantity'] || row['qty'] || row['contracts'] || '0');
    const rawPrice = parseFloat(row['fillprice'] || row['price'] || row['entryprice'] || row['exitprice'] || '0');
    const price = normalizeSierraPrice(ticker, rawPrice);
    const time = parseSierraDateTime(row['datetime'] || row['transdatetime'] || row['time'] || '');
    const orderType = (row['ordertype'] || '').toLowerCase();
    // MFE/MAE source: Sierra Chart resets these on every fill, recording the
    // price extreme reached since the prior fill. Blank on the opening fill
    // (no "during position" history yet) — that's expected, not an error.
    const rawHigh = parseFloat(row['highduringposition'] || '');
    const rawLow = parseFloat(row['lowduringposition'] || '');
    const high = rawHigh > 0 ? normalizeSierraPrice(ticker, rawHigh) : null;
    const low = rawLow > 0 ? normalizeSierraPrice(ticker, rawLow) : null;

    if (!ticker || !side || !qty || !price || !time) continue;
    fills.push({ ticker, side, qty, price, time, high, low, orderType, rawSymbol: row['symbol'] || '' });
  }

  const trades = groupFillsIntoTrades(fills);
  return trades.length > 0 ? trades : [newTrade()];
}

function TradovateImportModal({onClose, onImport}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isDemo, setIsDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const handleFetch = async () => {
    setLoading(true); setError('');
    try {
      const token = await tradovateAuth(username, password, isDemo);
      const { fills, orders } = await tradovateFetchFillsAndOrders(token, isDemo);
      if (!fills || fills.length === 0) {
        setError("No fills returned. Tradovate's API only exposes today's fills — yesterday's or older trades won't appear here. Use Sierra Chart CSV import for past days.");
        setLoading(false);
        return;
      }
      const trades = fillsToTrades(fills, orders);
      setPreview(trades);
    } catch(e) {
      setError(e.message + (e.message.toLowerCase().includes('fetch') ? ' — check your connection or try again in a moment.' : ''));
    }
    setLoading(false);
  };

  const inputStyle = {
    width:'100%', padding:'10px 12px', borderRadius:10,
    border:`1.5px solid ${C.border}`, background:C.bg,
    color:C.text, fontSize:13, fontFamily:'inherit',
    outline:'none', boxSizing:'border-box', marginBottom:10,
  };

  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:C.bg,borderRadius:20,padding:28,width:'100%',maxWidth:480,border:`1px solid ${C.border}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>Import from Tradovate</div>
          <button onClick={onClose} style={{background:'none',border:'none',color:C.textMut,fontSize:20,cursor:'pointer'}}>×</button>
        </div>

        {!preview ? (
          <>
            <div style={{fontSize:11,color:C.textMut,marginBottom:12}}>Pulls <b style={{color:C.textSub}}>today's</b> fills from your Tradovate account. Tradovate's API doesn't expose past days — for older sessions, use Sierra Chart CSV import instead.</div>

            <div style={{display:'flex',gap:8,marginBottom:12}}>
              {['Demo','Live'].map(m=>(
                <button key={m} onClick={()=>setIsDemo(m==='Demo')} style={{
                  flex:1,padding:'8px',borderRadius:10,border:`1.5px solid ${isDemo===(m==='Demo')?C.blue:C.border}`,
                  background:isDemo===(m==='Demo')?C.blue+'22':'transparent',
                  color:isDemo===(m==='Demo')?C.blue:C.textMut,
                  fontFamily:'inherit',fontSize:12,cursor:'pointer',fontWeight:600,
                }}>{m} Account</button>
              ))}
            </div>

            <input style={inputStyle} placeholder="Tradovate username / email"
              value={username} onChange={e=>setUsername(e.target.value)}/>
            <input style={inputStyle} type="password" placeholder="Tradovate password"
              value={password} onChange={e=>setPassword(e.target.value)}/>

            {error && <div style={{fontSize:12,color:C.red,marginBottom:10,padding:'8px 12px',background:C.red+'15',borderRadius:8}}>{error}</div>}

            <button onClick={handleFetch} disabled={loading||!username||!password} style={{
              width:'100%',padding:'12px',borderRadius:12,border:'none',
              background:loading?C.surface:C.blue,color:loading?C.textMut:'#fff',
              fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:loading?'not-allowed':'pointer',
            }}>{loading?'Fetching fills...':"Fetch Today's Trades"}</button>
          </>
        ) : (
          <>
            <div style={{fontSize:13,color:C.textSub,marginBottom:16}}>
              Found <b style={{color:C.text}}>{preview.length}</b> trade{preview.length!==1?'s':''} today. Review before importing.
            </div>
            <div style={{maxHeight:200,overflowY:'auto',marginBottom:16}}>
              {preview.map((t,i)=>(
                <div key={i} style={{padding:'10px 12px',background:C.surface,borderRadius:10,marginBottom:8,fontSize:12,color:C.textSub}}>
                  <b style={{color:C.text}}>{t.ticker} {t.direction}</b> — {t.contracts} contracts | Entry: {t.entryTime} Exit: {t.exitTime} | Pts: {t.points||'—'}
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:C.yellow,marginBottom:14,padding:'8px 12px',background:C.yellow+'15',borderRadius:8}}>
              ⚠ Setup type, SL, confluences and notes need to be filled manually after import.
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setPreview(null)} style={{flex:1,padding:'11px',borderRadius:12,border:`1.5px solid ${C.border}`,background:'transparent',color:C.textSub,fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>Back</button>
              <button onClick={()=>onImport(preview)} style={{flex:2,padding:'11px',borderRadius:12,border:'none',background:C.green,color:'#fff',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>Import {preview.length} Trade{preview.length!==1?'s':''}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TradesTab({trades,onChange,eod,onEodChange,date,isMobile,userId,onJumpToDate}){
  const update=(i,t)=>{
    let newTrades = trades.map((x,j)=>j===i?t:x);
    // HTF/Short-Term context and Opening Type describe the whole session, not
    // one trade — once set on any trade, carry it forward to any other trade
    // THIS DAY that's still blank on that field, so it doesn't need
    // re-entering per trade. Already-tagged trades are left alone (respects
    // a manual override).
    const prevT = trades[i];
    ['htfContext','stContext','openingType'].forEach(field=>{
      if (t[field] && t[field] !== prevT[field]) {
        newTrades = newTrades.map((x,j)=> (j!==i && !x[field]) ? {...x,[field]:t[field]} : x);
      }
    });
    onChange(newTrades);
  };
  const remove=(i)=>onChange(trades.filter((_,j)=>j!==i));
  const [showTradovate,setShowTradovate] = useState(false);
  const [pending,setPending] = useState(null); // days with untagged setup/SL, loaded once per visit

  useEffect(()=>{
    let live = true;
    loadAllDays(userId).then(days=>{
      if (!live) return;
      const result = [];
      days.forEach(row=>{
        const dayTrades = (row.data?.trades||[]).filter(t=>t.ticker||t.notes);
        const noSetup = dayTrades.filter(t=>!t.plan).length;
        const noSL = dayTrades.filter(t=>!t.sl).length;
        if (noSetup>0 || noSL>0) result.push({date:row.date, noSetup, noSL, total:dayTrades.length});
      });
      result.sort((a,b)=>b.date.localeCompare(a.date));
      setPending(result);
    });
    return ()=>{live=false;};
  },[userId,trades]); // re-check whenever the open day's trades change too
  const [organising,setOrganising]=useState(false);
  const [importing,setImporting]=useState(false);
  const setEod=k=>v=>onEodChange({...eod,[k]:v});

  // If any existing trade this day already has HTF/ST context or Opening
  // Type tagged, apply that same value to newly-imported trades that come in
  // blank — same "whole day" carry-forward as the live update() propagation
  // above.
  const inheritDayContext = (existing, incoming) => {
    const found = {};
    ['htfContext','stContext','openingType'].forEach(field=>{
      const src = existing.find(t=>t[field]);
      if (src) found[field] = src[field];
    });
    if (Object.keys(found).length === 0) return incoming;
    return incoming.map(t => ({
      ...t,
      ...(!t.htfContext && found.htfContext ? {htfContext:found.htfContext} : {}),
      ...(!t.stContext && found.stContext ? {stContext:found.stContext} : {}),
      ...(!t.openingType && found.openingType ? {openingType:found.openingType} : {}),
    }));
  };

  const handleTradovateImport = (imported) => {
    const kept = trades.filter(t=>t.ticker||t.notes);
    onChange([...kept, ...inheritDayContext(kept, imported)]);
    setShowTradovate(false);
  };

  // Groups parsed trades by their real entry date (not whatever day happens
  // to be open) and writes each group directly to its correct day in
  // Supabase. If the currently-open day is among them, also updates the live
  // view so it's visible immediately without a manual date-navigate+reload.
  // ONE import handler for everything: select any combination of files —
  // Fills/Sierra Chart trades, Cash History (true commission), intraday bars
  // (MFE/MAE) — and it auto-detects each by header signature and runs
  // whatever applies. No need to remember which button does what.
  const backfillFileRef = useRef();
  const handleUnifiedImport = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';
    const texts = await Promise.all(files.map(f => f.text()));

    let fillsText = null;
    let cashEntries = [];
    let intradayData = null; // { bars, priceMin, priceMax }
    const unrecognized = [];

    texts.forEach((text, i) => {
      const firstLine = (text.trim().split('\n')[0] || '').toLowerCase();
      if (firstLine.includes('cash change type')) {
        cashEntries = cashEntries.concat(parseCashHistory(text));
      } else if (firstLine.includes('activitytype') || firstLine.includes('fillprice') || firstLine.includes('highduringposition') || firstLine.includes('b/s') || firstLine.includes('_timestamp') || firstLine.includes('fill id')) {
        if (!fillsText) fillsText = text;
      } else if (firstLine.includes('date') && firstLine.includes('time') && firstLine.includes('high') && firstLine.includes('low')) {
        const parsed = parseIntradayBars(text);
        if (parsed.bars.length > 0) intradayData = parsed;
      } else {
        unrecognized.push(files[i].name);
      }
    });

    if (!fillsText && cashEntries.length === 0 && !intradayData) {
      window.alert("Couldn't recognize any of the selected file(s). Expected a Fills/Sierra Chart export, a Cash History export, and/or an intraday bar chart export. Send it to Claude in your project chat if this keeps happening.");
      return;
    }

    setImporting(true);
    const summaryParts = [];

    // 1. New trades, if a Fills/Sierra Chart file was included
    if (fillsText) {
      let parsed = parseFillsCSV(fillsText);
      if (parsed.length === 0 || (parsed.length === 1 && !parsed[0].ticker)) {
        summaryParts.push("Couldn't find any trades in the fills file — column names may not match what the app expects.");
      } else {
        if (cashEntries.length > 0) {
          const result = applyCashHistoryToTrades(parsed, cashEntries);
          parsed = result.trades;
          summaryParts.push(result.calibrated
            ? `✓ New trades' commission set from Cash History (auto-detected ${result.offsetApplied >= 0 ? '+' : ''}${result.offsetApplied/60}h offset).`
            : `⚠ Cash History given, but couldn't auto-calibrate its timezone for the new trades.`);
        }
        const groups = {};
        parsed.forEach(t => {
          const d = t._importDate || date;
          (groups[d] = groups[d] || []).push({ ...t, _importDate: undefined });
        });
        let totalNew = 0;
        for (const [d, newTradesRaw] of Object.entries(groups)) {
          let dayData;
          try { dayData = await loadDay(d, userId); } catch (_) { dayData = null; }
          if (!dayData) dayData = emptyDay();
          const existingKept = (dayData.trades || []).filter(t => t.ticker || t.notes);
          const newTrades = inheritDayContext(existingKept, newTradesRaw);
          const merged = [...existingKept, ...newTrades];
          await saveDay(d, { ...dayData, trades: merged }, userId);
          totalNew += newTrades.length;
          if (d === date) onChange(merged);
        }
        summaryParts.push(`Imported ${totalNew} trade${totalNew!==1?'s':''} across ${Object.keys(groups).length} day${Object.keys(groups).length!==1?'s':''}.`);
      }
    }

    // 2. Cash History — ALSO correct commission across the WHOLE account
    // (covers trades from past imports, not just this batch)
    if (cashEntries.length > 0) {
      const allDays = await loadAllDays(userId);
      const allTradesFlat = [];
      allDays.forEach(row => (row.data?.trades || []).forEach(t => {
        if (t.ticker && t.entryTime) allTradesFlat.push({ ...t, _importDate: row.date });
      }));
      const offset = detectCashHistoryOffsetMinutes(allTradesFlat, cashEntries);
      if (offset == null) {
        summaryParts.push(`Cash History: couldn't auto-calibrate timezone against existing trades — no retroactive corrections made.`);
      } else {
        const adjustedEntries = cashEntries.map(en => ({ ...en, minutes: en.minutes + offset }));
        const byDateTicker = {};
        adjustedEntries.forEach(en => {
          const key = `${en.dateKey}|${en.ticker}`;
          (byDateTicker[key] = byDateTicker[key] || []).push(en);
        });
        let commUpdated = 0, commDays = 0;
        for (const row of allDays) {
          const dKey = dayKeyFromDate(row.date);
          const trades = row.data?.trades || [];
          let changed = false;
          const newTrades = trades.map(t => {
            if (!t.ticker || !t.entryTime) return t;
            const key = `${dKey}|${t.ticker}`;
            const dayFees = byDateTicker[key];
            if (!dayFees) return t;
            const entryMin = timeToMinutes(t.entryTime);
            const exitMin = timeToMinutes(t.exitTime) ?? entryMin;
            if (entryMin == null) return t;
            const window = dayFees.filter(f => f.minutes >= entryMin - 1 && f.minutes <= exitMin + 1);
            if (window.length === 0) return t;
            const trueFee = window.reduce((s, f) => s + f.fee, 0);
            const oldFee = parseFloat(t.commission) || 0;
            if (Math.abs(trueFee - oldFee) < 0.01) return t;
            changed = true; commUpdated++;
            return { ...t, commission: trueFee.toFixed(2) };
          });
          if (changed) {
            commDays++;
            await saveDay(row.date, { ...row.data, trades: newTrades }, userId);
            if (row.date === date) onChange(newTrades);
          }
        }
        if (commUpdated > 0) summaryParts.push(`Commission corrected on ${commUpdated} existing trade${commUpdated!==1?'s':''} across ${commDays} day${commDays!==1?'s':''}.`);
      }
    }

    // 3. Intraday bars — MFE/MAE backfill across the WHOLE account, only
    // filling genuine blanks, with a price-range sanity check against the
    // wrong instrument being uploaded by mistake.
    if (intradayData) {
      const { bars, priceMin, priceMax } = intradayData;
      const barsByDate = {};
      bars.forEach(b => { (barsByDate[b.dateKey] = barsByDate[b.dateKey] || []).push(b); });
      const allDays = await loadAllDays(userId);
      let mfeUpdated = 0, mfeSkipped = 0, mfeDays = 0;
      for (const row of allDays) {
        const dKey = dayKeyFromDate(row.date);
        const dayBars = barsByDate[dKey];
        if (!dayBars) continue;
        const trades = row.data?.trades || [];
        let changed = false;
        const newTrades = trades.map(t => {
          if (!t.ticker || t.mfe || t.mae || !t.entryTime || !t.avgEntry) return t;
          const avgEntry = parseFloat(t.avgEntry);
          if (isNaN(avgEntry)) return t;
          if (priceMin != null && (avgEntry < priceMin - 1000 || avgEntry > priceMax + 1000)) { mfeSkipped++; return t; }
          const entryMin = timeToMinutes(t.entryTime);
          const exitMin = timeToMinutes(t.exitTime) ?? entryMin;
          if (entryMin == null) return t;
          let window = dayBars.filter(b => b.minutes >= entryMin && b.minutes <= exitMin);
          if (window.length === 0) window = dayBars.filter(b => Math.abs(b.minutes - entryMin) <= 3);
          if (window.length === 0) return t;
          const hi = Math.max(...window.map(b => b.high));
          const lo = Math.min(...window.map(b => b.low));
          const mfe = t.direction === 'long' ? Math.max(0, hi - avgEntry) : Math.max(0, avgEntry - lo);
          const mae = t.direction === 'long' ? Math.max(0, avgEntry - lo) : Math.max(0, hi - avgEntry);
          changed = true; mfeUpdated++;
          return { ...t, mfe: mfe.toFixed(2), mae: mae.toFixed(2) };
        });
        if (changed) {
          mfeDays++;
          await saveDay(row.date, { ...row.data, trades: newTrades }, userId);
          if (row.date === date) onChange(newTrades);
        }
      }
      summaryParts.push(`MFE/MAE filled on ${mfeUpdated} trade${mfeUpdated!==1?'s':''} across ${mfeDays} day${mfeDays!==1?'s':''}${mfeSkipped ? `, skipped ${mfeSkipped} (wrong instrument)` : ''}.`);
    }

    if (unrecognized.length > 0) {
      summaryParts.push(`Couldn't identify: ${unrecognized.join(', ')}.`);
    }

    setImporting(false);
    window.alert(summaryParts.join('\n\n'));
  };

  return(
    <div>
      {showTradovate && <TradovateImportModal onClose={()=>setShowTradovate(false)} onImport={handleTradovateImport}/>}
      <input ref={backfillFileRef} type="file" accept=".csv,.txt" multiple style={{display:'none'}} onChange={handleUnifiedImport}/>

      {/* Pending tags — visible before importing more, so you see the backlog first */}
      {pending && pending.length > 0 && (
        <div style={{background:C.yellow+'0d',border:`1px solid ${C.yellow}40`,borderRadius:12,padding:'12px 16px',marginBottom:14}}>
          <div style={{fontSize:11,color:C.yellow,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:8}}>
            ⚠ {pending.length} day{pending.length!==1?'s':''} need tagging ({pending.reduce((s,p)=>s+p.noSetup,0)} untagged setup, {pending.reduce((s,p)=>s+p.noSL,0)} missing SL)
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {pending.map(p=>(
              <button key={p.date} onClick={()=>onJumpToDate&&onJumpToDate(p.date)} style={{
                padding:'5px 11px',borderRadius:16,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                border:`1.5px solid ${C.border}`,background:C.surface,color:C.textSub,
                display:'flex',alignItems:'center',gap:5,
              }}>
                <b style={{color:C.text}}>{p.date}</b>
                {p.noSetup>0 && <span style={{color:C.yellow}}>· {p.noSetup} untagged</span>}
                {p.noSL>0 && <span style={{color:C.red}}>· {p.noSL} no SL</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Import — one click, straight to the file picker */}
      <button onClick={()=>backfillFileRef.current.click()} disabled={importing} title="Select any combination: Tradovate Fills, Sierra Chart trades, Cash History (true commission), intraday bars (MFE/MAE) — hold Ctrl/Cmd to select several at once, the app identifies what each one is" style={{
        width:'100%',padding:'11px 14px',borderRadius:12,marginBottom:6,
        border:`1.5px solid ${C.purple}`,background:C.purple+'15',
        color:C.purple,fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:importing?'not-allowed':'pointer',
        display:'flex',alignItems:'center',justifyContent:'center',gap:6,opacity:importing?0.6:1,
      }}>
        {importing?'⏳ Processing...':'📥 Import / Correct Trades (select files)'}
      </button>
      <div style={{textAlign:'center',marginBottom:16}}>
        <button onClick={()=>setShowTradovate(true)} style={{
          background:'none',border:'none',color:C.textMut,fontSize:11,fontFamily:'inherit',cursor:'pointer',textDecoration:'underline',
        }}>
          or connect live to Tradovate (needs $1,000+ funded equity)
        </button>
      </div>

      <SummaryBar trades={trades}/>
      {trades.map((t,i)=>(
        <TradeCard key={i} index={i} trade={t} onChange={nt=>update(i,nt)} onRemove={()=>remove(i)} isMobile={isMobile} userId={userId}/>
      ))}

      {/* ── Day Note ── */}
      <Divider label="Day Note (optional)"/>
      <Field label="" placeholder="Optional short note about the day — market context, levels for tomorrow..." value={eod.review} onChange={setEod('review')} rows={3}/>
    </div>
  );
}



// ═══ Process & Behavior ══════════════════════════════════════════════════════

function pearson(xs,ys){
  const n=xs.length;if(n<3)return null;
  const mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n;
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){num+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;}
  const den=Math.sqrt(dx*dy);
  return den?num/den:null;
}
function session3(entryTime){
  if(!entryTime)return '—';
  const[h,m]=entryTime.split(':').map(Number);
  const mins=h*60+m;
  if(mins<11*60)return 'First 90 min';   // 9:30-11:00
  if(mins<14*60+30)return 'Mid-day';     // 11:00-2:30pm
  return 'Last 90 min';                   // 2:30-4:00pm
}

function SvgDualLine({a,b,colA,colB,labelA,labelB,height=180,fmtY=v=>'$'+v.toFixed(0)}){
  const W=600,H=height,P={t:12,r:8,b:26,l:52};
  if(!a||a.length<2)return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:C.textDim,fontSize:12}}>Not enough data</div>;
  const all=[...a.map(p=>p.val),...(b||[]).map(p=>p.val)];
  const min=Math.min(0,...all),max=Math.max(0,...all),range=max-min||1;
  const y=v=>P.t+(1-(v-min)/range)*(H-P.t-P.b);
  const path=(s)=>s.map((p,i)=>`${i===0?'M':'L'}${(P.l+(i/(s.length-1))*(W-P.l-P.r)).toFixed(1)},${y(p.val).toFixed(1)}`).join(' ');
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block'}}>
      <line x1={P.l} x2={W-P.r} y1={y(0)} y2={y(0)} stroke={C.textMut} strokeWidth="0.7"/>
      <text x={P.l-6} y={y(max)+4} fill={C.textMut} fontSize="10" textAnchor="end">{fmtY(max)}</text>
      <path d={path(a)} fill="none" stroke={colA} strokeWidth="2" strokeLinejoin="round"/>
      {b&&b.length>1&&<path d={path(b)} fill="none" stroke={colB} strokeWidth="2" strokeDasharray="5,4" strokeLinejoin="round"/>}
      <rect x={P.l} y={H-16} width="10" height="3" fill={colA}/><text x={P.l+16} y={H-11} fill={C.textSub} fontSize="10">{labelA}</text>
      {b&&<><rect x={P.l+120} y={H-16} width="10" height="3" fill={colB}/><text x={P.l+136} y={H-11} fill={C.textSub} fontSize="10">{labelB}</text></>}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function extractAllTrades(days){
  const out=[];
  days.forEach(row=>{
    const trades=row.data?.trades||[];
    trades.forEach(t=>{
      if(!t.ticker||!t.result||!t.points)return;
      const contracts=parseFloat(t.contracts)||1;
      const points=parseFloat(t.points)||0;
      const sl=parseFloat(t.sl)||0;
      const pv=POINT_VALUES[t.ticker]||0;
      const grossPnl=points*pv;
      const commission=parseFloat(t.commission)||0;
      const pnl=grossPnl-commission; // net — every downstream stat (equity, PF, expectancy, all tag breakdowns) reads this
      const risk=sl*pv*contracts;
      const ptsPerC=contracts?points/contracts:0;
      // Real signed R-multiple: points-per-contract ÷ SL, sign comes naturally
      // from the points (positive=win, negative=loss). This reflects what
      // ACTUALLY happened — slippage, a wider/tighter stop than planned — not
      // an assumed flat -1R on every loss.
      const rr=sl?ptsPerC/sl:0;
      const mfeR = (t.mfe && sl) ? parseFloat(t.mfe)/sl : null; // max R that was available on the table
      out.push({
        date:row.date, ticker:t.ticker, direction:t.direction||'—',
        contracts, points, sl, pnl, grossPnl, commission, risk,
        rr:rr, // real signed R for every trade — no more hardcoded -1 for losses
        rawRR:rr, mfeR, result:t.result,
        setup:t.plan||'—', confluences:t.confluences||[], triggers:t.triggers||[],
        attempt:t.attempt||'—', stContext:t.stContext||'—', htfContext:t.htfContext||'—', openingType:t.openingType||'—', compositeBalanceExtreme:t.compositeBalanceExtreme||[], mExtremeDevBand:t.mExtremeDevBand||[], wExtremeDevBand:t.wExtremeDevBand||[],
        entryTime:t.entryTime||'', exitTime:t.exitTime||'',
        session:sessionWindow(t.entryTime)||'—',
        hold:calcHoldTime(t.entryTime,t.exitTime)||'',
        mfe:parseFloat(t.mfe)||0, mae:parseFloat(t.mae)||0,
        notes:t.notes||'', emotions:t.emotions||'',
      });
    });
  });
  return out;
}

function computeStats(trades){
  const closed=trades.filter(t=>['W','L','BE'].includes(t.result));
  const wins=closed.filter(t=>t.result==='W');
  const losses=closed.filter(t=>t.result==='L');
  const winRate=wins.length+losses.length>0?wins.length/(wins.length+losses.length)*100:0;
  const totalPnl=closed.reduce((s,t)=>s+t.pnl,0);
  const grossWin=wins.reduce((s,t)=>s+t.pnl,0);
  const grossLoss=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  const profitFactor=grossLoss>0?grossWin/grossLoss:grossWin>0?99:0;
  const avgWin=wins.length?grossWin/wins.length:0;
  const avgLoss=losses.length?grossLoss/losses.length:0;
  const avgWinRR=wins.length?wins.reduce((s,t)=>s+t.rawRR,0)/wins.length:0;
  const expectancy=closed.length?totalPnl/closed.length:0;

  // Daily P&L series + equity curve + drawdown
  const dayMap={};
  closed.forEach(t=>{dayMap[t.date]=(dayMap[t.date]||0)+t.pnl;});
  const dates=Object.keys(dayMap).sort();
  let cum=0, peak=0, maxDD=0;
  const equity=[], dailyPnl=[], ddSeries=[];
  dates.forEach(d=>{
    cum+=dayMap[d];
    if(cum>peak)peak=cum;
    const dd=peak-cum;
    if(dd>maxDD)maxDD=dd;
    equity.push({date:d,val:cum});
    dailyPnl.push({date:d,val:dayMap[d]});
    ddSeries.push({date:d,val:-dd});
  });

  // Per-day R total + win/loss counts, for the calendar's "1.46 · 1W 1L" cells
  const dayRMap={};
  closed.forEach(t=>{
    if(!dayRMap[t.date])dayRMap[t.date]={r:0,w:0,l:0,be:0,hasR:false};
    const dr=dayRMap[t.date];
    if(t.rawRR!=null&&t.sl>0){dr.r+=t.rawRR;dr.hasR=true;}
    if(t.result==='W')dr.w++; else if(t.result==='L')dr.l++; else if(t.result==='BE')dr.be++;
  });

  // Gain-to-Pain Ratio: sum of all UP days ÷ |sum of all DOWN days| — a
  // period-level risk-adjusted-return measure, distinct from Profit Factor
  // (which compares individual trades, not days). >1 means gains outweigh
  // the pain of drawdown days; higher is more resilient.
  const upDaysSum=dailyPnl.filter(d=>d.val>0).reduce((s,d)=>s+d.val,0);
  const downDaysSum=Math.abs(dailyPnl.filter(d=>d.val<0).reduce((s,d)=>s+d.val,0));
  const gainToPain=downDaysSum>0?upDaysSum/downDaysSum:(upDaysSum>0?99:0);

  // Streak
  let streak=0;
  for(let i=closed.length-1;i>=0;i--){
    const r=closed[i].result;
    if(r==='BE')continue;
    if(streak===0){streak=r==='W'?1:-1;}
    else if(streak>0&&r==='W')streak++;
    else if(streak<0&&r==='L')streak--;
    else break;
  }

  const breakdown=(keyFn,multi=false)=>{
    const m={};
    const addTo=(k,t)=>{
      if(!k||k==='—')return;
      if(!m[k])m[k]={w:0,l:0,be:0,pnl:0,gw:0,gl:0};
      if(t.result==='W'){m[k].w++;m[k].gw+=t.pnl;}
      else if(t.result==='L'){m[k].l++;m[k].gl+=Math.abs(t.pnl);}
      else m[k].be++;
      m[k].pnl+=t.pnl;
    };
    closed.forEach(t=>{
      const k=keyFn(t);
      if(multi&&Array.isArray(k))k.forEach(kk=>addTo(kk,t));
      else addTo(k,t);
    });
    return Object.entries(m).map(([k,v])=>({
      label:k, wins:v.w, losses:v.l, be:v.be, pnl:v.pnl,
      total:v.w+v.l+v.be,
      winRate:v.w+v.l>0?v.w/(v.w+v.l)*100:0,
      pf:v.gl>0?v.gw/v.gl:(v.gw>0?99:0),
      avgPnl:(v.w+v.l+v.be)>0?v.pnl/(v.w+v.l+v.be):0,
    })).sort((a,b)=>b.total-a.total);
  };

  const dowNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const withR=closed.filter(t=>t.rawRR!=null&&t.sl>0);
  const allR=withR.map(t=>t.rawRR);
  const avgR=allR.length?allR.reduce((s,v)=>s+v,0)/allR.length:0;
  const stdR=allR.length>1?Math.sqrt(allR.reduce((s,v)=>s+(v-avgR)**2,0)/allR.length):0;
  // Cumulative R curve — chronological, per-trade (not per-day like $ equity,
  // since R is meant to be compared trade-to-trade, position-size-normalized)
  const seqR=[...withR].sort((a,b)=>(a.date+a.entryTime).localeCompare(b.date+b.entryTime));
  let cumR=0;
  const rCurve=seqR.map((t,i)=>{cumR+=t.rawRR;return{date:String(i+1),val:+cumR.toFixed(2)};});

  // Sharpe / Sortino — risk-adjusted return, computed from daily $ P&L
  // (already net of commission). Not annualized — raw per-trading-day ratio,
  // since sample sizes here are small and an annualized number would imply
  // false precision. Sortino only penalizes downside days; Sharpe penalizes
  // any volatility, up or down.
  const dailyVals=dailyPnl.map(d=>d.val);
  const nDays=dailyVals.length;
  const meanDaily=nDays?dailyVals.reduce((s,v)=>s+v,0)/nDays:0;
  const stdDaily=nDays>1?Math.sqrt(dailyVals.reduce((s,v)=>s+(v-meanDaily)**2,0)/nDays):0;
  const downside=dailyVals.filter(v=>v<0);
  const downsideDev=downside.length?Math.sqrt(downside.reduce((s,v)=>s+v**2,0)/downside.length):0;
  const sharpe=stdDaily?meanDaily/stdDaily:0;
  const sortino=downsideDev?meanDaily/downsideDev:0;

  return {
    totalTrades:closed.length, wins:wins.length, losses:losses.length,
    be:closed.filter(t=>t.result==='BE').length,
    winRate, totalPnl, profitFactor, avgWin, avgLoss, avgWinRR, expectancy,
    maxDD, streak, equity, dailyPnl, ddSeries, dayMap, dayRMap, gainToPain,
    bySetup:breakdown(t=>t.setup),
    bySession:breakdown(t=>t.session),
    byInstrument:breakdown(t=>t.ticker),
    byDirection:breakdown(t=>t.direction),
    byDow:breakdown(t=>dowNames[new Date(t.date+'T12:00:00').getDay()]),
    byTrigger:breakdown(t=>t.triggers,true),
    byAttempt:breakdown(t=>t.attempt),
    byStContext:breakdown(t=>t.stContext),
    byHtfContext:breakdown(t=>t.htfContext),
    byOpeningType:breakdown(t=>t.openingType),
    rrList:wins.map(t=>t.rawRR),
    allR, avgR, stdR, rCurve,
    sharpe, sortino, nDays,
    totalCommission:closed.reduce((s,t)=>s+(t.commission||0),0),
  };
}

// ─── SVG Chart Components ─────────────────────────────────────────────────────
function SvgLineChart({series,color,height=180,fill=true,fmtY=v=>'$'+v.toFixed(0)}){
  const W=600,H=height,P={t:12,r:8,b:22,l:52};
  if(!series||series.length<2)return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:C.textDim,fontSize:12}}>Not enough data yet</div>;
  const vals=series.map(p=>p.val);
  const min=Math.min(0,...vals), max=Math.max(0,...vals);
  const range=max-min||1;
  const x=i=>P.l+(i/(series.length-1))*(W-P.l-P.r);
  const y=v=>P.t+(1-(v-min)/range)*(H-P.t-P.b);
  const path=series.map((p,i)=>`${i===0?'M':'L'}${x(i).toFixed(1)},${y(p.val).toFixed(1)}`).join(' ');
  const areaPath=path+` L${x(series.length-1).toFixed(1)},${y(Math.max(min,0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(min,0)).toFixed(1)} Z`;
  const gid='g'+Math.random().toString(36).slice(2,8);
  const ticks=[min,min+range/2,max];
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block'}}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
        <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
      </linearGradient></defs>
      {ticks.map((tv,i)=>(
        <g key={i}>
          <line x1={P.l} x2={W-P.r} y1={y(tv)} y2={y(tv)} stroke={C.border} strokeWidth="0.5" strokeDasharray="4,4"/>
          <text x={P.l-6} y={y(tv)+4} fill={C.textMut} fontSize="10" textAnchor="end">{fmtY(tv)}</text>
        </g>
      ))}
      {min<0&&<line x1={P.l} x2={W-P.r} y1={y(0)} y2={y(0)} stroke={C.textMut} strokeWidth="0.7"/>}
      {fill&&<path d={areaPath} fill={`url(#${gid})`}/>}
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={x(series.length-1)} cy={y(series[series.length-1].val)} r="3.5" fill={color}/>
      <text x={P.l} y={H-6} fill={C.textMut} fontSize="9">{series[0].date?.slice(5)}</text>
      <text x={W-P.r} y={H-6} fill={C.textMut} fontSize="9" textAnchor="end">{series[series.length-1].date?.slice(5)}</text>
    </svg>
  );
}

function SvgBarChart({series,height=160,posColor,negColor,fmtY=v=>'$'+v.toFixed(0)}){
  const W=600,H=height,P={t:12,r:8,b:22,l:52};
  if(!series||series.length===0)return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:C.textDim,fontSize:12}}>No data yet</div>;
  const vals=series.map(p=>p.val);
  const min=Math.min(0,...vals),max=Math.max(0,...vals);
  const range=max-min||1;
  const bw=Math.min(28,(W-P.l-P.r)/series.length*0.7);
  const x=i=>P.l+(i+0.5)/series.length*(W-P.l-P.r);
  const y=v=>P.t+(1-(v-min)/range)*(H-P.t-P.b);
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block'}}>
      <line x1={P.l} x2={W-P.r} y1={y(0)} y2={y(0)} stroke={C.textMut} strokeWidth="0.7"/>
      <text x={P.l-6} y={y(max)+4} fill={C.textMut} fontSize="10" textAnchor="end">{fmtY(max)}</text>
      {min<0&&<text x={P.l-6} y={y(min)+4} fill={C.textMut} fontSize="10" textAnchor="end">{fmtY(min)}</text>}
      {series.map((p,i)=>(
        <rect key={i} x={x(i)-bw/2} y={p.val>=0?y(p.val):y(0)}
          width={bw} height={Math.abs(y(p.val)-y(0))||1}
          fill={p.val>=0?(posColor||C.green):(negColor||C.red)} rx="2" opacity="0.85"/>
      ))}
      <text x={P.l} y={H-6} fill={C.textMut} fontSize="9">{series[0].date?.slice(5)}</text>
      <text x={W-P.r} y={H-6} fill={C.textMut} fontSize="9" textAnchor="end">{series[series.length-1].date?.slice(5)}</text>
    </svg>
  );
}

function BreakdownBars({items,valueKey='winRate',fmtVal=v=>v.toFixed(0)+'%',subKey}){
  if(!items||items.length===0)return <div style={{color:C.textDim,fontSize:12,padding:'16px 0',textAlign:'center'}}>No data yet</div>;
  const max=Math.max(...items.map(i=>Math.abs(i[valueKey])),1);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {items.map((it,i)=>{
        const v=it[valueKey];
        const pct=Math.abs(v)/max*100;
        const col=valueKey==='pnl'?(v>=0?C.green:C.red):(v>=55?C.green:v>=45?C.yellow:C.red);
        return(
          <div key={i}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:C.text,fontWeight:600}}>{it.label}
                <span style={{fontSize:10,color:C.textMut,marginLeft:6}}>{it.wins}W-{it.losses}L{it.be?`-${it.be}BE`:''}</span>
              </span>
              <span style={{fontSize:12,color:col,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{fmtVal(v)}
                {it.pf!==undefined&&<span style={{fontSize:10,color:it.pf>=1.5?C.green:it.pf>=1?C.yellow:C.red,marginLeft:6}}>PF {it.pf>=99?'∞':it.pf.toFixed(2)}</span>}
                {subKey&&<span style={{fontSize:10,color:it[subKey]>=0?C.green:C.red,marginLeft:6}}>{it[subKey]>=0?'+':''}${it[subKey].toFixed(0)}</span>}
              </span>
            </div>
            <div style={{height:7,background:C.surface2,borderRadius:4,overflow:'hidden'}}>
              <div style={{width:pct+'%',height:'100%',background:col,borderRadius:4,transition:'width 0.4s'}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RRHistogram({rrList,height=140}){
  if(!rrList||rrList.length===0)return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:C.textDim,fontSize:12}}>No winning trades yet</div>;
  const buckets=[{l:'0-1R',min:0,max:1},{l:'1-2R',min:1,max:2},{l:'2-3R',min:2,max:3},{l:'3-4R',min:3,max:4},{l:'4-5R',min:4,max:5},{l:'5R+',min:5,max:999}];
  const counts=buckets.map(b=>rrList.filter(r=>r>=b.min&&r<b.max).length);
  const max=Math.max(...counts,1);
  return(
    <div style={{display:'flex',gap:8,alignItems:'flex-end',height}}>
      {buckets.map((b,i)=>(
        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4,height:'100%',justifyContent:'flex-end'}}>
          <span style={{fontSize:11,color:C.textSub,fontWeight:700}}>{counts[i]||''}</span>
          <div style={{width:'100%',maxWidth:44,height:`${counts[i]/max*70}%`,minHeight:counts[i]?4:0,background:C.teal,borderRadius:'4px 4px 0 0',opacity:0.85}}/>
          <span style={{fontSize:10,color:C.textMut}}>{b.l}</span>
        </div>
      ))}
    </div>
  );
}

// Full-population R-multiple histogram — wins AND losses, real signed R
// (not the win-only, always-positive version above). This is what shows
// whether your losses are actually controlled at ~-1R or bleeding wider.
function RMultipleHistogram({allR,height=160}){
  if(!allR||allR.length===0)return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:C.textDim,fontSize:12}}>No R data yet — needs SL entered on closed trades</div>;
  const buckets=[
    {l:'<-2R',min:-999,max:-2},{l:'-2 to -1R',min:-2,max:-1},{l:'-1 to 0R',min:-1,max:0},
    {l:'0-1R',min:0,max:1},{l:'1-2R',min:1,max:2},{l:'2-3R',min:2,max:3},
    {l:'3-4R',min:3,max:4},{l:'4-5R',min:4,max:5},{l:'5R+',min:5,max:999},
  ];
  const counts=buckets.map(b=>allR.filter(r=>r>=b.min&&r<b.max).length);
  const max=Math.max(...counts,1);
  return(
    <div style={{display:'flex',gap:5,alignItems:'flex-end',height,overflowX:'auto'}}>
      {buckets.map((b,i)=>(
        <div key={i} style={{flex:1,minWidth:38,display:'flex',flexDirection:'column',alignItems:'center',gap:4,height:'100%',justifyContent:'flex-end'}}>
          <span style={{fontSize:10.5,color:C.textSub,fontWeight:700}}>{counts[i]||''}</span>
          <div style={{width:'100%',maxWidth:38,height:`${counts[i]/max*70}%`,minHeight:counts[i]?4:0,background:b.max<=0?C.red:C.green,borderRadius:'4px 4px 0 0',opacity:0.85}}/>
          <span style={{fontSize:9.5,color:C.textMut,whiteSpace:'nowrap'}}>{b.l}</span>
        </div>
      ))}
    </div>
  );
}

function HeatCalendar({dayMap, dayRMap}){
  const dates=Object.keys(dayMap).sort();
  if(dates.length===0)return <div style={{color:C.textDim,fontSize:12,padding:'16px 0',textAlign:'center'}}>No data yet</div>;
  // Group by month
  const months={};
  dates.forEach(d=>{const m=d.slice(0,7);if(!months[m])months[m]=[];months[m].push(d);});
  const maxAbs=Math.max(...Object.values(dayMap).map(v=>Math.abs(v)),1);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {Object.entries(months).map(([m,ds])=>{
        const first=new Date(m+'-01T12:00:00');
        const daysInMonth=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
        const startDow=first.getDay();
        const cells=[];
        for(let i=0;i<startDow;i++)cells.push(null);
        for(let d=1;d<=daysInMonth;d++){
          const ds2=`${m}-${d.toString().padStart(2,'0')}`;
          cells.push({day:d,pnl:dayMap[ds2],r:dayRMap?.[ds2]});
        }
        return(
          <div key={m}>
            <div style={{fontSize:11,color:C.textSub,fontWeight:700,marginBottom:6}}>{first.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
              {['S','M','T','W','T','F','S'].map((d,i)=><div key={i} style={{fontSize:9,color:C.textDim,textAlign:'center'}}>{d}</div>)}
              {cells.map((c,i)=>{
                if(!c)return <div key={i}/>;
                const has=c.pnl!==undefined;
                const intensity=has?Math.min(Math.abs(c.pnl)/maxAbs,1):0;
                const col=has?(c.pnl>=0?C.green:C.red):null;
                const r=c.r;
                return(
                  <div key={i} title={has?`$${c.pnl.toFixed(0)}${r?.hasR?` · ${r.r>=0?'+':''}${r.r.toFixed(2)}R`:''}`:''} style={{
                    minHeight:56,borderRadius:4,display:'flex',flexDirection:'column',padding:'3px 4px',
                    background:has?col+Math.round(14+intensity*40).toString(16).padStart(2,'0'):C.surface,
                    border:`1px solid ${has?col+'44':C.border}`,
                  }}>
                    <span style={{fontSize:9,color:has?C.textMut:C.textDim,fontWeight:400}}>{c.day}</span>
                    {has&&(
                      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:1}}>
                        {r?.hasR ? (
                          <span style={{fontSize:12,fontWeight:800,color:r.r>=0?C.green:C.red}}>{r.r>=0?'+':''}{r.r.toFixed(2)}</span>
                        ) : (
                          <span style={{fontSize:11,fontWeight:700,color:col}}>{c.pnl>=0?'+':''}${Math.abs(c.pnl)>=1000?(c.pnl/1000).toFixed(1)+'k':c.pnl.toFixed(0)}</span>
                        )}
                        {r&&(r.w||r.l)?(
                          <span style={{fontSize:8,color:C.textMut}}>{r.w?`${r.w}W`:''}{r.w&&r.l?' ':''}{r.l?`${r.l}L`:''}</span>
                        ):null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({title,sub,children}){
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:'16px 18px',marginBottom:14}}>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text}}>{title}</div>
        {sub&&<div style={{fontSize:11,color:C.textMut,marginTop:2}}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function BigStat({label,val,col,sub}){
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 16px'}}>
      <div style={{fontSize:10,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{label}</div>
      <div style={{fontSize:22,fontWeight:800,color:col||C.text,fontVariantNumeric:'tabular-nums',lineHeight:1.1}}>{val}</div>
      {sub&&<div style={{fontSize:10,color:C.textMut,marginTop:4}}>{sub}</div>}
    </div>
  );
}


// ═══ Deep Analytics Engine ═══════════════════════════════════════════════════
const PRETTY = {
  b_shape_FP:'b shape FP', P_shape_FP:'P shape FP', exhaustion:'Exhaustion', absorption:'Absorption',
  volume_spike:'Volume Spike', initiative_participants:'Initiative Participants',
  entry_1:'Entry 1', entry_2:'Entry 2', entry_3:'Entry 3',
  bullish_st:'Bullish ST', bearish_st:'Bearish ST', balanced_st:'Balanced ST',
  bullish_htf:'Bullish HTF', bearish_htf:'Bearish HTF',
  ir_iv:'In Range In Value', ir_ov:'In Range Out of Value', or_ov:'Out of Range Out of Value',
  m_dvah:'M DVAH', m_dval:'M DVAL', m_pvah:'M PVAH', m_pval:'M PVAL', m_extreme_dev:'M Extreme Deviation Band',
  w_dvah:'W DVAH', w_dval:'W DVAL', w_pvah:'W PVAH', w_pval:'W PVAL', w_extreme_dev:'W Extreme Deviation Band',
  pdvah:'PDVAH', pdval:'PDVAL',
  long:'Long', short:'Short',
  BPB:'BPB', RPB:'RPB', ROT:'ROT', FADE:'Fade',
  finesse:'Finesse entry', mid_move:'Entered mid-move', no_pivot:'No pivot confirmation', revenge:'Revenge trade', overtrading:'Overtrading after loss', oversized:'Oversized', moved_stop:'Moved stop', early_exit:'Early exit', chased:'Chased extension', no_level:'No level beneath entry',
  balance:'Balance (old)', failedexp:'Failed Exp (old)', reclaim:'Reclaim (old)', breakout:'Breakout (old)',
};
const pretty=v=>PRETTY[v]||v;

const DIMENSIONS = {
  setup:{label:'Setup', get:t=>t.setup, options:SETUP_OPTIONS},
  trigger:{label:'Entry Trigger', get:t=>t.triggers, multi:true, options:TRIGGER_OPTIONS},
  attempt:{label:'Entry Attempt', get:t=>t.attempt, options:ATTEMPT_OPTIONS},
  stContext:{label:'Short-Term Context', get:t=>t.stContext, options:ST_OPTIONS},
  htfContext:{label:'HTF Context', get:t=>t.htfContext, options:HTF_OPTIONS},
  openingType:{label:'Opening Type', get:t=>t.openingType, options:OPENING_OPTIONS},
  compositeBalanceExtreme:{label:'Composite Profile Balance Extreme', get:t=>t.compositeBalanceExtreme, multi:true, options:COMPOSITE_BALANCE_EXTREME},
  mExtremeDevBand:{label:'M Extreme Deviation Band', get:t=>t.mExtremeDevBand, multi:true, options:M_EXTREME_DEV_BAND},
  wExtremeDevBand:{label:'W Extreme Deviation Band', get:t=>t.wExtremeDevBand, multi:true, options:W_EXTREME_DEV_BAND},
  direction:{label:'Direction', get:t=>t.direction, options:DIRECTION_OPTIONS},
  ticker:{label:'Instrument', get:t=>t.ticker}, // no static list — genuinely data-driven (whatever you've traded)
  session:{label:'Session', get:t=>t.session, options:[{label:'IB Period',value:'IB Period'},{label:'C-period',value:'C-period'},{label:'D-period',value:'D-period'},{label:'Afternoon',value:'Afternoon'}]}, // derived from entry time
};

function dimValues(trades,key){
  const s=new Set();
  trades.forEach(t=>{
    const v=DIMENSIONS[key].get(t);
    if(DIMENSIONS[key].multi)(v||[]).forEach(x=>x&&x!=='—'&&s.add(x));
    else if(v&&v!=='—')s.add(v);
  });
  return[...s];
}

function applyFilters(trades,f){
  return trades.filter(t=>{
    if(f.from&&t.date<f.from)return false;
    if(f.to&&t.date>f.to)return false;
    for(const key of Object.keys(DIMENSIONS)){
      const sel=f[key];
      if(!sel||sel.length===0)continue;
      const v=DIMENSIONS[key].get(t);
      if(DIMENSIONS[key].multi){
        if(!(v||[]).some(x=>sel.includes(x)))return false;
      }else{
        if(!sel.includes(v))return false;
      }
    }
    return true;
  });
}

function metricsFor(trades){
  const closed=trades.filter(t=>['W','L','BE'].includes(t.result));
  const w=closed.filter(t=>t.result==='W'), l=closed.filter(t=>t.result==='L');
  const gw=w.reduce((s,t)=>s+t.pnl,0), gl=Math.abs(l.reduce((s,t)=>s+t.pnl,0));
  const total=closed.reduce((s,t)=>s+t.pnl,0);
  const withMfe=closed.filter(t=>t.mfe>0);
  const withMae=closed.filter(t=>t.mae>0);
  const withMfeR=closed.filter(t=>t.mfeR!=null);
  const capList=withMfe.filter(t=>t.contracts>0).map(t=>Math.max(0,(t.points/t.contracts))/t.mfe);
  const withR=closed.filter(t=>t.rawRR!=null&&t.sl>0);
  const avgR=withR.length?withR.reduce((s,t)=>s+t.rawRR,0)/withR.length:0;
  const stdR=withR.length>1?Math.sqrt(withR.reduce((s,t)=>s+(t.rawRR-avgR)**2,0)/withR.length):0;
  const avgMfeR=withMfeR.length?withMfeR.reduce((s,t)=>s+t.mfeR,0)/withMfeR.length:0;
  // Missed R — computed per-trade (mfeR - realized R) then averaged, not by
  // subtracting the two separate averages above (those can run over slightly
  // different trade sets since one needs SL+points, the other needs SL+MFE).
  const withBoth=closed.filter(t=>t.rawRR!=null&&t.sl>0&&t.mfeR!=null);
  const missedRList=withBoth.map(t=>t.mfeR-t.rawRR);
  const avgMissedR=missedRList.length?missedRList.reduce((s,v)=>s+v,0)/missedRList.length:0;
  return{
    count:closed.length, wins:w.length, losses:l.length, be:closed.length-w.length-l.length,
    winRate:w.length+l.length>0?w.length/(w.length+l.length)*100:0,
    totalPnl:total, avgPnl:closed.length?total/closed.length:0,
    pf:gl>0?gw/gl:(gw>0?99:0),
    expectancy:closed.length?total/closed.length:0,
    avgMFE:withMfe.length?withMfe.reduce((s,t)=>s+t.mfe,0)/withMfe.length:0,
    avgMAE:withMae.length?withMae.reduce((s,t)=>s+t.mae,0)/withMae.length:0,
    capture:capList.length?capList.reduce((s,v)=>s+v,0)/capList.length*100:0,
    mfeN:withMfe.length,
    avgR, stdR, rN:withR.length,
    avgMfeR, mfeRN:withMfeR.length,
    avgMissedR, missedRN:withBoth.length,
  };
}

function groupByDims(trades,dimKeys,minN=1){
  const groups={};
  trades.forEach(t=>{
    // build label combos — expand multi dims
    let combos=[[]];
    for(const key of dimKeys){
      const v=DIMENSIONS[key].get(t);
      const vals=DIMENSIONS[key].multi?(v||[]).filter(x=>x&&x!=='—'):(v&&v!=='—'?[v]:[]);
      if(vals.length===0){combos=[];break;}
      const next=[];
      combos.forEach(c=>vals.forEach(val=>next.push([...c,val])));
      combos=next;
    }
    combos.forEach(c=>{
      const k=c.join('|');
      if(!groups[k])groups[k]={label:c.map(pretty).join(' × '),trades:[]};
      groups[k].trades.push(t);
    });
  });
  return Object.values(groups)
    .map(g=>({label:g.label,...metricsFor(g.trades)}))
    .filter(g=>g.count>=minN)
    .sort((a,b)=>b.totalPnl-a.totalPnl);
}

// ─── Sortable table ───
function SortTable({columns,rows,defaultSort,isMobile}){
  const[sortKey,setSortKey]=useState(defaultSort||columns[1]?.key);
  const[dir,setDir]=useState(-1);
  const sorted=[...rows].sort((a,b)=>{
    const av=a[sortKey],bv=b[sortKey];
    if(typeof av==='string')return dir*av.localeCompare(bv);
    return dir*((av||0)-(bv||0));
  });
  const click=k=>{if(k===sortKey)setDir(-dir);else{setSortKey(k);setDir(-1);}};
  return(
    <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:isMobile?560:0}}>
        <thead><tr>
          {columns.map(c=>(
            <th key={c.key} onClick={()=>click(c.key)} style={{
              textAlign:c.align||'right',padding:'8px 10px',color:sortKey===c.key?C.teal:C.textMut,
              fontSize:10,textTransform:'uppercase',letterSpacing:'0.06em',cursor:'pointer',
              borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap',userSelect:'none',
            }}>{c.label}{sortKey===c.key?(dir<0?' ↓':' ↑'):''}</th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map((r,i)=>(
            <tr key={i} onClick={r.__onClick} style={{cursor:r.__onClick?'pointer':'default'}}
              onMouseEnter={e=>{if(r.__onClick)e.currentTarget.style.background=C.surface2;}}
              onMouseLeave={e=>{e.currentTarget.style.background='transparent';}}>
              {columns.map(c=>(
                <td key={c.key} style={{
                  padding:'7px 9px',textAlign:c.align||'right',
                  borderBottom:`0.5px solid ${C.border}`,whiteSpace:'nowrap',
                  color:c.color?c.color(r):C.text,
                  fontWeight:c.bold?700:400,fontVariantNumeric:'tabular-nums',
                }}>{c.fmt?c.fmt(r[c.key],r):r[c.key]}</td>
              ))}
            </tr>
          ))}
          {sorted.length===0&&<tr><td colSpan={columns.length} style={{padding:'20px',textAlign:'center',color:C.textDim}}>No trades match</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const perfColumns=(isMobile)=>[
  {key:'label',label:'Tag',align:'left',bold:true},
  {key:'totalPnl',label:'Total PnL',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.totalPnl>=0?C.green:C.red,bold:true},
  {key:'avgPnl',label:'Avg PnL',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.avgPnl>=0?C.green:C.red},
  {key:'count',label:'Trades'},
  {key:'winRate',label:'Win %',fmt:v=>v.toFixed(0)+'%',color:r=>r.winRate>=55?C.green:r.winRate>=45?C.yellow:C.red},
  {key:'pf',label:'PF',fmt:v=>v>=99?'∞':v.toFixed(2),color:r=>r.pf>=1.5?C.green:r.pf>=1?C.yellow:C.red},
  {key:'expectancy',label:'Expect.',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.expectancy>=0?C.green:C.red},
];

// Single shared definition of R/MFE/MAE columns — used by EVERY performance
// table in the app (per-dimension pages, Pivot, Rolling Windows). Change
// something here once and it's consistent everywhere, rather than each
// section defining its own copy that can drift out of sync.
function extraMetricCols(trades){
  const hasR=trades.some(t=>t.sl>0);
  const hasMfe=trades.some(t=>t.mfe>0);
  const cols=[];
  if(hasR)cols.push({key:'avgR',label:'Avg R',fmt:(v,r)=>r.rN?(v>=0?'+':'')+v.toFixed(2)+'R':'—',color:r=>r.avgR>=0?C.green:C.red,bold:true});
  if(hasMfe){
    cols.push({key:'avgMFE',label:'Avg MFE',fmt:v=>v?v.toFixed(1):'—',color:()=>C.green});
    cols.push({key:'avgMAE',label:'Avg MAE',fmt:v=>v?v.toFixed(1):'—',color:()=>C.red});
    cols.push({key:'capture',label:'Capture',fmt:(v,r)=>r.mfeN?v.toFixed(0)+'%':'—',color:r=>r.capture>=60?C.green:r.capture>=40?C.yellow:C.textMut});
  }
  return cols;
}

function HBars({rows,metric}){
  if(rows.length===0)return null;
  const vals=rows.map(r=>metric==='winRate'?r.winRate:metric==='pf'?Math.min(r.pf,5):metric==='count'?r.count:r.totalPnl);
  const max=Math.max(...vals.map(Math.abs),1);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:14}}>
      {rows.map((r,i)=>{
        const v=vals[i];
        const col=metric==='winRate'?(r.winRate>=55?C.green:r.winRate>=45?C.yellow:C.red)
          :metric==='pf'?(r.pf>=1.5?C.green:r.pf>=1?C.yellow:C.red)
          :metric==='count'?C.blue
          :(v>=0?C.green:C.red);
        return(
          <div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:130,fontSize:11,color:C.textSub,textAlign:'right',flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.label}</div>
            <div style={{flex:1,height:14,background:C.surface2,borderRadius:4,overflow:'hidden'}}>
              <div style={{width:Math.abs(v)/max*100+'%',height:'100%',background:col,borderRadius:4}}/>
            </div>
            <div style={{width:60,fontSize:11,color:col,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>
              {metric==='winRate'?r.winRate.toFixed(0)+'%':metric==='pf'?(r.pf>=99?'∞':r.pf.toFixed(2)):metric==='count'?r.count:(r.totalPnl>=0?'+':'')+'$'+r.totalPnl.toFixed(0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Global filter bar ───
function FilterBar({allTrades,filters,setFilters,isMobile}){
  const[open,setOpen]=useState(false);
  const activeCount=Object.keys(DIMENSIONS).reduce((n,k)=>n+(filters[k]?.length||0),0)+(filters.from?1:0)+(filters.to?1:0);
  const toggle=(key,val)=>{
    const cur=filters[key]||[];
    setFilters({...filters,[key]:cur.includes(val)?cur.filter(x=>x!==val):[...cur,val]});
  };
  const inputStyle={padding:'8px 11px',borderRadius:9,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:'inherit',outline:'none'};
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:'12px 16px',marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <input type="date" value={filters.from||''} onChange={e=>setFilters({...filters,from:e.target.value})} style={inputStyle}/>
          <span style={{color:C.textMut,fontSize:12}}>→</span>
          <input type="date" value={filters.to||''} onChange={e=>setFilters({...filters,to:e.target.value})} style={inputStyle}/>
        </div>
        <div style={{display:'flex',gap:8}}>
          {activeCount>0&&<button onClick={()=>setFilters({})} style={{padding:'8px 14px',borderRadius:9,border:`1.5px solid ${C.red}44`,background:'transparent',color:C.red,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Clear ({activeCount})</button>}
          <button onClick={()=>setOpen(!open)} style={{padding:'8px 14px',borderRadius:9,border:`1.5px solid ${open?C.teal:C.border}`,background:open?C.teal+'15':'transparent',color:open?C.teal:C.textSub,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600}}>
            {open?'Hide Filters':'Tag Filters'}
          </button>
        </div>
      </div>
      {activeCount>0&&(
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:10}}>
          {filters.from&&<span onClick={()=>setFilters({...filters,from:''})} style={{padding:'3px 10px',borderRadius:14,fontSize:11,border:`1px solid ${C.teal}55`,background:C.teal+'12',color:C.teal,cursor:'pointer',fontWeight:600}}>from {filters.from} ×</span>}
          {filters.to&&<span onClick={()=>setFilters({...filters,to:''})} style={{padding:'3px 10px',borderRadius:14,fontSize:11,border:`1px solid ${C.teal}55`,background:C.teal+'12',color:C.teal,cursor:'pointer',fontWeight:600}}>to {filters.to} ×</span>}
          {Object.keys(DIMENSIONS).flatMap(key=>(filters[key]||[]).map(v=>(
            <span key={key+v} onClick={()=>toggle(key,v)} style={{padding:'3px 10px',borderRadius:14,fontSize:11,border:`1px solid ${C.teal}55`,background:C.teal+'12',color:C.teal,cursor:'pointer',fontWeight:600}}>
              {DIMENSIONS[key].label}: {pretty(v)} ×
            </span>
          )))}
        </div>
      )}
      {open&&(
        <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:12}}>
          {Object.entries(DIMENSIONS).map(([key,dim])=>{
            const vals=dim.options?dim.options.map(o=>o.value):dimValues(allTrades,key);
            if(vals.length===0)return null;
            return(
              <div key={key}>
                <div style={{fontSize:10,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6,fontWeight:700}}>{dim.label}</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {vals.map(v=>{
                    const on=(filters[key]||[]).includes(v);
                    return(
                      <button key={v} onClick={()=>toggle(key,v)} style={{
                        padding:'4px 11px',borderRadius:16,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                        border:`1.5px solid ${on?C.teal:C.border}`,
                        background:on?C.teal+'18':'transparent',
                        color:on?C.teal:C.textMut,fontWeight:on?700:400,
                      }}>{pretty(v)}</button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────
function DimSection({dimKey,trades,minN,tagMetric,setTagMetric,isMobile,rollingBase}){
  const dim=DIMENSIONS[dimKey];
  const rows=groupByDims(trades,[dimKey],minN);
  const cols=[...perfColumns(isMobile),...extraMetricCols(trades)];
  return(
    <ChartCard title={`${dim.label} Performance`}>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
        {[['totalPnl','Total PnL'],['winRate','Win %'],['pf','Profit Factor'],['count','Trade Count']].map(([k,l])=>(
          <button key={k} onClick={()=>setTagMetric(k)} style={{
            padding:'5px 12px',borderRadius:16,fontSize:11,fontFamily:'inherit',cursor:'pointer',fontWeight:600,
            border:`1.5px solid ${tagMetric===k?C.blue:C.border}`,
            background:tagMetric===k?C.blue+'15':'transparent',
            color:tagMetric===k?C.blue:C.textMut,
          }}>{l}</button>
        ))}
      </div>
      <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'minmax(0,58%) minmax(0,42%)',gap:24,alignItems:'start'}}>
        <SortTable columns={cols} rows={rows} defaultSort="totalPnl" isMobile={isMobile}/>
        <HBars rows={rows} metric={tagMetric}/>
      </div>
      {rows.length===0&&<div style={{color:C.textDim,fontSize:12,textAlign:'center',padding:'8px 0'}}>No tags meet the minimum sample of {minN}</div>}
    </ChartCard>
  );
}

function AnalyticsTab({userId,isMobile,onJumpToDate}){
  const[days,setDays]=useState(null);
  const[section,setSection]=useState('equity');
  const[filters,setFilters]=useState({});
  const[minN,setMinN]=useState(1);
  const[tagMetric,setTagMetric]=useState('totalPnl');
  const[pivotDims,setPivotDims]=useState(['setup','trigger']);
  const[pivotMinN,setPivotMinN]=useState(5);
  const[rollWin,setRollWin]=useState(20);
  const[timeMetric,setTimeMetric]=useState('pnl');
  const[exFilters,setExFilters]=useState({});
  const[mfeDim,setMfeDim]=useState('setup');

  useEffect(()=>{
    let live=true;
    loadAllDays(userId).then(d=>{if(live)setDays(d);});
    return()=>{live=false;};
  },[userId]);

  if(days===null)return <div style={{textAlign:'center',color:C.textMut,padding:'60px 0',fontSize:13}}>Loading your data...</div>;

  const allTrades=extractAllTrades(days);
  const trades=applyFilters(allTrades,filters);
  const s=computeStats(trades);

  const SECTIONS=[
    ['equity','Equity & Drawdown'],
    ['setup','Setup'],['trigger','Entry Trigger'],['attempt','Entry Attempt'],
    ['stContext','Short-Term Context'],['htfContext','HTF Context'],['openingType','Opening Type'],['compositeBalanceExtreme','Balance Extreme'],['mExtremeDevBand','M Dev Band'],['wExtremeDevBand','W Dev Band'],['direction','Direction'],
    ['pivot','Cross / Pivot'],['time','Time & Session'],['rolling','Rolling Windows'],['mfemae','MFE / MAE'],['whatif','What-If'],['log','Trade Log'],
  ];

  const dimSectionKeys=['setup','trigger','attempt','stContext','htfContext','openingType','compositeBalanceExtreme','mExtremeDevBand','wExtremeDevBand','direction'];

  return(
    <div>
      <div style={{display:'flex',gap:5,marginBottom:12,overflowX:'auto',paddingBottom:2,flexWrap:isMobile?'nowrap':'wrap',maxWidth:900}}>
        {SECTIONS.map(([k,l])=>(
          <button key={k} onClick={()=>setSection(k)} style={{
            padding:'5px 11px',borderRadius:16,fontSize:11,fontFamily:'inherit',cursor:'pointer',fontWeight:600,whiteSpace:'nowrap',
            border:`1.5px solid ${section===k?C.teal:C.border}`,
            background:section===k?C.teal+'15':'transparent',
            color:section===k?C.teal:C.textMut,flexShrink:0,
          }}>{l}</button>
        ))}
      </div>

      <FilterBar allTrades={allTrades} filters={filters} setFilters={setFilters} isMobile={isMobile}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <div style={{fontSize:11,color:C.textMut}}>{trades.length} of {allTrades.length} trades match · Min sample: {dimSectionKeys.includes(section)?minN:section==='pivot'?pivotMinN:'—'}</div>
        {dimSectionKeys.includes(section)&&(
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:11,color:C.textMut}}>Min sample:</span>
            <input type="number" value={minN} min="1" onChange={e=>setMinN(parseInt(e.target.value)||1)}
              style={{width:56,padding:'6px 10px',borderRadius:8,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:'inherit',outline:'none'}}/>
          </div>
        )}
      </div>

      {s.totalTrades===0?(
        <div style={{textAlign:'center',color:C.textMut,padding:'40px 0',fontSize:13}}>No completed trades match the current filters.</div>
      ):(<>

      {/* ══ EQUITY & DRAWDOWN ══ */}
      {section==='equity'&&(<>
        <InsightsCard insights={insightsFor(trades)}/>
        <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(5,1fr)',gap:10,marginBottom:10}}>
          <BigStat label="Net P&L" val={`${s.totalPnl>=0?'+':''}$${s.totalPnl.toFixed(0)}`} col={s.totalPnl>=0?C.green:C.red}/>
          <BigStat label="Win Rate" val={`${s.winRate.toFixed(1)}%`} col={s.winRate>=50?C.green:s.winRate>=40?C.yellow:C.red} sub={`${s.wins}W · ${s.losses}L · ${s.be}BE`}/>
          <BigStat label="Profit Factor" val={s.profitFactor>=99?'∞':s.profitFactor.toFixed(2)} col={s.profitFactor>=1.5?C.green:s.profitFactor>=1?C.yellow:C.red}/>
          <BigStat label="Expectancy" val={`${s.expectancy>=0?'+':''}$${s.expectancy.toFixed(0)}`} col={s.expectancy>=0?C.green:C.red} sub="per trade"/>
          <BigStat label="Avg R" val={s.allR.length?`${s.avgR>=0?'+':''}${s.avgR.toFixed(2)}R`:'—'} col={s.avgR>=0?C.green:C.red} sub={s.allR.length?`σ ${s.stdR.toFixed(2)}R`:'needs SL entered'}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(5,1fr)',gap:10,marginBottom:16}}>
          <BigStat label="Sharpe (daily)" val={s.nDays>=5?s.sharpe.toFixed(2):'—'} col={s.sharpe>=0.5?C.green:s.sharpe>=0?C.yellow:C.red} sub={s.nDays<15?`⚠ only ${s.nDays} days`:`${s.nDays} trading days`}/>
          <BigStat label="Sortino (daily)" val={s.nDays>=5?s.sortino.toFixed(2):'—'} col={s.sortino>=0.7?C.green:s.sortino>=0?C.yellow:C.red} sub={s.nDays<15?`⚠ only ${s.nDays} days`:'downside-only'}/>
          <BigStat label="Gain-to-Pain" val={s.nDays>=1?(s.gainToPain>=99?'∞':s.gainToPain.toFixed(2)):'—'} col={s.gainToPain>=1.5?C.green:s.gainToPain>=1?C.yellow:C.red} sub="up days ÷ down days ($)"/>
          <BigStat label="Total Commission" val={s.totalCommission?`-$${s.totalCommission.toFixed(2)}`:'—'} col={C.textMut} sub={s.totalCommission?`${((s.totalCommission/Math.max(Math.abs(s.totalPnl+s.totalCommission),1))*100).toFixed(1)}% of gross`:'none tracked'}/>
        </div>
        <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <ChartCard title="Equity Curve" sub="Responds live to the tag filters above">
            <SvgLineChart series={s.equity} color={s.totalPnl>=0?C.green:C.red}/>
          </ChartCard>
          <ChartCard title="Drawdown" sub="Distance from equity peak">
            <SvgLineChart series={s.ddSeries} color={C.orange}/>
          </ChartCard>
          <ChartCard title="Daily P&L"><SvgBarChart series={s.dailyPnl}/></ChartCard>
          <ChartCard title="P&L Calendar" sub="R-value + win/loss count when SL is entered, otherwise $ P&L"><HeatCalendar dayMap={s.dayMap} dayRMap={s.dayRMap}/></ChartCard>
          <ChartCard title="R-Multiple Distribution" sub="Every closed trade, real signed R — not an assumed -1R on losses">
            <RMultipleHistogram allR={s.allR}/>
          </ChartCard>
          <ChartCard title="Cumulative R Curve" sub="Position-size-normalized — shows if your edge is real, independent of contract count">
            <SvgLineChart series={s.rCurve} color={s.avgR>=0?C.green:C.red} fill={false} fmtY={v=>v.toFixed(1)+'R'}/>
          </ChartCard>
        </div>
      </>)}

      {/* ══ PER-DIMENSION SECTIONS ══ */}
      {dimSectionKeys.includes(section)&&(
        <DimSection dimKey={section} trades={trades} minN={minN} tagMetric={tagMetric} setTagMetric={setTagMetric} isMobile={isMobile}/>
      )}

      {/* ══ CROSS / PIVOT ══ */}
      {section==='pivot'&&(
        <ChartCard title="Cross-Tag Pivot" sub="Group any 2-3 dimensions — where the edge actually lives">
          <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',marginBottom:16}}>
            {[0,1,2].map(i=>(
              <select key={i} value={pivotDims[i]||''} onChange={e=>{
                const nd=[...pivotDims];
                if(e.target.value)nd[i]=e.target.value;else nd.splice(i,1);
                setPivotDims(nd.filter(Boolean).slice(0,3));
              }} style={{padding:'8px 11px',borderRadius:9,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:'inherit',outline:'none'}}>
                <option value="">{i<2?'— pick dimension —':'— optional 3rd —'}</option>
                {Object.entries(DIMENSIONS).map(([k,d])=><option key={k} value={k}>{d.label}</option>)}
              </select>
            ))}
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:11,color:C.textMut}}>Min trades:</span>
              <input type="number" value={pivotMinN} min="1" onChange={e=>setPivotMinN(parseInt(e.target.value)||1)}
                style={{width:56,padding:'8px 11px',borderRadius:9,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:'inherit',outline:'none'}}/>
            </div>
          </div>
          {(()=>{
            if(pivotDims.length<2)return <div style={{color:C.textDim,fontSize:12,textAlign:'center',padding:'20px 0'}}>Pick at least 2 dimensions</div>;
            const rows=groupByDims(trades,pivotDims,pivotMinN);
            const small=rows.filter(r=>r.count<8).length;
            return(<>
              {small>0&&<div style={{fontSize:11,color:C.yellow,marginBottom:10}}>⚠ {small} combination{small>1?'s':''} below 8 trades — treat as indicative only</div>}
              <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'minmax(0,58%) minmax(0,42%)',gap:24,alignItems:'start'}}>
                <SortTable columns={[...perfColumns(isMobile),...extraMetricCols(trades)]} rows={rows} defaultSort="totalPnl" isMobile={isMobile}/>
                <HBars rows={rows.slice(0,14)} metric={tagMetric}/>
              </div>
            </>);
          })()}
        </ChartCard>
      )}

      {/* ══ TIME & SESSION ══ */}
      {section==='time'&&(()=>{
        const dows=['Mon','Tue','Wed','Thu','Fri'];
        const hours=[10,11,12,13,14,15];
        const cell={};
        trades.forEach(t=>{
          const d=new Date(t.date+'T12:00:00').getDay();
          if(d<1||d>5)return;
          const h=parseInt((t.entryTime||'').split(':')[0]);
          if(isNaN(h)||h<10||h>15)return;
          const k=`${d}_${h}`;
          if(!cell[k])cell[k]={pnl:0,n:0,w:0,l:0};
          cell[k].pnl+=t.pnl;cell[k].n++;
          if(t.result==='W')cell[k].w++;else if(t.result==='L')cell[k].l++;
        });
        const maxAbs=Math.max(...Object.values(cell).map(c=>Math.abs(timeMetric==='pnl'?c.pnl:(c.w+c.l?c.w/(c.w+c.l)*100-50:0))),1);
        return(<>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {[['pnl','P&L'],['wr','Win %']].map(([k,l])=>(
              <button key={k} onClick={()=>setTimeMetric(k)} style={{padding:'7px 16px',borderRadius:20,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600,border:`1.5px solid ${timeMetric===k?C.blue:C.border}`,background:timeMetric===k?C.blue+'15':'transparent',color:timeMetric===k?C.blue:C.textMut}}>{l}</button>
            ))}
          </div>
          <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <ChartCard title="Day × Hour Heatmap" sub="Entry hour (EST) vs day of week">
              <div style={{overflowX:'auto'}}>
                <div style={{display:'grid',gridTemplateColumns:`50px repeat(${hours.length},1fr)`,gap:4,minWidth:440}}>
                  <div/>
                  {hours.map(h=><div key={h} style={{fontSize:10,color:C.textMut,textAlign:'center'}}>{h}:00</div>)}
                  {dows.map((dn,di)=>(<React.Fragment key={dn}>
                    <div style={{fontSize:11,color:C.textSub,display:'flex',alignItems:'center'}}>{dn}</div>
                    {hours.map(h=>{
                      const c=cell[`${di+1}_${h}`];
                      if(!c)return <div key={h} style={{aspectRatio:'1.6',borderRadius:6,background:C.surface,border:`1px solid ${C.border}`}}/>;
                      const v=timeMetric==='pnl'?c.pnl:(c.w+c.l?c.w/(c.w+c.l)*100-50:0);
                      const col=v>=0?C.green:C.red;
                      const alpha=Math.round(18+Math.min(Math.abs(v)/maxAbs,1)*70).toString(16).padStart(2,'0');
                      return(
                        <div key={h} title={`${dn} ${h}:00 — $${c.pnl.toFixed(0)} · ${c.n} trades`} style={{aspectRatio:'1.6',borderRadius:6,background:col+alpha,border:`1px solid ${col}44`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                          <div style={{fontSize:10,fontWeight:700,color:C.text}}>{timeMetric==='pnl'?('$'+c.pnl.toFixed(0)):((c.w+c.l?(c.w/(c.w+c.l)*100).toFixed(0):'—')+'%')}</div>
                          <div style={{fontSize:8,color:C.textSub}}>{c.n}t</div>
                        </div>
                      );
                    })}
                  </React.Fragment>))}
                </div>
              </div>
            </ChartCard>
            <div>
              <ChartCard title="Day of Week">
                <SortTable columns={perfColumns(isMobile)} rows={groupByDims(trades,['session'],1).length?(()=>{
                  const dowNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                  const m={};
                  trades.forEach(t=>{
                    const k=dowNames[new Date(t.date+'T12:00:00').getDay()];
                    if(!m[k])m[k]=[];m[k].push(t);
                  });
                  return Object.entries(m).map(([k,v])=>({label:k,...metricsFor(v)}));
                })():[]} defaultSort="totalPnl" isMobile={isMobile}/>
              </ChartCard>
              <ChartCard title="Session Breakdown" sub="First 90 min · Mid-day · Last 90 min">
                <SortTable columns={perfColumns(isMobile)} rows={['First 90 min','Mid-day','Last 90 min'].map(sn=>({label:sn,...metricsFor(trades.filter(t=>session3(t.entryTime)===sn))})).filter(r=>r.count>0)} defaultSort="totalPnl" isMobile={isMobile}/>
              </ChartCard>
            </div>
          </div>
        </>);
      })()}

      {/* ══ ROLLING WINDOWS ══ */}
      {section==='rolling'&&(()=>{
        const seqAll=[...trades.filter(t=>['W','L','BE'].includes(t.result))].sort((a,b)=>(a.date+a.entryTime).localeCompare(b.date+b.entryTime));
        const windowTrades=seqAll.slice(-rollWin);
        const cur=metricsFor(windowTrades), all=metricsFor(seqAll);
        return(<>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {[20,50,100].map(n=>(
              <button key={n} onClick={()=>setRollWin(n)} style={{padding:'7px 16px',borderRadius:20,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600,border:`1.5px solid ${rollWin===n?C.teal:C.border}`,background:rollWin===n?C.teal+'15':'transparent',color:rollWin===n?C.teal:C.textMut}}>Last {n}</button>
            ))}
            <div style={{fontSize:11,color:C.textMut,alignSelf:'center'}}>{windowTrades.length<rollWin?`only ${windowTrades.length} closed trades available`:''}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(5,1fr)',gap:10,marginBottom:16}}>
            <BigStat label={`Win rate (last ${rollWin})`} val={cur.count?cur.winRate.toFixed(0)+'%':'—'} col={cur.winRate>=50?C.green:C.yellow} sub={`lifetime: ${all.winRate.toFixed(0)}%`}/>
            <BigStat label={`Expectancy (last ${rollWin})`} val={cur.count?(cur.expectancy>=0?'+':'')+'$'+cur.expectancy.toFixed(0):'—'} col={cur.expectancy>=0?C.green:C.red} sub={`lifetime: ${(all.expectancy>=0?'+':'')}$${all.expectancy.toFixed(0)}`}/>
            <BigStat label={`Avg R (last ${rollWin})`} val={cur.rN?(cur.avgR>=0?'+':'')+cur.avgR.toFixed(2)+'R':'—'} col={cur.avgR>=0?C.green:C.red} sub={all.rN?`lifetime: ${(all.avgR>=0?'+':'')}${all.avgR.toFixed(2)}R`:''}/>
            <BigStat label={`PF (last ${rollWin})`} val={cur.count?(cur.pf>=99?'∞':cur.pf.toFixed(2)):'—'} col={cur.pf>=1.5?C.green:cur.pf>=1?C.yellow:C.red} sub={`lifetime: ${all.pf>=99?'∞':all.pf.toFixed(2)}`}/>
            <BigStat label="Trend" val={cur.count?(cur.expectancy>=all.expectancy?'Improving ↗':'Decaying ↘'):'—'} col={cur.expectancy>=all.expectancy?C.green:C.red}/>
          </div>
          {['setup','trigger','attempt','stContext','htfContext','openingType','compositeBalanceExtreme','mExtremeDevBand','wExtremeDevBand','direction'].map(dk=>{
            const rows=groupByDims(windowTrades,[dk],1).map(r=>{
              const lifetime=groupByDims(seqAll,[dk],1).find(x=>x.label===r.label);
              return{...r,lifeExp:lifetime?lifetime.expectancy:0,delta:r.expectancy-(lifetime?lifetime.expectancy:0)};
            });
            if(rows.length===0)return null;
            return(
              <ChartCard key={dk} title={`${DIMENSIONS[dk].label} — last ${rollWin} vs lifetime`}>
                <SortTable columns={[
                  {key:'label',label:'Tag',align:'left',bold:true},
                  {key:'count',label:'N (window)'},
                  {key:'totalPnl',label:'PnL',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.totalPnl>=0?C.green:C.red,bold:true},
                  {key:'winRate',label:'Win %',fmt:v=>v.toFixed(0)+'%',color:r=>r.winRate>=55?C.green:r.winRate>=45?C.yellow:C.red},
                  {key:'expectancy',label:'Exp (window)',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.expectancy>=0?C.green:C.red},
                  {key:'lifeExp',label:'Exp (lifetime)',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:()=>C.textSub},
                  {key:'delta',label:'Δ',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.delta>=0?C.green:C.red,bold:true},
                  ...extraMetricCols(windowTrades),
                ]} rows={rows} defaultSort="delta" isMobile={isMobile}/>
              </ChartCard>
            );
          })}
        </>);
      })()}

      {/* ══ MFE / MAE ══ */}
      {section==='mfemae'&&(()=>{
        const withMfe=trades.filter(t=>t.mfe>0||t.mae>0);
        if(withMfe.length===0)return(
          <ChartCard title="MFE / MAE" sub="No trades with MFE/MAE data yet">
            <div style={{color:C.textDim,fontSize:12,textAlign:'center',padding:'20px 0'}}>
              MFE/MAE auto-fills on Sierra Chart CSV imports (from HighDuringPosition/LowDuringPosition). Import some trades, or enter MFE/MAE manually on a trade card, to see this section populate.
            </div>
          </ChartCard>
        );
        const rows=groupByDims(withMfe,[mfeDim],1);
        return(
          <ChartCard title="MFE / MAE by Tag" sub="Avg MFE = best move in your favor before exit · Avg MAE = worst heat taken · Capture = realized ÷ MFE">
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
              {Object.entries(DIMENSIONS).filter(([k])=>k!=='ticker').map(([k,d])=>(
                <button key={k} onClick={()=>setMfeDim(k)} style={{
                  padding:'5px 12px',borderRadius:16,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                  border:`1.5px solid ${mfeDim===k?C.purple:C.border}`,
                  background:mfeDim===k?C.purple+'15':'transparent',
                  color:mfeDim===k?C.purple:C.textMut,fontWeight:mfeDim===k?700:400,
                }}>{d.label}</button>
              ))}
            </div>
            {rows.length>0?(<>
              <SortTable columns={[
                {key:'label',label:'Tag',align:'left',bold:true},
                {key:'avgMFE',label:'Avg MFE',fmt:v=>v?v.toFixed(1)+' pts':'—',color:()=>C.green,bold:true},
                {key:'avgMAE',label:'Avg MAE',fmt:v=>v?v.toFixed(1)+' pts':'—',color:()=>C.red,bold:true},
                {key:'capture',label:'Capture %',fmt:(v,r)=>r.mfeN?v.toFixed(0)+'%':'—',color:r=>r.capture>=60?C.green:r.capture>=40?C.yellow:C.red,bold:true},
                {key:'avgR',label:'R Captured',fmt:(v,r)=>r.rN?(v>=0?'+':'')+v.toFixed(2)+'R':'—',color:r=>r.avgR>=0?C.green:C.red},
                {key:'avgMfeR',label:'Max R Available',fmt:(v,r)=>r.mfeRN?v.toFixed(2)+'R':'—',color:()=>C.textSub},
                {key:'avgMissedR',label:'R Missed',fmt:(v,r)=>r.missedRN?v.toFixed(2)+'R':'—',color:r=>r.avgMissedR<=0.3?C.green:r.avgMissedR<=0.8?C.yellow:C.red,bold:true},
                {key:'mfeN',label:'N (with MFE)'},
                {key:'totalPnl',label:'PnL',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.totalPnl>=0?C.green:C.red},
              ]} rows={rows} defaultSort="capture" isMobile={isMobile}/>
              <div style={{marginTop:12,fontSize:11,color:C.textMut}}>R Missed = Max R Available − R Captured, averaged per trade. Green ≤0.3R, yellow ≤0.8R, red beyond that — the tags in red are where you're leaving the most edge on the table.</div>
            </>):(
              <div style={{color:C.textDim,fontSize:12,textAlign:'center',padding:'20px 0'}}>No {DIMENSIONS[mfeDim].label} tags on trades with MFE/MAE yet</div>
            )}
          </ChartCard>
        );
      })()}

      {/* ══ WHAT-IF ══ */}
      {section==='whatif'&&(()=>{
        const excluded=t=>{
          for(const key of Object.keys(DIMENSIONS)){
            const sel=exFilters[key];
            if(!sel||sel.length===0)continue;
            const v=DIMENSIONS[key].get(t);
            if(DIMENSIONS[key].multi){if((v||[]).some(x=>sel.includes(x)))return true;}
            else if(sel.includes(v))return true;
          }
          return false;
        };
        const kept=trades.filter(t=>!excluded(t));
        const removedN=trades.length-kept.length;
        const sA=computeStats(trades), sB=computeStats(kept);
        const toggle=(key,val)=>{
          const cur=exFilters[key]||[];
          setExFilters({...exFilters,[key]:cur.includes(val)?cur.filter(x=>x!==val):[...cur,val]});
        };
        const D=({label,a,b,fmt,invert})=>{
          const better=invert?b<a:b>a;
          return(
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}>
              <div style={{fontSize:10,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{label}</div>
              <div style={{fontSize:13,color:C.textSub}}>{fmt(a)} → <b style={{color:better?C.green:C.red,fontSize:16}}>{fmt(b)}</b></div>
            </div>
          );
        };
        return(
          <ChartCard title="What-If / Exclusion" sub="Select any tags to remove those trades — see the trader you'd be without them">
            {Object.entries(DIMENSIONS).map(([key,dim])=>{
              const vals=dimValues(trades,key);
              if(vals.length===0)return null;
              return(
                <div key={key} style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:5,fontWeight:700}}>{dim.label}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {vals.map(v=>{
                      const on=(exFilters[key]||[]).includes(v);
                      return <button key={v} onClick={()=>toggle(key,v)} style={{padding:'4px 11px',borderRadius:16,fontSize:11,fontFamily:'inherit',cursor:'pointer',border:`1.5px solid ${on?C.red:C.border}`,background:on?C.red+'15':'transparent',color:on?C.red:C.textMut,fontWeight:on?700:400}}>{pretty(v)}</button>;
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{fontSize:12,color:C.textSub,margin:'14px 0'}}>Removing <b style={{color:C.red}}>{removedN}</b> of {trades.length} trades</div>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(5,1fr)',gap:10,marginBottom:16}}>
              <D label="Net P&L" a={sA.totalPnl} b={sB.totalPnl} fmt={v=>(v>=0?'+':'')+'$'+v.toFixed(0)}/>
              <D label="Profit Factor" a={sA.profitFactor} b={sB.profitFactor} fmt={v=>v>=99?'∞':v.toFixed(2)}/>
              <D label="Expectancy" a={sA.expectancy} b={sB.expectancy} fmt={v=>(v>=0?'+':'')+'$'+v.toFixed(0)}/>
              <D label="Avg R" a={sA.avgR} b={sB.avgR} fmt={v=>(v>=0?'+':'')+v.toFixed(2)+'R'}/>
              <D label="Max Drawdown" a={sA.maxDD} b={sB.maxDD} fmt={v=>'-$'+v.toFixed(0)} invert/>
            </div>
            <SvgDualLine a={sA.equity} b={sB.equity} colA={C.textMut} colB={C.teal} labelA="Actual" labelB="What-if"/>
          </ChartCard>
        );
      })()}

      {/* ══ TRADE LOG ══ */}
      {section==='log'&&(
        <ChartCard title="All Trades" sub="Click any row to open that day and edit tags/notes">
          <SortTable columns={[
            {key:'date',label:'Date',align:'left',bold:true},
            {key:'ticker',label:'Inst',align:'left'},
            {key:'direction',label:'Dir',align:'left',fmt:v=>pretty(v)},
            {key:'setup',label:'Setup',align:'left',fmt:v=>pretty(v)},
            {key:'triggersStr',label:'Triggers',align:'left'},
            {key:'attempt',label:'Att.',fmt:v=>v==='—'?'—':pretty(v).replace('Entry ','E')},
            {key:'stContext',label:'ST',fmt:v=>v==='—'?'—':pretty(v).replace(' ST','')},
            {key:'htfContext',label:'HTF',fmt:v=>v==='—'?'—':pretty(v).replace(' HTF','')},
            {key:'openingType',label:'Open',fmt:v=>v==='—'?'—':v==='ir_iv'?'IR-IV':v==='ir_ov'?'IR-OV':'OR-OV'},
            {key:'balExtStr',label:'Balance Extreme',align:'left'},
            {key:'mDevStr',label:'M Dev Band',align:'left'},
            {key:'wDevStr',label:'W Dev Band',align:'left'},
            {key:'result',label:'R',fmt:v=>v,color:r=>r.result==='W'?C.green:r.result==='L'?C.red:C.yellow,bold:true},
            {key:'pnl',label:'Net PnL',fmt:v=>(v>=0?'+':'')+'$'+v.toFixed(0),color:r=>r.pnl>=0?C.green:C.red,bold:true},
            {key:'commission',label:'Comm.',fmt:v=>v?'-$'+v.toFixed(2):'—',color:()=>C.textMut},
            {key:'rawRR',label:'RR',fmt:(v,r)=>r.sl>0?(v>=0?'+':'')+v.toFixed(2)+'R':'—',color:r=>r.rawRR>=0?C.green:C.red},
            {key:'mfe',label:'MFE',fmt:v=>v?parseFloat(v).toFixed(1):'—',color:()=>C.green},
            {key:'mae',label:'MAE',fmt:v=>v?parseFloat(v).toFixed(1):'—',color:()=>C.red},
            {key:'entryTime',label:'Entry'},
          ]} rows={trades.map(t=>({...t,
            triggersStr:(t.triggers||[]).map(pretty).join(', ')||'—',
            balExtStr:(t.compositeBalanceExtreme||[]).map(pretty).join(', ')||'—',
            mDevStr:(t.mExtremeDevBand||[]).map(pretty).join(', ')||'—',
            wDevStr:(t.wExtremeDevBand||[]).map(pretty).join(', ')||'—',
            __onClick:()=>onJumpToDate&&onJumpToDate(t.date)}))} defaultSort="date" isMobile={isMobile}/>
        </ChartCard>
      )}
      </>)}
    </div>
  );
}

// ═══ Insight Engine ══════════════════════════════════════════════════════════
function insightsFor(trades){
  const out=[];
  if(trades.length<10)return out;
  const dims=['setup','trigger','htfContext','stContext','attempt','direction','session'];
  let best=null;
  for(let i=0;i<dims.length;i++)for(let j=i+1;j<dims.length;j++){
    groupByDims(trades,[dims[i],dims[j]],8).forEach(g=>{
      if(g.expectancy>0&&(!best||g.expectancy>best.expectancy))best=g;
    });
  }
  if(best)out.push({icon:'🎯',tone:'green',text:`${best.label} — ${best.winRate.toFixed(0)}% win rate, PF ${best.pf>=99?'∞':best.pf.toFixed(2)}, ${best.expectancy>=0?'+':''}$${best.expectancy.toFixed(0)}/trade over ${best.count} trades. Currently your strongest edge.`});
  let worst=null;
  groupByDims(trades,['setup'],5).concat(groupByDims(trades,['trigger'],5)).forEach(g=>{
    if(g.totalPnl<0&&(!worst||g.totalPnl<worst.totalPnl))worst=g;
  });
  if(worst)out.push({icon:'📉',tone:'red',text:`${worst.label} — $${worst.totalPnl.toFixed(0)} over ${worst.count} trades (${worst.winRate.toFixed(0)}% win rate, PF ${worst.pf.toFixed(2)}). Weakest tag right now.`});
  const seq=[...trades.filter(t=>['W','L','BE'].includes(t.result))].sort((a,b)=>(a.date+a.entryTime).localeCompare(b.date+b.entryTime));
  if(seq.length>=30){
    const cur=metricsFor(seq.slice(-20)), all=metricsFor(seq);
    const diff=cur.expectancy-all.expectancy;
    out.push({icon:diff>=0?'📈':'📉',tone:diff>=0?'green':'yellow',
      text:`Last 20: ${(cur.expectancy>=0?'+':'')}$${cur.expectancy.toFixed(0)}/trade vs ${(all.expectancy>=0?'+':'')}$${all.expectancy.toFixed(0)} lifetime (${diff>=0?'+':''}$${diff.toFixed(0)}).`});
  }
  return out.slice(0,3);
}

function InsightsCard({insights}){
  if(!insights.length)return null;
  const toneCol={green:C.green,red:C.red,yellow:C.yellow,orange:C.orange};
  return(
    <div style={{background:C.surface,border:`1px solid ${C.teal}33`,borderRadius:14,padding:'16px 18px',marginBottom:16}}>
      <div style={{fontSize:11,color:C.teal,textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:800,marginBottom:12}}>⚡ Insights</div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {insights.map((ins,i)=>(
          <div key={i} style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            <span style={{fontSize:14}}>{ins.icon}</span>
            <span style={{fontSize:12.5,color:C.text,lineHeight:1.6,borderLeft:`2px solid ${toneCol[ins.tone]||C.teal}`,paddingLeft:10}}>{ins.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ Chat markdown + chart rendering ═════════════════════════════════════════
function MiniChart({spec}){
  try{
    if(spec.type==='bar'&&Array.isArray(spec.series)){
      const rows=spec.series.map(s=>({label:s.label,val:parseFloat(s.value)||0}));
      const max=Math.max(...rows.map(r=>Math.abs(r.val)),1);
      return(
        <div style={{margin:'10px 0',padding:'12px 14px',background:C.bg,borderRadius:10,border:`1px solid ${C.border}`}}>
          {spec.title&&<div style={{fontSize:11,fontWeight:700,color:C.textSub,marginBottom:10}}>{spec.title}</div>}
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            {rows.map((r,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:120,fontSize:10.5,color:C.textSub,textAlign:'right',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.label}</div>
                <div style={{flex:1,height:12,background:C.surface2,borderRadius:4,overflow:'hidden'}}>
                  <div style={{width:Math.abs(r.val)/max*100+'%',height:'100%',background:r.val>=0?C.green:C.red,borderRadius:4}}/>
                </div>
                <div style={{width:56,fontSize:10.5,fontWeight:700,color:r.val>=0?C.green:C.red}}>{spec.unit==='$'?(r.val>=0?'+':'')+'$'+r.val.toFixed(0):r.val.toFixed(spec.unit==='%'?0:2)+(spec.unit==='%'?'%':'')}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if(spec.type==='line'&&Array.isArray(spec.points)){
      const series=spec.points.map((p,i)=>({date:String(p.label??i+1),val:parseFloat(p.value)||0}));
      return(
        <div style={{margin:'10px 0',padding:'12px 14px',background:C.bg,borderRadius:10,border:`1px solid ${C.border}`}}>
          {spec.title&&<div style={{fontSize:11,fontWeight:700,color:C.textSub,marginBottom:10}}>{spec.title}</div>}
          <SvgLineChart series={series} color={C.blue} height={140} fill={false}/>
        </div>
      );
    }
  }catch(_){}
  return null;
}

function mdInline(text,key){
  const parts=text.split(/\*\*(.+?)\*\*/g);
  return <span key={key}>{parts.map((p,i)=>i%2===1?<b key={i} style={{color:C.text}}>{p}</b>:p)}</span>;
}

function MDMessage({content}){
  const segments=[];
  const re=/```chart\s*\n?([\s\S]*?)```/g;
  let last=0,m;
  while((m=re.exec(content))!==null){
    if(m.index>last)segments.push({t:'text',v:content.slice(last,m.index)});
    segments.push({t:'chart',v:m[1]});
    last=m.index+m[0].length;
  }
  if(last<content.length)segments.push({t:'text',v:content.slice(last)});

  const render=[];
  segments.forEach((seg,si)=>{
    if(seg.t==='chart'){
      try{render.push(<MiniChart key={'c'+si} spec={JSON.parse(seg.v.trim())}/>);}catch(_){render.push(<pre key={'c'+si} style={{fontSize:11,color:C.textMut}}>{seg.v}</pre>);}
      return;
    }
    const lines=seg.v.split('\n');
    let i=0;
    while(i<lines.length){
      const line=lines[i];
      if(line.trim().startsWith('|')){
        const tbl=[];
        while(i<lines.length&&lines[i].trim().startsWith('|')){tbl.push(lines[i]);i++;}
        const rows=tbl.filter(l=>!/^\s*\|[\s\-:|]+\|\s*$/.test(l)).map(l=>l.split('|').slice(1,-1).map(c=>c.trim()));
        if(rows.length){
          render.push(
            <div key={'t'+si+'_'+i} style={{overflowX:'auto',margin:'10px 0'}}>
              <table style={{borderCollapse:'collapse',fontSize:12,minWidth:280}}>
                <thead><tr>{rows[0].map((c,ci)=><th key={ci} style={{textAlign:ci===0?'left':'right',padding:'6px 10px',color:C.textMut,fontSize:10,textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap'}}>{c}</th>)}</tr></thead>
                <tbody>{rows.slice(1).map((r,ri)=>(
                  <tr key={ri}>{r.map((c,ci)=>{
                    const neg=/^-\$|^-\d/.test(c), pos=/^\+/.test(c);
                    return <td key={ci} style={{textAlign:ci===0?'left':'right',padding:'6px 10px',borderBottom:`0.5px solid ${C.border}`,whiteSpace:'nowrap',color:neg?C.red:pos?C.green:C.text,fontVariantNumeric:'tabular-nums'}}>{c}</td>;
                  })}</tr>
                ))}</tbody>
              </table>
            </div>
          );
        }
        continue;
      }
      if(/^#{1,3}\s/.test(line.trim())){
        render.push(<div key={'h'+si+'_'+i} style={{fontSize:13,fontWeight:800,color:C.text,margin:'12px 0 4px'}}>{line.replace(/^#{1,3}\s/,'')}</div>);
        i++;continue;
      }
      // accumulate plain lines until next special
      const buf=[];
      while(i<lines.length&&!lines[i].trim().startsWith('|')&&!/^#{1,3}\s/.test(lines[i].trim())){buf.push(lines[i]);i++;}
      const txt=buf.join('\n');
      if(txt.trim())render.push(<div key={'p'+si+'_'+i} style={{whiteSpace:'pre-wrap'}}>{mdInline(txt,'m'+si+'_'+i)}</div>);
    }
  });
  return <div style={{fontSize:13,color:C.text,lineHeight:1.7}}>{render}</div>;
}

// ─── Ask Claude Tab ───────────────────────────────────────────────────────────
function weekId(d){const y=d.getFullYear();const start=new Date(y,0,1);return y+'-W'+Math.ceil(((d-start)/864e5+1)/7);}
function monthId(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}

function ClaudeTab({userId,isMobile}){
  const chatKey='journal_chat_'+(userId||'anon');
  const nameKey='journal_ai_name_'+(userId||'anon');
  const[assistantName,setAssistantName]=useState(()=>{
    try{return localStorage.getItem(nameKey)||'Claude';}catch(_){return 'Claude';}
  });
  const[editingName,setEditingName]=useState(false);
  const[nameDraft,setNameDraft]=useState(assistantName);
  const saveName=()=>{
    const n=(nameDraft||'Claude').trim().slice(0,24)||'Claude';
    setAssistantName(n);
    try{
      localStorage.setItem(nameKey,n);
      window.dispatchEvent(new CustomEvent('ai-name-changed',{detail:n}));
    }catch(_){}
    setEditingName(false);
  };

  // ── Usage tracking (rough local estimate, not exact billing) ──
  const usageKey='journal_usage_'+(userId||'anon');
  const curMonth=monthId(new Date());
  const[usage,setUsage]=useState(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(usageKey));
      if(saved&&saved.month===curMonth)return saved;
    }catch(_){}
    return{month:curMonth,messages:0,tokensIn:0,tokensOut:0,cacheWrite:0,cacheRead:0};
  });
  const recordUsage=(tokensIn,tokensOut,cacheWrite,cacheRead)=>{
    setUsage(prev=>{
      const base=prev.month===curMonth?prev:{month:curMonth,messages:0,tokensIn:0,tokensOut:0,cacheWrite:0,cacheRead:0};
      const next={
        month:curMonth,
        messages:base.messages+1,
        tokensIn:base.tokensIn+(tokensIn||0),
        tokensOut:base.tokensOut+(tokensOut||0),
        cacheWrite:(base.cacheWrite||0)+(cacheWrite||0),
        cacheRead:(base.cacheRead||0)+(cacheRead||0),
      };
      try{localStorage.setItem(usageKey,JSON.stringify(next));}catch(_){}
      return next;
    });
  };
  // Sonnet 5 pricing: $3/M input, $10/M output, $3.75/M cache write, $0.30/M
  // cache read. Once caching kicks in (2nd+ message in a session), most of
  // the big context block bills at the cache-read rate instead of full
  // input price — this is where the real savings from caching show up.
  const estCost=(usage.tokensIn/1e6*3)+(usage.tokensOut/1e6*10)+((usage.cacheWrite||0)/1e6*3.75)+((usage.cacheRead||0)/1e6*0.30);
  const cacheSavings=(usage.cacheRead||0)/1e6*(3-0.30); // rough $ saved vs paying full input rate for those tokens
  const[days,setDays]=useState(null);
  const[messages,setMessages]=useState(()=>{
    try{const saved=JSON.parse(localStorage.getItem(chatKey));return Array.isArray(saved)?saved:[];}catch(_){return[];}
  });
  const[input,setInput]=useState('');
  const[thinking,setThinking]=useState(false);
  const scrollRef=useRef();

  useEffect(()=>{
    let live=true;
    loadAllDays(userId).then(d=>{if(live)setDays(d);});
    return()=>{live=false;};
  },[userId]);

  useEffect(()=>{
    try{localStorage.setItem(chatKey,JSON.stringify(messages));}catch(_){}
  },[messages,chatKey]);

  useEffect(()=>{
    if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;
  },[messages,thinking]);

  // ── Conversation history (multiple saved threads, browsable) ──
  const historyKey='journal_chat_history_'+(userId||'anon');
  const[history,setHistory]=useState(()=>{
    try{const saved=JSON.parse(localStorage.getItem(historyKey));return Array.isArray(saved)?saved:[];}catch(_){return[];}
  });
  const[showHistory,setShowHistory]=useState(false);
  const saveHistoryList=(list)=>{
    setHistory(list);
    try{localStorage.setItem(historyKey,JSON.stringify(list));}catch(_){}
  };
  const deriveTitle=(msgs)=>{
    const firstUser=msgs.find(m=>m.role==='user');
    if(!firstUser)return 'Conversation';
    const t=firstUser.content.trim().replace(/\s+/g,' ');
    return t.length>44?t.slice(0,44)+'…':t;
  };
  const archiveCurrent=()=>{
    if(messages.length===0)return;
    const entry={id:Date.now().toString(),title:deriveTitle(messages),updatedAt:Date.now(),messages};
    saveHistoryList([entry,...history].slice(0,50)); // keep last 50 threads
  };
  const clearChat=()=>{
    if(messages.length&&!window.confirm('Start a new conversation? This one will be saved to History.'))return;
    archiveCurrent();
    setMessages([]);
    try{localStorage.removeItem(chatKey);}catch(_){}
  };
  const openHistoryItem=(item)=>{
    archiveCurrent();
    setMessages(item.messages);
    setShowHistory(false);
  };
  const deleteHistoryItem=(id,e)=>{
    e.stopPropagation();
    saveHistoryList(history.filter(h=>h.id!==id));
  };

  const now=new Date();
  const weeklyDue=now.getDay()>=5&&localStorage.getItem('wk_review')!==weekId(now);
  const dom=now.getDate();
  const moTarget=dom<=2?monthId(new Date(now.getFullYear(),now.getMonth()-1,15)):monthId(now);
  const monthlyDue=(dom>=28||dom<=2)&&localStorage.getItem('mo_review')!==moTarget;

  const buildContext=()=>{
    if(!days)return '';
    const trades=extractAllTrades(days);
    const s=computeStats(trades);
    // Pre-computed aggregates (ground truth)
    const agg={};
    Object.keys(DIMENSIONS).forEach(k=>{
      agg[k]=groupByDims(trades,[k],1).map(g=>({tag:g.label,n:g.count,pnl:Math.round(g.totalPnl),wr:Math.round(g.winRate),pf:g.pf>=99?'inf':+g.pf.toFixed(2),exp:Math.round(g.expectancy),avgR:g.rN?+g.avgR.toFixed(2):null,missedR:g.missedRN?+g.avgMissedR.toFixed(2):null}));
    });
    const topPivots=[];
    const dims=['setup','trigger','htfContext','stContext','attempt','direction','session'];
    for(let i=0;i<dims.length;i++)for(let j=i+1;j<dims.length;j++){
      groupByDims(trades,[dims[i],dims[j]],8).slice(0,3).forEach(g=>topPivots.push({combo:g.label,n:g.count,pnl:Math.round(g.totalPnl),wr:Math.round(g.winRate),pf:g.pf>=99?'inf':+g.pf.toFixed(2),exp:Math.round(g.expectancy)}));
    }
    topPivots.sort((a,b)=>b.exp-a.exp);
    const insights=insightsFor(trades).map(i=>i.text);

    // Raw trade lines are the one part of this context that grows unbounded
    // with history — cap to the most recent MAX_RAW trades so cost doesn't
    // keep climbing forever. Aggregates/stats above still cover the FULL
    // account regardless of this cap.
    const sortedTrades = [...trades].sort((a,b)=>(a.date+a.entryTime).localeCompare(b.date+b.entryTime));
    const MAX_RAW = 150;
    const rawSubset = sortedTrades.length > MAX_RAW ? sortedTrades.slice(-MAX_RAW) : sortedTrades;
    const tradeLines=rawSubset.map(t=>
      `${t.date}|${t.ticker}|${t.direction}|${t.setup}|${t.result}|${t.contracts}c|SL:${t.sl}|Pts:${t.points}|NetP&L:$${t.pnl.toFixed(0)}|Commission:$${(t.commission||0).toFixed(2)}|RR:${t.rawRR.toFixed(2)}|Entry:${t.entryTime}(${t.session}/${session3(t.entryTime)})|Attempt:${t.attempt}|Triggers:${t.triggers.join(',')}|ST:${t.stContext}|HTF:${t.htfContext}|Open:${t.openingType}|BalExt:${(t.compositeBalanceExtreme||[]).join(',')}|MDevBand:${(t.mExtremeDevBand||[]).join(',')}|WDevBand:${(t.wExtremeDevBand||[]).join(',')}|MFE:${t.mfe||0}|MAE:${t.mae||0}|Notes:${t.notes.slice(0,100)}`
    ).join('\n');
    const trimmedNote = sortedTrades.length > MAX_RAW
      ? `\n(Showing the most recent ${MAX_RAW} of ${sortedTrades.length} total trades. The aggregates and lifetime stats above cover the FULL account regardless. If asked about older trades specifically, say only the most recent ${MAX_RAW} are loaded here.)`
      : '';
    const reviews=days.filter(d=>d.data?.eod?.review).map(d=>`${d.date}: ${d.data.eod.review.slice(0,300)}`).join('\n');

    return `TRADER PROFILE: Futures day trader (ES/NQ via MES/MNQ micros on sim). System: Auction Market Theory, Market Profile, order flow. Trades 10:30-4pm EST after IB forms. Setups: BPB (break from value pullback), RPB (return to value pullback), ROT (rotational), Fade (reversal at extremes). Risk: $200/trade full, $100 half. Targeting Tradeify Select 50K eval ($3000 target, $2000 max DD, 40% consistency). Point values: ES=$50 NQ=$20 MES=$5 MNQ=$2. Points are TOTAL across contracts; SL/MFE/MAE are per contract.

LIFETIME STATS: ${s.totalTrades} closed | ${s.winRate.toFixed(1)}% WR | Net $${s.totalPnl.toFixed(0)} | PF ${s.profitFactor>=99?'inf':s.profitFactor.toFixed(2)} | Exp $${s.expectancy.toFixed(0)}/trade | MaxDD $${s.maxDD.toFixed(0)}

PRE-COMPUTED AGGREGATES (ground truth — use these numbers):
${JSON.stringify(agg)}

TOP PIVOT COMBOS (N>=8):
${JSON.stringify(topPivots.slice(0,12))}


CURRENT INSIGHTS:
${insights.join('\n')}

RAW TRADES (for custom filters/aggregations you compute yourself):
${tradeLines}${trimmedNote}

EOD REVIEWS:
${reviews}`;
  };

  const callClaude=async(newMessages)=>{
    setThinking(true);
    try{
      const res=await fetch('/api/claude',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          max_tokens:1400,
          system:`You are ${assistantName}, a ruthless-efficiency trading journal analytics engine. If asked your name, answer ${assistantName}.

NON-NEGOTIABLE (never break these, no matter how terse the response):
1. GROUNDING: Every number comes from PRE-COMPUTED AGGREGATES or is computed from RAW TRADES below. Never estimate or invent. Insufficient data → say "Insufficient data" + what's missing. Nothing more.
2. SAMPLE SIZE: State N for every stat. N<8 → append "⚠N=X" (compressed, not a sentence). Never drop this to save words.
3. SCOPE: If filters/refinements are active ("now only shorts", "last 30 days"), state them in one short line at the top — not the same as repeating the question, this prevents ambiguity about what the numbers cover. Never drop this either.

EFFICIENCY (apply everywhere else):
- Max token efficiency. Every word earns its place. Default: as short as possible while still answering.
- Never repeat the question. Never greet, close, encourage, or pad.
- Never narrate what you're about to do — just answer.
- Structured output (table/bullets/numbered) over paragraphs, always.
- Abbreviate freely once context is clear: RR, PnL, BE, SL, TP, R, WR, PF.
- One sentence or one table beats a paragraph, every time.
- Round aggressively (2.47R → 2.5R) unless the person asks for precision.
- Only answer what's asked — no volunteered extra analysis unless requested.
- Order: (1) direct answer, (2) key numbers as table/bullets, (3) one-line insight only if it adds real value, (4) stop.

CHARTS: when a visual genuinely helps, emit exactly one fenced block: \u0060\u0060\u0060chart\n{"type":"bar","title":"...","unit":"$","series":[{"label":"...","value":123}]}\n\u0060\u0060\u0060 (or {"type":"line","title":"...","points":[{"label":"...","value":123}]}). Valid JSON only, max 8 bars / 30 points.

REVIEWS: weekly/monthly review → NUMBERS ONLY: "## The Numbers" (table: Trades, W-L-BE, WR, Net PnL, PF, Expectancy, Best day, Worst day, Max DD), "## Strongest Tags" (top 3 by expectancy, with N), "## Weakest Tags" (bottom 3, with N). No psychology, no advice paragraphs.

HAND-OFF: if the question is genuinely open-ended strategic/conceptual discussion, or needs deep multi-angle reasoning that can't honestly compress into a table or a few lines (not just "has multiple parts" — most multi-part data questions still fit the efficient format above) — don't force it into a short answer. Instead reply with ONLY: "This needs more depth than fits here — ask Claude directly in your claude.ai chat for the full breakdown." One line, nothing else. Reserve this for real cases, not as a way to dodge normal analysis.

All trades are legitimate — analyze performance, not behavior.

${buildContext()}`,
          messages:newMessages,
        })
      });
      const json=await res.json();
      if(!res.ok){
        setMessages([...newMessages,{role:'assistant',content:'Error: '+(json.error||'Claude request failed ('+res.status+')')}]);
        setThinking(false);
        return;
      }
      const text=json.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n');
      setMessages([...newMessages,{role:'assistant',content:text||'Claude returned an empty response — try rephrasing the question.'}]);
      if(json.usage)recordUsage(json.usage.input_tokens,json.usage.output_tokens,json.usage.cache_creation_input_tokens,json.usage.cache_read_input_tokens);
    }catch(e){
      setMessages([...newMessages,{role:'assistant',content:'Error: could not reach the server — '+e.message}]);
    }
    setThinking(false);
  };

  const send=async()=>{
    if(!input.trim()||thinking)return;
    const nm=[...messages,{role:'user',content:input.trim()}];
    setMessages(nm);setInput('');
    await callClaude(nm);
  };

  const genReview=async(period)=>{
    if(thinking)return;
    const today=new Date();
    let from,to,label;
    if(period==='week'){
      const d=new Date(today);d.setDate(d.getDate()-d.getDay()+1);
      from=d.toLocaleDateString('en-CA');to=today.toLocaleDateString('en-CA');
      label=`weekly review (${from} → ${to})`;
      localStorage.setItem('wk_review',weekId(today));
    }else{
      const base=today.getDate()<=2?new Date(today.getFullYear(),today.getMonth()-1,15):today;
      from=new Date(base.getFullYear(),base.getMonth(),1).toLocaleDateString('en-CA');
      to=new Date(base.getFullYear(),base.getMonth()+1,0).toLocaleDateString('en-CA');
      label=`monthly review (${from} → ${to})`;
      localStorage.setItem('mo_review',monthId(base));
    }
    const nm=[...messages,{role:'user',content:`Generate my ${label}. Only use trades and EOD reviews dated within that range.`}];
    setMessages(nm);
    await callClaude(nm);
  };

  const suggestions=[
    'Profit factor of Absorption + Bearish HTF + Entry 3 last 60 days',
    'Strongest combinations with at least 10 trades',
    'ROT last 40 trades vs overall',
    'Equity curve if I exclude Entry 1 on Balanced Short Term',
    'Chart my P&L by entry trigger',
  ];

  return(
    <div style={{display:'flex',flexDirection:'column',height:isMobile?'calc(100vh - 220px)':'calc(100vh - 160px)'}}>
      {(weeklyDue||monthlyDue)&&(
        <div style={{background:C.teal+'10',border:`1px solid ${C.teal}40`,borderRadius:12,padding:'10px 14px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:C.text}}>📬 Your {weeklyDue?'weekly':'monthly'} review is ready to generate</span>
          <button onClick={()=>genReview(weeklyDue?'week':'month')} style={{padding:'7px 14px',borderRadius:9,border:'none',background:C.teal,color:'#fff',fontSize:12,fontFamily:'inherit',fontWeight:700,cursor:'pointer'}}>Generate now</button>
        </div>
      )}
      <div style={{display:'flex',gap:8,marginBottom:12,position:'relative'}}>
        <button onClick={()=>genReview('week')} disabled={thinking} style={{flex:1,padding:'9px',borderRadius:10,border:`1.5px solid ${C.border}`,background:'transparent',color:C.textSub,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600}}>📅 Weekly Review</button>
        <button onClick={()=>genReview('month')} disabled={thinking} style={{flex:1,padding:'9px',borderRadius:10,border:`1.5px solid ${C.border}`,background:'transparent',color:C.textSub,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600}}>🗓 Monthly Review</button>
        <button onClick={()=>setShowHistory(!showHistory)} title="Browse past conversations" style={{padding:'9px 14px',borderRadius:10,border:`1.5px solid ${showHistory?C.teal:C.border}`,background:showHistory?C.teal+'15':'transparent',color:showHistory?C.teal:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600}}>🕐 History{history.length>0?` (${history.length})`:''}</button>
        {messages.length>0&&<button onClick={clearChat} disabled={thinking} title="Start a new conversation" style={{padding:'9px 14px',borderRadius:10,border:`1.5px solid ${C.border}`,background:'transparent',color:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600}}>🗑 New</button>}
        {showHistory&&(
          <div style={{position:'absolute',top:'110%',right:0,left:isMobile?0:'auto',width:isMobile?'100%':380,maxHeight:400,overflowY:'auto',background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.25)',zIndex:20,padding:8}}>
            {history.length===0?(
              <div style={{padding:'20px 14px',textAlign:'center',fontSize:12,color:C.textMut}}>No past conversations yet. Hit "New" after chatting to save this one and start fresh.</div>
            ):history.map(h=>(
              <div key={h.id} onClick={()=>openHistoryItem(h)} style={{
                padding:'10px 12px',borderRadius:9,cursor:'pointer',marginBottom:4,
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,
              }}
                onMouseEnter={e=>e.currentTarget.style.background=C.surface2}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}
              >
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,color:C.text,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.title}</div>
                  <div style={{fontSize:10,color:C.textMut,marginTop:2}}>{new Date(h.updatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})} · {h.messages.length} messages</div>
                </div>
                <span onClick={e=>deleteHistoryItem(h.id,e)} title="Delete" style={{color:C.textMut,fontSize:14,cursor:'pointer',flexShrink:0,padding:'2px 6px'}}>×</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {usage.messages>0&&(
        <div style={{fontSize:11,color:C.textMut,marginBottom:12,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <span>📊 This month: <b style={{color:C.textSub}}>{usage.messages}</b> message{usage.messages!==1?'s':''} · ~<b style={{color:C.textSub}}>{(usage.tokensIn+usage.tokensOut).toLocaleString()}</b> tokens · ~<b style={{color:estCost>1?C.yellow:C.textSub}}>${estCost.toFixed(3)}</b>{cacheSavings>0.001&&<span style={{color:C.green}}> · saved ~${cacheSavings.toFixed(3)} via caching</span>}</span>
          <span style={{color:C.textDim}}>· estimate — exact billing at console.anthropic.com</span>
        </div>
      )}
      <div ref={scrollRef} style={{flex:1,overflowY:'auto',paddingBottom:16}}>
        {messages.length===0&&(
          <div style={{textAlign:'center',padding:'30px 20px'}}>
            <div style={{fontSize:32,marginBottom:12}}>🤖</div>
            {editingName?(
              <div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:6}}>
                <input autoFocus value={nameDraft} onChange={e=>setNameDraft(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter')saveName();if(e.key==='Escape'){setNameDraft(assistantName);setEditingName(false);}}}
                  style={{padding:'6px 10px',borderRadius:8,border:`1.5px solid ${C.teal}`,background:C.bg,color:C.text,fontSize:14,fontFamily:'inherit',outline:'none',textAlign:'center',width:160}}/>
                <button onClick={saveName} style={{padding:'6px 12px',borderRadius:8,border:'none',background:C.teal,color:'#fff',fontSize:12,fontFamily:'inherit',fontWeight:700,cursor:'pointer'}}>Save</button>
              </div>
            ):(
              <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:6}}>
                Ask {assistantName} anything about your data
                <span onClick={()=>{setNameDraft(assistantName);setEditingName(true);}} title="Rename" style={{marginLeft:8,fontSize:11,color:C.textMut,cursor:'pointer',fontWeight:400,textDecoration:'underline'}}>rename</span>
              </div>
            )}
            <div style={{fontSize:12,color:C.textMut,marginBottom:24,lineHeight:1.6}}>Grounded in your real Supabase trades — with tables, charts,<br/>sample-size warnings, and follow-up refinement.</div>
            <div style={{display:'flex',flexDirection:'column',gap:8,maxWidth:420,margin:'0 auto'}}>
              {suggestions.map((sg,i)=>(
                <button key={i} onClick={()=>setInput(sg)} style={{
                  padding:'10px 16px',borderRadius:12,border:`1px solid ${C.border}`,
                  background:C.surface,color:C.textSub,fontSize:12,fontFamily:'inherit',
                  cursor:'pointer',textAlign:'left',
                }}>{sg}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m,i)=>{
          const isHandoff = m.role==='assistant' && /ask Claude directly in your claude\.ai chat/i.test(m.content);
          const originalQuestion = isHandoff && i>0 ? messages[i-1].content : null;
          return(
          <div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',marginBottom:12}}>
            <div style={{
              maxWidth:'90%',padding:'12px 16px',borderRadius:14,
              background:m.role==='user'?C.teal+'20':C.surface,
              border:`1px solid ${m.role==='user'?C.teal+'40':C.border}`,
            }}>
              {m.role==='user'?<div style={{fontSize:13,color:C.text,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{m.content}</div>:<MDMessage content={m.content}/>}
              {isHandoff && originalQuestion && (
                <button onClick={()=>{
                  try{navigator.clipboard.writeText(originalQuestion);}catch(_){}
                  window.open('https://claude.ai/new?q='+encodeURIComponent(originalQuestion), '_blank');
                }} style={{
                  marginTop:10,padding:'8px 14px',borderRadius:9,border:`1.5px solid ${C.teal}`,
                  background:C.teal+'15',color:C.teal,fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer',
                }}>↗ Open in Claude (question copied — paste if it's not already there)</button>
              )}
            </div>
          </div>
          );
        })}
        {thinking&&(
          <div style={{display:'flex',justifyContent:'flex-start',marginBottom:12}}>
            <div style={{padding:'12px 16px',borderRadius:14,background:C.surface,border:`1px solid ${C.border}`,fontSize:13,color:C.textMut}}>Computing from your data...</div>
          </div>
        )}
      </div>
      <div style={{display:'flex',gap:8,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder='Ask, then refine: "now only shorts", "last 30 days", "exclude Entry 1"...'
          rows={1}
          style={{flex:1,padding:'12px 16px',borderRadius:12,border:`1.5px solid ${C.border}`,
            background:C.surface,color:C.text,fontSize:13,fontFamily:'inherit',outline:'none',resize:'none'}}/>
        <button onClick={send} disabled={thinking||!input.trim()} style={{
          padding:'0 20px',borderRadius:12,border:'none',
          background:thinking||!input.trim()?C.surface:C.teal,
          color:thinking||!input.trim()?C.textMut:'#fff',
          fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:thinking||!input.trim()?'not-allowed':'pointer',
        }}>Send</button>
      </div>
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
      <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:'18px 18px 0 0',padding:'22px 18px 36px',width:'100%',maxWidth:560}}>
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

// ─── Root ─────────────────────────────────────────────────────────────────────
// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen(){
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[mode,setMode]=useState('login'); // 'login'|'signup'
  const[error,setError]=useState('');
  const[loading,setLoading]=useState(false);

  const handle=async()=>{
    if(!email||!password){setError('Enter email and password.');return;}
    setLoading(true);setError('');
    const{error:err}=mode==='login'?await signIn(email,password):await signUp(email,password);
    setLoading(false);
    if(err)setError(err.message);
  };

  return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter',sans-serif",padding:20}}>
      <div style={{width:'100%',maxWidth:380,background:C.surface,borderRadius:20,padding:'36px 32px',border:`1px solid ${C.border}`}}>
        <div style={{fontSize:22,fontWeight:800,color:C.text,marginBottom:4}}>Trading Journal</div>
        <div style={{fontSize:13,color:C.textMut,marginBottom:32}}>{mode==='login'?'Sign in to your account':'Create a new account'}</div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:C.textSub,marginBottom:6,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em'}}>Email</div>
          <input
            type="email" value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handle()}
            placeholder="you@email.com"
            style={{width:'100%',padding:'11px 14px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,fontFamily:'inherit',outline:'none'}}
          />
        </div>
        <div style={{marginBottom:22}}>
          <div style={{fontSize:11,color:C.textSub,marginBottom:6,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em'}}>Password</div>
          <input
            type="password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handle()}
            placeholder="••••••••"
            style={{width:'100%',padding:'11px 14px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,fontFamily:'inherit',outline:'none'}}
          />
        </div>

        {error&&<div style={{fontSize:12,color:C.red,marginBottom:14,padding:'8px 12px',background:C.red+'15',borderRadius:8}}>{error}</div>}

        <button onClick={handle} disabled={loading} style={{
          width:'100%',padding:'13px',borderRadius:12,
          background:loading?C.surface:C.blue,border:'none',
          color:'#fff',fontSize:14,fontFamily:'inherit',fontWeight:700,
          cursor:loading?'not-allowed':'pointer',marginBottom:16,
          opacity:loading?0.6:1,transition:'all 0.15s',
        }}>{loading?'...':(mode==='login'?'Sign In':'Create Account')}</button>

        <div style={{textAlign:'center',fontSize:13,color:C.textMut}}>
          {mode==='login'?'No account? ':'Have an account? '}
          <span onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('');}} style={{color:C.blue,cursor:'pointer',fontWeight:600}}>
            {mode==='login'?'Sign up':'Sign in'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const today=todayStr();
  const isMobile=useIsMobile();
  const[user,setUser]=useState(null);
  const[authLoading,setAuthLoading]=useState(true);
  const[selectedDate,setSelectedDate]=useState(today);
  const[tab,setTab]=useState(0);
  const[dayData,setDayData]=useState(null);
  const[index,setIndex]=useState({});
  const[loading,setLoading]=useState(true);
  const[saveStatus,setSaveStatus]=useState('idle');
  const [theme,setTheme]=useState(initialTheme());
  applyTheme(theme);
  useEffect(()=>{applyTheme(theme);try{localStorage.setItem('journal_theme',theme);}catch(_){}},[theme]);
  const [aiName,setAiName]=useState('Claude');
  useEffect(()=>{
    const key='journal_ai_name_'+(user?.id||'anon');
    try{setAiName(localStorage.getItem(key)||'Claude');}catch(_){setAiName('Claude');}
  },[user,tab]);
  useEffect(()=>{
    const onRename=e=>setAiName(e.detail||'Claude');
    window.addEventListener('ai-name-changed',onRename);
    return()=>window.removeEventListener('ai-name-changed',onRename);
  },[]);
  const[showCal,setShowCal]=useState(false);
  const saveTimer=useRef(null);

  // Auth state listener
  useEffect(()=>{
    getCurrentUser().then(u=>{setUser(u);setAuthLoading(false);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user||null);
    });
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{if(user)loadIndex(user.id).then(idx=>setIndex(idx||{}));},[user]);
  useEffect(()=>{
    if(!user)return;
    setLoading(true);
    loadDay(selectedDate,user.id).then(d=>{setDayData(d||emptyDay());setLoading(false);});
  },[selectedDate,user]);

  useEffect(()=>{
    if(!dayData||loading||!user)return;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      await saveDay(selectedDate,dayData,user.id);
      const trades=dayData.trades||[];
      const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points)-(parseFloat(t.commission)||0),0);
      const esPts=trades.filter(t=>['ES','MES'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
      const nqPts=trades.filter(t=>['NQ','MNQ'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
      const wins=trades.filter(t=>t.result==='W').length;
      const summary={
        pnl:total,esPts,nqPts,wins,trades:trades.length,
        bias:dayData.pre?.dailyBias||'',
      };
      await saveIndex(selectedDate,summary,user.id);
      setIndex(prev=>({...prev,[selectedDate]:summary}));
      setSaveStatus('saved');
      setTimeout(()=>setSaveStatus('idle'),3000);
    },1000);
    return()=>clearTimeout(saveTimer.current);
  },[dayData]);

  const updateTrades=trades=>setDayData(d=>({...d,trades}));
  const updateEod=eod=>setDayData(d=>({...d,eod}));

  const goDay=(offset)=>{
    const d=new Date(selectedDate+'T12:00:00');
    d.setDate(d.getDate()+offset);
    setSelectedDate(d.toLocaleDateString('en-CA'));
    setTab(0);
  };

  const isToday=selectedDate===today;
  const dayIdx=index[selectedDate];
  const sideW=260;

  // Auth loading
  if(authLoading) return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter',sans-serif"}}>
      <div style={{color:C.textMut,fontSize:14}}>Loading...</div>
    </div>
  );

  // Login screen
  if(!user) return <LoginScreen/>;

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

      <div style={{maxWidth:'100%',margin:'0 auto',display:isMobile?'block':'flex',minHeight:'100vh'}}>

        {/* Desktop Sidebar */}
        {!isMobile&&(
          <div style={{width:sideW,flexShrink:0,borderRight:`1px solid ${C.surface2}`,padding:'28px 20px',display:'flex',flexDirection:'column',gap:24,position:'sticky',top:0,height:'100vh',overflowY:'auto'}}>
            <div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.14em',textTransform:'uppercase',marginBottom:6}}>Trading Journal</div>
              <div style={{fontSize:24,fontWeight:800,color:C.text}}>📈</div>
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{fontSize:12,color:saveStatus==='saving'?C.yellow:saveStatus==='saved'?C.green:C.textDim}}>
                {saveStatus==='saving'?'● Saving...':saveStatus==='saved'?'✓ Saved':'○ Auto-save on'}
              </div>
              <button onClick={()=>setTheme(theme==='dark'?'light':'dark')} title="Toggle light / dark" style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:34,height:30,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>{theme==='dark'?'☀️':'🌙'}</button>
            </div>
            <div style={{marginTop:'auto',paddingTop:16,borderTop:`1px solid ${C.border}`}}>
              
              <button onClick={signOut} style={{width:'100%',padding:'8px',borderRadius:8,background:'transparent',border:`1px solid ${C.border}`,color:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Sign out</button>
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
                    {i===0?'📊 ':i===1?'📈 ':'🤖 '}{i===2?aiName:t}
                  </button>
                ))}
              </div>
            </div>
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
                  <button onClick={()=>setTheme(theme==='dark'?'light':'dark')} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:30,height:28,cursor:'pointer',fontSize:13}}>{theme==='dark'?'☀️':'🌙'}</button>
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
                {tab===0?'📊 Trades':tab===1?'📈 Analytics':'🤖 Ask Claude'}
              </div>
              <div style={{fontSize:14,color:C.textMut}}>{fmtDate(selectedDate)}{isToday?' · Today':''}</div>
            </div>
          )}

          {loading?(
            <div style={{textAlign:'center',color:C.textMut,fontSize:13,padding:'60px 0'}}>Loading...</div>
          ):(
            <>
              {tab===0&&<TradesTab trades={dayData.trades} onChange={updateTrades} eod={dayData.eod} onEodChange={updateEod} date={selectedDate} isMobile={isMobile} userId={user?.id} onJumpToDate={d=>setSelectedDate(d)}/>}
              {tab===1&&<AnalyticsTab userId={user?.id} isMobile={isMobile} onJumpToDate={d=>{setSelectedDate(d);setTab(0);}}/>}
              {tab===2&&<ClaudeTab userId={user?.id} isMobile={isMobile}/>}
            </>
          )}
        </div>
      </div>
      {showCal&&<CalendarModal selectedDate={selectedDate} onSelect={d=>{setSelectedDate(d);setTab(0);}} onClose={()=>setShowCal(false)} index={index}/>}
    </div>
  );
}
