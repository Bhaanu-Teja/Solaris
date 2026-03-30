/* ============================================================
   SOLARIS v2 — compare.js
   Node Comparison Tool
   Side-by-side analysis of any two nodes
   ============================================================ */
'use strict';

const NodeComparison = (() => {
    let compareChart = null;

    // Render comparison cards for two nodes
    const render = (nodeA, nodeB) => {
        if (!nodeA || !nodeB) return;

        const cards = document.getElementById('compareCards');
        if (!cards) return;

        const mkCard = (node, side) => {
            const isWinner = (valA, valB) => side === 'A' ? valA > valB : valB > valA;
            const w = (a, b) => isWinner(a, b) ? 'compare-winner' : '';

            return `
            <div class="compare-node-card side-${side}">
                <div class="cnc-header side-${side}">
                    <div class="cnc-name">${node.name}</div>
                    <div class="cnc-status">${node.status}</div>
                </div>
                <div class="cnc-power">${node.power.toFixed(2)}<span> kW</span></div>
                <div class="cnc-metrics">
                    <div class="cnc-row ${w(nodeA.irradiance, nodeB.irradiance)}">
                        <span class="cnc-label">Irradiance</span>
                        <span class="cnc-val">${node.irradiance} W/m²</span>
                    </div>
                    <div class="cnc-row ${w(nodeA.efficiency, nodeB.efficiency)}">
                        <span class="cnc-label">Efficiency</span>
                        <span class="cnc-val">${node.efficiency.toFixed(1)}%</span>
                    </div>
                    <div class="cnc-row ${w(nodeB.temperature, nodeA.temperature)}">
                        <span class="cnc-label">Temperature</span>
                        <span class="cnc-val">${node.temperature}°C</span>
                    </div>
                    <div class="cnc-row ${w(nodeB.cloudCover, nodeA.cloudCover)}">
                        <span class="cnc-label">Cloud Cover</span>
                        <span class="cnc-val">${node.cloudCover}%</span>
                    </div>
                    <div class="cnc-row">
                        <span class="cnc-label">Voltage</span>
                        <span class="cnc-val">${node.voltage?.toFixed(0) || '--'} V</span>
                    </div>
                    <div class="cnc-row">
                        <span class="cnc-label">Status</span>
                        <span class="cnc-val">${node.status}</span>
                    </div>
                </div>
            </div>`;
        };

        const divider = `
            <div class="compare-divider">
                <div class="compare-divider-line"></div>
                <div class="compare-divider-label">VS</div>
                <div class="compare-divider-line"></div>
            </div>`;

        cards.innerHTML = mkCard(nodeA, 'A') + divider + mkCard(nodeB, 'B');

        // Render overlay chart
        renderOverlay(nodeA, nodeB);
    };

    const renderOverlay = (nodeA, nodeB) => {
        const ctx = document.getElementById('compareCanvas');
        if (!ctx) return;
        if (compareChart) { compareChart.destroy(); compareChart = null; }

        // Build 24h irradiance profiles for both nodes
        const profileA = buildDailyProfile(nodeA.lat ?? 0, nodeA.lon ?? 0, nodeA.cloudCover);
        const profileB = buildDailyProfile(nodeB.lat ?? 0, nodeB.lon ?? 0, nodeB.cloudCover);
        const labels   = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`);

        compareChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: nodeA.name,
                        data: profileA,
                        borderColor: '#FFCC00',
                        backgroundColor: 'rgba(255,204,0,0.08)',
                        borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0,
                    },
                    {
                        label: nodeB.name,
                        data: profileB,
                        borderColor: '#00C8FF',
                        backgroundColor: 'rgba(0,200,255,0.06)',
                        borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0,
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 600 },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { labels: { color: '#7A8BA8', font: { family: "'JetBrains Mono'", size: 10 }, boxWidth: 10 } },
                    tooltip: {
                        backgroundColor: 'rgba(6,11,20,0.96)',
                        borderColor: 'rgba(255,204,0,0.3)', borderWidth: 1,
                        titleColor: '#FFCC00', bodyColor: '#B0C4DE',
                        titleFont: { family: "'Orbitron'", size: 10 },
                        bodyFont: { family: "'JetBrains Mono'", size: 9 },
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' } },
                    y: {
                        grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' },
                        title: { display: true, text: 'W/m²', color: '#3D4F66', font: { size: 9 } }
                    }
                }
            }
        });
    };

    // Pure function: build 24h irradiance profile
    const buildDailyProfile = (lat, lon, cloudCover) => {
        return Array.from({ length: 24 }, (_, h) => {
            const doy  = 180;
            const decl = 23.45 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180;
            const ha   = ((h + lon / 15) - 12) * 15 * Math.PI / 180;
            const latR = lat * Math.PI / 180;
            const sinAlt = Math.sin(latR)*Math.sin(decl) + Math.cos(latR)*Math.cos(decl)*Math.cos(ha);
            const elev = Math.max(0, Math.asin(sinAlt) * 180 / Math.PI);
            if (elev <= 0) return 0;
            const am  = 1 / (Math.sin(elev * Math.PI / 180) + 0.50572 * Math.pow(elev + 6.07995, -1.6364));
            const dni = 1353 * Math.pow(0.7, Math.pow(am, 0.678));
            const ghi = dni * Math.sin(elev * Math.PI / 180);
            return Math.max(0, Math.round(ghi * (1 - (cloudCover / 100) * 0.75)));
        });
    };

    const init = () => {
        const update = () => {
            const iA = parseInt(document.getElementById('compareA')?.value || '5');
            const iB = parseInt(document.getElementById('compareB')?.value || '3');
            // Will be called with real node data from script.js
            if (window._lastNodes && window._lastNodes.length > 0) {
                render(window._lastNodes[iA], window._lastNodes[iB]);
            }
        };
        document.getElementById('compareA')?.addEventListener('change', update);
        document.getElementById('compareB')?.addEventListener('change', update);
    };

    return { init, render, buildDailyProfile };
})();
