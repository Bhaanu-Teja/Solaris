/* ============================================================
   SOLARIS v2 — script.js  (main orchestrator)
   Haskell patterns: Lazy Streams · STM TVars · Pure Fn · ADTs
   ============================================================ */
'use strict';

/* ── Lazy Engine ──────────────────────────────────────────── */
const Lazy = (() => {
    const thunk = fn => { let d=false,v; return ()=>{ if(!d){v=fn();d=true;} return v; }; };
    const stream = (h,tf) => ({ head:h, tail:thunk(tf) });
    const take = (n,s) => { const r=[]; let c=s; for(let i=0;i<n&&c;i++){r.push(c.head);c=c.tail();} return r; };
    const map  = (fn,s) => stream(fn(s.head), ()=>map(fn,s.tail()));
    return { thunk, stream, take, map };
})();

/* ── STM ──────────────────────────────────────────────────── */
class TVar {
    constructor(v){ this._v=v; this._s=new Set(); }
    read(){ return this._v; }
    write(v){ const o=this._v; this._v=v; this._s.forEach(f=>f(v,o)); }
    subscribe(f){ this._s.add(f); return ()=>this._s.delete(f); }
}
const atomically = async fn => { try{ return await fn(); } catch(e){ console.error('[STM]',e); throw e; } };

/* ── ADTs ─────────────────────────────────────────────────── */
const Status = Object.freeze({ NOMINAL:'NOMINAL', WARNING:'WARNING', CRITICAL:'CRITICAL', OFFLINE:'OFFLINE', PEAK:'PEAK' });
const Weather = Object.freeze({ CLEAR:'CLEAR', PARTLY:'PARTLY_CLOUDY', OVERCAST:'OVERCAST', RAIN:'RAIN', STORM:'STORM' });

/* ── State ────────────────────────────────────────────────── */
const AppState = {
    nodes:   new TVar([]),
    weather: new TVar([]),
    updated: new TVar(null),
};

/* ── Locations ────────────────────────────────────────────── */
const LOCS = [
    { name:'San Francisco', lat:37.7749,  lng:-122.4194 },
    { name:'New York',      lat:40.7128,  lng:-74.0060  },
    { name:'London',        lat:51.5074,  lng:-0.1278   },
    { name:'Tokyo',         lat:35.6762,  lng:139.6503  },
    { name:'Sydney',        lat:-33.8688, lng:151.2093  },
    { name:'Mumbai',        lat:19.0760,  lng:72.8777   },
    { name:'Cairo',         lat:30.0444,  lng:31.2357   },
    { name:'Moscow',        lat:55.7558,  lng:37.6173   },
];

/* ── Solar Physics (pure functions) ───────────────────────── */
const Physics = (() => {
    const elev = (lat,lng,now) => {
        const doy  = Math.floor((now - new Date(now.getFullYear(),0,0))/86400000);
        const decl = 23.45*Math.sin((2*Math.PI/365)*(doy-81))*Math.PI/180;
        const ha   = ((now.getUTCHours()+now.getUTCMinutes()/60+lng/15)-12)*15*Math.PI/180;
        const latR = lat*Math.PI/180;
        const s    = Math.sin(latR)*Math.sin(decl)+Math.cos(latR)*Math.cos(decl)*Math.cos(ha);
        return Math.max(0, Math.asin(s)*180/Math.PI);
    };
    const irr = (e,cloud) => {
        if(e<=0) return 0;
        const am  = 1/(Math.sin(e*Math.PI/180)+0.50572*Math.pow(e+6.07995,-1.6364));
        const dni = 1353*Math.pow(0.7,Math.pow(am,0.678));
        return Math.max(0, dni*Math.sin(e*Math.PI/180)*(1-(cloud/100)*0.75));
    };
    const pwr = (i,area,eff,temp) => Math.max(0,(i*area*(eff/100)*(1+(-0.004)*(temp-25)))/1000);
    const profile24 = (lat,lng,cloud) => Array.from({length:24},(_,h)=>{
        const d=new Date(); d.setUTCHours(h,0,0,0);
        return Math.round(irr(elev(lat,lng,d),cloud));
    });
    return { elev, irr, pwr, profile24 };
})();

