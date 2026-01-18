// --- 1. GLOBAL VARIABLES ---
let nearbyFeatures = []; // Track markers to remove them later
let is3D = false;
const WAQI_TOKEN = '14f75b5c2a7941f401e0cae7e48d9f21ffba9d6b';

// --- 2. SETUP MAP (Satellite & Street) ---
const defaultCenter = ol.proj.fromLonLat([78.9629, 20.5937]);

// Street Layer (Normal Map)
const streetLayer = new ol.layer.Tile({
    source: new ol.source.OSM(),
    visible: true 
});

// Satellite Layer (Real Imagery)
const satelliteLayer = new ol.layer.Tile({
    source: new ol.source.XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 19,
        attributions: 'Tiles © Esri'
    }),
    visible: false 
});

// Map Initialization
var map = new ol.Map({
    target: 'map',
    layers: [satelliteLayer, streetLayer],
    view: new ol.View({
        center: defaultCenter,
        zoom: 5
    }),
    controls: []
});

// --- 3. LAYERS & MARKERS ---
const vectorSource = new ol.source.Vector();
const vectorLayer = new ol.layer.Vector({
    source: vectorSource,
    style: function (feature) {
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

// Helper Functions
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

// --- 4. API FUNCTIONS (Weather, Coords, Route) ---

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

async function initiateRoute() {
    const country = document.getElementById('country-input').value;
    let srcTxt = document.getElementById('source-input').value;
    let dstTxt = document.getElementById('dest-input').value;
    const btn = document.querySelector('.btn-go');

    // Validation
    if (srcTxt.trim() === "" || dstTxt.trim() === "" || srcTxt === "Your Location" || dstTxt === "Your Destination" || country.trim() === "") {
        showCustomModal("Details Missing", "Please enter <b>Country</b>, <b>Location</b>, and <b>Destination</b> to start.");
        return; 
    }

    btn.innerText = "Routing...";
    
    let start = await getCoords(`${srcTxt}, ${country}`);
    let end = await getCoords(`${dstTxt}, ${country}`);

    if(!start || !end) { 
        showCustomModal("Location Error", "Could not find one of the locations. Please check spelling.");
        btn.innerText = "Start Journey 🚀"; 
        return; 
    }

    // UI Updates
    document.getElementById('landing-overlay').style.transform = "translateY(-120%)";
    document.getElementById('back-btn').style.display = "flex";
    document.getElementById('nav-hud').style.display = "flex";
    document.getElementById('turn-hud').style.display = "flex";

    // Clear & Markers
    vectorSource.clear();
    addMarker(start.lat, start.lon, 'https://cdn-icons-png.flaticon.com/512/3253/3253110.png'); 
    addMarker(end.lat, end.lon, 'https://cdn-icons-png.flaticon.com/512/684/684908.png'); 

    // OSRM Routing
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=true`;

    try {
        const res = await fetch(osrmUrl);
        const data = await res.json();

        if(data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            
            document.getElementById('dist-rem').innerText = (route.distance / 1000).toFixed(1) + " km";
            document.getElementById('time-rem').innerText = Math.round(route.duration / 60) + " min";
            
            const routeFeature = new ol.format.GeoJSON().readFeature(route.geometry, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
            });
            routeFeature.set('type', 'route');
            vectorSource.addFeature(routeFeature);

            map.getView().fit(vectorSource.getExtent(), { padding: [100, 100, 100, 100], duration: 1000 });
            updateWeather(start.lat, start.lon);

            if(route.legs[0].steps.length > 0) {
                const step = route.legs[0].steps[0];
                document.getElementById('turn-msg').innerText = step.maneuver.type + " " + (step.name || "ahead");
            }

            if(!is3D) toggle3DMode();
        }
    } catch(e) {
        showCustomModal("Routing Error", "Could not calculate route. Server might be busy.");
        console.error(e);
    }
    btn.innerText = "Start Journey 🚀";
}

// --- 5. SEARCH & TOGGLE LOGIC ---

function toggleSatellite() {
    const btn = document.getElementById('btnSat');
    const isSatOn = satelliteLayer.getVisible();

    if(isSatOn) {
        satelliteLayer.setVisible(false);
        streetLayer.setVisible(true);
        btn.classList.remove('active');
        btn.style.background = "white";
        btn.style.color = "#555";
    } else {
        satelliteLayer.setVisible(true);
        streetLayer.setVisible(false);
        btn.classList.add('active');
        btn.style.background = "#2ecc71";
        btn.style.color = "white";
    }
}

async function searchNearby(type) {
    // 1. Button Selection
    let btnClass = '';
    if(type === 'restaurant') btnClass = '.btn-food';
    else if(type === 'hotel') btnClass = '.btn-hotel';
    else if(type === 'hospital') btnClass = '.btn-hospital';
    else if(type === 'gas_station') btnClass = '.btn-fuel';
    else if(type === 'shopping_mall') btnClass = '.btn-mall';

    const btn = document.querySelector(btnClass);

    // 2. TOGGLE LOGIC
    if (btn.classList.contains('active')) {
        nearbyFeatures.forEach(f => vectorSource.removeFeature(f));
        nearbyFeatures = [];
        btn.classList.remove('active');
        return;
    }

    // Reset others
    document.querySelectorAll('.fab').forEach(b => b.classList.remove('active'));
    nearbyFeatures.forEach(f => vectorSource.removeFeature(f));
    nearbyFeatures = [];

    // 3. SEARCH LOGIC
    const view = map.getView();
    const extent = view.calculateExtent(map.getSize());
    const bottomLeft = ol.proj.toLonLat(ol.extent.getBottomLeft(extent));
    const topRight = ol.proj.toLonLat(ol.extent.getTopRight(extent));
    const viewbox = `${bottomLeft[0]},${topRight[1]},${topRight[0]},${bottomLeft[1]}`;

    console.log("Searching for:", type);
    btn.style.opacity = "0.7";

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${type}&limit=10&viewbox=${viewbox}&bounded=1`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        btn.style.opacity = "1";

        if(data.length === 0) { 
            // Yahan showCustomModal call ho raha hai, jo niche defined hai
            showCustomModal("No Results Found", `Sorry! No <b>${type.replace('_', ' ')}</b> found nearby.<br>Try zooming out or moving the map.`);
            return; 
        }

        btn.classList.add('active');

        let iconUrl = 'https://cdn-icons-png.flaticon.com/512/684/684908.png'; 
        if(type === 'restaurant') iconUrl = 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png';
        if(type === 'hotel') iconUrl = 'https://cdn-icons-png.flaticon.com/512/3009/3009489.png';
        if(type === 'hospital') iconUrl = 'https://cdn-icons-png.flaticon.com/512/4320/4320371.png';
        if(type === 'gas_station') iconUrl = 'https://cdn-icons-png.flaticon.com/512/1505/1505585.png';
        if(type === 'shopping_mall') iconUrl = 'https://cdn-icons-png.flaticon.com/512/3081/3081559.png';

        data.forEach(item => {
            const marker = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([parseFloat(item.lon), parseFloat(item.lat)])),
                type: 'icon',
                iconUrl: iconUrl
            });
            vectorSource.addFeature(marker);
            nearbyFeatures.push(marker);
        });

    } catch(e) {
        console.error(e);
        btn.style.opacity = "1";
        showCustomModal("Error", "Something went wrong. Check internet.");
    }
}

