// --- 1. GLOBAL VARIABLES ---
let currentUserCoords = null;
let markersByCategory = {}; // Correct Object structure
let is3D = false;
let isCompassMode = false;
let geolocation = null;
let positionFeature = new ol.Feature(); 

const WAQI_TOKEN = '14f75b5c2a7941f401e0cae7e48d9f21ffba9d6b';

// --- 2. SETUP MAP ---
const defaultCenter = ol.proj.fromLonLat([78.9629, 20.5937]);

// Street Layer
const streetLayer = new ol.layer.Tile({
    source: new ol.source.OSM(),
    visible: true 
});

// Satellite Layer
const satelliteLayer = new ol.layer.Tile({
    source: new ol.source.XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 19,
        attributions: 'Tiles © Esri'
    }),
    visible: false 
});

// Map Init
var map = new ol.Map({
    target: 'map',
    layers: [satelliteLayer, streetLayer],
    view: new ol.View({
        center: defaultCenter,
        zoom: 5
    }),
    controls: []
});

// --- 3. LAYERS & STYLES ---
const vectorSource = new ol.source.Vector();
const vectorLayer = new ol.layer.Vector({
    source: vectorSource,
    style: function (feature) {
        const type = feature.get('type');
        if (type === 'route') {
            return new ol.style.Style({ stroke: new ol.style.Stroke({ width: 6, color: '#4285F4' }) });
        }
        if (type === 'icon') {
            return new ol.style.Style({
                image: new ol.style.Icon({
                    anchor: [0.5, 1],
                    scale: 0.08, 
                    src: feature.get('iconUrl')
                })
            });
        }
        if (type === 'geoMarker') {
            return new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 8,
                    fill: new ol.style.Fill({ color: '#3399CC' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 3 })
                })
            });
        }
    }
});
map.addLayer(vectorLayer);

// --- 4. HELPER FUNCTIONS ---
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

// Input Handling
const inputs = ['source-input', 'dest-input'];
inputs.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('focus', () => { if(el.value.includes('Your')) el.value = ''; });
    el.addEventListener('blur', () => { if(el.value === '') el.value = el.getAttribute('placeholder'); });
});

// --- 5. LOCATION & COMPASS LOGIC (Fixed) ---

function askLocationPermission() {
    document.getElementById('location-modal').style.display = 'flex';
}

function denyLocation() {
    document.getElementById('location-modal').style.display = 'none';
}

function allowLocation() {
    document.getElementById('location-modal').style.display = 'none';
    startTracking();
}

function startTracking() {
    if(geolocation) return; // Already tracking

    geolocation = new ol.Geolocation({
        trackingOptions: { enableHighAccuracy: true },
        projection: map.getView().getProjection(),
    });

    geolocation.setTracking(true);
    positionFeature.set('type', 'geoMarker'); 
    vectorSource.addFeature(positionFeature);

    // Position Change Logic
    geolocation.on('change:position', function () {
        const coordinates = geolocation.getPosition(); // Returns Web Mercator [x, y]
        const heading = geolocation.getHeading() || 0;
        
        positionFeature.setGeometry(coordinates ? new ol.geom.Point(coordinates) : null);

        // 👇 NEW LOGIC: Input Field Auto-Fill 👇
        if (coordinates) {
            // Save coordinates for Routing logic later
            currentUserCoords = coordinates; 

            // Input box update karo (Sirf agar wo khali hai ya default hai)
            const srcInput = document.getElementById('source-input');
            if (srcInput.value === 'Your Location' || srcInput.value === '') {
                srcInput.value = "My Current Location";
                srcInput.style.color = "#2ecc71"; // Green Text
                srcInput.style.fontWeight = "bold";
            }
        }
        // 👆 NEW LOGIC END 👆

        // Compass Mode Logic
        if (isCompassMode && coordinates) {
            const view = map.getView();
            view.setCenter(coordinates);
            if (heading) {
                view.setRotation(-heading);
                const btnIcon = document.querySelector('#btnCompass i');
                if(btnIcon) btnIcon.style.transform = `rotate(${heading}rad)`;
            }
        }
    });

    geolocation.on('error', function (error) {
        // Agar error aaye to chupchap raho, user manually daal lega
        console.log("Location access denied.");
    });
}

