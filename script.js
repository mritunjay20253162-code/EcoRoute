// --- 1. GLOBAL VARIABLES ---
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
        const coordinates = geolocation.getPosition();
        const heading = geolocation.getHeading() || 0;
        
        positionFeature.setGeometry(coordinates ? new ol.geom.Point(coordinates) : null);

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
        alert("Location access denied or unavailable.");
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

async function initiateRoute() {
    const country = document.getElementById('country-input').value;
    let srcTxt = document.getElementById('source-input').value;
    let dstTxt = document.getElementById('dest-input').value;
    const btn = document.querySelector('.btn-go');

    if (srcTxt.trim() === "" || dstTxt.trim() === "" || srcTxt === "Your Location" || dstTxt === "Your Destination" || country.trim() === "") {
        showCustomModal("Details Missing", "Please enter <b>Country</b>, <b>Location</b>, and <b>Destination</b>.");
        return; 
    }

    btn.innerText = "Routing...";
    
    // Clear old data
    vectorSource.clear();
    markersByCategory = {}; 
    document.querySelectorAll('.fab').forEach(b => b.classList.remove('active'));

    let start = await getCoords(`${srcTxt}, ${country}`);
    let end = await getCoords(`${dstTxt}, ${country}`);

    if(!start || !end) { 
        showCustomModal("Location Error", "Could not find location. Please check spelling.");
        btn.innerText = "Start Journey 🚀"; 
        return; 
    }

    // UI Updates
    document.getElementById('landing-overlay').style.transform = "translateY(-120%)";
    document.getElementById('back-btn').style.display = "flex";
    document.getElementById('nav-hud').style.display = "flex";
    document.getElementById('turn-hud').style.display = "flex";

    addMarker(start.lat, start.lon, 'https://cdn-icons-png.flaticon.com/512/3253/3253110.png'); 
    addMarker(end.lat, end.lon, 'https://cdn-icons-png.flaticon.com/512/684/684908.png'); 

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

            // Ask for Location after 1 second
            setTimeout(() => { askLocationPermission(); }, 1000);
        }
    } catch(e) {
        showCustomModal("Routing Error", "Could not calculate route.");
        console.error(e);
    }
    btn.innerText = "Start Journey 🚀";
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

// --- 14. DYNAMIC BACKGROUND SLIDESHOW (No Blink / Preloaded) ---

// 1. Sirf Image Links (Bina 'url()' ke)
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

// 2. IMAGE PRELOADER (Ye Blink hone se rokega)
// Ye loop chup-chaap saari photos download kar lega
imageUrls.forEach((url) => {
    const img = new Image();
    img.src = url;
});

// 3. Random Start
let bgIndex = Math.floor(Math.random() * imageUrls.length);

// Page load par pehli image set karo
const overlay = document.getElementById('landing-overlay');
if(overlay) {
    overlay.style.backgroundImage = `url("${imageUrls[bgIndex]}")`;
}

// 4. Background Changer Function
function changeBackground() {
    const overlay = document.getElementById('landing-overlay');
    
    // Check karo ki overlay visible hai ya nahi
    if (overlay && overlay.style.display !== 'none' && !overlay.classList.contains('slide-up-exit')) {
        bgIndex = (bgIndex + 1) % imageUrls.length; // Next Index
        
        // Image Update
        overlay.style.backgroundImage = `url("${imageUrls[bgIndex]}")`;
    }
}

// Har 5 second mein change karo
setInterval(changeBackground, 5000);