// --- 6. UI HELPERS (Modals, Country List, Transitions) ---

// THIS WAS MISSING IN YOUR CODE! 👇
function showCustomModal(title, message) {
    const modal = document.getElementById('error-modal');
    if (!modal) { alert(message); return; } // Safety fallback

    const h3 = modal.querySelector('h3');
    const p = modal.querySelector('p');
    const iconContainer = modal.querySelector('.modal-icon');
    const icon = modal.querySelector('.modal-icon i');

    if (h3) h3.innerText = title;
    if (p) p.innerHTML = message;
    
    if (icon && iconContainer) {
        if(title.includes("No Results")) {
            icon.className = "fas fa-search-minus"; 
            iconContainer.style.color = "#f39c12"; 
        } else {
            icon.className = "fas fa-exclamation-circle";
            iconContainer.style.color = "#e74c3c"; 
        }
    }
    modal.style.display = 'flex';
}

function closeErrorModal() {
    const modal = document.getElementById('error-modal');
    if(modal) modal.style.display = 'none';
}

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

// Country List
const countryList = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
    "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
    "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (Congo-Brazzaville)", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia (Czech Republic)",
    "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
    "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
    "Fiji", "Finland", "France",
    "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
    "Haiti", "Holy See", "Honduras", "Hungary",
    "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
    "Jamaica", "Japan", "Jordan",
    "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan",
    "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
    "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
    "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
    "Oman",
    "Pakistan", "Palau", "Palestine State", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
    "Qatar",
    "Romania", "Russia", "Rwanda",
    "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
    "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
    "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States of America", "Uruguay", "Uzbekistan",
    "Vanuatu", "Venezuela", "Vietnam",
    "Yemen",
    "Zambia", "Zimbabwe"
];

window.addEventListener('load', () => {
    const dataList = document.getElementById('country-list');
    if(dataList){
        dataList.innerHTML = '';
        countryList.forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            dataList.appendChild(option);
        });
    }
});