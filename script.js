
const defaultCenter = ol.proj.fromLonLat([78.9629, 20.5937]); 
var map = new ol.Map({
    target: 'map',
    layers: [
        new ol.layer.Tile({
            source: new ol.source.OSM() 
        })
    ],
    view: new ol.View({
        center: defaultCenter,
        zoom: 5
    }),
    controls: [] 
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
                    scale: 0.08, 
                    src: feature.get('iconUrl') || 'https://cdn-icons-png.flaticon.com/512/684/684908.png'
                })
            });
        }
    }
});
map.addLayer(vectorLayer);

let is3D = false;
const WAQI_TOKEN = '14f75b5c2a7941f401e0cae7e48d9f21ffba9d6b';

function toMapCoords(lat, lon) {
    return ol.proj.fromLonLat([parseFloat(lon), parseFloat(lat)]);
}

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

//ROUTING LOGIC (Using OSRM API manually)
async function initiateRoute() {
    const country = document.getElementById('country-input').value;
    let srcTxt = document.getElementById('source-input').value;
    let dstTxt = document.getElementById('dest-input').value;
    const btn = document.querySelector('.btn-go');

    btn.innerText = "Routing...";
    
    //Geting Coordinates
    let start = await getCoords(`${srcTxt}, ${country}`);
    let end = await getCoords(`${dstTxt}, ${country}`);

    if(!start || !end) { alert("Location not found"); btn.innerText = "Start Journey 🚀"; return; }

    //UI Updates
    document.getElementById('landing-overlay').style.transform = "translateY(-120%)";
    document.getElementById('back-btn').style.display = "flex";
    document.getElementById('nav-hud').style.display = "flex";
    document.getElementById('turn-hud').style.display = "flex";

    //Clear old layers
    vectorSource.clear();

    //Add Start/End Markers
    addMarker(start.lat, start.lon, 'https://cdn-icons-png.flaticon.com/512/3253/3253110.png'); // Start Dot
    addMarker(end.lat, end.lon, 'https://cdn-icons-png.flaticon.com/512/684/684908.png'); // End Flag

    //Fetch Route from OSRM
    //OSRM expects coordinates as "lon,lat"
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=true`;

    try {
        const res = await fetch(osrmUrl);
        const data = await res.json();

        if(data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            
            // Updating Stats
            document.getElementById('dist-rem').innerText = (route.distance / 1000).toFixed(1) + " km";
            document.getElementById('time-rem').innerText = Math.round(route.duration / 60) + " min";
            
            //Drawing Route Line
            const routeFeature = new ol.format.GeoJSON().readFeature(route.geometry, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
            });
            routeFeature.set('type', 'route');
            vectorSource.addFeature(routeFeature);

            // Fiting map to route
            map.getView().fit(vectorSource.getExtent(), { padding: [100, 100, 100, 100], duration: 1000 });

            // Updating Weather
            updateWeather(start.lat, start.lon);

            // Showing Turn Instruction (First step)
            if(route.legs[0].steps.length > 0) {
                const step = route.legs[0].steps[0];
                document.getElementById('turn-msg').innerText = step.maneuver.type + " " + (step.name || "ahead");
            }

            // Auto switching to 3D
            if(!is3D) toggle3DMode();
        }

    } catch(e) {
        alert("Routing failed. Try again.");
        console.error(e);
    }
    btn.innerText = "Start Journey 🚀";
}

//CONTROLS
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


//NEAREST SEARCH FUNCTION 

async function searchNearby(type) {
    const view = map.getView();
    
    // Screen ki boundary (Extent) nikalenge taaki hum sirf dikh rahe area mein search karein
    const extent = view.calculateExtent(map.getSize());
    
    // Coordinates ko convert karenge 
    const bottomLeft = ol.proj.toLonLat(ol.extent.getBottomLeft(extent));
    const topRight = ol.proj.toLonLat(ol.extent.getTopRight(extent));

    const viewbox = `${bottomLeft[0]},${topRight[1]},${topRight[0]},${bottomLeft[1]}`;

    console.log("Searching nearby:", type);

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${type}&limit=5&viewbox=${viewbox}&bounded=1`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if(data.length === 0) { 
            alert("Is area mein koi " + type + " nahi mila. Map thoda move karein."); 
            return; 
        }

        //setting icons
        let iconUrl = 'https://cdn-icons-png.flaticon.com/512/684/684908.png'; // Default
        if(type === 'hotel') iconUrl = 'https://cdn-icons-png.flaticon.com/512/3009/3009489.png';
        if(type === 'restaurant') iconUrl = 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png';

        //adding markers to map
        data.forEach(item => {
            addMarker(item.lat, item.lon, iconUrl);
        });

    } catch(e) {
        console.error("Search Error:", e);
        alert("Search failed. Internet check karein.");
    }
}

// countries list 
const countryList = [
    "India", "USA", "United Kingdom", "Canada", "Australia", "Germany", "France", 
    "Japan", "China", "Brazil", "Russia", "South Africa", "Italy", "Spain", 
    "Netherlands", "Switzerland", "Sweden", "New Zealand", "Singapore", "UAE",
    "Saudi Arabia", "Mexico", "Argentina", "Chile", "Colombia", "Egypt", "Turkey",
    "Thailand", "Vietnam", "Malaysia", "Indonesia", "Philippines", "South Korea",
    "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Afghanistan", "Iran", "Iraq",
    "Israel", "Portugal", "Belgium", "Austria", "Norway", "Denmark", "Finland",
    "Ireland", "Poland", "Ukraine", "Greece", "Hungary", "Czech Republic"
];

window.addEventListener('load', () => {
    const dataList = document.getElementById('country-list');
    
    dataList.innerHTML = '';

    countryList.forEach(country => {
        const option = document.createElement('option');
        option.value = country;
        dataList.appendChild(option);
    });
});


//WELCOME SCREEN LOGIC

function enterApp() {
    const welcomeScreen = document.getElementById('welcome-screen');
    welcomeScreen.style.opacity = '0'; // Fade out effect
    
    const mainApp = document.getElementById('main-app');
    mainApp.style.display = 'block';

    setTimeout(() => {
        welcomeScreen.style.display = 'none'; 
        
        map.updateSize(); 
        
    }, 500); // 0.5 second wait for fading
}


//WELCOME SCREEN LOGIC

function enterApp() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const mainApp = document.getElementById('main-app');

    mainApp.style.display = 'block';

    map.updateSize();

    setTimeout(() => {
        welcomeScreen.classList.add('slide-up-exit');
        
        mainApp.classList.add('app-enter-active');
    }, 50);

    setTimeout(() => {
        welcomeScreen.style.display = 'none';
    }, 800); 
}