/* ── Data Engine ──────────────────────────────────────────── */
const DataEngine = {
    fetchAll: () => {
        const now=new Date(), wx=AppState.weather.read();
        const sim=typeof ControlPanel!=='undefined'?ControlPanel.getSimParams():null;
        return LOCS.map((loc,i) => {
            const w      = wx[i];
            const online = typeof ControlPanel!=='undefined'?ControlPanel.isNodeOnline(loc.name):true;
            let cloud = w?w.cloudCover:10+Math.random()*60;
            let temp  = w?w.temperature:15+Math.random()*25;
            if(sim){ cloud=sim.cloud; temp=sim.temp; }
            const e  = Physics.elev(loc.lat,loc.lng,now);
            let   ir = Physics.irr(e,cloud);
            if(sim) ir*=sim.irrMult;
            const pw = online?Physics.pwr(ir,200,22.5,temp):0;
            const ep = Physics.pwr(ir,200,22.5,temp);
            const st = !online?Status.OFFLINE:ir>900?Status.PEAK:ir>100?Status.NOMINAL:pw>0?Status.WARNING:Status.OFFLINE;
            const wc = cloud<15?Weather.CLEAR:cloud<40?Weather.PARTLY:cloud<70?Weather.OVERCAST:cloud<90?Weather.RAIN:Weather.STORM;
            const wIcon = w&&typeof WeatherAPI!=='undefined'?WeatherAPI.wmoToIcon(w.weatherCode||0).icon:'☀';
            return { name:loc.name, lat:loc.lat, lng:loc.lng,
                irradiance:Math.round(ir), temperature:Math.round(temp*10)/10,
                cloudCover:Math.round(cloud), power:Math.round(pw*100)/100,
                voltage:390+Math.random()*20, current:10+Math.random()*5,
                efficiency:Math.round((22.5+(Math.random()-0.5)*2)*100)/100,
                status:st, weatherCond:wc, online, _expectedPower:ep,
                weatherIcon:wIcon };
        });
    },
    forecastStream: (lat,lng) => {
        let h=0;
        const g=()=>{ const d=new Date(); d.setHours(d.getHours()+(h++)); const c=10+Math.random()*60; const e=Physics.elev(lat,lng,d); const i=Physics.irr(e,c); return {hour:d,irr:i,power:Physics.pwr(i,200,22.5)}; };
        return Lazy.stream(g(),g);
    }
};

/* ── Chart theme ──────────────────────────────────────────── */
const CT = { grid:'rgba(255,204,0,0.05)', tick:'#3D4F66', leg:'#7A8BA8', gold:'#FFCC00', amber:'#FF9900', green:'#00FF9F', blue:'#00C8FF', red:'#FF3B3B', mono:"'JetBrains Mono',monospace", disp:"'Orbitron',monospace" };
const baseOpts = () => ({
    responsive:true, maintainAspectRatio:false, animation:{duration:600},
    interaction:{intersect:false,mode:'index'},
    plugins:{
        legend:{labels:{color:CT.leg,font:{family:CT.mono,size:9},boxWidth:10}},
        tooltip:{backgroundColor:'rgba(6,11,20,0.96)',borderColor:'rgba(255,204,0,0.3)',borderWidth:1,titleColor:CT.gold,bodyColor:'#B0C4DE',titleFont:{family:CT.disp,size:10},bodyFont:{family:CT.mono,size:9},padding:10,cornerRadius:6}
    },
    scales:{
        x:{grid:{color:CT.grid},ticks:{color:CT.tick,font:{family:CT.mono,size:9}},border:{color:'rgba(255,204,0,0.08)'}},
        y:{grid:{color:CT.grid},ticks:{color:CT.tick,font:{family:CT.mono,size:9}},border:{color:'rgba(255,204,0,0.08)'}}
    }
});

