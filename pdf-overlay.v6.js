// PDF overlay logic: loads Consultorio.pdf template, renders patient name and
// medication content into the empty middle area using built-in Helvetica,
// triggers download of the final document.

(function (global) {
  'use strict';

  const TEMPLATE_URL = './Consultorio.pdf';

  // Overlay zone (A4 portrait, bottom-left origin).
  const ZONE = {
    pageWidth: 595,
    pageHeight: 842,
    left: 60,
    right: 535,
    top: 700,
    bottom: 250,
  };

  const LAYOUT = {
    patientNameY: 680,
    patientNameSize: 22,
    gapAfterPatientName: 32,
    routeHeaderSize: 13,
    routeHeaderLineHeight: 13,
    gapAfterRouteHeader: 14,
    medSize: 11,
    medLineHeight: 15,
    medIndentX: 80,
    gapBetweenMeds: 10,
    pageNumberX: 460,
    pageNumberY: 240,
    pageNumberSize: 9,
  };

  const FREQUENCY_MAP = {
    1: '24/24h',
    2: '12/12h',
    3: '8/8h',
    4: '6/6h',
    6: '4/4h',
  };

  // Cached template bytes — loaded once per session.
  let templateBytesPromise = null;

  function loadTemplateBytes() {
    if (!templateBytesPromise) {
      templateBytesPromise = fetch(TEMPLATE_URL).then((r) => {
        if (!r.ok) throw new Error('Failed to load Consultorio.pdf');
        return r.arrayBuffer();
      });
    }
    return templateBytesPromise;
  }

  // Extract "250mg/5ml" or "100mcg/jato" from a longer presentation string.
  // Second part after '/' may be numeric ("5ml") or alphabetic ("ml", "jato").
  function presentationShort(presentation) {
    const match = presentation.match(/^[\d.,]+\s*\w+(?:[\/+]\s*\w+)*/);
    return match ? match[0].trim() : presentation;
  }

  function frequencyString(dosesPerDay) {
    return FREQUENCY_MAP[dosesPerDay] || `${dosesPerDay}x/dia`;
  }

  // Portuguese articles/conjunctions/prepositions kept lowercase mid-name.
  const LOWERCASE_PARTICLES = new Set([
    'e', 'de', 'da', 'do', 'das', 'dos',
    'a', 'o', 'as', 'os',
    'em', 'no', 'na', 'nos', 'nas',
    'para', 'por', 'com', 'sem',
  ]);
  function capitalizeWords(str) {
    return str
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w, i) => {
        if (!w) return w;
        if (i > 0 && LOWERCASE_PARTICLES.has(w)) return w;
        return w[0].toUpperCase() + w.slice(1);
      })
      .join(' ');
  }

  // Group items by route, preserving first-seen order.
  function groupByRoute(items) {
    const order = [];
    const groups = new Map();
    for (const item of items) {
      const route = item.medication.route;
      if (!groups.has(route)) {
        groups.set(route, []);
        order.push(route);
      }
      groups.get(route).push(item);
    }
    return order.map((route) => ({ route, items: groups.get(route) }));
  }

  // Plan layout: walks items in order, decides page breaks based on remaining
  // vertical space. Returns an array of pages, each containing draw operations
  // with their absolute y positions.
  function planLayout(items, hasPatientName) {
    const pages = [];
    let currentPage = { ops: [] };
    let currentY = hasPatientName ? ZONE.top - 20 : ZONE.top; // page 1 starts below patient name (drawn separately)
    if (hasPatientName) currentY = LAYOUT.patientNameY - LAYOUT.gapAfterPatientName;

    const grouped = groupByRoute(items);
    let medNumber = 1;

    const newPage = () => {
      pages.push(currentPage);
      currentPage = { ops: [] };
      currentY = ZONE.top;
    };

    for (const group of grouped) {
      const headerBlock = LAYOUT.routeHeaderLineHeight + LAYOUT.gapAfterRouteHeader;
      const firstMedBlock = LAYOUT.medLineHeight * 2 + LAYOUT.gapBetweenMeds;
      if (currentY - (headerBlock + firstMedBlock) < ZONE.bottom) {
        newPage();
      }
      currentPage.ops.push({
        type: 'routeHeader',
        label: `Uso ${group.route}`,
        y: currentY,
      });
      currentY -= headerBlock;

      for (const item of group.items) {
        const medBlock = LAYOUT.medLineHeight * 2 + LAYOUT.gapBetweenMeds;
        if (currentY - medBlock < ZONE.bottom) {
          newPage();
          // Repeat the route header on the new page so the doctor can see context.
          currentPage.ops.push({
            type: 'routeHeader',
            label: `Uso ${group.route} (cont.)`,
            y: currentY,
          });
          currentY -= headerBlock;
        }
        currentPage.ops.push({
          type: 'med',
          item,
          number: medNumber,
          y: currentY,
        });
        currentY -= medBlock;
        medNumber += 1;
      }
    }
    pages.push(currentPage);
    return pages;
  }

  // Build line 1 with anti-tampering hyphen fill across the usable width.
  function buildFilledLine(prefix, font, fontSize, maxWidth) {
    const base = `${prefix} `;
    const baseWidth = font.widthOfTextAtSize(base, fontSize);
    const dashWidth = font.widthOfTextAtSize('-', fontSize) || fontSize * 0.4;
    const remaining = maxWidth - baseWidth;
    const numDashes = Math.max(3, Math.floor(remaining / dashWidth));
    return base + '-'.repeat(numDashes);
  }

  function buildMedLines(item, number, font) {
    const med = item.medication;
    const params = item.params;
    const presShort = presentationShort(med.presentation);
    const freq = frequencyString(params.dosesPerDay);
    const duration = params.durationDays;

    const line1Prefix = `${number}) ${med.name} ${presShort}`;
    const line1 = buildFilledLine(
      line1Prefix,
      font,
      LAYOUT.medSize,
      ZONE.right - ZONE.left
    );

    let line2;
    if (med.fixed_dose) {
      line2 = `Ofertar ${med.fixed_dose_string} via ${med.route} ${freq} por ${duration} dias`;
    } else {
      const volume = item.calc.volumePerDoseMl.toFixed(1).replace('.', ',');
      line2 = `Ofertar ${volume}ml via ${med.route} ${freq} por ${duration} dias`;
    }

    return { line1, line2 };
  }

  async function generatePrescriptionPDF(patient, items) {
    const { PDFDocument, rgb, StandardFonts } = global.PDFLib;

    const templateBytes = await loadTemplateBytes();

    const template = await PDFDocument.load(templateBytes);
    const output = await PDFDocument.create();

    // Built-in Standard14 fonts — no embedding, no viewer substitution risk.
    const helvetica = await output.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await output.embedFont(StandardFonts.HelveticaBold);

    const patientName = capitalizeWords(patient.name);
    const pageLayouts = planLayout(items, true);
    const totalPages = pageLayouts.length;

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx += 1) {
      const [copied] = await output.copyPages(template, [0]);
      const page = output.addPage(copied);

      if (pageIdx === 0) {
        page.drawText(patientName, {
          x: ZONE.left,
          y: LAYOUT.patientNameY,
          size: LAYOUT.patientNameSize,
          font: helveticaBold,
          color: rgb(0, 0, 0),
        });
      }

      for (const op of pageLayouts[pageIdx].ops) {
        if (op.type === 'routeHeader') {
          page.drawText(op.label, {
            x: ZONE.left,
            y: op.y,
            size: LAYOUT.routeHeaderSize,
            font: helveticaBold,
            color: rgb(0, 0, 0),
          });
          const headerWidth = helveticaBold.widthOfTextAtSize(
            op.label,
            LAYOUT.routeHeaderSize
          );
          page.drawLine({
            start: { x: ZONE.left, y: op.y - 3 },
            end: { x: ZONE.left + headerWidth, y: op.y - 3 },
            thickness: 0.75,
            color: rgb(0, 0, 0),
          });
        } else if (op.type === 'med') {
          const { line1, line2 } = buildMedLines(op.item, op.number, helvetica);
          page.drawText(line1, {
            x: ZONE.left,
            y: op.y,
            size: LAYOUT.medSize,
            font: helvetica,
            color: rgb(0, 0, 0),
          });
          page.drawText(line2, {
            x: LAYOUT.medIndentX,
            y: op.y - LAYOUT.medLineHeight,
            size: LAYOUT.medSize,
            font: helvetica,
            color: rgb(0, 0, 0),
          });
        }
      }

      const pageLabel = `Página ${pageIdx + 1} de ${totalPages}`;
      page.drawText(pageLabel, {
        x: LAYOUT.pageNumberX,
        y: LAYOUT.pageNumberY,
        size: LAYOUT.pageNumberSize,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4),
      });
    }

    const pdfBytes = await output.save();
    return pdfBytes;
  }

  function slugify(str) {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function todayIsoDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function downloadPDF(bytes, patientName) {
    const filename = `prescricao_${slugify(patientName) || 'paciente'}_${todayIsoDate()}.pdf`;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  // Public API
  global.PdfOverlay = {
    generatePrescriptionPDF,
    downloadPDF,
    presentationShort,
    frequencyString,
    capitalizeWords,
    LAYOUT,
    ZONE,
  };
})(window);