function toggleCompassMode() {
    const btn = document.getElementById('btnCompass');
    const view = map.getView();

    // 1. Agar tracking shuru nahi hui hai, to permission mango
    if (!geolocation || !geolocation.getTracking()) {
        askLocationPermission();
        return;
    }

    // 2. Toggle Mode
    isCompassMode = !isCompassMode;

    if (isCompassMode) {
        btn.classList.add('active');
        
        // Turant Re-center karo
        const pos = geolocation.getPosition();
        if(pos) {
            view.animate({ center: pos, duration: 500, zoom: 16 }); // Thoda Zoom bhi karega
        } else {
            alert("Waiting for GPS signal..."); // Agar location abhi fetch nahi hui
        }

    } else {
        btn.classList.remove('active');
        view.animate({ rotation: 0, duration: 500 });
        const btnIcon = document.querySelector('#btnCompass i');
        if(btnIcon) btnIcon.style.transform = 'rotate(0deg)';
    }
}

// --- 6. ROUTING & API FUNCTIONS ---

async function getCoords(query) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.length ? { lat: data[0].lat, lon: data[0].lon } : null;
    } catch(e) { return null; }
}
// --- Helper: Get AQI Value for Calculation ---
async function getRawAQI(lat, lon) {
    if (!WAQI_TOKEN) return 50; // Agar token nahi hai to default Moderate man lo
    try {
        const res = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`);
        const data = await res.json();
        if (data.status === 'ok') {
            return data.data.aqi;
        } else {
            return 50; // Fallback default
        }
    } catch (e) {
        return 50; // Error aane par default value
    }
}

async function updateWeather(lat, lon) {
    try {
        const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const wData = await wRes.json();
        document.getElementById('temp-val').innerText = Math.round(wData.current_weather.temperature) + "°C";
        
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

// Global variable to store current routes data
let allAnalyzedRoutes = [];
let routeLayers = []; // To manage map lines

// --- Helper Function to Shift Coordinates (Demo ke liye) ---
function getShiftedCoordinates(coords, latOffset, lonOffset) {
    return coords.map((coord, index) => {
        // Start (0) aur End (last) point ko mat hilana, taki destination sahi rahe
        if (index === 0 || index === coords.length - 1) return coord;
        
        // Beech ke points ko thoda shift karo [Lon, Lat]
        return [coord[0] + lonOffset, coord[1] + latOffset];
    });
}

async function initiateRoute() {
    const country = document.getElementById('country-input').value;
    let srcTxt = document.getElementById('source-input').value;
    let dstTxt = document.getElementById('dest-input').value;
    const btn = document.querySelector('.btn-go');

    if (srcTxt.trim() === "" || dstTxt.trim() === "" || country.trim() === "") {
        showCustomModal("Details Missing", "Please enter Country, Start, and Destination.");
        return; 
    }

    btn.innerText = "Generating Options...";
    
    // Cleanup
    vectorSource.clear();
    markersByCategory = {}; 
    document.querySelectorAll('.fab').forEach(b => b.classList.remove('active'));
    routeLayers.forEach(l => map.removeLayer(l)); routeLayers = []; 

    // Get Coordinates
    let start;
    if (srcTxt === "My Current Location" && currentUserCoords) {
        const lonLat = ol.proj.toLonLat(currentUserCoords);
        start = { lat: lonLat[1], lon: lonLat[0] };
    } else {
        start = await getCoords(`${srcTxt}, ${country}`);
    }
    let end = await getCoords(`${dstTxt}, ${country}`);

    if(!start || !end) { 
        showCustomModal("Location Error", "Locations not found."); btn.innerText = "Start Journey 🚀"; return; 
    }

    // UI Updates
    document.getElementById('landing-overlay').style.transform = "translateY(-120%)";
    document.getElementById('back-btn').style.display = "flex";

    addMarker(start.lat, start.lon, 'https://cdn-icons-png.flaticon.com/512/3253/3253110.png'); 
    addMarker(end.lat, end.lon, 'https://cdn-icons-png.flaticon.com/512/684/684908.png'); 

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`;

    try {
        const res = await fetch(osrmUrl);
        const data = await res.json();

        if(data.routes && data.routes.length > 0) {
            localStorage.setItem('eco_trip_active', 'true');
            localStorage.setItem('eco_start_lat', start.lat);
            localStorage.setItem('eco_start_lon', start.lon);
            localStorage.setItem('eco_end_lat', end.lat);
            localStorage.setItem('eco_end_lon', end.lon);
            localStorage.setItem('eco_src_txt', srcTxt);
            localStorage.setItem('eco_dst_txt', dstTxt);
            localStorage.setItem('eco_country', country);
            let rawRoutes = data.routes;

            // --- 🛠️ DEMO MAGIC (UPDATED) ---
            if (rawRoutes.length === 1) {
                const original = rawRoutes[0];
                
                // --- Route B (Alternative 1) ---
                const routeB = JSON.parse(JSON.stringify(original));
                routeB.duration = original.duration * 1.15; 
                routeB.distance = original.distance * 1.10;
                // 👇 SHIFT LOGIC: Thoda North-East shift karo
                routeB.geometry.coordinates = getShiftedCoordinates(original.geometry.coordinates, 0.005, 0.005);

                // --- Route C (Alternative 2) ---
                const routeC = JSON.parse(JSON.stringify(original));
                routeC.duration = original.duration * 0.95; 
                routeC.distance = original.distance * 0.98;
                // 👇 SHIFT LOGIC: Thoda South-West shift karo
                routeC.geometry.coordinates = getShiftedCoordinates(original.geometry.coordinates, -0.005, -0.005);

                rawRoutes = [original, routeB, routeC];
                console.log("Demo Mode: Created visually distinct routes.");
            }
            // -----------------------------

            // Analyze Routes
            const processedRoutes = await Promise.all(rawRoutes.map(async (route, index) => {
                const midIndex = Math.floor(route.geometry.coordinates.length / 2);
                const midCoords = route.geometry.coordinates[midIndex];
                let aqi = await getRawAQI(midCoords[1], midCoords[0]);

                // Demo AQI variation
                if (index === 1) aqi = Math.max(30, aqi - 40); 
                if (index === 2) aqi = aqi + 50; 

                const pollutionScore = (route.distance / 1000) * aqi; 

                return {
                    id: index,
                    routeObj: route,
                    aqi: aqi,
                    duration: route.duration, 
                    distance: route.distance, 
                    pScore: pollutionScore
                };
            }));

            // Stats Calculation
            const maxDuration = Math.max(...processedRoutes.map(r => r.duration));
            const maxPollution = Math.max(...processedRoutes.map(r => r.pScore));

            allAnalyzedRoutes = processedRoutes.map(r => {
                let timeSaved = ((maxDuration - r.duration) / maxDuration) * 100;
                let healthSaved = ((maxPollution - r.pScore) / maxPollution) * 100;
                return { ...r, timeSaved: Math.max(0, timeSaved), healthSaved: Math.max(0, healthSaved) };
            });

            renderRouteSelectionUI(allAnalyzedRoutes);
            selectRoute(0); // Select first by default
            
            updateWeather(start.lat, start.lon);
            if(!is3D) toggle3DMode();
        }
    } catch(e) {
        console.error(e);
        showCustomModal("Error", "Routing failed.");
    }
    btn.innerText = "Start Journey 🚀";
}

// --- NEW FUNCTION: UI Banane ke liye ---
function renderRouteSelectionUI(routes) {
    const panel = document.getElementById('route-selection-panel');
    const list = document.getElementById('routes-list');
    list.innerHTML = ''; // Clear old

    routes.forEach((r, index) => {
        const timeMin = Math.round(r.duration / 60);
        const distKm = (r.distance / 1000).toFixed(1);
        
        // Dynamic Badges
        let badgesHtml = '';
        if (r.healthSaved > 0) badgesHtml += `<span class="badge badge-health">💚 +${Math.round(r.healthSaved)}% Health</span>`;
        if (r.timeSaved > 0) badgesHtml += `<span class="badge badge-time">⚡ +${Math.round(r.timeSaved)}% Time</span>`;
        if (badgesHtml === '') badgesHtml = `<span class="badge badge-warn">⚠️ Standard Route</span>`;

        const card = document.createElement('div');
        card.className = `route-card`;
        card.id = `route-card-${index}`;
        card.onclick = () => selectRoute(index);
        
        card.innerHTML = `
            <div class="route-header">
                <span>Route ${String.fromCharCode(65 + index)}</span> <span>${timeMin} min</span>
            </div>
            <div class="route-stats">
                <span>${distKm} km</span> | <span>AQI: ${r.aqi}</span>
            </div>
            <div class="badges">${badgesHtml}</div>
        `;
        list.appendChild(card);
    });

    panel.style.display = 'flex'; // Show panel
}

// --- NEW FUNCTION: Route Select karne par ---
function selectRoute(index) {
    const selectedData = allAnalyzedRoutes[index];
    const route = selectedData.routeObj;

    // 1. Map Layers Clear karo (Sirf purani route lines)
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];

    // 2. Draw ALL routes (Grey color for unselected)
    allAnalyzedRoutes.forEach(r => {
        const isSelected = (r.id === index);
        const color = isSelected ? '#4285F4' : '#bdc3c7'; // Blue vs Grey
        const width = isSelected ? 6 : 4;
        const zIndex = isSelected ? 10 : 1; // Selected upar rahega

        const routeFeature = new ol.format.GeoJSON().readFeature(r.routeObj.geometry, {
            dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
        });

        const vectorSourceRoute = new ol.source.Vector({ features: [routeFeature] });
        const vectorLayerRoute = new ol.layer.Vector({
            source: vectorSourceRoute,
            style: new ol.style.Style({
                stroke: new ol.style.Stroke({ width: width, color: color }),
                zIndex: zIndex
            })
        });
        
        map.addLayer(vectorLayerRoute);
        routeLayers.push(vectorLayerRoute); // Track layer to remove later
    });

    // 3. Highlight Card UI
    document.querySelectorAll('.route-card').forEach(c => c.classList.remove('selected'));
    document.getElementById(`route-card-${index}`).classList.add('selected');

    // 4. Update HUD Stats
    document.getElementById('dist-rem').innerText = (route.distance / 1000).toFixed(1) + " km";
    document.getElementById('time-rem').innerText = Math.round(route.duration / 60) + " min";
    document.getElementById('nav-hud').style.display = 'flex'; // Stats dikhao

    // 5. Fit Map
    const extent = routeLayers[index].getSource().getExtent(); // Fit to selected route
    map.getView().fit(extent, { padding: [50, 50, 200, 50], duration: 1000 });
}
// --- 7. SEARCH & TOGGLE FUNCTIONS ---

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
    let btnClass = '';
    if(type === 'restaurant') btnClass = '.btn-food';
    else if(type === 'hotel') btnClass = '.btn-hotel';
    else if(type === 'hospital') btnClass = '.btn-hospital';
    else if(type === 'gas_station') btnClass = '.btn-fuel';
    else if(type === 'shopping_mall') btnClass = '.btn-mall';

    const btn = document.querySelector(btnClass);

    if (!markersByCategory[type]) markersByCategory[type] = [];

    if (btn.classList.contains('active')) {
        markersByCategory[type].forEach(f => vectorSource.removeFeature(f));
        markersByCategory[type] = [];
        btn.classList.remove('active');
        return;
    }

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
            showCustomModal("No Results Found", `Sorry! No <b>${type.replace('_', ' ')}</b> found nearby.`);
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
            markersByCategory[type].push(marker);
        });

    } catch(e) {
        btn.style.opacity = "1";
        showCustomModal("Error", "Check internet connection.");
    }
}