/* ── Charts ───────────────────────────────────────────────── */
const Charts = {};
const initCharts = () => {
    const mk=(id,type,data,opts)=>{ const el=document.getElementById(id); return el?new Chart(el,{type,data,options:opts}):null; };
    Charts.irr = mk('irradianceCanvas','line',{ labels:Array.from({length:24},(_,i)=>`${String(i).padStart(2,'0')}:00`), datasets:LOCS.slice(0,4).map((l,i)=>({label:l.name,data:Array(24).fill(0),borderColor:[CT.gold,CT.amber,CT.blue,CT.green][i],backgroundColor:['rgba(255,204,0,0.07)','rgba(255,153,0,0.05)','rgba(0,200,255,0.05)','rgba(0,255,159,0.04)'][i],borderWidth:1.5,tension:0.4,fill:true,pointRadius:0})) }, baseOpts());
    Charts.gen = mk('generationCanvas','bar',{ labels:LOCS.map(l=>l.name.split(' ')[0]), datasets:[{label:'Output (kW)',data:Array(8).fill(0),backgroundColor:LOCS.map((_,i)=>`hsla(${42-i*3},100%,${65-i*3}%,0.85)`),borderRadius:4,borderSkipped:false}] }, {...baseOpts(),scales:{...baseOpts().scales,x:{...baseOpts().scales.x,grid:{display:false}}}});
    Charts.eff = mk('efficiencyCanvas','radar',{ labels:LOCS.map(l=>l.name.split(' ')[0]), datasets:[{label:'Efficiency %',data:Array(8).fill(22.5),borderColor:CT.gold,backgroundColor:'rgba(255,204,0,0.07)',borderWidth:1.5,pointBackgroundColor:CT.gold,pointRadius:3},{label:'Target',data:Array(8).fill(25),borderColor:'rgba(0,200,255,0.3)',backgroundColor:'rgba(0,200,255,0.02)',borderWidth:1,borderDash:[4,4],pointRadius:0}] },{responsive:true,maintainAspectRatio:false,animation:{duration:600},plugins:{legend:{labels:{color:CT.leg,font:{family:CT.mono,size:9},boxWidth:8}},tooltip:baseOpts().plugins.tooltip},scales:{r:{grid:{color:'rgba(255,204,0,0.07)'},angleLines:{color:'rgba(255,204,0,0.07)'},ticks:{color:CT.tick,font:{family:CT.mono,size:8},backdropColor:'transparent'},pointLabels:{color:CT.leg,font:{family:CT.mono,size:8}}}}});
    Charts.anom = mk('anomalyCanvas','bar',{ labels:LOCS.map(l=>l.name.split(' ')[0]), datasets:[{label:'Expected (kW)',data:Array(8).fill(0),backgroundColor:'rgba(0,200,255,0.35)',borderRadius:3},{label:'Actual (kW)',data:Array(8).fill(0),backgroundColor:'rgba(255,204,0,0.75)',borderRadius:3}] },{...baseOpts(),scales:{...baseOpts().scales,x:{...baseOpts().scales.x,grid:{display:false}}}});
    Charts.cloud = mk('cloudCanvas','doughnut',{ labels:['Clear','Partly','Overcast','Rain'], datasets:[{data:[3,3,1,1],backgroundColor:['rgba(255,204,0,0.85)','rgba(255,153,0,0.7)','rgba(0,200,255,0.6)','rgba(155,93,229,0.6)'],borderColor:'#060B14',borderWidth:2,hoverOffset:4}] },{responsive:true,maintainAspectRatio:false,cutout:'68%',animation:{duration:600},plugins:{legend:{position:'bottom',labels:{color:CT.leg,font:{family:CT.mono,size:9},padding:10,boxWidth:8}},tooltip:baseOpts().plugins.tooltip}});
    const fL=Array.from({length:72},(_,i)=>{ const d=new Date(); d.setHours(d.getHours()+i); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}h`; });
    Charts.forecast = mk('forecastCanvas','line',{ labels:fL, datasets:[{label:'Predicted (MW)',data:Array(72).fill(0),borderColor:CT.gold,backgroundColor:'rgba(255,204,0,0.08)',borderWidth:2,tension:0.4,fill:true,pointRadius:0},{label:'Upper',data:Array(72).fill(0),borderColor:'rgba(255,204,0,0.2)',backgroundColor:'rgba(255,204,0,0.03)',borderWidth:1,borderDash:[4,4],tension:0.4,fill:'-1',pointRadius:0},{label:'Lower',data:Array(72).fill(0),borderColor:'rgba(255,204,0,0.2)',backgroundColor:'transparent',borderWidth:1,borderDash:[4,4],tension:0.4,fill:false,pointRadius:0}] }, baseOpts());
};

/* ── Live Strip ───────────────────────────────────────────── */
const LiveStrip = (() => {
    let cv,ctx,buf=[]; const N=200;
    const init=()=>{ cv=document.getElementById('liveStripCanvas'); if(!cv)return; ctx=cv.getContext('2d'); const r=()=>{ cv.width=cv.offsetWidth*devicePixelRatio; cv.height=cv.offsetHeight*devicePixelRatio; ctx.scale(devicePixelRatio,devicePixelRatio); }; r(); window.addEventListener('resize',r); };
    const push=v=>{ buf.push(v); if(buf.length>N)buf.shift(); };
    const draw=()=>{ if(!ctx||buf.length<2)return; const w=cv.offsetWidth,h=cv.offsetHeight; ctx.clearRect(0,0,w,h); const mx=Math.max(...buf,0.1),st=w/(N-1); const g=ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,'rgba(255,204,0,0.35)'); g.addColorStop(1,'rgba(255,204,0,0)'); ctx.beginPath(); ctx.moveTo(0,h); buf.forEach((v,i)=>{ const x=(N-buf.length+i)*st,y=h-(v/mx)*(h-4); ctx.lineTo(x,y); }); ctx.lineTo(w,h); ctx.closePath(); ctx.fillStyle=g; ctx.fill(); ctx.beginPath(); buf.forEach((v,i)=>{ const x=(N-buf.length+i)*st,y=h-(v/mx)*(h-4); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }); ctx.strokeStyle='rgba(255,204,0,0.9)'; ctx.lineWidth=1.5; ctx.stroke(); const lx=(N-1)*st,ly=h-(buf[buf.length-1]/mx)*(h-4); ctx.beginPath(); ctx.arc(lx,ly,3,0,Math.PI*2); ctx.fillStyle='#FFCC00'; ctx.shadowColor='#FFCC00'; ctx.shadowBlur=8; ctx.fill(); ctx.shadowBlur=0; };
    return { init, push, draw };
})();

/* ── Node Renderer ────────────────────────────────────────── */
const NodeRenderer = (() => {
    const sc=s=>({[Status.NOMINAL]:'#00FF9F',[Status.WARNING]:'#FF9900',[Status.CRITICAL]:'#FF3B3B',[Status.OFFLINE]:'#3D4F66',[Status.PEAK]:'#00C8FF'}[s]||'#7A8BA8');
    const hist={};
    const render=(nodes,filter='all')=>{
        const grid=document.getElementById('nodesGrid'); if(!grid)return;
        let f=nodes;
        if(filter==='high')   f=nodes.filter(n=>n.power>=5);
        if(filter==='alerts') f=nodes.filter(n=>n.status===Status.WARNING||n.status===Status.CRITICAL);
        if(filter==='offline')f=nodes.filter(n=>!n.online||n.status===Status.OFFLINE);
        nodes.forEach(n=>{ if(!hist[n.name])hist[n.name]=[]; hist[n.name].push(n.power); if(hist[n.name].length>40)hist[n.name].shift(); });
        grid.innerHTML=f.map((n,i)=>{ const c=sc(n.status); const t=(Math.random()-0.4)*12; return `<div class="node-card ${n.status===Status.WARNING||n.status===Status.CRITICAL?'alert':''} ${!n.online?'node-offline':''}" style="animation-delay:${i*50}ms"><div class="node-header"><span class="node-name">${n.name}</span><span class="node-status" style="color:${c}"><span class="status-dot" style="background:${c};box-shadow:0 0 8px ${c}40"></span>${n.status}</span></div><div class="node-power">${n.power.toFixed(2)}<span> kW</span></div><div class="node-trend ${t>=0?'up':'down'}">${t>=0?'↑':'↓'} ${Math.abs(t).toFixed(1)}%</div><div class="node-metrics"><div class="node-metric"><span class="nm-label">IRRADIANCE</span><span class="nm-value">${n.irradiance}<small> W/m²</small></span></div><div class="node-metric"><span class="nm-label">TEMP</span><span class="nm-value">${n.temperature}°C</span></div><div class="node-metric"><span class="nm-label">WEATHER</span><span class="nm-value" style="font-size:20px">${n.weatherIcon||'☀'}</span></div><div class="node-metric"><span class="nm-label">CLOUD</span><span class="nm-value">${n.cloudCover}%</span></div><div class="node-metric"><span class="nm-label">VOLTAGE</span><span class="nm-value">${(n.voltage||0).toFixed(0)}V</span></div><div class="node-metric"><span class="nm-label">EFF</span><span class="nm-value">${(n.efficiency||0).toFixed(1)}%</span></div></div><div class="node-sparkline"><canvas id="sp-${n.name.replace(/\s/g,'_')}"></canvas></div></div>`; }).join('');
        requestAnimationFrame(()=>f.forEach(n=>{ const el=document.getElementById(`sp-${n.name.replace(/\s/g,'_')}`); if(!el)return; const h2=hist[n.name]||[]; if(h2.length<2)return; el.width=el.offsetWidth*devicePixelRatio; el.height=el.offsetHeight*devicePixelRatio; const cx=el.getContext('2d'); cx.scale(devicePixelRatio,devicePixelRatio); const w=el.offsetWidth,hh=el.offsetHeight,mx=Math.max(...h2,0.1),mn=Math.min(...h2),rng=mx-mn||1,st=w/(h2.length-1); const c=sc(n.status); const g=cx.createLinearGradient(0,0,0,hh); g.addColorStop(0,c+'50'); g.addColorStop(1,'transparent'); cx.beginPath(); cx.moveTo(0,hh); h2.forEach((v,i)=>{ const x=i*st,y=hh-((v-mn)/rng)*(hh-2); cx.lineTo(x,y); }); cx.lineTo(w,hh); cx.closePath(); cx.fillStyle=g; cx.fill(); cx.beginPath(); h2.forEach((v,i)=>{ const x=i*st,y=hh-((v-mn)/rng)*(hh-2); i===0?cx.moveTo(x,y):cx.lineTo(x,y); }); cx.strokeStyle=c; cx.lineWidth=1.5; cx.stroke(); }));
    };
    return { render };
})();

/* ── Main App ─────────────────────────────────────────────── */
const SolarApp = (() => {
    let _filter='all', _startT=Date.now();

    const init=()=>{
        initCursor(); initNav(); initCharts(); LiveStrip.init();
        ControlPanel.init(); EnergyCalculator.init(); NodeComparison.init();
        WeatherAPI.startAutoRefresh();
        bindEvents(); startLoop(); startTimers(); initForecast();
    };

    const initCursor=()=>{
        const ring=document.getElementById('cursorRing'),dot=document.getElementById('cursorDot');
        let mx=0,my=0,rx=0,ry=0;
        document.addEventListener('mousemove',e=>{ mx=e.clientX;my=e.clientY; dot.style.left=mx+'px';dot.style.top=my+'px'; });
        (function a(){ rx+=(mx-rx)*0.12; ry+=(my-ry)*0.12; ring.style.left=rx+'px'; ring.style.top=ry+'px'; requestAnimationFrame(a); })();
        document.addEventListener('mouseover',e=>{ const t=e.target.closest('a,button,.node-card,.kpi-card,.ctrl-card,.chart-panel,.calc-panel'); if(t){ring.style.width='44px';ring.style.height='44px';ring.style.borderColor='#FF9900';}else{ring.style.width='32px';ring.style.height='32px';ring.style.borderColor='#FFCC00';} });
        document.addEventListener('mousedown',()=>ring.style.transform='translate(-50%,-50%) scale(0.8)');
        document.addEventListener('mouseup',  ()=>ring.style.transform='translate(-50%,-50%) scale(1)');
    };

    const initNav=()=>{
        const links=document.querySelectorAll('.nav-link'),prog=document.getElementById('navProgress');
        window.addEventListener('scroll',()=>{
            if(prog) prog.style.width=(window.scrollY/(document.body.scrollHeight-window.innerHeight)*100)+'%';
            document.querySelectorAll('section[id]').forEach(s=>{ const r=s.getBoundingClientRect(); if(r.top<=80&&r.bottom>80){ links.forEach(l=>l.classList.remove('active')); const a=document.querySelector(`.nav-link[data-section="${s.id}"]`); if(a)a.classList.add('active'); } });
        });
        links.forEach(l=>l.addEventListener('click',e=>{ e.preventDefault(); document.querySelector(l.getAttribute('href'))?.scrollIntoView({behavior:'smooth',block:'start'}); }));
    };

    const bindEvents=()=>{
        document.getElementById('refreshBtn')?.addEventListener('click',()=>{ const b=document.getElementById('refreshBtn'); b.style.transition='transform 0.5s'; b.style.transform='rotate(360deg)'; setTimeout(()=>{b.style.transform='';b.style.transition='';},500); fetchAndUpdate(); });
        document.getElementById('exportBtn')?.addEventListener('click',()=>ControlPanel.exportCSV(AppState.nodes.read()));
        document.querySelectorAll('.filter-btn').forEach(b=>b.addEventListener('click',()=>{ document.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); _filter=b.dataset.filter; NodeRenderer.render(AppState.nodes.read(),_filter); }));
        document.querySelectorAll('.tbtn').forEach(b=>b.addEventListener('click',()=>{ document.querySelectorAll('.tbtn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }));
    };

    const startLoop=async()=>{ await fetchAndUpdate(); setInterval(fetchAndUpdate,2000); };

    const fetchAndUpdate=async()=>{
        let nodes;
        try { const r=await fetch('/api/solar/locations'); if(!r.ok)throw 0; nodes=await r.json(); }
        catch { nodes=DataEngine.fetchAll(); }
        await atomically(()=>AppState.nodes.write(nodes));
        window._lastNodes=nodes;
        updateKPIs(nodes); updateCharts(nodes);
        NodeRenderer.render(nodes,_filter);
        ControlPanel.renderControlCards(nodes);
        ControlPanel.checkThresholds(nodes);
        ControlPanel.detectAnomalies(nodes);
        LiveStrip.push(nodes.reduce((s,n)=>s+n.power,0));
        LiveStrip.draw();
        updateCompare(nodes);
        // Refresh weather
        const wx=await WeatherAPI.fetchAll();
        await atomically(()=>AppState.weather.write(wx));
    };

    const updateKPIs=nodes=>{
        const total=nodes.reduce((s,n)=>s+n.power,0);
        const avgI=nodes.reduce((s,n)=>s+n.irradiance,0)/nodes.length;
        const avgE=nodes.reduce((s,n)=>s+n.efficiency,0)/nodes.length;
        const online=nodes.filter(n=>n.online!==false).length;
        const set=(id,v)=>{ const el=document.getElementById(id); if(el){el.style.transform='scale(1.06)';el.textContent=v;setTimeout(()=>el.style.transform='',150);} };
        set('totalPowerVal',total.toFixed(1)); set('avgIrrVal',Math.round(avgI)); set('effVal',avgE.toFixed(1));
        const co2=total*24*0.475; const trees=(co2*0.0417).toFixed(0);
        set('co2Val',co2.toFixed(0));
        const ts=document.getElementById('treeSub'); if(ts)ts.textContent=`${trees} trees equiv. today`;
        const pf=document.getElementById('powerFill'); if(pf)pf.style.width=Math.min(100,(total/80)*100)+'%';
        const iF=document.getElementById('irrFill');   if(iF)iF.style.width=Math.min(100,(avgI/1000)*100)+'%';
        const eF=document.getElementById('effFill');   if(eF)eF.style.width=avgE+'%';
        const cF=document.getElementById('co2Fill');   if(cF)cF.style.width=Math.min(100,(co2/500)*100)+'%';
        const pt=document.getElementById('powerTrend'); if(pt){const d=(Math.random()-0.4)*5;pt.textContent=`${d>=0?'↑':'↓'} ${Math.abs(d).toFixed(1)}% vs last interval`;pt.style.color=d>=0?'#00FF9F':'#FF3B3B';}
        const ob=document.getElementById('onlineBadge'); if(ob)ob.textContent=`${online}/8 NODES ONLINE`;
        const as=document.getElementById('anomalySub'); if(as)as.textContent=`${nodes.filter(n=>n.status===Status.WARNING).length} anomalies detected`;
        const vals=nodes.map(n=>n.irradiance);
        const maxEl=document.getElementById('maxIrr'); if(maxEl)maxEl.textContent=Math.max(...vals)+' W/m²';
        const avgEl=document.getElementById('avgIrr'); if(avgEl)avgEl.textContent=Math.round(avgI)+' W/m²';
        const minEl=document.getElementById('minIrr'); if(minEl)minEl.textContent=Math.min(...vals)+' W/m²';
    };

    const updateCharts=nodes=>{
        if(Charts.irr){nodes.slice(0,4).forEach((n,i)=>Charts.irr.data.datasets[i].data=Physics.profile24(n.lat,n.lng||n.lon,n.cloudCover));Charts.irr.update('none');}
        if(Charts.gen){Charts.gen.data.datasets[0].data=nodes.map(n=>n.power);Charts.gen.update('none');}
        if(Charts.eff){Charts.eff.data.datasets[0].data=nodes.map(n=>n.efficiency);Charts.eff.update('none');}
        if(Charts.anom){Charts.anom.data.datasets[0].data=nodes.map(n=>n._expectedPower??n.power);Charts.anom.data.datasets[1].data=nodes.map(n=>n.power);Charts.anom.update('none');}
        if(Charts.cloud){const c=[0,0,0,0];nodes.forEach(n=>{if(n.cloudCover<15)c[0]++;else if(n.cloudCover<40)c[1]++;else if(n.cloudCover<70)c[2]++;else c[3]++;});Charts.cloud.data.datasets[0].data=c;Charts.cloud.update('none');}
    };

    const initForecast=()=>{
        if(!Charts.forecast)return;
        const s=DataEngine.forecastStream(19.08,72.88), pts=Lazy.take(72,s), sc=LOCS.length;
        Charts.forecast.data.datasets[0].data=pts.map(p=>p.power*sc);
        Charts.forecast.data.datasets[1].data=pts.map(p=>p.power*sc*1.13);
        Charts.forecast.data.datasets[2].data=pts.map(p=>p.power*sc*0.87);
        Charts.forecast.update();
        const total=pts.reduce((s,p)=>s+p.power*sc,0);
        ['fd0val','fd1val','fd2val'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=((total/3)*(0.9+Math.random()*0.2)).toFixed(1); });
    };

    const updateCompare=nodes=>{
        const iA=parseInt(document.getElementById('compareA')?.value||'5');
        const iB=parseInt(document.getElementById('compareB')?.value||'3');
        if(nodes[iA]&&nodes[iB])NodeComparison.render(nodes[iA],nodes[iB]);
    };

    const startTimers=()=>{
        const tick=()=>{
            const now=new Date(), t=now.toUTCString().split(' ')[4]+' UTC';
            ['systemTime','footerTime'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=t; });
            const e=Math.floor((Date.now()-_startT)/1000);
            const el=document.getElementById('uptime');
            if(el)el.textContent=`${String(Math.floor(e/3600)).padStart(2,'0')}:${String(Math.floor((e%3600)/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`;
        };
        tick(); setInterval(tick,1000);
    };

    return { init };
})();

document.addEventListener('DOMContentLoaded',()=>SolarApp.init());
