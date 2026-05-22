// Application logic: loads the medication catalog, manages form state,
// handles modals, renders the live preview, and triggers PDF generation.
// All UI strings are in Brazilian Portuguese.

(function () {
  'use strict';

  const ROUTE_ORDER = ['Oral', 'Inalatório', 'Tópico', 'Outro'];

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
    el.previewFrame = document.getElementById('previewFrame');
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
    const filtered = state.medications.filter((m) => {
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.category && m.category.toLowerCase().includes(q)) ||
        (m.presentation && m.presentation.toLowerCase().includes(q))
      );
    });
    if (!filtered.length) {
      el.medicationList.innerHTML =
        '<li class="empty">Nenhuma medicação encontrada.</li>';
      el.addMedBtn.disabled = true;
      el.medicationSearch.dataset.selectedId = '';
      return;
    }
    el.medicationList.innerHTML = filtered
      .map(
        (m) => `
        <li role="option" data-id="${m.id}">
          <span class="med-name">${escapeHtml(m.name)}</span>
          <span class="med-pres">${escapeHtml(m.presentation)}</span>
          <span class="med-cat">${escapeHtml(m.category || '')}</span>
        </li>`
      )
      .join('');
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
    el.firstTimeTitle.textContent = med.name + ' — ' + med.presentation;
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
      const med = state.medications.find((m) => m.id === id);
      if (!med) {
        closeFirstTimeModal();
        return;
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
        // Edit in place — no max-dose modal escalation, user is already reviewing.
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
    const volume = item.calc.volumePerDoseMl;
    const volStr = volume != null ? `${volume.toFixed(1).replace('.', ',')}ml/dose` : '—';
    return `${p.doseMgPerKgPerDay}mg/kg/dia (${totalMg.toFixed(0)}mg/dia) · ${volStr} · ${freq} · ${p.durationDays} dias`;
  }

  function bindSelectedActions() {
    el.selectedList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
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

  // ── Live PDF preview ──────────────────────────────────────────────────
  // Regenerates the actual PDF in the iframe on every change (debounced).
  // True WYSIWYG: what you see is what the download will produce.
  let previewBlobUrl = null;
  let previewDebounceTimer = null;
  let previewInFlight = false;
  let previewRetry = false;

  function schedulePreviewUpdate() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(triggerPreviewUpdate, 80);
  }

  function triggerPreviewUpdate() {
    if (previewInFlight) {
      previewRetry = true;
      return;
    }
    previewInFlight = true;
    if (el.previewStatus) el.previewStatus.textContent = 'atualizando…';
    updatePreviewPDF().finally(() => {
      previewInFlight = false;
      if (el.previewStatus) el.previewStatus.textContent = '';
      if (previewRetry) {
        previewRetry = false;
        triggerPreviewUpdate();
      }
    });
  }

  async function updatePreviewPDF() {
    try {
      const patient = {
        name: state.patient.name || ' ',
        weight: parseFloat(state.patient.weight) || 0,
      };
      const bytes = await window.PdfOverlay.generatePrescriptionPDF(
        patient,
        state.selected
      );
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const previousUrl = previewBlobUrl;
      previewBlobUrl = url;
      // #toolbar=0 hides the viewer chrome in Chrome; #view=FitH fits horizontally.
      el.previewFrame.src = url + '#toolbar=0&view=FitH';
      if (previousUrl) {
        // Revoke after a short delay so the iframe has time to load the new URL.
        setTimeout(() => URL.revokeObjectURL(previousUrl), 500);
      }
    } catch (e) {
      console.error('Preview generation failed', e);
      if (el.previewStatus) el.previewStatus.textContent = 'erro ao gerar preview';
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
  }

  document.addEventListener('DOMContentLoaded', init);
})();
