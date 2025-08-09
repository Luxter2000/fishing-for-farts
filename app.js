// Fishing For Farts – A Stinky Journey (polished)
// All logic client-side. HTTPS geolocation + manual picker, Open‑Meteo, tide approximation, overlay chart, PWA.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const state = {
  userLoc: null,
  spots: [],
  species: [],
  markers: [],
  map: null,
  chart: null,
  forecast: null,
  tideSeries: null,
  sunrise: null,
  sunset: null,
  xp: 0,
  level: 1
};

const PUNS = [
  "Casting a whiff...",
  "Let it rip (the drag)!",
  "Wind from the rear = extra cast distance.",
  "Something’s fishy in the air.",
  "Silent but deadly… hooks.",
  "A gentle toot on the breeze.",
  "Bubble trail = chum of destiny.",
  "Poot, scoot, and recruit… fish.",
  "Green clouds bring silver ghosts.",
  "Break wind, not leaders.",
  "Gust of trust, cast with thrust.",
  "May your lures swim and your wafts win."
];

const XP_PER_CATCH = 25;
const XP_PER_LEVEL = (lvl) => 100 + (lvl - 1) * 50;

// UTILITIES -------------------------------------------------------------
const km = (m) => (m / 1000).toFixed(2);
function haversine(a, b) {
  const R = 6371e3, toRad = (d)=>d*Math.PI/180;
  const dLat = toRad(b.lat-a.lat), dLon = toRad(b.lon-a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function compass(deg){
  const dirs=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW","N"];
  return dirs[Math.round(deg/22.5)];
}
function showToast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tid);
  t._tid = setTimeout(()=>t.classList.remove("show"), 2200);
}

// MAP ------------------------------------------------------------------
async function initMap(){
  state.map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
  state.map.setView([-27.5, 153.2], 10);

  state.map.on('click', (e)=>{
    setUserLocation(e.latlng.lat, e.latlng.lng, true);
    showToast("Manual location set. Wafting data your way…");
  });

  // When user taps "Pick on map", show hint cursor
  $("#btn-pick-location").addEventListener("click", ()=>{
    const mapEl = $("#map");
    mapEl.style.cursor = "crosshair";
    const once = ()=>{ mapEl.style.cursor = ""; state.map.off("click", once); };
    state.map.once("click", once);
  });
}

// DATA LOAD -------------------------------------------------------------
async function loadData(){
  const [spots, species] = await Promise.all([
    fetch('data/spots.json').then(r=>r.json()),
    fetch('data/species.json').then(r=>r.json()),
  ]);
  state.spots = spots;
  state.species = species;
  populateSpeciesUI();
  populateLogFormSpecies();
}

// GEOLOCATION -----------------------------------------------------------
function getSavedLocation(){
  try{
    const saved = JSON.parse(localStorage.getItem('fff_user_loc'));
    if(saved && typeof saved.lat==='number') return saved;
  }catch{}
  return null;
}
function saveLocation(lat, lon){
  localStorage.setItem('fff_user_loc', JSON.stringify({lat, lon}));
}

async function useMyLocation(){
  if(!('geolocation' in navigator)){
    showToast("Geolocation not supported. Tap Pick on map.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const {latitude, longitude} = pos.coords;
      setUserLocation(latitude, longitude, false);
      showToast("Location found. Follow your nose…");
    },
    err=>{
      const code = err && err.code;
      const messages = {
        1: "Permission denied. Tap Pick on map.",
        2: "Position unavailable. Move a little, then try again.",
        3: "Timed out. Try again or Pick on map."
      };
      showToast(messages[code] || "Couldn’t get location. Pick on map.");
    },
    {enableHighAccuracy:true, timeout:10000, maximumAge:30000}
  );
}

async function setUserLocation(lat, lon){
  state.userLoc = {lat, lon};
  saveLocation(lat, lon);
  if(state.userMarker) state.map.removeLayer(state.userMarker);
  state.userMarker = L.marker([lat, lon], {title:"You (whiffy)"}).addTo(state.map);
  state.map.setView([lat, lon], 13);
  await refreshAll();
}

