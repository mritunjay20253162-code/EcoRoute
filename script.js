// --- 1. SETUP MAP (OpenLayers) ---
const defaultCenter = ol.proj.fromLonLat([78.9629, 20.5937]); // India Center

var map = new ol.Map({
    target: 'map',
    layers: [
        new ol.layer.Tile({
            source: new ol.source.OSM() // OpenStreetMap Tiles
        })
    ],
    view: new ol.View({
        center: defaultCenter,
        zoom: 5
    }),
    controls: [] // Empty to remove default zoom buttons
});

// Layer for Route Lines and Markers
const vectorSource = new ol.source.Vector();
const vectorLayer = new ol.layer.Vector({
    source: vectorSource,
    style: function (feature) {
        // Style logic for Route Line vs Markers
        const type = feature.get('type');
        if (type === 'route') {
            return new ol.style.Style({
                stroke: new ol.style.Stroke({ width: 6, color: '#4285F4' })
            });
        }
        if (type === 'icon') {
            return new ol.style.Style({
                image: new ol.style.Icon({
                    anchor: [0.5, 1],
                    scale: 0.08, // Adjust icon size
                    src: feature.get('iconUrl') || 'https://cdn-icons-png.flaticon.com/512/684/684908.png'
                })
            });
        }
    }
});
map.addLayer(vectorLayer);

// --- 2. LOGIC VARIABLES ---
let is3D = false;
const WAQI_TOKEN = '14f75b5c2a7941f401e0cae7e48d9f21ffba9d6b';

// --- 3. HELPER FUNCTIONS ---

// Convert Lat/Lon to Map Projection
function toMapCoords(lat, lon) {
    return ol.proj.fromLonLat([parseFloat(lon), parseFloat(lat)]);
}

// Add Marker Function
function addMarker(lat, lon, iconUrl) {
    const marker = new ol.Feature({
        geometry: new ol.geom.Point(toMapCoords(lat, lon)),
        type: 'icon',
        iconUrl: iconUrl
    });
    vectorSource.addFeature(marker);
}

// Input handling
const inputs = ['source-input', 'dest-input'];
inputs.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('focus', () => { if(el.value.includes('Your')) el.value = ''; });
    el.addEventListener('blur', () => { if(el.value === '') el.value = el.getAttribute('placeholder'); });
});

// --- 4. CORE FEATURES ---

async function getCoords(query) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.length ? { lat: data[0].lat, lon: data[0].lon } : null;
    } catch(e) { return null; }
}

async function updateWeather(lat, lon) {
    try {
        // Weather
        const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const wData = await wRes.json();
        document.getElementById('temp-val').innerText = Math.round(wData.current_weather.temperature) + "°C";
        
        // AQI
        if(WAQI_TOKEN) {
            const aRes = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`);
            const aData = await aRes.json();
            if(aData.status === 'ok') {
                const aqi = aData.data.aqi;
                const el = document.getElementById('aqi-val');
                el.innerText = aqi;
                el.style.color = aqi <= 50 ? '#2ecc71' : (aqi <= 100 ? '#f1c40f' : '#e74c3c');
            }
        }
    } catch(e) {}
}

// --- 5. ROUTING LOGIC (Using OSRM API manually) ---
async function initiateRoute() {
    const country = document.getElementById('country-input').value;
    let srcTxt = document.getElementById('source-input').value;
    let dstTxt = document.getElementById('dest-input').value;
    const btn = document.querySelector('.btn-go');

    btn.innerText = "Routing...";
    
    // 1. Get Coordinates
    let start = await getCoords(`${srcTxt}, ${country}`);
    let end = await getCoords(`${dstTxt}, ${country}`);

    if(!start || !end) { alert("Location not found"); btn.innerText = "Start Journey 🚀"; return; }

    // 2. UI Updates
    document.getElementById('landing-overlay').style.transform = "translateY(-120%)";
    document.getElementById('back-btn').style.display = "flex";
    document.getElementById('nav-hud').style.display = "flex";
    document.getElementById('turn-hud').style.display = "flex";

    // 3. Clear old layers
    vectorSource.clear();

    // 4. Add Start/End Markers
    addMarker(start.lat, start.lon, 'https://cdn-icons-png.flaticon.com/512/3253/3253110.png'); // Start Dot
    addMarker(end.lat, end.lon, 'https://cdn-icons-png.flaticon.com/512/684/684908.png'); // End Flag

    // 5. Fetch Route from OSRM
    // OSRM expects coordinates as "lon,lat"
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=true`;

    try {
        const res = await fetch(osrmUrl);
        const data = await res.json();

        if(data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            
            // Update Stats
            document.getElementById('dist-rem').innerText = (route.distance / 1000).toFixed(1) + " km";
            document.getElementById('time-rem').innerText = Math.round(route.duration / 60) + " min";
            
            // Draw Route Line
            const routeFeature = new ol.format.GeoJSON().readFeature(route.geometry, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
            });
            routeFeature.set('type', 'route');
            vectorSource.addFeature(routeFeature);

            // Fit map to route
            map.getView().fit(vectorSource.getExtent(), { padding: [100, 100, 100, 100], duration: 1000 });

            // Update Weather
            updateWeather(start.lat, start.lon);

            // Show Turn Instruction (First step)
            if(route.legs[0].steps.length > 0) {
                const step = route.legs[0].steps[0];
                document.getElementById('turn-msg').innerText = step.maneuver.type + " " + (step.name || "ahead");
            }

            // Auto switch to 3D
            if(!is3D) toggle3DMode();
        }

    } catch(e) {
        alert("Routing failed. Try again.");
        console.error(e);
    }
    btn.innerText = "Start Journey 🚀";
}

// --- 6. CONTROLS ---
function toggleDarkMode() { document.body.classList.toggle('dark-mode'); }

function toggle3DMode() {
    is3D = !is3D;
    const mapEl = document.getElementById('map');
    const btn = document.getElementById('btn3d');
    
    if(is3D) {
        mapEl.classList.add('view-3d');
        btn.classList.add('active');
    } else {
        mapEl.classList.remove('view-3d');
        btn.classList.remove('active');
    }
    map.updateSize();
}

function zoomIn() { 
    const view = map.getView();
    view.animate({zoom: view.getZoom() + 1, duration: 250});
}
function zoomOut() { 
    const view = map.getView();
    view.animate({zoom: view.getZoom() - 1, duration: 250});
}