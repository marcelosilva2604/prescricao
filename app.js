// Application logic: loads the medication catalog, manages form state,
// handles modals, renders the live preview, and triggers PDF generation.
// All UI strings are in Brazilian Portuguese.

(function () {
  'use strict';

  const ROUTE_ORDER = ['Oral', 'Inalatório', 'Tópico', 'Outro'];

  // Taketomo handbook split into 3 chunks to stay under GitHub Pages 100MB limit.
  // Pages 1-750 -> chunk 1, 751-1500 -> chunk 2, 1501-2260 -> chunk 3.
  const TAKETOMO_CHUNKS = [
    { url: './taketomo-1.pdf', startPage: 1, endPage: 750 },
    { url: './taketomo-2.pdf', startPage: 751, endPage: 1500 },
    { url: './taketomo-3.pdf', startPage: 1501, endPage: 2260 },
  ];
  const SEARCH_RESULT_CAP = 50;

  const state = {
    medications: [],
    selected: [],
    validatedIds: new Set(),
    patient: { name: '', weight: '', dob: '' },
    pendingMedicationId: null,
    editingIndex: null,
    catalogLoaded: false,
  };

  // ── DOM refs ──────────────────────────────────────────────────────────
  const el = {};
  function cacheDom() {
    el.form = document.getElementById('patientForm');
    el.patientName = document.getElementById('patientName');
    el.patientWeight = document.getElementById('patientWeight');
    el.patientDob = document.getElementById('patientDob');
    el.ageDisplay = document.getElementById('ageDisplay');
    el.errName = document.getElementById('errName');
    el.errWeight = document.getElementById('errWeight');
    el.errDob = document.getElementById('errDob');
    el.medicationSearch = document.getElementById('medicationSearch');
    el.medicationList = document.getElementById('medicationList');
    el.addMedBtn = document.getElementById('addMedBtn');
    el.selectedList = document.getElementById('selectedList');
    el.generateBtn = document.getElementById('generateBtn');
    el.newPrescriptionBtn = document.getElementById('newPrescriptionBtn');
    el.previewPages = document.getElementById('previewPages');
    el.previewStatus = document.getElementById('previewStatus');
    el.firstTimeModal = document.getElementById('firstTimeModal');
    el.firstTimeTitle = document.getElementById('firstTimeTitle');
    el.ftDose = document.getElementById('ftDose');
    el.ftFrequency = document.getElementById('ftFrequency');
    el.ftDuration = document.getElementById('ftDuration');
    el.ftMaxDose = document.getElementById('ftMaxDose');
    el.ftDoseField = document.getElementById('ftDoseField');
    el.ftMaxField = document.getElementById('ftMaxField');
    el.ftFixedNotice = document.getElementById('ftFixedNotice');
    el.ftPresentation = document.getElementById('ftPresentation');
    el.ftConcentration = document.getElementById('ftConcentration');
    el.ftRoute = document.getElementById('ftRoute');
    el.ftPresentationField = document.getElementById('ftPresentationField');
    el.ftConcRouteRow = document.getElementById('ftConcRouteRow');
    el.ftCancel = document.getElementById('ftCancel');
    el.ftConfirm = document.getElementById('ftConfirm');
    el.maxDoseModal = document.getElementById('maxDoseModal');
    el.mdBody = document.getElementById('mdBody');
    el.mdUseMax = document.getElementById('mdUseMax');
    el.mdKeep = document.getElementById('mdKeep');
    el.mdCancel = document.getElementById('mdCancel');
  }

  // ── Catalog loading ───────────────────────────────────────────────────
  async function loadCatalog() {
    try {
      const res = await fetch('./medicacoes.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.medications = data.medications;
      state.catalogLoaded = true;
      renderMedicationOptions('');
    } catch (e) {
      console.error('Erro ao carregar medicacoes.json', e);
      el.medicationList.innerHTML =
        '<li class="empty">Erro ao carregar catálogo de medicações.</li>';
    }
  }

  function renderMedicationOptions(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      const n = state.medications.length;
      el.medicationList.innerHTML = `<li class="empty">Digite para buscar entre ${n} medicamentos.</li>`;
      el.addMedBtn.disabled = true;
      el.medicationSearch.dataset.selectedId = '';
      return;
    }
    // Rank: curated entries first, then taketomo refs, both sub-ranked by prefix match then substring.
    const filtered = [];
    for (const m of state.medications) {
      const name = m.name.toLowerCase();
      const cat = (m.category || '').toLowerCase();
      const pres = (m.presentation || '').toLowerCase();
      let score;
      if (name.startsWith(q)) score = 0;
      else if (name.includes(q)) score = 1;
      else if (cat.includes(q)) score = 2;
      else if (pres.includes(q)) score = 3;
      else continue;
      // Curated entries promote one tier.
      if (m.source === 'curated') score -= 0.5;
      filtered.push({ m, score });
    }
    filtered.sort((a, b) => a.score - b.score);
    if (!filtered.length) {
      el.medicationList.innerHTML =
        '<li class="empty">Nenhuma medicação encontrada.</li>';
      el.addMedBtn.disabled = true;
      el.medicationSearch.dataset.selectedId = '';
      return;
    }
    const limited = filtered.slice(0, SEARCH_RESULT_CAP);
    let html = limited
      .map(({ m }) => {
        const presText = m.presentation || (m.source === 'taketomo' ? 'referência Taketomo — configure ao adicionar' : '');
        const ipage = m.taketomo_page
          ? `<button type="button" class="info-btn" data-page="${m.taketomo_page}" title="Abrir Taketomo p. ${m.taketomo_page}" aria-label="Abrir Taketomo página ${m.taketomo_page}">i</button>`
          : '';
        return `
          <li role="option" data-id="${escapeHtml(m.id)}">
            <div class="med-row">
              <div class="med-info">
                <span class="med-name">${escapeHtml(m.name)}</span>
                <span class="med-pres">${escapeHtml(presText)}</span>
                <span class="med-cat">${escapeHtml(m.category || '')}</span>
              </div>
              ${ipage}
            </div>
          </li>`;
      })
      .join('');
    if (filtered.length > SEARCH_RESULT_CAP) {
      html += `<li class="empty">+${filtered.length - SEARCH_RESULT_CAP} resultados — refine a busca.</li>`;
    }
    el.medicationList.innerHTML = html;
  }

  function openTaketomo(page) {
    if (!page) return;
    for (const chunk of TAKETOMO_CHUNKS) {
      if (page >= chunk.startPage && page <= chunk.endPage) {
        const localPage = page - chunk.startPage + 1;
        window.open(`${chunk.url}#page=${localPage}`, '_blank', 'noopener');
        return;
      }
    }
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ── Patient form ──────────────────────────────────────────────────────
  function bindFormEvents() {
    el.patientName.addEventListener('input', (e) => {
      state.patient.name = e.target.value;
      validate();
      schedulePreviewUpdate();
    });
    el.patientWeight.addEventListener('input', (e) => {
      state.patient.weight = e.target.value;
      validate();
      recalculateAll();
      schedulePreviewUpdate();
      renderSelected();
    });
    el.patientDob.addEventListener('input', (e) => {
      state.patient.dob = e.target.value;
      renderAgeDisplay();
    });
    // Constrain date picker to past dates.
    el.patientDob.max = todayIsoLocal();
  }

  function todayIsoLocal() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function computeAge(dobStr) {
    if (!dobStr) return null;
    const parts = dobStr.split('-').map(Number);
    if (parts.length !== 3) return null;
    const [y, m, d] = parts;
    const dob = new Date(y, m - 1, d);
    if (isNaN(dob.getTime())) return null;
    const now = new Date();
    if (dob > now) return { error: 'future' };
    let years = now.getFullYear() - dob.getFullYear();
    let months = now.getMonth() - dob.getMonth();
    const days = now.getDate() - dob.getDate();
    if (days < 0) months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    return { years, months };
  }

  function formatAge(age) {
    if (!age) return '';
    if (age.error === 'future') return '';
    const { years, months } = age;
    if (years === 0 && months === 0) return 'Menos de 1 mês';
    if (years === 0) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
    if (months === 0) return `${years} ${years === 1 ? 'ano' : 'anos'}`;
    return `${years} ${years === 1 ? 'ano' : 'anos'} e ${months} ${months === 1 ? 'mês' : 'meses'}`;
  }

  function renderAgeDisplay() {
    const age = computeAge(state.patient.dob);
    if (!age) {
      el.ageDisplay.textContent = '';
      el.errDob.textContent = '';
      return;
    }
    if (age.error === 'future') {
      el.ageDisplay.textContent = '';
      el.errDob.textContent = 'Data de nascimento não pode ser no futuro.';
      return;
    }
    el.errDob.textContent = '';
    el.ageDisplay.textContent = `Idade: ${formatAge(age)}`;
  }

  function validate() {
    const name = state.patient.name.trim();
    const weight = parseFloat(state.patient.weight);
    let ok = true;
    if (!name) {
      el.errName.textContent = 'Informe o nome do paciente.';
      ok = false;
    } else {
      el.errName.textContent = '';
    }
    if (!weight || isNaN(weight) || weight < 0.5 || weight > 100) {
      el.errWeight.textContent = 'Peso deve estar entre 0,5 e 100 kg.';
      ok = false;
    } else {
      el.errWeight.textContent = '';
    }
    const hasMeds = state.selected.length > 0;
    el.generateBtn.disabled = !(ok && hasMeds);
    el.generateBtn.title = el.generateBtn.disabled
      ? 'Adicione paciente e medicações'
      : 'Gerar PDF da prescrição';
    return ok;
  }

  // ── Medication selection ──────────────────────────────────────────────
  function bindMedSelector() {
    el.medicationSearch.addEventListener('input', (e) => {
      el.medicationSearch.dataset.selectedId = '';
      el.addMedBtn.disabled = true;
      renderMedicationOptions(e.target.value);
    });
    el.medicationList.addEventListener('click', (e) => {
      const infoBtn = e.target.closest('.info-btn');
      if (infoBtn) {
        e.stopPropagation();
        openTaketomo(parseInt(infoBtn.dataset.page, 10));
        return;
      }
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      [...el.medicationList.querySelectorAll('li.active')].forEach((x) =>
        x.classList.remove('active')
      );
      li.classList.add('active');
      el.medicationSearch.dataset.selectedId = li.dataset.id;
      el.addMedBtn.disabled = false;
    });
    el.addMedBtn.addEventListener('click', () => {
      const id = el.medicationSearch.dataset.selectedId;
      if (!id) return;
      handleAddMedication(id);
    });
  }

  function handleAddMedication(id) {
    const med = state.medications.find((m) => m.id === id);
    if (!med) return;
    const defaultParams = buildDefaultParams(med);
    if (state.validatedIds.has(id)) {
      finalizeAdd(med, defaultParams);
    } else {
      openFirstTimeModal(med, defaultParams);
    }
  }

  function buildDefaultParams(med) {
    return {
      doseMgPerKgPerDay: med.dose_mg_per_kg_per_day || 0,
      dosesPerDay: med.doses_per_day,
      durationDays: med.default_duration_days,
      maxMgPerDay: med.max_mg_per_day || 0,
    };
  }

  function finalizeAdd(med, params) {
    // Check max dose, then add (or escalate via modal).
    if (!med.fixed_dose && params.maxMgPerDay > 0) {
      const weight = parseFloat(state.patient.weight) || 0;
      const calculated = weight * params.doseMgPerKgPerDay;
      if (weight > 0 && calculated > params.maxMgPerDay) {
        openMaxDoseModal(med, params, calculated);
        return;
      }
    }
    pushSelection(med, params);
  }

  function pushSelection(med, params) {
    const item = { medication: med, params: { ...params } };
    item.calc = computeCalc(item);
    state.selected.push(item);
    state.validatedIds.add(med.id);
    state.editingIndex = null;
    render();
  }

  function computeCalc(item) {
    const med = item.medication;
    const p = item.params;
    if (med.fixed_dose) {
      return { totalMgPerDay: null, dosePerAdminMg: null, volumePerDoseMl: null };
    }
    const weight = parseFloat(state.patient.weight) || 0;
    const totalMgPerDay = weight * p.doseMgPerKgPerDay;
    const dosePerAdminMg = p.dosesPerDay > 0 ? totalMgPerDay / p.dosesPerDay : 0;
    const conc = med.concentration_mg_per_ml || 1;
    const volumePerDoseMl = dosePerAdminMg / conc;
    return {
      totalMgPerDay,
      dosePerAdminMg,
      volumePerDoseMl: Math.round(volumePerDoseMl * 10) / 10,
    };
  }

  function recalculateAll() {
    state.selected.forEach((item) => {
      item.calc = computeCalc(item);
    });
  }

  // ── First-time modal ──────────────────────────────────────────────────
  function openFirstTimeModal(med, params, editingIndex) {
    state.pendingMedicationId = med.id;
    state.editingIndex = editingIndex == null ? null : editingIndex;
    el.firstTimeTitle.textContent = med.presentation
      ? `${med.name} — ${med.presentation}`
      : med.name;

    // Reference-only medications (from taketomo) need presentation/concentration/route.
    const showReferenceFields = !med.data_complete && !med.fixed_dose;
    el.ftPresentationField.style.display = !med.data_complete ? '' : 'none';
    el.ftConcRouteRow.style.display = showReferenceFields ? '' : 'none';
    el.ftPresentation.value = med.presentation || '';
    el.ftConcentration.value = med.concentration_mg_per_ml || '';
    el.ftRoute.value = med.route || 'Oral';

    if (med.fixed_dose) {
      el.ftDoseField.style.display = 'none';
      el.ftMaxField.style.display = 'none';
      el.ftFixedNotice.style.display = 'block';
      el.ftFixedNotice.textContent = `Dose fixa: ${med.fixed_dose_string}`;
    } else {
      el.ftDoseField.style.display = '';
      el.ftMaxField.style.display = '';
      el.ftFixedNotice.style.display = 'none';
      el.ftDose.value = params.doseMgPerKgPerDay || '';
      el.ftMaxDose.value = params.maxMgPerDay || '';
    }
    el.ftFrequency.value = params.dosesPerDay;
    el.ftDuration.value = params.durationDays;
    if (typeof el.firstTimeModal.showModal === 'function') {
      el.firstTimeModal.showModal();
    } else {
      el.firstTimeModal.setAttribute('open', '');
    }
  }

  function closeFirstTimeModal() {
    if (typeof el.firstTimeModal.close === 'function') {
      el.firstTimeModal.close();
    } else {
      el.firstTimeModal.removeAttribute('open');
    }
    state.pendingMedicationId = null;
    state.editingIndex = null;
  }

  function bindFirstTimeModal() {
    el.ftCancel.addEventListener('click', (e) => {
      e.preventDefault();
      closeFirstTimeModal();
    });
    el.ftConfirm.addEventListener('click', (e) => {
      e.preventDefault();
      const id = state.pendingMedicationId;
      const catalogMed = state.medications.find((m) => m.id === id);
      if (!catalogMed) {
        closeFirstTimeModal();
        return;
      }

      // For reference-only meds, enrich with user-supplied presentation/concentration/route.
      let med = catalogMed;
      if (!catalogMed.data_complete && !catalogMed.fixed_dose) {
        med = {
          ...catalogMed,
          presentation: el.ftPresentation.value.trim() || catalogMed.presentation,
          concentration_mg_per_ml: parseFloat(el.ftConcentration.value) || catalogMed.concentration_mg_per_ml,
          route: el.ftRoute.value || catalogMed.route,
        };
      } else if (!catalogMed.data_complete) {
        // Fixed-dose reference: still let user set presentation/route.
        med = {
          ...catalogMed,
          presentation: el.ftPresentation.value.trim() || catalogMed.presentation,
        };
      }

      const params = {
        doseMgPerKgPerDay: med.fixed_dose
          ? 0
          : parseFloat(el.ftDose.value) || 0,
        dosesPerDay: parseInt(el.ftFrequency.value, 10) || 1,
        durationDays: parseInt(el.ftDuration.value, 10) || 1,
        maxMgPerDay: med.fixed_dose
          ? 0
          : parseFloat(el.ftMaxDose.value) || 0,
      };
      const editingIndex = state.editingIndex;
      closeFirstTimeModal();
      if (editingIndex != null) {
        // Edit in place — replace the medication ref so updated presentation/route stick.
        state.selected[editingIndex].medication = med;
        state.selected[editingIndex].params = params;
        state.selected[editingIndex].calc = computeCalc(state.selected[editingIndex]);
        state.validatedIds.add(med.id);
        render();
      } else {
        finalizeAdd(med, params);
      }
    });
  }

  // ── Max dose modal ────────────────────────────────────────────────────
  function openMaxDoseModal(med, params, calculatedMg) {
    state.pendingMedicationId = med.id;
    state._pendingParams = params;
    state._pendingCalcMg = calculatedMg;
    const weight = parseFloat(state.patient.weight) || 0;
    el.mdBody.innerHTML = `
      Para <strong>${escapeHtml(med.name)}</strong>, a dose calculada para
      <strong>${weight.toString().replace('.', ',')}kg</strong> é
      <strong>${calculatedMg.toFixed(0)}mg/dia</strong>, mas a dose máxima
      recomendada é <strong>${params.maxMgPerDay}mg/dia</strong>.
      <br><br>Como deseja prosseguir?`;
    el.mdUseMax.textContent = `Usar dose máxima (${params.maxMgPerDay}mg)`;
    if (typeof el.maxDoseModal.showModal === 'function') {
      el.maxDoseModal.showModal();
    } else {
      el.maxDoseModal.setAttribute('open', '');
    }
  }

  function closeMaxDoseModal() {
    if (typeof el.maxDoseModal.close === 'function') {
      el.maxDoseModal.close();
    } else {
      el.maxDoseModal.removeAttribute('open');
    }
    state.pendingMedicationId = null;
    state._pendingParams = null;
    state._pendingCalcMg = null;
  }

  function bindMaxDoseModal() {
    el.mdUseMax.addEventListener('click', (e) => {
      e.preventDefault();
      const med = state.medications.find((m) => m.id === state.pendingMedicationId);
      const params = { ...state._pendingParams };
      const weight = parseFloat(state.patient.weight) || 1;
      // Recompute mg/kg/day so volume matches the max cap.
      params.doseMgPerKgPerDay = params.maxMgPerDay / weight;
      closeMaxDoseModal();
      pushSelection(med, params);
    });
    el.mdKeep.addEventListener('click', (e) => {
      e.preventDefault();
      const med = state.medications.find((m) => m.id === state.pendingMedicationId);
      const params = { ...state._pendingParams };
      closeMaxDoseModal();
      pushSelection(med, params);
    });
    el.mdCancel.addEventListener('click', (e) => {
      e.preventDefault();
      closeMaxDoseModal();
    });
  }

  // ── Selected medications list ─────────────────────────────────────────
  function renderSelected() {
    if (!state.selected.length) {
      el.selectedList.innerHTML =
        '<li class="empty">Nenhuma medicação adicionada.</li>';
      return;
    }
    el.selectedList.innerHTML = state.selected
      .map((item, idx) => {
        const med = item.medication;
        const summary = summarizeItem(item);
        return `
          <li>
            <div class="sel-row">
              <div class="sel-info">
                <div class="sel-name">${escapeHtml(med.name)} <span class="sel-pres">${escapeHtml(med.presentation)}</span></div>
                <div class="sel-summary">${escapeHtml(summary)}</div>
              </div>
              <div class="sel-actions">
                ${med.taketomo_page ? `<button type="button" data-action="info" data-page="${med.taketomo_page}" class="btn-sm info-btn-sel" title="Taketomo p. ${med.taketomo_page}" aria-label="Abrir Taketomo">i</button>` : ''}
                <button type="button" data-action="edit" data-index="${idx}" class="btn-sm">Editar</button>
                <button type="button" data-action="remove" data-index="${idx}" class="btn-sm btn-danger" aria-label="Remover ${escapeHtml(med.name)}">×</button>
              </div>
            </div>
          </li>`;
      })
      .join('');
  }

  function summarizeItem(item) {
    const med = item.medication;
    const p = item.params;
    const freq = window.PdfOverlay.frequencyString(p.dosesPerDay);
    if (med.fixed_dose) {
      return `${med.fixed_dose_string} · ${freq} · ${p.durationDays} dias`;
    }
    const weight = parseFloat(state.patient.weight) || 0;
    const totalMg = weight * p.doseMgPerKgPerDay;
    const doseStr = formatDoseUnitPreview(item);
    return `${p.doseMgPerKgPerDay}mg/kg/dia (${totalMg.toFixed(0)}mg/dia) · ${doseStr}/dose · ${freq} · ${p.durationDays} dias`;
  }

  function bindSelectedActions() {
    el.selectedList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'info') {
        openTaketomo(parseInt(btn.dataset.page, 10));
        return;
      }
      const idx = parseInt(btn.dataset.index, 10);
      if (btn.dataset.action === 'remove') {
        state.selected.splice(idx, 1);
        render();
      } else if (btn.dataset.action === 'edit') {
        const item = state.selected[idx];
        openFirstTimeModal(item.medication, item.params, idx);
      }
    });
  }

  // ── Live preview: PDF.js renders template once, DOM overlays per page ──
  // Uses pdf-overlay.js's planLayout for identical page-break logic.
  const PDF_W = 595;
  const PDF_H = 842;
  const PAGE_NUM_X = 460;
  const PAGE_NUM_Y = 240;
  const PAGE_NUM_SIZE = 9;

  let templateSourceCanvas = null; // offscreen canvas holding the rendered template
  let previewReady = false;

  async function renderTemplateToCanvas() {
    if (!window.pdfjsLib) throw new Error('pdf.js not loaded');
    if (el.previewStatus) el.previewStatus.textContent = 'carregando…';
    const data = await fetch('./Consultorio.pdf').then((r) => r.arrayBuffer());
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const dpr = window.devicePixelRatio || 1;
    const renderScale = 2 * dpr;
    const viewport = page.getViewport({ scale: renderScale });
    const off = document.createElement('canvas');
    off.width = viewport.width;
    off.height = viewport.height;
    await page.render({ canvasContext: off.getContext('2d'), viewport }).promise;
    templateSourceCanvas = off;
    previewReady = true;
    if (el.previewStatus) el.previewStatus.textContent = '';
    renderOverlay();
  }

  function paintTemplateInto(canvas) {
    canvas.width = templateSourceCanvas.width;
    canvas.height = templateSourceCanvas.height;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.getContext('2d').drawImage(templateSourceCanvas, 0, 0);
  }

  // Ensure exactly `count` page stages exist in the preview container.
  function ensurePages(count) {
    const container = el.previewPages;
    while (container.children.length < count) {
      const stage = document.createElement('div');
      stage.className = 'preview-stage';
      const canvas = document.createElement('canvas');
      canvas.className = 'preview-canvas';
      const overlay = document.createElement('div');
      overlay.className = 'preview-overlay';
      stage.append(canvas, overlay);
      container.append(stage);
      if (templateSourceCanvas) paintTemplateInto(canvas);
    }
    while (container.children.length > count) {
      container.removeChild(container.lastChild);
    }
  }

  function pdfToCss(xPt, yPtFromBottom, size, scale) {
    return {
      x: xPt * scale,
      top: (PDF_H - yPtFromBottom) * scale,
      fontSize: size * scale,
    };
  }

  function schedulePreviewUpdate() {
    // Overlay updates are cheap (DOM only) — no debounce.
    renderOverlay();
  }

  function formatDoseUnitPreview(item) {
    const med = item.medication;
    const calc = item.calc || {};
    const unitType = med.unit_type || 'ml';
    if (unitType === 'ml') {
      const v = calc.volumePerDoseMl;
      if (v == null || !isFinite(v) || isNaN(v)) return '— ml';
      return `${v.toFixed(1).replace('.', ',')}ml`;
    }
    const mgPerUnit = med.mg_per_unit || 0;
    const dosePerAdmin = calc.dosePerAdminMg || 0;
    if (mgPerUnit <= 0) return `${dosePerAdmin.toFixed(0)}mg`;
    const units = dosePerAdmin / mgPerUnit;
    const rounded = Math.round(units * 2) / 2;
    const pluralS = rounded !== 1 ? 's' : '';
    return `${rounded.toString().replace('.', ',')} ${unitType}${pluralS}`;
  }

  function buildMedHTML(item, number, posTop, posBottom, scale) {
    const med = item.medication;
    const presShort = window.PdfOverlay.presentationShort(med.presentation);
    const freq = window.PdfOverlay.frequencyString(item.params.dosesPerDay);
    const line1Prefix = `${number}) ${med.name} ${presShort}`;
    let line2;
    if (med.fixed_dose) {
      line2 = `Ofertar ${med.fixed_dose_string} via ${med.route} ${freq} por ${item.params.durationDays} dias`;
    } else {
      line2 = `Ofertar ${formatDoseUnitPreview(item)} via ${med.route} ${freq} por ${item.params.durationDays} dias`;
    }
    const m1 = posTop;
    const m2 = posBottom;
    return (
      `<div class="ov-med1" style="left:${m1.x}px;top:${m1.top}px;font-size:${m1.fontSize}px;">` +
        `<span>${escapeHtml(line1Prefix)}</span><span class="ov-dashes" aria-hidden="true"></span>` +
      `</div>` +
      `<div class="ov-med2" style="left:${m2.x}px;top:${m2.top}px;font-size:${m2.fontSize}px;">${escapeHtml(line2)}</div>`
    );
  }

  function renderOverlay() {
    if (!el.previewPages) return;
    if (!previewReady) return;

    const LAYOUT = window.PdfOverlay.LAYOUT;
    const ZONE = window.PdfOverlay.ZONE;

    // Plan pages identically to the PDF generator.
    const pages = window.PdfOverlay.planLayout(state.selected, true);
    const totalPages = pages.length;
    ensurePages(totalPages);

    const stages = el.previewPages.children;
    const displayName = state.patient.name.trim()
      ? window.PdfOverlay.capitalizeWords(state.patient.name)
      : '';

    for (let i = 0; i < totalPages; i += 1) {
      const stage = stages[i];
      const overlay = stage.querySelector('.preview-overlay');
      const stageWidth = stage.clientWidth || 600;
      const scale = stageWidth / PDF_W;

      let html = '';

      // Patient name on every page.
      if (displayName) {
        const p = pdfToCss(ZONE.left, LAYOUT.patientNameY, LAYOUT.patientNameSize, scale);
        html += `<div class="ov-name" style="left:${p.x}px;top:${p.top}px;font-size:${p.fontSize}px;">${escapeHtml(displayName)}</div>`;
      }

      for (const op of pages[i].ops) {
        if (op.type === 'routeHeader') {
          const r = pdfToCss(ZONE.left, op.y, LAYOUT.routeHeaderSize, scale);
          html += `<div class="ov-route" style="left:${r.x}px;top:${r.top}px;font-size:${r.fontSize}px;">${escapeHtml(op.label)}</div>`;
        } else if (op.type === 'med') {
          const top = pdfToCss(ZONE.left, op.y, LAYOUT.medSize, scale);
          const bottom = pdfToCss(LAYOUT.medIndentX, op.y - LAYOUT.medLineHeight, LAYOUT.medSize, scale);
          html += buildMedHTML(op.item, op.number, top, bottom, scale);
        }
      }

      // Page number bottom-right.
      const pn = pdfToCss(PAGE_NUM_X, PAGE_NUM_Y, PAGE_NUM_SIZE, scale);
      const pageLabel = `Página ${i + 1} de ${totalPages}`;
      html += `<div class="ov-pagenum" style="left:${pn.x}px;top:${pn.top}px;font-size:${pn.fontSize}px;">${escapeHtml(pageLabel)}</div>`;

      overlay.innerHTML = html;
    }
  }

  function groupSelectedByRoute(items) {
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
    // Sort routes by canonical order if known.
    order.sort((a, b) => {
      const ai = ROUTE_ORDER.indexOf(a);
      const bi = ROUTE_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return order.map((route) => ({ route, items: groups.get(route) }));
  }

  // ── Generate / reset ──────────────────────────────────────────────────
  function bindGenerate() {
    el.generateBtn.addEventListener('click', async () => {
      if (!validate()) return;
      el.generateBtn.disabled = true;
      const originalLabel = el.generateBtn.textContent;
      el.generateBtn.textContent = 'Gerando…';
      try {
        const bytes = await window.PdfOverlay.generatePrescriptionPDF(
          { name: state.patient.name, weight: parseFloat(state.patient.weight) },
          state.selected
        );
        window.PdfOverlay.downloadPDF(bytes, state.patient.name);
      } catch (e) {
        console.error(e);
        alert('Erro ao gerar PDF: ' + (e.message || e));
      } finally {
        el.generateBtn.textContent = originalLabel;
        validate();
      }
    });
  }

  function bindNewPrescription() {
    el.newPrescriptionBtn.addEventListener('click', () => {
      if (state.selected.length || state.patient.name || state.patient.weight) {
        if (!confirm('Limpar todos os dados desta prescrição?')) return;
      }
      state.patient = { name: '', weight: '', dob: '' };
      state.selected = [];
      state.validatedIds = new Set();
      state.editingIndex = null;
      el.patientName.value = '';
      el.patientWeight.value = '';
      el.patientDob.value = '';
      el.ageDisplay.textContent = '';
      el.errDob.textContent = '';
      el.medicationSearch.value = '';
      el.medicationSearch.dataset.selectedId = '';
      el.addMedBtn.disabled = true;
      renderMedicationOptions('');
      render();
      el.patientName.focus();
    });
  }

  // ── Orchestration ─────────────────────────────────────────────────────
  function render() {
    validate();
    renderSelected();
    schedulePreviewUpdate();
  }

  async function init() {
    cacheDom();
    bindFormEvents();
    bindMedSelector();
    bindFirstTimeModal();
    bindMaxDoseModal();
    bindSelectedActions();
    bindGenerate();
    bindNewPrescription();
    await loadCatalog();
    render();
    // Template render is async; overlay re-renders when ready.
    renderTemplateToCanvas().catch((e) => {
      console.error('Template render failed', e);
      if (el.previewStatus) el.previewStatus.textContent = 'erro carregando template';
    });
    window.addEventListener('resize', () => renderOverlay());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