// WEATHER + TIDE + MOON -------------------------------------------------
async function fetchForecast(){
  const {lat, lon} = state.userLoc;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('hourly', 'temperature_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('daily', 'sunrise,sunset,moon_phase');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '2');
  const res = await fetch(url.toString());
  const data = await res.json();
  state.forecast = data;

  if (data?.daily?.sunrise?.length){
    state.sunrise = new Date(data.daily.sunrise[0]);
    state.sunset  = new Date(data.daily.sunset[0]);
  }

  state.tideSeries = buildTideSeries(data);
}

function buildTideSeries(data){
  // Toy tide model: semidiurnal cosine + barometric tweak.
  const {latitude:lat, longitude:lon} = state.userLoc;
  const times = data.hourly.time.map(t=>new Date(t));
  const pressures = data.hourly.pressure_msl || [];
  const baseAmp = 1.1; // meters (toy amplitude)
  const tidalPeriod = 12.42; // hours
  const phase = (lon/15) * Math.PI/2;
  const heights = times.map((dt, i)=>{
    const tHours = (dt - times[0]) / 36e5;
    let h = baseAmp * 0.5 * (1 + Math.cos((2*Math.PI/ tidalPeriod) * tHours + phase));
    const p = pressures[i] || pressures[0] || 1015;
    h += (1015 - p) * 0.0015;
    return Math.max(0, +h.toFixed(2));
  });
  const rising = heights.map((h, i)=> i===0 ? true : (h - heights[i-1]) >= 0);
  return {times, heights, rising};
}

function getCurrentSnapshot(){
  const idx = nearestHourIndex(state.forecast.hourly.time);
  const f = k => state.forecast.hourly[k][idx];
  const wind = f('wind_speed_10m');
  const windDir = f('wind_direction_10m');
  const temp = f('temperature_2m');
  const pressure = f('pressure_msl');
  const rain = f('precipitation');
  const tideH = state.tideSeries.heights[idx];
  const rising = state.tideSeries.rising[idx];
  const moonIdx = state.forecast.daily.moon_phase?.[0] ?? 0;
  const moonName = moonPhaseName(moonIdx);
  return {wind, windDir, temp, pressure, rain, tideH, rising, moonIdx, moonName};
}

function nearestHourIndex(times){
  const now = Date.now();
  let best=0, bestD=Infinity;
  for(let i=0;i<times.length;i++){
    const d = Math.abs(new Date(times[i]).getTime() - now);
    if(d<bestD){best=i;bestD=d;}
  }
  return best;
}
function moonPhaseName(x){
  const names = [
    "New Moon","Waxing Crescent","First Quarter","Waxing Gibbous",
    "Full Moon","Waning Gibbous","Last Quarter","Waning Crescent"
  ];
  const idx = Math.round((x*8))%8;
  return names[idx];
}

// SCORING ---------------------------------------------------------------
function biteScore(snapshot, when){
  let s = 50;
  if(snapshot.wind >=5 && snapshot.wind<=18) s+=15;
  else if(snapshot.wind>30) s-=15;
  if(snapshot.rising) s+=10; else s-=5;
  if(snapshot.rain>4) s-=10;
  if(snapshot.pressure>=1012 && snapshot.pressure<=1020) s+=5;
  if (state.sunrise && state.sunset){
    const t = when || new Date();
    const minsToEdge = Math.min(
      Math.abs((t - state.sunrise)/60000),
      Math.abs((t - state.sunset )/60000)
    );
    if(minsToEdge<=90) s+=15;
  }
  return Math.max(0, Math.min(100, s));
}

function speciesChance(spec, snap){
  const priors = { flathead:0.30, bream:0.35, whiting:0.28, tailor:0.22, mulloway:0.10 };
  const id = spec.id;
  let p = (priors[id] ?? 0.2);

  if (snap.rising) p+=0.05;
  if (snap.wind>=6 && snap.wind<=15) p+=0.04;
  if (id==='whiting' && snap.tideH>0.4) p+=0.03;
  if (id==='tailor' && snap.wind>10) p+=0.05;
  if (id==='mulloway' && (snap.moonIdx>0.45 && snap.moonIdx<0.55)) p+=0.05;
  if (id==='flathead' && snap.rain<1) p+=0.02;
  if (state.sunrise && state.sunset){
    const minsToEdge = Math.min(
      Math.abs((Date.now() - state.sunrise)/60000),
      Math.abs((Date.now() - state.sunset )/60000)
    );
    if(minsToEdge<=120) p+=0.05;
  }

  const s = biteScore(snap);
  const mult = 0.7 + 0.6 * (s/100);
  const pct = Math.round(Math.min(95, Math.max(3, p*100*mult)));
  return pct;
}

// UI BINDINGS -----------------------------------------------------------
function populateSpeciesUI(){
  const list = $("#speciesList");
  list.innerHTML = "";
  state.species.forEach(spec=>{
    const li = document.createElement("div");
    li.className = "species-card";
    li.innerHTML = `
      <img src="${spec.image}" alt="${spec.name}">
      <div class="meta">
        <a href="#" data-spec="${spec.id}" class="spec-link" role="button">${spec.name}</a>
        <div class="sub">Bag: ${spec.bag} • Min: ${spec.min} cm</div>
        <div>Chance: <span class="chance" id="chance_${spec.id}">–</span></div>
      </div>
    `;
    list.appendChild(li);
  });
  list.addEventListener('click', (e)=>{
    const a = e.target.closest('.spec-link');
    if(a){
      e.preventDefault();
      const spec = state.species.find(s=>s.id===a.dataset.spec);
      openSpeciesModal(spec);
    }
  });
}

function updateSpeciesChances(){
  const snap = getCurrentSnapshot();
  state.species.forEach(spec=>{
    const pct = speciesChance(spec, snap);
    const el = document.querySelector(`#chance_${spec.id}`);
    el.textContent = `${pct}%`;
    el.className = `chance ${pct>=60?'good': pct>=35?'ok':'bad'}`;
  });
}

function openSpeciesModal(spec){
  const dlg = $("#speciesModal");
  const body = $("#speciesModalBody");
  const snap = getCurrentSnapshot();
  body.innerHTML = `
    <div class="bio">
      <div style="display:grid; grid-template-columns:160px 1fr; gap:1rem; align-items:center">
        <img src="${spec.image}" alt="${spec.name}" style="width:160px; height:160px; object-fit:cover; border-radius:16px; border:2px solid var(--grid)" />
        <div>
          <h3 style="margin:.2rem 0 0">${spec.name}</h3>
          <p class="sub">Bag: ${spec.bag} • Min size: ${spec.min} cm</p>
          <div style="display:flex; gap:.5rem; flex-wrap:wrap">
            <span class="badge">Chance: ${speciesChance(spec, snap)}%</span>
            <span class="badge">Current tide: ${snap.rising?'Rising':'Falling'}</span>
            <span class="badge">Wind: ${Math.round(snap.wind)} km/h ${compass(snap.windDir)}</span>
          </div>
        </div>
      </div>
      <p style="margin-top:0.8rem">${spec.blurb}</p>
      <div style="margin-top:.4rem; font-size:.9rem; color:#475569">Tip: fish responsibly. Farts are catch‑and‑release.</div>
    </div>
  `;
  dlg.showModal();
}

// SPOTS LIST & MAP MARKERS ---------------------------------------------
function renderSpots(){
  state.markers.forEach(m => state.map.removeLayer(m));
  state.markers = [];

  const here = state.userLoc;
  const enriched = state.spots.map(s=>{
    const d = haversine(here, {lat:s.lat, lon:s.lon});
    const snap = getCurrentSnapshot();
    const score = Math.round(biteScore(snap));
    return {...s, distance: d, score};
  }).sort((a,b)=> a.distance - b.distance);

  const ul = $("#spotList");
  ul.innerHTML = "";
  enriched.forEach(s=>{
    const li = document.createElement('li');
    li.className = 'spot-item';
    const dist = km(s.distance);
    li.innerHTML = `
      <div>
        <div><strong>${s.name}</strong></div>
        <div class="sub">${dist} km • Score <strong>${s.score}</strong> • ${s.description}</div>
      </div>
      <div class="spot-actions">
        <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}">Navigate</a>
      </div>
    `;
    ul.appendChild(li);

    const marker = L.marker([s.lat, s.lon]).addTo(state.map)
      .bindPopup(`<strong>${s.name}</strong><br>${s.description}<br><em>${dist} km • Score ${s.score}</em>`);
    state.markers.push(marker);
  });
}

// CHART ----------------------------------------------------------------
function renderChart(){
  const ctx = $("#forecastChart");
  if(state.chart){ state.chart.destroy(); }

  const hours = state.forecast.hourly.time.map(t=> new Date(t));
  const labels = hours.map(h=> h.toLocaleTimeString([], {hour:'2-digit'}));
  const wind = state.forecast.hourly.wind_speed_10m.map(v=> Math.round(v));
  const rain = state.forecast.hourly.precipitation.map(v=> v);
  const tide = state.tideSeries.heights;

  const shadePlugin = {
    id:'biteShade',
    beforeDraw(chart){
      const {ctx, chartArea:{left,right,top,bottom}, scales:{x}} = chart;
      if(!state.sunrise || !state.sunset) return;
      const win = [];
      for(let i=0;i<hours.length;i++){
        const minsToEdge = Math.min(
          Math.abs((hours[i] - state.sunrise)/60000),
          Math.abs((hours[i] - state.sunset )/60000)
        );
        const okWind = wind[i] >= 5 && wind[i] <= 18;
        if(minsToEdge<=90 && okWind) win.push(i);
      }
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,0.12)';
      let start = null;
      for(let i=0;i<win.length;i++){
        if(start===null) start = win[i];
        const next = win[i+1];
        if(next!==win[i]+1 || i===win.length-1){
          const x1 = x.getPixelForValue(start);
          const x2 = x.getPixelForValue(win[i]+1);
          ctx.fillRect(x1, top, x2-x1, bottom-top);
          start = null;
        }
      }
      ctx.restore();
    }
  };

  state.chart = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets:[
        {
          type:'bar',
          label:'Rain (mm)',
          data:rain,
          yAxisID:'y2',
          borderRadius:4
        },
        {
          type:'line',
          label:'Wind (km/h)',
          data:wind,
          yAxisID:'y',
          tension:.25,
          pointRadius:0,
          borderWidth:2
        },
        {
          type:'line',
          label:'Tide (m)',
          data:tide,
          yAxisID:'y3',
          tension:.3,
          pointRadius:0,
          borderWidth:2
        }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins:{
        legend:{display:true, labels:{boxWidth:16}},
        tooltip:{
          callbacks:{
            label(ctx){
              const lbl = ctx.dataset.label || '';
              const v = ctx.parsed.y;
              return `${lbl}: ${v}${lbl.includes('Wind')?' km/h':lbl.includes('Rain')?' mm':lbl.includes('Tide')?' m':''}`;
            }
          }
        }
      },
      scales:{
        y:{ position:'left', title:{text:'Wind', display:true}, suggestedMin:0, suggestedMax:40, grid:{drawOnChartArea:false}},
        y2:{ position:'right', title:{text:'Rain', display:true}, suggestedMin:0, suggestedMax:10, grid:{drawOnChartArea:false}},
        y3:{ position:'right', title:{text:'Tide', display:true}, suggestedMin:0, suggestedMax:2.2, grid:{}, offset:true }
      }
    },
    plugins:[shadePlugin]
  });
}

