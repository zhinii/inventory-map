const state={site:null,taxonomy:null,inventory:[],map:null,markers:new Map(),boundary:null};
const $=id=>document.getElementById(id);
const norm=v=>(v??'').toString().toLowerCase().replace(/[-_/]/g,' ').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
async function load(){
  const [site,taxonomy,inventory]=await Promise.all(['data/site.json','data/taxonomy.json','data/inventory.json'].map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error(`Could not load ${u}`);return r.json()})));
  Object.assign(state,{site,taxonomy,inventory});
  buildSelects(); initMap(); bind();
}
function buildSelects(){
  state.taxonomy.materials.forEach(v=>$('material').add(new Option(v,v)));
  state.taxonomy.forms.forEach(v=>$('form').add(new Option(v,v)));
}
function initMap(){
  const c=state.site.center; state.map=L.map('map',{zoomControl:true}).setView([c.latitude,c.longitude],state.site.zoom||17);
  const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:'Tiles © Esri'}).addTo(state.map);
  const streets=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'});
  L.control.layers({Satellite:satellite,Streets:streets}).addTo(state.map);
  if(state.site.boundary?.length>=3){state.boundary=L.polygon(state.site.boundary.map(p=>[p.latitude,p.longitude]),{color:'#9b3d22',weight:3,fillOpacity:.08}).addTo(state.map);state.map.fitBounds(state.boundary.getBounds(),{padding:[20,20]});}
}
function bind(){
  $('searchButton').addEventListener('click',runSearch); $('query').addEventListener('keydown',e=>{if(e.key==='Enter')runSearch()}); $('clearSearch').addEventListener('click',clearSearch);
}
function recordText(r){const alias=state.taxonomy.aliases[norm(r.form)]||[];return norm([r.material,r.form,r.title,r.description,r.landmark,r.notes,...(r.attributes||[]),...(r.tags||[]),...alias].join(' '));}
function scoreRecord(r,material,form,query){
  const text=recordText(r),terms=norm(query).split(' ').filter(Boolean); let score=0,max=0;
  if(material){max+=40;if(norm(r.material)===norm(material))score+=40;else if(text.includes(norm(material)))score+=20;}
  if(form){max+=40;if(norm(r.form)===norm(form))score+=40;else if(text.includes(norm(form)))score+=22;}
  terms.forEach(t=>{max+=8;if(text.includes(t))score+=8;});
  if(!material&&!form&&!terms.length)return 0; return Math.round((score/Math.max(max,1))*100);
}
function runSearch(){
  const material=$('material').value,form=$('form').value,query=$('query').value;
  if(!material&&!form&&!query.trim()){setStatus('Describe at least one material, geometry, or search term.');return;}
  clearMarkers();
  const matches=state.inventory.map(r=>({...r,_score:scoreRecord(r,material,form,query)})).filter(r=>r._score>0).sort((a,b)=>b._score-a._score);
  renderResults(matches); matches.forEach(addMarker);
  $('resultCount').textContent=matches.length;
  if(matches.length){const group=L.featureGroup(matches.map(r=>state.markers.get(r.id)));state.map.fitBounds(group.getBounds(),{padding:[40,40],maxZoom:19});setStatus(`${matches.length} likely location${matches.length===1?'':'s'} revealed. Select a result to inspect it.`)}
  else setStatus('No likely locations found. Try a broader material name, geometry, color, condition, or ordinary term.');
}
function setStatus(t){$('status').textContent=t}
function clearSearch(){ $('material').value='';$('form').value='';$('query').value='';clearMarkers();$('results').innerHTML='<p class="empty-state">Search results will appear here with photos and directions.</p>';$('resultCount').textContent='0';setStatus('Material locations remain hidden until you search.');state.map.setView([state.site.center.latitude,state.site.center.longitude],state.site.zoom||17);}
function clearMarkers(){state.markers.forEach(m=>m.remove());state.markers.clear();}
function addMarker(r){const p=r.materialLocation||r.cameraLocation;if(!p)return;const m=L.marker([p.latitude,p.longitude]).addTo(state.map);m.bindPopup(`<strong>${esc(r.title)}</strong>${r.demo?'<br><span class="demo-label">DEMO LOCATION</span>':''}<br><img src="${esc(r.images?.[0]||'')}" alt="${esc(r.title)}"><br>${esc(r.description)}<br><small>${esc(r.landmark||'')}</small>`);state.markers.set(r.id,m)}
function renderResults(matches){const el=$('results');el.innerHTML='';if(!matches.length){el.innerHTML='<p class="empty-state">No matches yet.</p>';return;}matches.forEach(r=>{const card=document.createElement('article');card.className='result-card';card.innerHTML=`<img src="${esc(r.images?.[0]||'')}" alt="${esc(r.title)}"><div><p class="score">${r._score}% text match ${r.demo?'· DEMO':''}</p><h3>${esc(r.title)}</h3><p>${esc(r.material)} · ${esc(r.form)}</p><p>${esc(r.landmark||'Location description pending')}</p></div>`;card.addEventListener('click',()=>{const m=state.markers.get(r.id);if(m){state.map.setView(m.getLatLng(),19);m.openPopup();}});el.appendChild(card);});}
function esc(v){return (v??'').toString().replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
load().catch(e=>setStatus(e.message));
