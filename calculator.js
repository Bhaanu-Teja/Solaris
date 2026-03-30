/* ============================================================
   SOLARIS v2 — calculator.js
   Energy Yield Calculator
   Pure solar physics functions → deterministic output
   Mirrors Haskell pure function design
   ============================================================ */
'use strict';

const EnergyCalculator = (() => {

    // ── Location database ───────────────────────────────────
    const LOC_DB = {
        sanfrancisco: { lat: 37.77,  lon: -122.42, name: 'San Francisco', avgSunHours: 5.4 },
        newyork:      { lat: 40.71,  lon: -74.01,  name: 'New York',      avgSunHours: 4.7 },
        london:       { lat: 51.51,  lon: -0.13,   name: 'London',        avgSunHours: 3.5 },
        tokyo:        { lat: 35.68,  lon: 139.65,  name: 'Tokyo',         avgSunHours: 4.3 },
        sydney:       { lat: -33.87, lon: 151.21,  name: 'Sydney',        avgSunHours: 6.0 },
        mumbai:       { lat: 19.08,  lon: 72.88,   name: 'Mumbai',        avgSunHours: 6.5 },
        cairo:        { lat: 30.04,  lon: 31.24,   name: 'Cairo',         avgSunHours: 7.2 },
        moscow:       { lat: 55.76,  lon: 37.62,   name: 'Moscow',        avgSunHours: 2.9 },
        custom:       { lat: 0,      lon: 0,        name: 'Custom',        avgSunHours: 5.0 },
    };

    const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
    const CO2_PER_KWH = 0.475; // kg CO2 per kWh (India grid average)
    const TREES_PER_KG_CO2 = 0.0417; // 1 tree absorbs ~24 kg CO2/yr

    let calcChart = null;

    // ── Pure function: optimal tilt angle ───────────────────
    // Rule: tilt ≈ latitude × 0.87 for annual optimum
    const optimalTilt = (lat) => Math.abs(lat) * 0.87;

    // ── Pure function: tilt factor correction ───────────────
    const tiltFactor = (tiltDeg, lat) => {
        const opt = optimalTilt(lat);
        const dev = Math.abs(tiltDeg - opt);
        return Math.max(0.5, 1 - dev * 0.005);
    };

    // ── Pure function: calculate peak sun hours for location ──
    // Uses latitude-based model with seasonal weighting
    const peakSunHours = (lat, lon, doy = 180) => {
        const decl   = 23.45 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180;
        const latR   = lat * Math.PI / 180;
        const sunrise = Math.acos(-Math.tan(latR) * Math.tan(decl)) * 180 / Math.PI / 15;
        const daylength = sunrise * 2;
        // Average irradiance during daylight ~ 0.6 × 1000 W/m2
        return daylength * 0.6;
    };

    // ── Pure function: annual energy estimate ───────────────
    const calculateAnnualEnergy = (params) => {
        const { areaM2, effPct, lossPct, lat, lon, tiltDeg } = params;
        const eff       = effPct / 100;
        const lossMult  = 1 - lossPct / 100;
        const tf        = tiltFactor(tiltDeg, lat);

        // Compute monthly yield using 12-month solar declination
        const monthlyKwh = Array.from({ length: 12 }, (_, m) => {
            const doy   = Math.round(30.4 * (m + 0.5));
            const psh   = peakSunHours(lat, lon, doy);
            const days  = [31,28,31,30,31,30,31,31,30,31,30,31][m];
            const daily = areaM2 * eff * lossMult * tf * psh;
            return daily * days;
        });

        const annualKwh  = monthlyKwh.reduce((s, x) => s + x, 0);
        const dailyKwh   = annualKwh / 365;
        const monthlyAvg = annualKwh / 12;

        return { annualKwh, dailyKwh, monthlyAvg, monthlyKwh };
    };

    // ── Format currency ─────────────────────────────────────
    const fmtCurrency = (val, currency) => {
        const sym = CURRENCY_SYMBOLS[currency] || '';
        if (val >= 1_000_000) return `${sym}${(val/1_000_000).toFixed(2)}M`;
        if (val >= 1_000)     return `${sym}${(val/1_000).toFixed(1)}K`;
        return `${sym}${val.toFixed(0)}`;
    };

    // ── Render results ───────────────────────────────────────
    const renderResults = (energy, rate, currency, lat) => {
        const { annualKwh, dailyKwh, monthlyAvg, monthlyKwh } = energy;

        // Energy
        document.getElementById('rsDailyKwh').textContent   = dailyKwh.toFixed(1);
        document.getElementById('rsMonthlyKwh').textContent  = monthlyAvg.toFixed(0);
        document.getElementById('rsAnnualKwh').textContent   = annualKwh.toFixed(0);

        // Savings
        const dailySave   = dailyKwh   * rate;
        const monthlySave = monthlyAvg * rate;
        const annualSave  = annualKwh  * rate;
        document.getElementById('rsDailySave').textContent   = fmtCurrency(dailySave, currency);
        document.getElementById('rsMonthlySave').textContent  = fmtCurrency(monthlySave, currency);
        document.getElementById('rsAnnualSave').textContent   = fmtCurrency(annualSave, currency);
        document.getElementById('rs25yr').textContent         = fmtCurrency(annualSave * 25 * 0.85, currency); // 15% degradation

        // CO2
        const annualCo2   = annualKwh * CO2_PER_KWH;
        const trees        = annualCo2 * TREES_PER_KG_CO2;
        document.getElementById('rsCo2').textContent   = `${annualCo2.toFixed(0)} kg`;
        document.getElementById('rsTrees').textContent = `${trees.toFixed(0)} 🌳`;

        // Optimal tilt
        document.getElementById('optimalAngle').textContent = `${optimalTilt(lat).toFixed(1)}°`;

        // Monthly bar chart
        renderCalcChart(monthlyKwh);

        // Show results
        document.getElementById('calcPlaceholder').style.display = 'none';
        document.getElementById('calcOutput').style.display       = 'block';
    };

    // ── Monthly chart ────────────────────────────────────────
    const renderCalcChart = (monthlyKwh) => {
        const ctx = document.getElementById('calcChart');
        if (!ctx) return;
        if (calcChart) { calcChart.destroy(); calcChart = null; }

        calcChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
                datasets: [{
                    label: 'Monthly Generation (kWh)',
                    data: monthlyKwh.map(v => Math.round(v)),
                    backgroundColor: monthlyKwh.map((v, i) => {
                        const max = Math.max(...monthlyKwh);
                        const t   = v / max;
                        return `rgba(255, ${Math.round(180 * t + 50), 0}, 0, 0.8)`;
                    }),
                    backgroundColor: monthlyKwh.map((v, i) => {
                        const peak = i >= 3 && i <= 8; // Apr-Sep
                        return peak ? 'rgba(255,204,0,0.85)' : 'rgba(255,153,0,0.6)';
                    }),
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#7A8BA8', font: { family: "'JetBrains Mono'" , size: 9 } } },
                    tooltip: {
                        backgroundColor: 'rgba(6,11,20,0.96)',
                        borderColor: 'rgba(255,204,0,0.3)', borderWidth: 1,
                        titleColor: '#FFCC00', bodyColor: '#B0C4DE',
                        callbacks: { label: ctx => ` ${ctx.raw} kWh` }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' } },
                    y: { grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' } },
                }
            }
        });
    };

    // ── Main calculate function ──────────────────────────────
    const calculate = () => {
        const locKey   = document.getElementById('calcLocation')?.value || 'mumbai';
        let   loc      = LOC_DB[locKey] || LOC_DB.mumbai;

        if (locKey === 'custom') {
            const lat = parseFloat(document.getElementById('customLat')?.value || '0');
            const lon = parseFloat(document.getElementById('customLon')?.value || '0');
            loc = { lat, lon, name: 'Custom', avgSunHours: peakSunHours(lat, lon) };
        }

        const areaM2   = parseFloat(document.getElementById('calcArea')?.value  || '50');
        const effPct   = parseFloat(document.getElementById('calcEff')?.value   || '22.5');
        const lossPct  = parseFloat(document.getElementById('calcLoss')?.value  || '14');
        const rate     = parseFloat(document.getElementById('calcRate')?.value  || '8');
        const currency = document.getElementById('calcCurrency')?.value || 'INR';
        const tiltDeg  = parseFloat(document.getElementById('calcTilt')?.value  || '25');

        const energy = calculateAnnualEnergy({ areaM2, effPct, lossPct, lat: loc.lat, lon: loc.lon, tiltDeg });
        renderResults(energy, rate, currency, loc.lat);
    };

    // ── Init ─────────────────────────────────────────────────
    const init = () => {
        document.getElementById('calcBtn')?.addEventListener('click', calculate);

        // Show/hide custom coords
        document.getElementById('calcLocation')?.addEventListener('change', e => {
            const cf = document.getElementById('customCoordsField');
            if (cf) cf.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });

        // Tilt label
        document.getElementById('calcTilt')?.addEventListener('input', e => {
            const el = document.getElementById('calcTiltVal');
            if (el) el.textContent = `${e.target.value}°`;
        });

        // Hide custom coords initially
        const cf = document.getElementById('customCoordsField');
        if (cf) cf.style.display = 'none';

        // Hide output initially
        const out = document.getElementById('calcOutput');
        if (out) out.style.display = 'none';
    };

    return { init, calculate };
})();
