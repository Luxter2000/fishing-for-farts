// App v2: clearer spot markers + bite windows in popups + species links open species.html
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const state = { userLoc:null, spots:[], species:[], markers:[], map:null, chart:null, forecast:null, tideSeries:null, sunrise:null, sunset:null, xp:0, level:1 };

const PUNS = ["Casting a whiff...","Let it rip (the drag)!","Wind from the rear = extra cast distance.","Something’s fishy in the air.","Silent but deadly… hooks.","A gentle toot on the breeze.","Bubble trail = chum of destiny.","Poot, scoot, and recruit… fish.","Green clouds bring silver ghosts."];

const XP_PER_CATCH = 25;
const XP_PER_LEVEL = (lvl) => 100 + (lvl - 1) * 50;

const km = (m) => (m/1000).toFixed(2);
function haversine(a,b){const R=6371e3,toRad=d=>d*Math.PI/180;const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);const lat1=toRad(a.lat),lat2=toRad(b.lat);const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function compass(deg){const dirs=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW","N"];return dirs[Math.round(deg/22.5)];}
function showToast(msg){const t=$("#toast"); if(!t) return; t.textContent=msg; t.classList.add("show"); clearTimeout(t._tid); t._tid = setTimeout(()=>t.classList.remove("show"), 2200);}

async function initMap(){
  state.map = L.map('map',{zoomControl:true, attributionControl:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'&copy; OpenStreetMap'}).addTo(state.map);
  state.map.setView([-27.5,153.2],10);
  state.map.on('click',(e)=>{ setUserLocation(e.latlng.lat,e.latlng.lng); showToast("Manual location set. Wafting data your way…"); });
  $("#btn-pick-location")?.addEventListener("click",()=>{ const el=$("#map"); el.style.cursor="crosshair"; const once=()=>{el.style.cursor=""; state.map.off("click",once)}; state.map.once("click",once); });
}

async function loadData(){
  const [spots,species] = await Promise.all([ fetch('data/spots.json').then(r=>r.json()), fetch('data/species.json').then(r=>r.json()) ]);
  state.spots=spots; state.species=species;
  populateSpeciesUI(); populateLogFormSpecies();
}

function getSavedLocation(){ try{const s=JSON.parse(localStorage.getItem('fff_user_loc')); if(s&&typeof s.lat==='number') return s;}catch{} return null;}
function saveLocation(lat,lon){ localStorage.setItem('fff_user_loc', JSON.stringify({lat,lon})); }

async function useMyLocation(){
  if(!('geolocation' in navigator)){ showToast("Geolocation not supported. Tap Pick on map."); return; }
  navigator.geolocation.getCurrentPosition(
    pos=>{ const {latitude,longitude}=pos.coords; setUserLocation(latitude,longitude); showToast("Location found. Follow your nose…"); },
    err=>{ showToast("Location blocked/unavailable. Tap Pick on map."); },
    {enableHighAccuracy:true, timeout:10000, maximumAge:30000}
  );
}

async function setUserLocation(lat,lon){
  state.userLoc={lat,lon}; saveLocation(lat,lon);
  if(state.userMarker) state.map.removeLayer(state.userMarker);
  state.userMarker = L.marker([lat,lon],{title:"You"}).addTo(state.map);
  state.map.setView([lat,lon],13);
  await refreshAll();
}

async function fetchForecast(){
  const {lat,lon}=state.userLoc;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude',lat); url.searchParams.set('longitude',lon);
  url.searchParams.set('hourly','temperature_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('daily','sunrise,sunset,moon_phase'); url.searchParams.set('timezone','auto'); url.searchParams.set('forecast_days','2');
  const res = await fetch(url); const data = await res.json(); state.forecast=data;
  if (data?.daily?.sunrise?.length){ state.sunrise = new Date(data.daily.sunrise[0]); state.sunset = new Date(data.daily.sunset[0]); }
  state.tideSeries = buildTideSeries(data);
}

function buildTideSeries(data){
  const times = data.hourly.time.map(t=>new Date(t)); const pressures=data.hourly.pressure_msl||[];
  const baseAmp=1.1, tidalPeriod=12.42, phase=(state.userLoc.lon/15)*Math.PI/2;
  const heights = times.map((dt,i)=>{ const tH=(dt-times[0])/36e5; let h= baseAmp*0.5*(1+Math.cos((2*Math.PI/tidalPeriod)*tH+phase)); const p=pressures[i]||pressures[0]||1015; h += (1015-p)*0.0015; return Math.max(0, +h.toFixed(2)); });
  const rising = heights.map((h,i)=> i===0?true:(h-heights[i-1])>=0);
  return {times,heights,rising};
}

function getCurrentSnapshot(){
  const idx = nearestHourIndex(state.forecast.hourly.time);
  const f = k=>state.forecast.hourly[k][idx];
  const wind=f('wind_speed_10m'), windDir=f('wind_direction_10m'), temp=f('temperature_2m'), pressure=f('pressure_msl'), rain=f('precipitation');
  const tideH=state.tideSeries.heights[idx], rising=state.tideSeries.rising[idx];
  const moonIdx=state.forecast.daily.moon_phase?.[0]??0, moonName=moonPhaseName(moonIdx);
  return {wind,windDir,temp,pressure,rain,tideH,rising,moonIdx,moonName};
}
function nearestHourIndex(times){ const now=Date.now(); let best=0,bestD=1/0; for(let i=0;i<times.length;i++){ const d=Math.abs(new Date(times[i]).getTime()-now); if(d<bestD){best=i;bestD=d;} } return best; }
function moonPhaseName(x){ const n=["New Moon","Waxing Crescent","First Quarter","Waxing Gibbous","Full Moon","Waning Gibbous","Last Quarter","Waning Crescent"]; return n[Math.round((x*8))%8]; }

function biteScore(snap, when){
  let s=50;
  if(snap.wind>=5 && snap.wind<=18) s+=15; else if(snap.wind>30) s-=15;
  if(snap.rising) s+=10; else s-=5;
  if(snap.rain>4) s-=10;
  if(snap.pressure>=1012 && snap.pressure<=1020) s+=5;
  if (state.sunrise && state.sunset){
    const t= when || new Date(); const minsToEdge = Math.min(Math.abs((t-state.sunrise)/60000), Math.abs((t-state.sunset)/60000)); if(minsToEdge<=90) s+=15;
  }
  return Math.max(0, Math.min(100,s));
}

function computeBiteWindows(threshold=65){
  const times = state.forecast.hourly.time.map(t=>new Date(t));
  const winIdx = [];
  for(let i=0;i<times.length;i++){
    const snap = {
      wind: state.forecast.hourly.wind_speed_10m[i],
      windDir: state.forecast.hourly.wind_direction_10m[i],
      temp: state.forecast.hourly.temperature_2m[i],
      pressure: state.forecast.hourly.pressure_msl[i],
      rain: state.forecast.hourly.precipitation[i],
      tideH: state.tideSeries.heights[i],
      rising: state.tideSeries.rising[i],
      moonIdx: state.forecast.daily.moon_phase?.[0]??0
    };
    const score = biteScore(snap, new Date(times[i]));
    if (score >= threshold) winIdx.push(i);
  }
  // group contiguous indexes into ranges
  const ranges = [];
  let start=null;
  for (let i=0;i<winIdx.length;i++){
    if(start===null) start=winIdx[i];
    const next=winIdx[i+1];
    if(next!==winIdx[i]+1 || i===winIdx.length-1){
      const a = times[start], b = times[winIdx[i]];
      ranges.push([a,b]);
      start=null;
    }
  }
  return ranges.slice(0,4); // top few
}

function populateSpeciesUI(){
  const list=$("#speciesList"); if(!list) return; list.innerHTML="";
  state.species.forEach(spec=>{
    const li=document.createElement("div");
    li.className="species-card";
    li.innerHTML=`
      <img src="${spec.image}" alt="${spec.name}">
      <div class="meta">
        <a href="species.html?id=${spec.id}" class="spec-link">${spec.name}</a>
        <div class="sub">Bag: ${spec.bag} • Min: ${spec.min} cm</div>
        <div>Chance: <span class="chance" id="chance_${spec.id}">–</span></div>
      </div>`;
    list.appendChild(li);
  });
  updateSpeciesChances();
}

function updateSpeciesChances(){
  const now = getCurrentSnapshot();
  state.species.forEach(spec=>{
    const pct = speciesChance(spec, now);
    const el = document.getElementById(`chance_${spec.id}`);
    if(el){ el.textContent = `${pct}%`; el.className = `chance ${pct>=60?'good': pct>=35?'ok':'bad'}`; }
  });
}

function speciesChance(spec, snap){
  const priors={flathead:0.30,bream:0.35,whiting:0.28,tailor:0.22,mulloway:0.10};
  const id=spec.id; let p = (priors[id] ?? 0.2);
  if (snap.rising) p+=0.05;
  if (snap.wind>=6 && snap.wind<=15) p+=0.04;
  if (id==='whiting' && snap.tideH>0.4) p+=0.03;
  if (id==='tailor' && snap.wind>10) p+=0.05;
  if (id==='mulloway' && (snap.moonIdx>0.45 && snap.moonIdx<0.55)) p+=0.05;
  if (id==='flathead' && snap.rain<1) p+=0.02;
  const s = biteScore(snap); const mult = 0.7 + 0.6 * (s/100);
  return Math.round(Math.min(95, Math.max(3, p*100*mult)));
}

function renderSpots(){
  state.markers.forEach(m=>state.map.removeLayer(m)); state.markers=[];
  const here=state.userLoc;
  const enriched = state.spots.map(s=>{
    const d = haversine(here,{lat:s.lat,lon:s.lon});
    const snap = getCurrentSnapshot();
    const score = Math.round(biteScore(snap));
    return {...s, distance:d, score};
  }).sort((a,b)=>a.distance-b.distance);

  const ul=$("#spotList"); if(ul) ul.innerHTML="";
  const ranges = computeBiteWindows();
  const rangeText = ranges.length? ranges.map(([a,b])=> `${a.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}–${b.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`).join(', ') : 'No standout windows';

  enriched.forEach((s, idx)=>{
    const marker = L.circleMarker([s.lat,s.lon], {radius:10, color:'#4f46e5', weight:2, fillColor:'#a5b4fc', fillOpacity:0.8})
      .addTo(state.map)
      .bindTooltip(`${idx+1}. ${s.name}`, {permanent:true, direction:'top', offset:[0,-12], className:'spot-label'});
    marker.bindPopup(`
      <strong>${s.name}</strong><br>
      <em>${(s.description||'').replace(/</g,'&lt;')}</em><br>
      <div style="margin-top:.35rem"><strong>Recommended bite times:</strong><br>${rangeText}</div>
      <div style="margin-top:.35rem">
        <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}">Navigate</a>
      </div>
    `);
    state.markers.push(marker);

    if(ul){
      const li=document.createElement('li'); li.className='spot-item';
      const dist=(km(s.distance));
      li.innerHTML=`
        <div>
          <div><strong>${idx+1}. ${s.name}</strong></div>
          <div class="sub">${dist} km • Score <strong>${s.score}</strong> • ${s.description}</div>
        </div>
        <div class="spot-actions">
          <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}">Navigate</a>
        </div>`;
      ul.appendChild(li);
    }
  });
}

function renderChart(){
  const ctx = document.getElementById("forecastChart"); if(state.chart) state.chart.destroy();
  const hours = state.forecast.hourly.time.map(t=> new Date(t));
  const labels = hours.map(h=> h.toLocaleTimeString([], {hour:'2-digit'}));
  const wind = state.forecast.hourly.wind_speed_10m.map(v=> Math.round(v));
  const rain = state.forecast.hourly.precipitation.map(v=> v);
  const tide = state.tideSeries.heights;

  const shadePlugin={id:'biteShade',beforeDraw(chart){const {ctx, chartArea:{top,bottom}, scales:{x}}=chart; const ranges=computeBiteWindows(); ctx.save(); ctx.fillStyle='rgba(34,197,94,0.12)'; ranges.forEach(([a,b])=>{ const x1=x.getPixelForValue(a); const x2=x.getPixelForValue(new Date(b.getTime()+60*60*1000)); ctx.fillRect(x1, top, x2-x1, bottom-top); }); ctx.restore(); }};

  state.chart = new Chart(ctx, { type:'bar', data:{ labels, datasets:[
    {type:'bar', label:'Rain (mm)', data:rain, yAxisID:'y2', borderRadius:4},
    {type:'line', label:'Wind (km/h)', data:wind, yAxisID:'y', tension:.25, pointRadius:0, borderWidth:2},
    {type:'line', label:'Tide (m)', data:tide, yAxisID:'y3', tension:.3, pointRadius:0, borderWidth:2}
  ]},
  options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
    scales:{ y:{position:'left', suggestedMin:0, suggestedMax:40, title:{display:true,text:'Wind'}},
             y2:{position:'right', suggestedMin:0, suggestedMax:10, title:{display:true,text:'Rain'}, grid:{drawOnChartArea:false}},
             y3:{position:'right', suggestedMin:0, suggestedMax:2.2, title:{display:true,text:'Tide'}, offset:true}},
    plugins:{legend:{display:true}}
  }, plugins:[shadePlugin]});
}

function loadXP(){ const meta=JSON.parse(localStorage.getItem('fff_meta')||'{}'); state.xp=meta.xp||0; state.level=meta.level||1; updateXPUI(); }
function saveXP(){ localStorage.setItem('fff_meta', JSON.stringify({xp:state.xp, level:state.level})); }
function grantXP(n){ state.xp+=n; while(state.xp>=XP_PER_LEVEL(state.level)){ state.xp-=XP_PER_LEVEL(state.level); state.level++; showToast(`Level up! Lv ${state.level} 🌬️`);} saveXP(); updateXPUI(); }
function updateXPUI(){ const cap=XP_PER_LEVEL(state.level); const pct=Math.max(2, Math.min(100, Math.round((state.xp/cap)*100))); const bar=document.getElementById('xpBar'); if(bar) bar.style.width=pct+'%'; const txt=document.getElementById('xpText'); if(txt) txt.textContent = `Lv ${state.level} • ${state.xp}/${cap} XP`; }
function loadCatches(){ return JSON.parse(localStorage.getItem('fff_catches')||'[]'); }
function saveCatches(a){ localStorage.setItem('fff_catches', JSON.stringify(a)); }
function renderCatches(){ const ul=document.getElementById('catchList'); if(!ul) return; const arr=loadCatches().slice(-20).reverse(); ul.innerHTML = arr.map(c=>`
  <li class="catch-item">
    <div class="thumb"></div>
    <div>
      <div><strong>${c.species}</strong> • ${c.size} cm</div>
      <div class="sub">${new Date(c.when).toLocaleString([], {dateStyle:'medium', timeStyle:'short'})} • ${c.method||'—'}</div>
      ${c.notes? `<div class="sub">${c.notes}</div>`:''}
    </div>
  </li>`).join('') || `<li class="catch-item"><div>No catches yet. Go make a stink!</div></li>`; }

function populateLogFormSpecies(){ const sel=document.getElementById('logSpecies'); if(!sel) return; sel.innerHTML= state.species.map(s=>`<option>${s.name}</option>`).join(''); }
function bindLog(){ const btn=document.getElementById('btn-log-catch'); if(!btn) return; const dlg=document.getElementById('logModal'); btn.addEventListener('click',()=>dlg.showModal()); dlg?.querySelector('[data-close]')?.addEventListener('click',()=>dlg.close()); document.getElementById('speciesModal')?.querySelector('[data-close]')?.addEventListener('click',()=>document.getElementById('speciesModal').close()); document.getElementById('logForm')?.addEventListener('submit', (e)=>{ e.preventDefault(); const entry={ species: document.getElementById('logSpecies').value, size: parseFloat(document.getElementById('logSize').value), method: document.getElementById('logMethod').value.trim(), notes: document.getElementById('logNotes').value.trim(), when: Date.now() }; const arr=loadCatches(); arr.push(entry); saveCatches(arr); renderCatches(); grantXP(XP_PER_CATCH); e.target.reset(); dlg.close(); showToast("Catch logged! That’s one for the nosebook."); }); }

function renderNow(){ const s=getCurrentSnapshot(); const w=document.getElementById('wind'); if(w) w.textContent=`${Math.round(s.wind)} km/h`; const wd=document.getElementById('windDir'); if(wd) wd.style.transform=`rotate(${s.windDir}deg)`; const p=document.getElementById('pressure'); if(p) p.textContent=`${Math.round(s.pressure)} hPa`; const t=document.getElementById('tidePhase'); if(t) t.textContent = `${s.rising?'Rising':'Falling'} (${s.tideH.toFixed(2)} m)`; const m=document.getElementById('moon'); if(m) m.textContent=s.moonName; const tp=document.getElementById('temp'); if(tp) tp.textContent = `${Math.round(s.temp)}°C`; updateSpeciesChances(); }

async function refreshAll(){ if(!state.userLoc) return; await fetchForecast(); renderNow(); renderSpots(); renderChart(); }

function startPuns(){ const el=document.getElementById('pun'); if(!el) return; const tick=()=>{ el.textContent = PUNS[Math.floor(Math.random()*PUNS.length)]; }; tick(); setInterval(tick, 5000); }

window.addEventListener('DOMContentLoaded', async ()=>{
  const y=document.getElementById('year'); if(y) y.textContent = new Date().getFullYear();
  await initMap(); await loadData(); loadXP(); renderCatches(); bindLog();
  const saved=getSavedLocation(); if(saved){ setUserLocation(saved.lat, saved.lon); } else { showToast("Tap “Use my location” (HTTPS only) or Pick on map."); }
  document.getElementById('btn-use-location')?.addEventListener('click', useMyLocation);
  if (window.feather) window.feather.replace();
  startPuns();
});
