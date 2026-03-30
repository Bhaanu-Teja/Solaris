/* ============================================================
   SOLARIS v2 — weather.js
   Live Weather Integration via Open-Meteo API (no API key)
   Updates cloud cover for all 8 nodes with real data
   ============================================================ */
'use strict';

const WeatherAPI = (() => {
    const LOCATIONS = [
        { name: 'San Francisco', lat: 37.7749,  lon: -122.4194 },
        { name: 'New York',      lat: 40.7128,  lon: -74.0060  },
        { name: 'London',        lat: 51.5074,  lon: -0.1278   },
        { name: 'Tokyo',         lat: 35.6762,  lon: 139.6503  },
        { name: 'Sydney',        lat: -33.8688, lon: 151.2093  },
        { name: 'Mumbai',        lat: 19.0760,  lon: 72.8777   },
        { name: 'Cairo',         lat: 30.0444,  lon: 31.2357   },
        { name: 'Moscow',        lat: 55.7558,  lon: 37.6173   },
    ];

    // Cached weather data per node
    const _cache = new Map();
    let _lastFetch = 0;
    const CACHE_TTL = 600_000; // 10 minutes

    // Fetch weather for one location from Open-Meteo
    const fetchOne = async (loc) => {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=cloudcover,temperature_2m,weathercode,windspeed_10m&hourly=cloudcover,direct_radiation&forecast_days=1&timezone=auto`;
        try {
            const res  = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const curr = data.current;
            // Build 24h irradiance from hourly direct_radiation if available
            const hourlyRad = data.hourly?.direct_radiation || [];
            return {
                name:        loc.name,
                lat:         loc.lat,
                lon:         loc.lon,
                cloudCover:  curr.cloudcover    ?? 30,
                temperature: curr.temperature_2m ?? 25,
                windSpeed:   curr.windspeed_10m  ?? 5,
                weatherCode: curr.weathercode    ?? 0,
                hourlyRad:   hourlyRad.slice(0, 24),
                fetchedAt:   Date.now(),
            };
        } catch {
            // Fallback: return simulated values
            return {
                name:        loc.name,
                lat:         loc.lat,
                lon:         loc.lon,
                cloudCover:  10 + Math.random() * 60,
                temperature: 15 + Math.random() * 25,
                windSpeed:   3  + Math.random() * 15,
                weatherCode: 0,
                hourlyRad:   [],
                fetchedAt:   Date.now(),
                simulated:   true,
            };
        }
    };

    // Fetch all locations (staggered to avoid rate limiting)
    const fetchAll = async () => {
        const now = Date.now();
        if (now - _lastFetch < CACHE_TTL && _cache.size === LOCATIONS.length) {
            return Array.from(_cache.values());
        }
        _lastFetch = now;

        // Update HUD
        const hudApi = document.getElementById('hudApi');
        if (hudApi) hudApi.textContent = 'FETCHING...';

        const results = [];
        for (const loc of LOCATIONS) {
            const data = await fetchOne(loc);
            _cache.set(loc.name, data);
            results.push(data);
            await new Promise(r => setTimeout(r, 120)); // stagger 120ms
        }

        // Update UI badges
        const allSim = results.every(r => r.simulated);
        const wBadge = document.getElementById('weatherBadge');
        const wsHud  = document.getElementById('weatherStatus');
        if (wBadge) {
            wBadge.textContent = allSim ? '⚡ SIMULATED WEATHER' : '☀ LIVE WEATHER';
            wBadge.className = allSim ? 'badge-pill' : 'badge-pill success';
        }
        if (wsHud) wsHud.textContent = allSim ? 'WEATHER: SIMULATED' : 'WEATHER: LIVE';
        if (hudApi) hudApi.textContent = allSim ? 'SIMULATED' : 'OPEN-METEO';

        return results;
    };

    // Get cached data or fallback for a node by name
    const get = (name) => _cache.get(name) || null;

    // Map WMO weather codes to icons and descriptions
    const wmoToIcon = (code) => {
        if (code === 0)              return { icon: '☀', label: 'Clear' };
        if (code <= 3)               return { icon: '⛅', label: 'Partly Cloudy' };
        if (code <= 48)              return { icon: '☁', label: 'Foggy/Overcast' };
        if (code <= 67)              return { icon: '🌧', label: 'Rain' };
        if (code <= 77)              return { icon: '❄', label: 'Snow' };
        if (code <= 82)              return { icon: '🌧', label: 'Showers' };
        return                              { icon: '⛈', label: 'Thunderstorm' };
    };

    // Refresh on a 10-minute interval
    const startAutoRefresh = () => {
        fetchAll();
        setInterval(fetchAll, CACHE_TTL);
    };

    return { fetchAll, fetchOne, get, wmoToIcon, LOCATIONS, startAutoRefresh };
})();
