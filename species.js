// species.js — renders a Pokemon-card style species page using species.json
(async function(){
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const data = await fetch('data/species.json').then(r=>r.json());
  const spec = data.find(s=>s.id===id) || data[0];
  if (!spec) return;

  document.title = `${spec.name} — Species Bio`;
  const $ = (s)=>document.querySelector(s);
  $("#img").src = spec.image;
  $("#img").alt = spec.name;
  $("#title").textContent = spec.name;
  $("#bag").textContent = `Bag: ${spec.bag}`;
  $("#min").textContent = `Min size: ${spec.min} cm`;
  $("#habitat").textContent = spec.habitat || "Inlets, estuaries";
  $("#blurb").textContent = spec.blurb;

  $("#bestTides").textContent = spec.bestTides || "Rising to full";
  $("#bestTimes").textContent = spec.bestTimes || "Dawn/Dusk";
  $("#baits").textContent = (spec.baits||[]).join(', ') || "Prawns, worms, pilchards";
  $("#lures").textContent = (spec.lures||[]).join(', ') || "Soft plastics, metals, topwater";

  document.getElementById('card').hidden = false;
  if (window.feather) window.feather.replace();
})();
