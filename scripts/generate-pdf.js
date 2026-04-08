const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const app = require('../server');

async function generatePdf() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const server = app.listen(0);

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;
    const page = await browser.newPage();

    await page.setViewport({ width: 1440, height: 2200, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('screen');
    await page.evaluate(() => {
      const cities = ['Mumbai', 'Bengaluru'];
      const dayList = Array.isArray(window.DAYS) ? window.DAYS : DAYS;
      const mrpMap = window.MRP || MRP;
      const floorMap = window.FLOORS || FLOORS;

      const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const fmt = (value) => Math.round(value).toLocaleString('en-IN');
      const calcPrice = (cityName, pkg, pct) => Math.round(mrpMap[cityName][pkg] * (1 - pct / 100));
      const calcActualPct = (cityName, pkg, priceValue) => {
        const mrp = mrpMap[cityName][pkg] || 1;
        return Number(((1 - priceValue / mrp) * 100).toFixed(1));
      };
      const getPrevComparableIdx = (drops, currentIdx) => {
        for (let idx = currentIdx - 1; idx >= 0; idx -= 1) {
          if (drops[idx].flag !== 'gap' && drops[idx].p === drops[currentIdx].p) {
            return idx;
          }
        }
        return -1;
      };
      const getDropMeta = (cityName, drops, currentIdx) => {
        const entry = drops[currentIdx];
        if (!entry || entry.flag === 'gap' || !entry.p) return null;
        const priceValue = calcPrice(cityName, entry.p, entry.pct);
        const actualPct = calcActualPct(cityName, entry.p, priceValue);
        const prevIdx = getPrevComparableIdx(drops, currentIdx);
        const prevPrice = prevIdx >= 0 ? calcPrice(cityName, drops[prevIdx].p, drops[prevIdx].pct) : null;
        const rateChangePct = prevPrice === null ? null : Number((((priceValue - prevPrice) / prevPrice) * 100).toFixed(1));
        let displaySignal = 'drop';
        if (entry.flag === 'floor') displaySignal = 'floor';
        else if (entry.flag === 'trap') displaySignal = 'trap';
        else if (entry.flag === 'midnight') displaySignal = 'midnight';
        else if (rateChangePct !== null && rateChangePct > 0) displaySignal = 'spike';
        return { entry, priceValue, actualPct, rateChangePct, displaySignal };
      };

      const signalLabel = (signal) => {
        if (signal === 'floor') return 'Floor';
        if (signal === 'spike') return 'Spike';
        if (signal === 'trap') return 'Trap';
        if (signal === 'midnight') return 'Midnight';
        return 'Drop';
      };

      const signalClass = (signal) => {
        if (signal === 'floor') return 'is-floor';
        if (signal === 'spike') return 'is-spike';
        if (signal === 'trap') return 'is-trap';
        if (signal === 'midnight') return 'is-midnight';
        return 'is-drop';
      };

      const buildMetric = (label, value) => `
        <div class="pdf-metric">
          <div class="pdf-metric-value">${escapeHtml(value)}</div>
          <div class="pdf-metric-label">${escapeHtml(label)}</div>
        </div>`;

      const buildDayCard = (cityName, day) => {
        const drops = day.drops.filter((drop) => drop.flag !== 'gap' && drop.p);
        const floorIndex = drops.findIndex((drop) => drop.flag === 'floor');
        const bestMeta = drops.reduce((best, _drop, idx) => {
          const meta = getDropMeta(cityName, drops, idx);
          if (!meta) return best;
          if (!best || meta.actualPct > best.actualPct) return meta;
          return best;
        }, null);
        const firstMeta = getDropMeta(cityName, drops, 0);
        const packages = [...new Set(drops.map((drop) => drop.p))].join(' · ');

        const rows = day.drops.map((drop, idx) => {
          if (drop.flag === 'gap') {
            return `
              <tr class="pdf-gap-row">
                <td>—</td>
                <td colspan="5">Silence window · no active drop · story says “nothing live right now”.</td>
              </tr>`;
          }

          const meta = getDropMeta(cityName, day.drops, idx);
          const changeText = meta.rateChangePct === null
            ? '—'
            : `${meta.rateChangePct > 0 ? '▲' : '▼'} ${Math.abs(meta.rateChangePct)}%`;

          return `
            <tr>
              <td>${escapeHtml(drop.t)}</td>
              <td>${escapeHtml(drop.p)}</td>
              <td>₹${fmt(meta.priceValue)}</td>
              <td>${meta.actualPct}%</td>
              <td>${escapeHtml(changeText)}</td>
              <td><span class="pdf-signal ${signalClass(meta.displaySignal)}">${signalLabel(meta.displaySignal)}</span></td>
            </tr>`;
        }).join('');

        return `
          <section class="pdf-day-card">
            <div class="pdf-day-head">
              <div>
                <div class="pdf-day-date">${escapeHtml(day.date)}</div>
                <div class="pdf-day-theme">${escapeHtml(day.theme)}</div>
              </div>
              <div class="pdf-day-packages">${escapeHtml(packages)}</div>
            </div>

            <div class="pdf-metrics-grid">
              ${buildMetric('Total drops', drops.length)}
              ${buildMetric('Best off MRP', bestMeta ? `${bestMeta.actualPct}%` : '—')}
              ${buildMetric('Floor position', floorIndex >= 0 ? `#${floorIndex + 1}` : '—')}
              ${buildMetric('Midnight drop', day.midnight ? 'Yes' : 'No')}
            </div>

            <div class="pdf-hero-row">
              <div class="pdf-hero-card">
                <div class="pdf-hero-kicker">Opening live window</div>
                <div class="pdf-hero-price">${firstMeta ? `₹${fmt(firstMeta.priceValue)}` : '—'}</div>
                <div class="pdf-hero-copy">${firstMeta ? `${firstMeta.actualPct}% off MRP · ${escapeHtml(firstMeta.entry.p)}` : 'No live drop'}</div>
              </div>
              <div class="pdf-hero-card alt">
                <div class="pdf-hero-kicker">Best seen today — so far</div>
                <div class="pdf-hero-price">${bestMeta ? `₹${fmt(bestMeta.priceValue)}` : '—'}</div>
                <div class="pdf-hero-copy">${bestMeta ? `${bestMeta.actualPct}% off MRP · ${escapeHtml(bestMeta.entry.p)}` : 'No floor detected'}</div>
              </div>
            </div>

            <div class="pdf-table-wrap">
              <table class="pdf-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Package</th>
                    <th>Price</th>
                    <th>% off MRP</th>
                    <th>vs prev</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </section>`;
      };

      const buildCitySection = (cityName) => {
        const cityDays = dayList.map((day) => buildDayCard(cityName, day)).join('');
        const packageSummary = Object.entries(mrpMap[cityName])
          .map(([pkg, mrpValue]) => `<span class="pdf-pill">${escapeHtml(pkg)} · MRP ₹${fmt(mrpValue)} · Floor ₹${fmt(floorMap[cityName][pkg])}</span>`)
          .join('');

        return `
          <section class="pdf-city-section">
            <div class="pdf-city-header">
              <div>
                <div class="pdf-city-kicker">Flash Sale Engine · Anniversary 2026</div>
                <h2>${escapeHtml(cityName)}</h2>
                <p>Styled for print, structured from the live dashboard data, and optimized for readable A4 portrait export.</p>
              </div>
              <div class="pdf-city-badge">${escapeHtml(cityName)} pricing grid</div>
            </div>
            <div class="pdf-pill-row">${packageSummary}</div>
            <div class="pdf-day-grid">${cityDays}</div>
          </section>`;
      };

      const style = document.createElement('style');
      style.id = 'pdf-export-style';
      style.textContent = `
        @page { size: A4 portrait; margin: 10mm; }
        :root {
          --pdf-acc:#073daa;
          --pdf-acc-mid:#022f90;
          --pdf-bg:#f4f8ff;
          --pdf-card:#ffffff;
          --pdf-border:#dce7f8;
          --pdf-ink:#08101f;
          --pdf-ink-soft:#5c6b88;
          --pdf-green:#0f8d6b;
          --pdf-red:#993c1d;
          --pdf-amber:#854f0b;
        }
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: var(--pdf-bg);
          color: var(--pdf-ink);
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: Inter, Arial, sans-serif;
        }
        body {
          padding: 0;
          font-size: 11px;
        }
        .pdf-root {
          display: grid;
          gap: 12mm;
        }
        .pdf-city-section {
          background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
          border: 1px solid var(--pdf-border);
          border-radius: 20px;
          padding: 7mm;
          box-shadow: 0 10px 30px rgba(12, 32, 84, 0.06);
          break-inside: auto;
        }
        .pdf-city-section + .pdf-city-section {
          break-before: page;
        }
        .pdf-city-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 14px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--pdf-border);
        }
        .pdf-city-header h2 {
          margin: 4px 0 6px;
          font-size: 24px;
          line-height: 1.1;
        }
        .pdf-city-header p {
          margin: 0;
          max-width: 420px;
          color: var(--pdf-ink-soft);
          line-height: 1.45;
        }
        .pdf-city-kicker {
          color: var(--pdf-acc);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .14em;
        }
        .pdf-city-badge {
          padding: 10px 14px;
          border-radius: 999px;
          background: linear-gradient(135deg, var(--pdf-acc) 0%, var(--pdf-acc-mid) 100%);
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .08em;
          white-space: nowrap;
        }
        .pdf-pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
        }
        .pdf-pill {
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid var(--pdf-border);
          background: #fff;
          color: var(--pdf-ink-soft);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .04em;
        }
        .pdf-day-grid {
          display: grid;
          gap: 12px;
        }
        .pdf-day-card {
          border: 1px solid var(--pdf-border);
          border-radius: 18px;
          background: var(--pdf-card);
          padding: 12px;
          break-inside: avoid;
          box-shadow: 0 8px 24px rgba(11, 27, 70, 0.04);
        }
        .pdf-day-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 10px;
        }
        .pdf-day-date {
          font-size: 16px;
          font-weight: 900;
          line-height: 1;
        }
        .pdf-day-theme {
          margin-top: 4px;
          color: var(--pdf-ink-soft);
          font-size: 11px;
          font-weight: 600;
        }
        .pdf-day-packages {
          padding: 6px 10px;
          border-radius: 999px;
          background: #eef5ff;
          color: var(--pdf-acc-mid);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: .06em;
          text-transform: uppercase;
        }
        .pdf-metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 10px;
        }
        .pdf-metric {
          border: 1px solid var(--pdf-border);
          border-radius: 14px;
          background: linear-gradient(180deg, #fff 0%, #f8fbff 100%);
          padding: 10px;
        }
        .pdf-metric-value {
          font-size: 18px;
          font-weight: 900;
          line-height: 1;
        }
        .pdf-metric-label {
          margin-top: 5px;
          color: var(--pdf-ink-soft);
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .09em;
        }
        .pdf-hero-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 10px;
        }
        .pdf-hero-card {
          padding: 12px;
          border-radius: 16px;
          border: 1px solid var(--pdf-border);
          background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
        }
        .pdf-hero-card.alt {
          background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
        }
        .pdf-hero-kicker {
          color: var(--pdf-ink-soft);
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .12em;
        }
        .pdf-hero-price {
          margin-top: 6px;
          font-size: 24px;
          font-weight: 300;
          line-height: 1;
        }
        .pdf-hero-copy {
          margin-top: 6px;
          color: var(--pdf-ink-soft);
          font-size: 10px;
          font-weight: 600;
        }
        .pdf-table-wrap {
          overflow: hidden;
          border: 1px solid var(--pdf-border);
          border-radius: 16px;
        }
        .pdf-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .pdf-table thead tr {
          background: linear-gradient(135deg, var(--pdf-acc) 0%, #000 100%);
        }
        .pdf-table th {
          padding: 9px 10px;
          text-align: left;
          color: #fff;
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .1em;
        }
        .pdf-table td {
          padding: 8px 10px;
          border-bottom: 1px solid var(--pdf-border);
          background: #fff;
          font-size: 10px;
          vertical-align: middle;
        }
        .pdf-table tbody tr:last-child td {
          border-bottom: 0;
        }
        .pdf-gap-row td {
          color: var(--pdf-ink-soft);
          font-style: italic;
          background: #f9fbff;
        }
        .pdf-signal {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .08em;
          border: 1px solid transparent;
        }
        .pdf-signal.is-drop { background: #eef5ff; color: var(--pdf-acc-mid); border-color: #cfe0fb; }
        .pdf-signal.is-floor { background: #e8faf4; color: var(--pdf-green); border-color: #b7ead9; }
        .pdf-signal.is-spike { background: #faece7; color: var(--pdf-red); border-color: #f0c8b8; }
        .pdf-signal.is-trap { background: #faeeda; color: var(--pdf-amber); border-color: #efdbb4; }
        .pdf-signal.is-midnight { background: #eef5ff; color: var(--pdf-acc); border-color: #cfe0fb; }
      `;

      const exportRoot = document.createElement('main');
      exportRoot.className = 'pdf-root';
      exportRoot.innerHTML = cities.map((cityName) => buildCitySection(cityName)).join('');

      document.head.appendChild(style);
      document.body.className = 'pdf-export-body';
      document.body.innerHTML = '';
      document.body.appendChild(exportRoot);
      window.scrollTo(0, 0);
    });

    await page.waitForTimeout?.(600);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const exportsDir = path.join(__dirname, '..', 'exports');
    fs.mkdirSync(exportsDir, { recursive: true });

    const outputPath = path.join(exportsDir, 'powerbarre-flash-sale.pdf');
    await page.pdf({
      path: outputPath,
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
      scale: 1.0,
      preferCSSPageSize: true,
    });

    console.log(`PDF created at ${outputPath}`);
  } finally {
    server.close();
    await browser.close();
  }
}

generatePdf().catch((error) => {
  console.error('Failed to generate PDF:', error);
  process.exitCode = 1;
});