// CATCH LOG + XP -------------------------------------------------------
function loadXP(){
  const meta = JSON.parse(localStorage.getItem('fff_meta')||'{}');
  state.xp = meta.xp || 0;
  state.level = meta.level || 1;
  updateXPUI();
}
function saveXP(){
  localStorage.setItem('fff_meta', JSON.stringify({xp:state.xp, level:state.level}));
}
function grantXP(amount){
  state.xp += amount;
  while(state.xp >= XP_PER_LEVEL(state.level)){
    state.xp -= XP_PER_LEVEL(state.level);
    state.level++;
    showToast(`Level up! You reached Lv ${state.level} 🌬️`);
  }
  saveXP();
  updateXPUI();
}
function updateXPUI(){
  const cap = XP_PER_LEVEL(state.level);
  const pct = Math.max(2, Math.min(100, Math.round((state.xp / cap)*100)));
  $("#xpBar").style.width = pct + "%";
  $("#xpText").textContent = `Lv ${state.level} • ${state.xp}/${cap} XP`;
}

function loadCatches(){
  const arr = JSON.parse(localStorage.getItem('fff_catches')||'[]');
  return arr;
}
function saveCatches(arr){
  localStorage.setItem('fff_catches', JSON.stringify(arr));
}
function renderCatches(){
  const ul = $("#catchList");
  const arr = loadCatches().slice(-20).reverse();
  ul.innerHTML = arr.map(c=>`
    <li class="catch-item">
      <div class="thumb"></div>
      <div>
        <div><strong>${c.species}</strong> • ${c.size} cm</div>
        <div class="sub">${new Date(c.when).toLocaleString([], {dateStyle:'medium', timeStyle:'short'})} • ${c.method || '—'}</div>
        ${c.notes? `<div class="sub">${c.notes}</div>`:''}
      </div>
    </li>
  `).join('') || `<li class="catch-item"><div>No catches yet. Go make a stink!</div></li>`;
}