// --- 8. UI, MODALS & END TRIP ---

function showCustomModal(title, message) {
    const modal = document.getElementById('error-modal');
    if (!modal) { alert(message); return; }

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

function openRatingModal() {
    // 👇 1. YAHAN SABSE BADA CHANGE HAI: DATA DELETE KARO 👇
    console.log("Ending Trip... Clearing Data.");
    
    localStorage.removeItem('eco_trip_active'); // Flag hatao
    localStorage.removeItem('eco_start_lat');
    localStorage.removeItem('eco_start_lon');
    localStorage.removeItem('eco_end_lat');
    localStorage.removeItem('eco_end_lon');
    localStorage.removeItem('eco_src_txt');
    localStorage.removeItem('eco_dst_txt');
    localStorage.removeItem('eco_country');
    
    // 👆 DATA DELETE HO GAYA 👆

    // 2. Ab Rating Modal dikhao
    document.getElementById('rating-modal').style.display = 'flex';
}

function rateStar(n) {
    for (let i = 1; i <= 5; i++) {
        const star = document.getElementById(`star-${i}`);
        if (i <= n) {
            star.classList.add('active'); star.classList.remove('far'); star.classList.add('fas');
        } else {
            star.classList.remove('active');
        }
    }
}

function showThankYouScreen() {
    document.getElementById('rating-modal').style.display = 'none';
    document.getElementById('thank-you-screen').style.display = 'flex';
}

function resetAppFull() {
    location.reload();
}

// --- 21. SESSION RESTORE (Mini Backend) ---

function enterApp() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const mainApp = document.getElementById('main-app');
    mainApp.style.display = 'block';
    map.updateSize();

    setTimeout(() => {
        welcomeScreen.classList.add('slide-up-exit');
        mainApp.classList.add('app-enter-active');
        
        setTimeout(() => { 
            askLocationPermission(); 
            const isActive = localStorage.getItem('eco_trip_active');
            
            if (isActive === 'true') {
                console.log("Restoring previous session...");

                document.getElementById('country-input').value = localStorage.getItem('eco_country');
                document.getElementById('source-input').value = localStorage.getItem('eco_src_txt');
                document.getElementById('dest-input').value = localStorage.getItem('eco_dst_txt');
                initiateRoute();
            }

        }, 500); 
    }, 50);

    setTimeout(() => { welcomeScreen.style.display = 'none'; }, 800); 
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
        countryList.forEach(c => {
            const option = document.createElement('option');
            option.value = c;
            dataList.appendChild(option);
        });
    }

    const isActive = localStorage.getItem('eco_trip_active');

    if (isActive === 'true') {
        console.log("Found active session. Bypassing welcome screen...");
       
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        document.getElementById('main-app').classList.add('app-enter-active');

        document.getElementById('country-input').value = localStorage.getItem('eco_country');
        document.getElementById('source-input').value = localStorage.getItem('eco_src_txt');
        document.getElementById('dest-input').value = localStorage.getItem('eco_dst_txt');

        map.updateSize();
        
        setTimeout(() => {
            initiateRoute();
            if(localStorage.getItem('eco_start_lat')) {
                 askLocationPermission();
            }
        }, 500);

    } 
});

const imageUrls = [
    "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=80&w=2021&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=2560&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1483921020237-2ff51e8e4b22?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1495954484750-af469f2f9be5?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=2089&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?q=80&w=2070&auto=format&fit=crop"
];

imageUrls.forEach((url) => {
    const img = new Image();
    img.src = url;
});

let bgIndex = Math.floor(Math.random() * imageUrls.length);

const overlay = document.getElementById('landing-overlay');
if(overlay) {
    overlay.style.backgroundImage = `url("${imageUrls[bgIndex]}")`;
}

function changeBackground() {
    const overlay = document.getElementById('landing-overlay');
    
    if (overlay && overlay.style.display !== 'none' && !overlay.classList.contains('slide-up-exit')) {
        bgIndex = (bgIndex + 1) % imageUrls.length;

        overlay.style.backgroundImage = `url("${imageUrls[bgIndex]}")`;
    }
}

setInterval(changeBackground, 5000);

function toggleRoutePanel() {
    const panel = document.getElementById('route-selection-panel');
    panel.classList.toggle('minimized');
}