function populateLogFormSpecies(){
  const sel = $("#logSpecies");
  sel.innerHTML = state.species.map(s=>`<option>${s.name}</option>`).join('');
}

function bindModals(){
  $("#btn-log-catch").addEventListener('click', ()=> $("#logModal").showModal());
  $$("#logModal [data-close], #speciesModal [data-close]").forEach(btn=>{
    btn.addEventListener('click', (e)=> e.target.closest('dialog').close());
  });
}

// RENDER CONDITIONS -----------------------------------------------------
function renderNow(){
  const s = getCurrentSnapshot();
  $("#wind").textContent = `${Math.round(s.wind)} km/h`;
  $("#windDir").style.transform = `rotate(${s.windDir}deg)`;
  $("#pressure").textContent = `${Math.round(s.pressure)} hPa`;
  $("#tidePhase").textContent = `${s.rising?'Rising':'Falling'} (${s.tideH.toFixed(2)} m)`;
  $("#moon").textContent = s.moonName;
  $("#temp").textContent = `${Math.round(s.temp)}°C`;
  updateSpeciesChances();
}

// REFRESH CYCLE ---------------------------------------------------------
async function refreshAll(){
  if(!state.userLoc) return;
  await fetchForecast();
  renderNow();
  renderSpots();
  renderChart();
}

// FUN: Puns rotator -----------------------------------------------------
function startPuns(){
  const el = $("#pun");
  function tick(){
    const p = PUNS[Math.floor(Math.random()*PUNS.length)];
    el.textContent = p;
  }
  tick();
  setInterval(tick, 5000);
}

// INIT ------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async ()=>{
  $("#year").textContent = new Date().getFullYear();
  await initMap();
  await loadData();
  loadXP();
  renderCatches();
  bindModals();

  const saved = getSavedLocation();
  if(saved){ setUserLocation(saved.lat, saved.lon); }
  else { showToast("Tap “Use my location” (HTTPS only) or Pick on map."); }

  $("#btn-use-location").addEventListener('click', useMyLocation);
  $("#btn-pick-location").addEventListener('click', ()=> showToast("Tap anywhere on the map to set your spot."));

  if (window.feather) window.feather.replace();

  startPuns();
});
