(() => {
  "use strict";

  const COLORS = {
    navy: "#17365d",
    blue: "#3785bb",
    teal: "#24968d",
    green: "#43a77a",
    amber: "#e8a23c",
    red: "#d76468",
    purple: "#8b76bd",
    slate: "#718091",
    grid: "rgba(104, 125, 144, 0.13)",
  };
  const GROUP_COLORS = [COLORS.blue, COLORS.teal, COLORS.amber, COLORS.purple, COLORS.red, COLORS.green];
  const QUADRANT_COLORS = {
    Grave: COLORS.red,
    Agudo: COLORS.amber,
    Crónico: COLORS.blue,
    "Bajo control": COLORS.green,
  };
  const TYPE_COLORS = {
    Correctivo: COLORS.red,
    Preventivo: COLORS.blue,
    Predictivo: COLORS.teal,
  };
  const MAINTENANCE_TYPES = ["Correctivo", "Preventivo", "Predictivo"];
  const QUADRANTS = ["Agudo", "Grave", "Crónico", "Bajo control"];
  const MAX_DATASETS = 10;
  const REQUIRED_COLUMNS = [
    "OT",
    "Tipo_mantenimiento",
    "Estado",
    "Fecha_inicio",
    "Fecha_fin",
    "Equipo",
    "Modo_falla",
    "Downtime_h",
    "Horas_mano_obra",
    "Costo_total_CLP",
  ];

  const state = {
    analyses: new Map(),
    charts: new Map(),
    selectedGroup: "all",
    paretoMetric: "frequency",
    jackknifeEntity: "equipment",
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    if (!window.Papa || !window.Chart || !window.jspdf) {
      showToast("No se pudieron cargar las bibliotecas del panel. Revisa tu conexión y recarga la página.", "error", 8000);
      return;
    }

    [
      "group-filter",
      "date-range",
      "data-status",
      "summary-meta",
      "kpi-grid",
      "insights-list",
      "dataset-list",
      "dataset-count",
      "file-input",
      "drop-zone",
      "toast-region",
      "critical-head",
      "critical-body",
      "critical-table-title",
      "jackknife-title",
      "pareto-title",
      "sidebar-datasets",
      "sidebar-dataset-list",
      "initial-upload-kicker",
      "initial-upload-title",
      "initial-upload-description",
      "initial-upload-button",
    ].forEach((id) => {
      elements[id] = document.getElementById(id);
    });

    Chart.defaults.font.family = '"DM Sans", "Segoe UI", sans-serif';
    Chart.defaults.color = "#718091";
    Chart.defaults.borderColor = COLORS.grid;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 7;
    Chart.defaults.plugins.legend.labels.boxHeight = 7;
    Chart.defaults.plugins.tooltip.backgroundColor = "#10253f";
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 7;
    Chart.defaults.animation.duration = 360;

    bindEvents();
    syncDashboard();
  }

  function bindEvents() {
    document.getElementById("hero-upload").addEventListener("click", openFilePicker);
    elements["initial-upload-button"].addEventListener("click", openFilePicker);
    elements["drop-zone"].addEventListener("click", openFilePicker);
    elements["file-input"].addEventListener("change", (event) => {
      addFiles(Array.from(event.target.files || []));
      event.target.value = "";
    });

    const dropZone = elements["drop-zone"];
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("dragging");
      });
    });
    dropZone.addEventListener("drop", (event) => {
      addFiles(Array.from(event.dataTransfer?.files || []));
    });

    elements["group-filter"].addEventListener("change", (event) => {
      selectDataset(event.target.value);
    });
    document.getElementById("reset-sample").addEventListener("click", loadSample);
    document.getElementById("export-pdf").addEventListener("click", exportPdf);
    document.getElementById("header-pdf").addEventListener("click", exportPdf);
    document.getElementById("hero-pdf").addEventListener("click", exportPdf);
    document.getElementById("export-csv").addEventListener("click", exportCsv);

    document.querySelectorAll("[data-pareto]").forEach((button) => {
      button.addEventListener("click", () => {
        state.paretoMetric = button.dataset.pareto;
        setSegmentActive("[data-pareto]", button);
        renderParetoChart();
      });
    });
    document.querySelectorAll("[data-jk]").forEach((button) => {
      button.addEventListener("click", () => {
        state.jackknifeEntity = button.dataset.jk;
        setSegmentActive("[data-jk]", button);
        renderJackknife();
      });
    });

    document.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", () => {
        document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
        link.classList.add("active");
        const label = link.querySelector("span:last-child")?.textContent?.trim();
        document.getElementById("breadcrumb-current").textContent = label || "Resumen ejecutivo";
      });
    });

    elements["dataset-list"].addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-group]");
      if (!button) return;
      state.analyses.delete(button.dataset.removeGroup);
      if (state.selectedGroup === button.dataset.removeGroup) state.selectedGroup = "all";
      syncDashboard();
      showToast(`Se quitó el dataset ${button.dataset.removeGroup} de esta sesión.`, "success");
    });

    elements["sidebar-dataset-list"].addEventListener("click", (event) => {
      const button = event.target.closest("[data-select-group]");
      if (!button || button.disabled) return;
      selectDataset(button.dataset.selectGroup);
    });
  }

  function selectDataset(group) {
    if (group !== "all" && !state.analyses.has(group)) {
      loadBundledDataset(group);
      return;
    }
    if (group === "all" && !state.analyses.size) return;
    state.selectedGroup = group;
    elements["group-filter"].value = group;
    renderSidebarDatasets();
    renderDashboard();
  }

  async function loadBundledDataset(group) {
    if (state.analyses.size >= MAX_DATASETS) {
      showToast(`No se puede agregar el grupo ${group}: se alcanzó el máximo de ${MAX_DATASETS} datasets por sesión.`, "error", 8000);
      return;
    }

    showLoading(`Cargando dataset del grupo ${group}…`);
    try {
      const dataset = window.CMMS_DEFAULT_DATASETS?.find((item) => item.group === group);
      if (!dataset || typeof dataset.text !== "string") {
        throw new Error(`no se encontró el dataset de muestra del grupo ${group}`);
      }
      const parsed = parseCsvText(dataset.text);
      const analysis = analyzeDataset(dataset.group, dataset.fileName, parsed.data);
      state.analyses.set(group, analysis);
      state.selectedGroup = group;
      syncDashboard();
      showToast(`Tus datasets se encuentran listos para analizar. Se cargó ${dataset.fileName}.`, "success");
    } catch (error) {
      showToast(`No se pudo cargar el dataset del grupo ${group}: ${error.message}`, "error", 8000);
    } finally {
      hideLoading();
    }
  }

  function setSegmentActive(selector, activeButton) {
    document.querySelectorAll(selector).forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  }

  function openFilePicker() {
    elements["file-input"].click();
  }

  async function loadSample() {
    showLoading("Cargando datasets incluidos A–D…");
    try {
      if (!Array.isArray(window.CMMS_DEFAULT_DATASETS) || !window.CMMS_DEFAULT_DATASETS.length) {
        throw new Error("no se encontró el paquete local de datasets A–D");
      }

      const bundledAnalyses = window.CMMS_DEFAULT_DATASETS.map(({ group, fileName, text }) => {
        if (!group || !fileName || typeof text !== "string") {
          throw new Error("el paquete local contiene un dataset incompleto");
        }
        const parsed = parseCsvText(text);
        return [group, analyzeDataset(group, fileName, parsed.data)];
      });

      state.analyses.clear();
      bundledAnalyses.forEach(([group, analysis]) => state.analyses.set(group, analysis));
      state.selectedGroup = "all";
      syncDashboard();
      showToast("Datasets de los grupos A–D cargados. Puedes agregar tus propios CSV.", "success");
    } catch (error) {
      syncDashboard();
      showToast(`No se pudieron cargar los datasets incluidos: ${error.message}. Puedes agregar un CSV manualmente.`, "error", 8000);
    } finally {
      hideLoading();
    }
  }

  async function addFiles(files) {
    if (!files.length) return;
    showLoading(`Leyendo ${files.length} archivo${files.length === 1 ? "" : "s"}…`);
    let loaded = 0;
    const errors = [];

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        errors.push(`${file.name}: el archivo no tiene extensión CSV`);
        continue;
      }
      const group = groupNameFromFile(file.name);
      if (!state.analyses.has(group) && state.analyses.size >= MAX_DATASETS) {
        errors.push(`${file.name}: se alcanzó el máximo de ${MAX_DATASETS} datasets por sesión`);
        continue;
      }
      try {
        const text = await file.text();
        const parsed = parseCsvText(text);
        const analysis = analyzeDataset(group, file.name, parsed.data);
        state.analyses.set(group, analysis);
        loaded += 1;
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }

    if (loaded) {
      const groups = [...state.analyses.keys()];
      state.selectedGroup = groups.length > 1 ? "all" : groups[0];
      syncDashboard();
      showToast(`Tus datasets se encuentran listos para analizar. ${groups.length} disponibles en esta sesión.`, "success");
    }
    if (errors.length) showToast(errors.join(" · "), "error", 9000);
    hideLoading();
  }

  function parseCsvText(text) {
    if (!text.trim()) throw new Error("el archivo está vacío");
    const result = Papa.parse(text.replace(/^\uFEFF/, ""), {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      transformHeader: (header) => header.trim().replace(/^\uFEFF/, ""),
    });
    if (result.errors.length) {
      const significant = result.errors.filter((error) => error.code !== "TooFewFields");
      if (significant.length) {
        throw new Error(significant.slice(0, 2).map((error) => error.message).join("; "));
      }
    }
    if (!result.meta.fields?.length) throw new Error("no se detectaron encabezados CSV");
    const missing = REQUIRED_COLUMNS.filter((column) => !result.meta.fields.includes(column));
    if (missing.length) throw new Error(`faltan columnas requeridas: ${missing.join(", ")}`);
    const data = result.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
    if (!data.length) throw new Error("el archivo no contiene filas de datos");
    return { data, fields: result.meta.fields };
  }

  function groupNameFromFile(fileName) {
    const match = fileName.match(/grupo[\s_-]*([a-z0-9]+)/i);
    if (match) return match[1].toUpperCase();
    const base = fileName.replace(/\.csv$/i, "").replace(/^CMMS[_ -]*/i, "");
    return base.trim() || "Dataset";
  }

  function cleanText(value) {
    const text = String(value ?? "").trim().replace(/^'+/, "").trim();
    return text === "" ? "" : text;
  }

  function parseNumber(value) {
    let text = cleanText(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
    if (!text || text === "-" || text === ".") return 0;
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) text = text.replace(/\./g, "").replace(",", ".");
      else text = text.replace(/,/g, "");
    } else if (comma >= 0) {
      text = normalizeSingleSeparator(text, ",");
    } else if (dot >= 0) {
      text = normalizeSingleSeparator(text, ".");
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeSingleSeparator(text, separator) {
    const groups = text.split(separator);
    const integerPart = groups[0].replace(/^[+-]/, "");
    const validThousands = /^\d{1,3}$/.test(integerPart)
      && groups.length > 1
      && groups.slice(1).every((group) => /^\d{3}$/.test(group))
      && (groups.length > 2 || integerPart !== "0");
    if (validThousands) return groups.join("");
    if (groups.length === 2) return `${groups[0]}.${groups[1]}`;
    return text;
  }

  function parseDate(value) {
    const text = cleanText(value);
    if (!text) return null;
    let match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      return new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0),
      );
    }
    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0),
      );
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalizeMaintenance(value) {
    const text = cleanText(value).toLocaleLowerCase("es");
    if (["correctivo", "correctiva"].includes(text)) return "Correctivo";
    if (["preventivo", "preventiva"].includes(text)) return "Preventivo";
    if (["predictivo", "predictiva"].includes(text)) return "Predictivo";
    return cleanText(value) || "Sin clasificar";
  }

  function normalizeState(value) {
    const text = cleanText(value).toLocaleLowerCase("es");
    if (["cerrada", "cerrado"].includes(text)) return "CERRADA";
    if (["abierta", "abierto"].includes(text)) return "ABIERTA";
    if (["en ejecucion", "en ejecución", "ejecutando"].includes(text)) return "EN EJECUCIÓN";
    return cleanText(value).toLocaleUpperCase("es");
  }

  function analyzeDataset(group, fileName, rows) {
    const seen = new Set();
    const normalized = [];
    let duplicateCount = 0;

    for (const original of rows) {
      const row = {};
      Object.keys(original).forEach((key) => {
        row[key.trim()] = cleanText(original[key]);
      });
      const signature = Object.keys(row).sort().map((key) => `${key}=${row[key]}`).join("\u001f");
      if (seen.has(signature)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(signature);
      row.Tipo_mantenimiento = normalizeMaintenance(row.Tipo_mantenimiento);
      row.Estado = normalizeState(row.Estado);
      row.OT = cleanText(row.OT);
      row.Equipo = cleanText(row.Equipo);
      row.Tipo_equipo = cleanText(row.Tipo_equipo) || "Sin clasificar";
      row.Modo_falla = cleanText(row.Modo_falla);
      row.Horas_mano_obra = parseNumber(row.Horas_mano_obra);
      row.Downtime_h = parseNumber(row.Downtime_h);
      row.Costo_total_CLP = parseNumber(row.Costo_total_CLP);
      row.Fecha_inicio_parsed = parseDate(row.Fecha_inicio);
      row.Fecha_fin_parsed = parseDate(row.Fecha_fin);
      row.Tiempo_reparacion_calculado = row.Fecha_inicio_parsed && row.Fecha_fin_parsed
        ? (row.Fecha_fin_parsed.getTime() - row.Fecha_inicio_parsed.getTime()) / 3600000
        : null;
      normalized.push(row);
    }

    if (!normalized.length) throw new Error("no quedaron registros después de limpiar el CSV");

    const uniqueOt = uniqueCount(normalized.map((row) => row.OT));
    const totals = {
      ot: uniqueOt,
      hh: sum(normalized.map((row) => row.Horas_mano_obra)),
      downtime: sum(normalized.map((row) => row.Downtime_h)),
      cost: sum(normalized.map((row) => row.Costo_total_CLP)),
    };
    const maintenance = MAINTENANCE_TYPES.map((type) => {
      const matching = normalized.filter((row) => row.Tipo_mantenimiento === type);
      const rowOt = uniqueCount(matching.map((row) => row.OT));
      const hh = sum(matching.map((row) => row.Horas_mano_obra));
      const downtime = sum(matching.map((row) => row.Downtime_h));
      const cost = sum(matching.map((row) => row.Costo_total_CLP));
      return {
        type,
        ot: rowOt,
        otPct: percentage(rowOt, totals.ot),
        hh,
        hhPct: percentage(hh, totals.hh),
        downtime,
        downtimePct: percentage(downtime, totals.downtime),
        cost,
        costPct: percentage(cost, totals.cost),
      };
    });

    const corrective = normalized.filter((row) => row.Tipo_mantenimiento === "Correctivo");
    const validRepairs = corrective.filter((row) => (
      row.Estado === "CERRADA"
      && row.Fecha_inicio_parsed
      && row.Fecha_fin_parsed
      && Number.isFinite(row.Tiempo_reparacion_calculado)
      && row.Tiempo_reparacion_calculado > 0
    ));
    const durations = validRepairs.map((row) => row.Tiempo_reparacion_calculado);
    const mttr = mean(durations);
    const medianRepair = median(durations);

    const typeEquipmentMap = new Map();
    validRepairs.forEach((row) => {
      addGroupedRow(typeEquipmentMap, row.Tipo_equipo, row);
    });
    const mttrByEquipmentType = [...typeEquipmentMap.entries()].map(([type, grouped]) => ({
      type,
      repairs: uniqueCount(grouped.map((row) => row.OT)),
      mttr: mean(grouped.map((row) => row.Tiempo_reparacion_calculado)),
      median: median(grouped.map((row) => row.Tiempo_reparacion_calculado)),
    })).sort((a, b) => b.mttr - a.mttr);

    const paretoMap = new Map();
    corrective.filter((row) => row.Modo_falla).forEach((row) => {
      addGroupedRow(paretoMap, row.Modo_falla, row);
    });
    const pareto = [...paretoMap.entries()].map(([mode, grouped]) => ({
      mode,
      events: uniqueCount(grouped.map((row) => row.OT)),
      downtime: sum(grouped.map((row) => row.Downtime_h)),
      cost: sum(grouped.map((row) => row.Costo_total_CLP)),
    }));
    const equipmentJackknife = buildJackknife(validRepairs, "Equipo", "Downtime_h");
    const failureJackknife = buildJackknife(validRepairs.filter((row) => row.Modo_falla), "Modo_falla", "Downtime_h");
    const dates = normalized.flatMap((row) => [row.Fecha_inicio_parsed, row.Fecha_fin_parsed]).filter(Boolean);

    return {
      group,
      fileName,
      sourceRows: rows.length,
      recordCount: normalized.length,
      duplicateCount,
      rows: normalized,
      totals,
      maintenance,
      correctiveOt: uniqueCount(corrective.map((row) => row.OT)),
      correctiveValidRepairs: uniqueCount(validRepairs.map((row) => row.OT)),
      validRepairRows: validRepairs.length,
      validRepairs,
      mttr,
      medianRepair,
      durations,
      mttrByEquipmentType,
      pareto,
      equipmentJackknife,
      failureJackknife,
      dates: dates.length
        ? { min: new Date(Math.min(...dates.map((date) => date.getTime()))), max: new Date(Math.max(...dates.map((date) => date.getTime()))) }
        : null,
    };
  }

  function addGroupedRow(map, key, row) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  function sum(values) {
    return values.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
  }

  function mean(values) {
    return values.length ? sum(values) / values.length : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function percentage(value, total) {
    return total ? (value / total) * 100 : 0;
  }

  function uniqueCount(values) {
    return new Set(values.filter((value) => value !== null && value !== undefined && value !== "")).size;
  }

  function buildJackknife(rows, categoryField, downtimeField) {
    const grouped = new Map();
    rows.filter((row) => row[categoryField]).forEach((row) => addGroupedRow(grouped, row[categoryField], row));
    const groups = [...grouped.entries()].map(([name, values]) => ({
      name,
      failures: uniqueCount(values.map((row) => row.OT)),
      downtime: sum(values.map((row) => row[downtimeField])),
    })).filter((row) => row.failures > 0);

    if (!groups.length) return [];
    const totalFailures = sum(groups.map((row) => row.failures));
    const meanFrequency = totalFailures / groups.length;
    const meanRepairTime = totalFailures
      ? sum(groups.map((row) => row.downtime)) / totalFailures
      : 0;

    return groups.map((row) => {
      const averageRepairTime = row.downtime / row.failures;
      const frequencyNorm = meanFrequency ? row.failures / meanFrequency : 0;
      const mttrNorm = meanRepairTime ? averageRepairTime / meanRepairTime : 0;
      const quadrant = classifyQuadrant(frequencyNorm, mttrNorm);
      return {
        ...row,
        averageRepairTime,
        frequencyNorm,
        mttrNorm,
        risk: frequencyNorm * mttrNorm,
        quadrant,
      };
    }).sort((a, b) => b.risk - a.risk);
  }

  function classifyQuadrant(frequency, mttr) {
    if (frequency < 1 && mttr < 1) return "Bajo control";
    if (frequency < 1 && mttr >= 1) return "Agudo";
    if (frequency >= 1 && mttr < 1) return "Crónico";
    return "Grave";
  }

  function syncDashboard() {
    const groups = [...state.analyses.keys()];
    document.getElementById("app-shell").classList.toggle("has-datasets", groups.length > 0);
    renderUploadWelcome(groups.length);
    renderSidebarDatasets();
    if (!groups.length) {
      elements["group-filter"].innerHTML = '<option value="all">Sin datasets cargados</option>';
      renderDatasetList();
      updateStatus();
      renderEmptyDashboard();
      return;
    }

    const priorSelection = state.selectedGroup;
    const options = ['<option value="all">Todos los grupos</option>']
      .concat(groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`));
    elements["group-filter"].innerHTML = options.join("");
    elements["group-filter"].value = groups.includes(priorSelection) ? priorSelection : "all";
    state.selectedGroup = elements["group-filter"].value;
    renderDatasetList();
    updateStatus();
    renderDashboard();
  }

  function renderUploadWelcome(datasetCount) {
    if (datasetCount) {
      elements["initial-upload-kicker"].textContent = "ANÁLISIS LISTO";
      elements["initial-upload-title"].textContent = "¡Tus datasets se encuentran listos!";
      elements["initial-upload-description"].textContent = `${datasetCount} dataset${datasetCount === 1 ? "" : "s"} cargado${datasetCount === 1 ? "" : "s"}. Ya puedes revisar tus resultados o agregar más archivos CSV.`;
      elements["initial-upload-button"].textContent = "Agregar otro dataset CSV";
      return;
    }
    elements["initial-upload-kicker"].textContent = "BIENVENIDO/A A CMMS OPTIMUS";
    elements["initial-upload-title"].textContent = "¡Comienza cargando tus datos!";
    elements["initial-upload-description"].textContent = "Selecciona uno o más archivos CSV para iniciar tus análisis de mantenimiento.";
    elements["initial-upload-button"].textContent = "Seleccionar dataset CSV";
  }

  function renderSidebarDatasets() {
    const analyses = [...state.analyses.values()].sort((a, b) => a.group.localeCompare(b.group, "es"));
    const loadedGroups = new Set(analyses.map((analysis) => analysis.group));
    const bundledDatasets = Array.isArray(window.CMMS_DEFAULT_DATASETS) ? window.CMMS_DEFAULT_DATASETS : [];
    elements["sidebar-datasets"].hidden = analyses.length === 0 && bundledDatasets.length === 0;
    const options = analyses.length
      ? [`<button class="sidebar-dataset${state.selectedGroup === "all" ? " active" : ""}" type="button" data-select-group="all" aria-pressed="${state.selectedGroup === "all"}" title="Mostrar todos los datasets cargados"><span class="sidebar-dataset-icon" aria-hidden="true">Σ</span><span class="sidebar-dataset-name">Todos</span></button>`]
      : [];
    options.push(...analyses.map((analysis) => `<button class="sidebar-dataset${state.selectedGroup === analysis.group ? " active" : ""}" type="button" data-select-group="${escapeHtml(analysis.group)}" aria-pressed="${state.selectedGroup === analysis.group}" title="Mostrar ${escapeHtml(analysis.fileName)} · grupo ${escapeHtml(analysis.group)}"><span class="sidebar-dataset-icon" aria-hidden="true">${escapeHtml(shorten(analysis.group, 2).toLocaleUpperCase("es"))}</span><span class="sidebar-dataset-name">${escapeHtml(analysis.fileName)}</span></button>`));
    options.push(...bundledDatasets
      .filter((dataset) => !loadedGroups.has(dataset.group))
      .map((dataset) => `<button class="sidebar-dataset sidebar-dataset-available" type="button" data-select-group="${escapeHtml(dataset.group)}" aria-pressed="false" title="Cargar y visualizar ${escapeHtml(dataset.fileName)}"><span class="sidebar-dataset-icon" aria-hidden="true">${escapeHtml(shorten(dataset.group, 2).toLocaleUpperCase("es"))}</span><span class="sidebar-dataset-name">${escapeHtml(dataset.fileName)}</span></button>`));
    elements["sidebar-dataset-list"].innerHTML = options.join("");
  }

  function updateStatus() {
    const groups = [...state.analyses.values()];
    const records = sum(groups.map((group) => group.recordCount));
    const groupText = `${groups.length} grupo${groups.length === 1 ? "" : "s"} · ${formatNumber(records, 0)} filas`;
    elements["data-status"].innerHTML = `<span class="status-dot"></span><span>${escapeHtml(groupText)}</span>`;
    elements["dataset-count"].textContent = `${groups.length} dataset${groups.length === 1 ? "" : "s"} · ${formatNumber(records, 0)} filas válidas`;
    document.getElementById("reset-sample").hidden = groups.length === 1 && groups[0].group === "D" && groups[0].fileName === "CMMS_grupo_D.csv";
  }

  function getVisibleAnalyses() {
    if (state.selectedGroup === "all") return [...state.analyses.values()];
    const analysis = state.analyses.get(state.selectedGroup);
    return analysis ? [analysis] : [];
  }

  function renderDashboard() {
    const analyses = getVisibleAnalyses();
    if (!analyses.length) {
      renderEmptyDashboard();
      return;
    }
    const aggregate = aggregateAnalyses(analyses);
    renderKpis(aggregate, analyses);
    renderInsights(analyses, aggregate);
    renderDateRange(analyses);
    elements["summary-meta"].textContent = state.selectedGroup === "all"
      ? `${analyses.length} datasets · ${formatNumber(aggregate.recordCount, 0)} registros analizados`
      : `${analyses[0].group} · ${formatNumber(aggregate.recordCount, 0)} registros`;

    renderOverviewChart(analyses);
    renderMaintenanceChart(analyses);
    renderCorrectiveChart(analyses);
    renderMttrChart(analyses);
    renderParetoChart();
    renderJackknife();
  }

  function aggregateAnalyses(analyses) {
    const totals = {
      ot: sum(analyses.map((analysis) => analysis.totals.ot)),
      hh: sum(analyses.map((analysis) => analysis.totals.hh)),
      downtime: sum(analyses.map((analysis) => analysis.totals.downtime)),
      cost: sum(analyses.map((analysis) => analysis.totals.cost)),
    };
    const repairDurations = analyses.flatMap((analysis) => analysis.durations);
    const correctiveOt = sum(analyses.map((analysis) => analysis.correctiveOt));
    return {
      recordCount: sum(analyses.map((analysis) => analysis.recordCount)),
      sourceRows: sum(analyses.map((analysis) => analysis.sourceRows)),
      duplicateCount: sum(analyses.map((analysis) => analysis.duplicateCount)),
      totals,
      correctiveOt,
      correctiveOtPct: percentage(correctiveOt, totals.ot),
      correctiveHH: percentage(
        sum(analyses.map((analysis) => analysis.maintenance.find((row) => row.type === "Correctivo")?.hh || 0)),
        totals.hh,
      ),
      correctiveDowntime: percentage(
        sum(analyses.map((analysis) => analysis.maintenance.find((row) => row.type === "Correctivo")?.downtime || 0)),
        totals.downtime,
      ),
      correctiveCost: percentage(
        sum(analyses.map((analysis) => analysis.maintenance.find((row) => row.type === "Correctivo")?.cost || 0)),
        totals.cost,
      ),
      mttr: mean(repairDurations),
      median: median(repairDurations),
      validRepairs: sum(analyses.map((analysis) => analysis.correctiveValidRepairs)),
      validRepairRows: repairDurations.length,
      hoursPerThousand: totals.ot ? totals.hh / totals.ot * 1000 : 0,
      downtimePerThousand: totals.ot ? totals.downtime / totals.ot * 1000 : 0,
      costPerThousand: totals.ot ? totals.cost / totals.ot * 1000 : 0,
    };
  }

  function renderKpis(summary, analyses) {
    const cards = [
      { label: "Órdenes de trabajo", value: formatNumber(summary.totals.ot, 0), foot: `${formatNumber(summary.recordCount, 0)} registros únicos tras limpieza`, tone: "blue" },
      { label: "Horas-hombre", value: formatCompact(summary.totals.hh), foot: `${formatNumber(summary.hoursPerThousand, 0)} HH por cada 1.000 OT`, tone: "teal" },
      { label: "Downtime acumulado", value: `${formatCompact(summary.totals.downtime)} h`, foot: `${formatNumber(summary.downtimePerThousand, 0)} h por cada 1.000 OT`, tone: "amber" },
      { label: "MTTR correctivo", value: summary.mttr === null ? "—" : `${formatNumber(summary.mttr, 1)} h`, foot: `${formatNumber(summary.validRepairs, 0)} OT válidas · mediana ${summary.median === null ? "—" : `${formatNumber(summary.median, 1)} h`}`, tone: "purple" },
    ];
    if (analyses.length === 1) {
      cards[0].foot = `${formatNumber(analyses[0].correctiveOt, 0)} correctivas · ${formatNumber(analyses[0].duplicateCount, 0)} duplicados exactos`;
    }
    elements["kpi-grid"].innerHTML = cards.map((card) => `
      <article class="kpi-card kpi-${card.tone}">
        <span class="kpi-label">${escapeHtml(card.label)}</span>
        <strong class="kpi-value">${escapeHtml(card.value)}</strong>
        <span class="kpi-foot">${escapeHtml(card.foot)}</span>
      </article>
    `).join("");
  }

  function renderInsights(analyses, summary) {
    const maxCorrective = maxBy(analyses, (item) => percentage(item.correctiveOt, item.totals.ot));
    const maxDowntime = maxBy(analyses, (item) => item.totals.ot ? item.totals.downtime / item.totals.ot : 0);
    const maxCost = maxBy(analyses, (item) => item.totals.ot ? item.totals.cost / item.totals.ot : 0);
    const maxMttr = maxBy(analyses.filter((item) => item.mttr !== null), (item) => item.mttr);
    const items = [
      {
        title: "Participación correctiva",
        text: maxCorrective
          ? `<b>${escapeHtml(maxCorrective.group)}</b> presenta la mayor proporción de OT correctivas (${formatNumber(percentage(maxCorrective.correctiveOt, maxCorrective.totals.ot), 1)}%).`
          : "No hay OT correctivas para comparar.",
      },
      {
        title: "Impacto operacional",
        text: maxDowntime
          ? `<b>${escapeHtml(maxDowntime.group)}</b> registra más downtime por OT (${formatNumber(maxDowntime.totals.downtime / maxDowntime.totals.ot, 2)} h/OT).`
          : "No hay downtime registrado.",
      },
      {
        title: "Intensidad económica",
        text: maxCost
          ? `<b>${escapeHtml(maxCost.group)}</b> tiene el mayor costo directo medio por OT (${formatCompact(maxCost.totals.cost / maxCost.totals.ot)} CLP/OT).`
          : "No hay costos registrados.",
      },
      {
        title: "Mantenibilidad",
        text: maxMttr
          ? `El MTTR más alto corresponde a <b>${escapeHtml(maxMttr.group)}</b> (${formatNumber(maxMttr.mttr, 1)} h; ${formatNumber(maxMttr.correctiveValidRepairs, 0)} OT válidas).`
          : "No hay reparaciones válidas para calcular MTTR.",
      },
    ];
    if (analyses.length === 1) {
      const analysis = analyses[0];
      const topMode = sortedPareto(analysis, "frequency")[0];
      items[1].text = topMode
        ? `El modo de falla más frecuente es <b>${escapeHtml(topMode.mode)}</b> (${formatNumber(topMode.events, 0)} OT correctivas).`
        : items[1].text;
      items[2].text = `El costo registrado es ${formatCompact(summary.totals.cost)} CLP; ${formatNumber(summary.correctiveCost, 1)}% corresponde a correctivos.`;
    }
    elements["insights-list"].innerHTML = items.map((item, index) => `
      <div class="insight-row">
        <span class="insight-number">0${index + 1}</span>
        <div><strong>${escapeHtml(item.title)}</strong><p>${item.text}</p></div>
      </div>
    `).join("");
  }

  function renderDateRange(analyses) {
    const dates = analyses.flatMap((analysis) => analysis.dates ? [analysis.dates.min, analysis.dates.max] : []);
    if (!dates.length) {
      elements["date-range"].textContent = "Fechas de trabajo no disponibles";
      return;
    }
    const min = new Date(Math.min(...dates.map((date) => date.getTime())));
    const max = new Date(Math.max(...dates.map((date) => date.getTime())));
    elements["date-range"].textContent = min.getFullYear() === max.getFullYear()
      ? `${formatDate(min, false)} — ${formatDate(max, false)}`
      : `${formatDate(min, true)} — ${formatDate(max, true)}`;
  }

  function renderOverviewChart(analyses) {
    const metrics = [
      ["OT únicas", (analysis) => analysis.totals.ot],
      ["HH", (analysis) => analysis.totals.hh],
      ["Downtime [h]", (analysis) => analysis.totals.downtime],
      ["Costo [CLP]", (analysis) => analysis.totals.cost],
    ];
    const indexed = metrics.map(([, getter]) => {
      const values = analyses.map(getter);
      const max = Math.max(...values, 0);
      return values.map((value) => max ? (value / max) * 100 : 0);
    });
    const datasets = analyses.map((analysis, index) => ({
      label: analysis.group,
      data: metrics.map((_, metricIndex) => indexed[metricIndex][index]),
      backgroundColor: `${GROUP_COLORS[index % GROUP_COLORS.length]}33`,
      borderColor: GROUP_COLORS[index % GROUP_COLORS.length],
      pointBackgroundColor: GROUP_COLORS[index % GROUP_COLORS.length],
      pointBorderColor: "#fff",
      pointRadius: 3,
      borderWidth: 2,
    }));
    const chart = createChart("overview-chart", "radar", {
      labels: metrics.map((item) => item[0]),
      datasets,
    }, {
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 25, backdropColor: "transparent", font: { size: 8 } },
          grid: { color: COLORS.grid },
          angleLines: { color: COLORS.grid },
          pointLabels: { color: "#718091", font: { size: 9 } },
        },
      },
      plugins: {
        legend: { display: analyses.length > 1, position: "bottom" },
        tooltip: {
          callbacks: {
            label(context) {
              const analysis = analyses[context.datasetIndex];
              const actual = metrics[context.dataIndex][1](analysis);
              return `${analysis.group}: ${formatMetric(context.dataIndex, actual)}`;
            },
            afterBody() {
              return "Escala indexada: 100 equivale al valor máximo observado";
            },
          },
        },
      },
    });
    return chart;
  }

  function renderMaintenanceChart(analyses) {
    const datasets = analyses.map((analysis, index) => {
      const totals = MAINTENANCE_TYPES.map((type) => (
        analysis.maintenance.find((row) => row.type === type)?.otPct || 0
      ));
      return {
        label: analysis.group,
        data: totals,
        backgroundColor: GROUP_COLORS[index % GROUP_COLORS.length],
        borderRadius: 4,
        maxBarThickness: 31,
      };
    });
    createChart("maintenance-chart", "bar", {
      labels: MAINTENANCE_TYPES,
      datasets,
    }, {
      scales: {
        x: { grid: { display: false }, stacked: false, ticks: { font: { size: 10 } } },
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: "% de OT únicas" },
          ticks: { font: { size: 10 } },
        },
      },
      plugins: { legend: { display: analyses.length > 1, position: "bottom" } },
    });
  }

  function renderCorrectiveChart(analyses) {
    const metrics = [
      ["OT correctivas", (analysis) => percentage(analysis.correctiveOt, analysis.totals.ot)],
      ["HH", (analysis) => analysis.maintenance.find((row) => row.type === "Correctivo")?.hhPct || 0],
      ["Downtime", (analysis) => analysis.maintenance.find((row) => row.type === "Correctivo")?.downtimePct || 0],
      ["Costo", (analysis) => analysis.maintenance.find((row) => row.type === "Correctivo")?.costPct || 0],
    ];
    const datasets = analyses.map((analysis, index) => ({
      label: analysis.group,
      data: metrics.map(([, getter]) => getter(analysis)),
      backgroundColor: GROUP_COLORS[index % GROUP_COLORS.length],
      borderRadius: 3,
      maxBarThickness: 26,
    }));
    createChart("corrective-chart", "bar", {
      labels: metrics.map((item) => item[0]),
      datasets,
    }, {
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            font: { size: 9 },
            callback(value) {
              return wrapChartLabel(this.getLabelForValue(value), 10);
            },
          },
        },
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: "% del total de cada grupo" },
          ticks: { font: { size: 10 } },
        },
      },
      plugins: { legend: { display: analyses.length > 1, position: "bottom" } },
    });
  }

  function renderMttrChart(analyses) {
    if (analyses.length > 1) {
      const labels = analyses.map((analysis) => analysis.group);
      createChart("mttr-chart", "bar", {
        labels,
        datasets: [
          {
            label: "MTTR medio [h]",
            data: analyses.map((analysis) => analysis.mttr ?? 0),
            backgroundColor: COLORS.blue,
            borderRadius: 4,
          },
          {
            label: "Mediana [h]",
            data: analyses.map((analysis) => median(analysis.durations) ?? 0),
            backgroundColor: COLORS.teal,
            borderRadius: 4,
          },
        ],
      }, {
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: "Horas" } },
        },
        plugins: { legend: { display: true, position: "bottom" } },
      });
      return;
    }

    const analysis = analyses[0];
    const rows = analysis.mttrByEquipmentType.slice(0, 15).reverse();
    const backgroundColors = rows.map((row) => (
      row.mttr > (analysis.mttr ?? 0) ? COLORS.amber : COLORS.blue
    ));
    createChart("mttr-chart", "bar", {
      labels: rows.map((row) => row.type),
      datasets: [{
        label: "MTTR medio [h]",
        data: rows.map((row) => row.mttr),
        backgroundColor: backgroundColors,
        borderRadius: 4,
        maxBarThickness: 19,
      }],
    }, {
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "Horas" }, ticks: { font: { size: 10 } } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel(context) {
              const item = rows[context.dataIndex];
              return `Reparaciones válidas: ${formatNumber(item.repairs, 0)} · Mediana: ${formatNumber(item.median, 1)} h`;
            },
          },
        },
      },
    });
  }

  function sortedPareto(analysis, metric) {
    const key = metric === "downtime" ? "downtime" : metric === "cost" ? "cost" : "events";
    const sorted = [...analysis.pareto].sort((a, b) => b[key] - a[key]).slice(0, 10);
    const total = sum(analysis.pareto.map((row) => row[key]));
    let cumulative = 0;
    return sorted.map((row) => {
      const percent = percentage(row[key], total);
      cumulative += percent;
      return { ...row, value: row[key], percent, cumulative };
    });
  }

  function renderParetoChart() {
    const analyses = getVisibleAnalyses();
    if (!analyses.length) return;
    const metric = state.paretoMetric;
    const label = metric === "downtime" ? "Downtime acumulado [h]" : metric === "cost" ? "Costo [CLP]" : "OT únicas";
    const title = metric === "downtime" ? "Pareto por downtime" : metric === "cost" ? "Pareto por costo directo" : "Pareto por frecuencia";
    elements["pareto-title"].textContent = title;

    if (analyses.length > 1) {
      const allModes = new Map();
      analyses.forEach((analysis) => {
        const key = metric === "downtime" ? "downtime" : metric === "cost" ? "cost" : "events";
        analysis.pareto.forEach((row) => {
          allModes.set(row.mode, (allModes.get(row.mode) || 0) + row[key]);
        });
      });
      const topModes = [...allModes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const total = sum([...allModes.values()]);
      let cumulative = 0;
      const percents = topModes.map(([, value]) => {
        cumulative += percentage(value, total);
        return cumulative;
      });
      createChart("pareto-chart", "bar", {
        labels: topModes.map(([mode]) => mode),
        datasets: [{
          label,
          data: topModes.map(([, value]) => value),
          backgroundColor: topModes.map((_, index) => GROUP_COLORS[index % GROUP_COLORS.length]),
          borderRadius: 3,
          yAxisID: "y",
          order: 2,
        }, {
          label: "% acumulado",
          data: percents,
          type: "line",
          yAxisID: "y1",
          borderColor: COLORS.slate,
          backgroundColor: COLORS.slate,
          pointBackgroundColor: COLORS.slate,
          pointRadius: 3,
          tension: 0.25,
          order: 1,
        }],
      }, paretoOptions(label));
      return;
    }

    const rows = sortedPareto(analyses[0], metric);
    createChart("pareto-chart", "bar", {
      labels: rows.map((row) => row.mode),
      datasets: [{
        label,
        data: rows.map((row) => row.value),
        backgroundColor: rows.map((_, index) => GROUP_COLORS[index % GROUP_COLORS.length]),
        borderRadius: 3,
        yAxisID: "y",
        order: 2,
      }, {
        label: "% acumulado",
        data: rows.map((row) => row.cumulative),
        type: "line",
        yAxisID: "y1",
        borderColor: COLORS.slate,
        backgroundColor: COLORS.slate,
        pointBackgroundColor: COLORS.slate,
        pointRadius: 3,
        tension: 0.25,
        order: 1,
      }],
    }, paretoOptions(label));
  }

  function paretoOptions(valueLabel) {
    return {
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            font: { size: 10 },
            callback(value) {
              return wrapChartLabel(this.getLabelForValue(value));
            },
          },
        },
        y: { beginAtZero: true, title: { display: true, text: valueLabel }, ticks: { font: { size: 10 } } },
        y1: {
          beginAtZero: true,
          max: 105,
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Acumulado [%]" },
          ticks: { callback: (value) => `${value}%`, font: { size: 10 } },
        },
      },
      plugins: { legend: { position: "bottom" } },
    };
  }

  function renderJackknife() {
    const analyses = getVisibleAnalyses();
    if (!analyses.length) return;
    const entity = state.jackknifeEntity;
    const dataKey = entity === "equipment" ? "equipmentJackknife" : "failureJackknife";
    const title = entity === "equipment" ? "Mapa de criticidad por equipo" : "Mapa de criticidad por modo de falla";
    const tableTitle = entity === "equipment" ? "Equipos de mayor riesgo" : "Modos de falla de mayor riesgo";
    elements["jackknife-title"].textContent = title;
    elements["critical-table-title"].textContent = tableTitle;

    const datasets = analyses.map((analysis, index) => {
      const points = analysis[dataKey];
      return {
        label: analysis.group,
        data: points.map((point) => ({
          x: Math.max(point.frequencyNorm, 0.01),
          y: Math.max(point.mttrNorm, 0.01),
          name: point.name,
          risk: point.risk,
          quadrant: point.quadrant,
          failures: point.failures,
          downtime: point.downtime,
        })),
        backgroundColor: points.map((point) => `${QUADRANT_COLORS[point.quadrant]}cc`),
        borderColor: points.map((point) => QUADRANT_COLORS[point.quadrant]),
        pointRadius: analyses.length > 1 ? 4 : 5,
        pointHoverRadius: 7,
      };
    });
    createChart("jackknife-chart", "scatter", { datasets }, {
      scales: {
        x: {
          type: "logarithmic",
          min: 0.01,
          title: { display: true, text: "Frecuencia normalizada" },
          grid: { color: COLORS.grid },
        },
        y: {
          type: "logarithmic",
          min: 0.01,
          title: { display: true, text: "MTTR normalizado" },
          grid: { color: COLORS.grid },
        },
      },
      plugins: {
        legend: { display: analyses.length > 1, position: "bottom" },
        tooltip: {
          callbacks: {
            label(context) {
              const point = context.raw;
              return `${point.name} · R* ${formatNumber(point.risk, 2)}`;
            },
            afterLabel(context) {
              const point = context.raw;
              return `${point.quadrant} · ${formatNumber(point.failures, 0)} fallas · ${formatNumber(point.x, 2)}× freq. · ${formatNumber(point.y, 2)}× MTTR`;
            },
          },
        },
      },
    });
    renderCriticalTable(analyses, dataKey);
  }

  function renderCriticalTable(analyses, dataKey) {
    const entityName = state.jackknifeEntity === "equipment" ? "Equipo" : "Modo de falla";
    const rows = analyses.flatMap((analysis) => analysis[dataKey].slice(0, analyses.length === 1 ? 10 : 5).map((row) => ({
      group: analysis.group,
      ...row,
    })));
    const header = analyses.length > 1
      ? ["Grupo", entityName, "Fallas", "MTTR [h]", "R*"]
      : [entityName, "Fallas", "MTTR [h]", "R*", "Cuadrante"];
    elements["critical-head"].innerHTML = `<tr>${header.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr>`;
    elements["critical-body"].innerHTML = rows.length
      ? rows.map((row) => `
        <tr>
          ${analyses.length > 1 ? `<td>${escapeHtml(row.group)}</td>` : ""}
          <td title="${escapeHtml(row.name)}">${escapeHtml(shorten(row.name, 27))}</td>
          <td>${formatNumber(row.failures, 0)}</td>
          <td>${formatNumber(row.averageRepairTime, 1)}</td>
          <td><strong>${formatNumber(row.risk, 2)}</strong></td>
          ${analyses.length === 1 ? `<td><span class="risk-badge ${riskClass(row.quadrant)}">${escapeHtml(row.quadrant)}</span></td>` : ""}
        </tr>
      `).join("")
      : `<tr><td colspan="${header.length}" class="table-empty">No hay reparaciones válidas para clasificar.</td></tr>`;
  }

  function wrapChartLabel(value, maxLength = 12) {
    const lines = [];
    let line = "";
    String(value).split(/\s+/).forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && candidate.length > maxLength) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function renderDatasetList() {
    const analyses = [...state.analyses.values()].sort((a, b) => a.group.localeCompare(b.group, "es"));
    if (!analyses.length) {
      elements["dataset-list"].innerHTML = '<div class="dataset-empty">Aún no hay datasets cargados.</div>';
      return;
    }
    elements["dataset-list"].innerHTML = analyses.map((analysis) => `
      <div class="dataset-item">
        <span class="dataset-file-icon">CSV</span>
        <div class="dataset-copy">
          <strong title="${escapeHtml(analysis.fileName)}">${escapeHtml(analysis.group)} · ${escapeHtml(analysis.fileName)}</strong>
          <span>${formatNumber(analysis.recordCount, 0)} filas válidas · ${formatNumber(analysis.duplicateCount, 0)} duplicados exactos</span>
        </div>
        <button class="dataset-remove" type="button" data-remove-group="${escapeHtml(analysis.group)}" aria-label="Quitar grupo ${escapeHtml(analysis.group)}" title="Quitar dataset">×</button>
      </div>
    `).join("");
  }

  function renderEmptyDashboard() {
    elements["kpi-grid"].innerHTML = Array.from({ length: 4 }, () => `
      <article class="kpi-card"><span class="kpi-label">Sin datos</span><strong class="kpi-value">—</strong><span class="kpi-foot">Carga uno o más archivos CSV</span></article>
    `).join("");
    elements["summary-meta"].textContent = "Sin datasets cargados";
    elements["date-range"].textContent = "Fechas no disponibles";
    elements["insights-list"].innerHTML = '<div class="dataset-empty">Agrega un CSV para iniciar el análisis.</div>';
    [
      "overview-chart",
      "maintenance-chart",
      "corrective-chart",
      "mttr-chart",
      "pareto-chart",
      "jackknife-chart",
    ].forEach((id) => destroyChart(id));
    elements["critical-head"].innerHTML = "";
    elements["critical-body"].innerHTML = "";
  }

  function createChart(canvasId, type, data, options) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    const chart = new Chart(canvas, {
      type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { mode: "index", intersect: false },
        },
        ...options,
      },
    });
    state.charts.set(canvasId, chart);
    return chart;
  }

  function destroyChart(canvasId) {
    state.charts.get(canvasId)?.destroy();
    state.charts.delete(canvasId);
  }

  function exportCsv() {
    const analyses = [...state.analyses.values()];
    if (!analyses.length) {
      showToast("Carga al menos un dataset antes de exportar.", "error");
      return;
    }
    const columns = [
      ["Grupo", (item) => item.group],
      ["Archivo", (item) => item.fileName],
      ["Registros origen", (item) => item.sourceRows],
      ["Registros analizados", (item) => item.recordCount],
      ["Duplicados exactos", (item) => item.duplicateCount],
      ["OT únicas", (item) => item.totals.ot],
      ["OT correctivas", (item) => item.correctiveOt],
      ["OT correctivas [%]", (item) => percentage(item.correctiveOt, item.totals.ot)],
      ["HH totales", (item) => item.totals.hh],
      ["Downtime total [h]", (item) => item.totals.downtime],
      ["Costo total [CLP]", (item) => item.totals.cost],
      ["MTTR correctivo [h]", (item) => item.mttr ?? ""],
      ["Mediana reparación [h]", (item) => median(item.durations) ?? ""],
      ["Reparaciones válidas", (item) => item.correctiveValidRepairs],
      ["HH por 1000 OT", (item) => item.totals.ot ? item.totals.hh / item.totals.ot * 1000 : 0],
      ["Downtime por 1000 OT [h]", (item) => item.totals.ot ? item.totals.downtime / item.totals.ot * 1000 : 0],
      ["Costo por 1000 OT [CLP]", (item) => item.totals.ot ? item.totals.cost / item.totals.ot * 1000 : 0],
      ["Modo de falla más frecuente", (item) => sortedPareto(item, "frequency")[0]?.mode || ""],
      ["Equipo con mayor R*", (item) => item.equipmentJackknife[0]?.name || ""],
    ];
    const csv = [
      columns.map(([name]) => csvCell(name)).join(","),
      ...analyses.map((analysis) => columns.map(([, getter]) => csvCell(getter(analysis))).join(",")),
    ].join("\r\n");
    downloadBlob(`Resumen_CMMS_${dateStamp()}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
    showToast("Resumen de indicadores descargado en CSV.", "success");
  }

  async function exportPdf() {
    const analyses = getVisibleAnalyses();
    if (!analyses.length) {
      showToast("Carga al menos un dataset antes de exportar el informe.", "error");
      return;
    }
    if (!window.jspdf?.jsPDF) {
      showToast("No se pudo cargar el exportador PDF. Revisa tu conexión.", "error");
      return;
    }

    showLoading("Preparando informe ejecutivo PDF…");
    const originalParetoMetric = state.paretoMetric;
    const originalJackknifeEntity = state.jackknifeEntity;
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      if (typeof doc.autoTable !== "function") throw new Error("No se cargó el complemento de tablas del PDF");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 16;
      const summary = aggregateAnalyses(analyses);
      const pageTitle = (title, subtitle) => {
        doc.setFillColor(16, 37, 63);
        doc.rect(0, 0, pageWidth, 25, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text(title, margin, 11);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(202, 218, 228);
        doc.text(subtitle, margin, 18);
        doc.setTextColor(35, 50, 67);
      };
      const pageFooter = () => {
        const count = doc.getNumberOfPages();
        for (let page = 1; page <= count; page += 1) {
          doc.setPage(page);
          doc.setDrawColor(224, 231, 236);
          doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(126, 140, 152);
          doc.text(          "CMMS Optimus · Informe generado localmente", margin, pageHeight - 7);
          doc.text(`${page} / ${count}`, pageWidth - margin, pageHeight - 7, { align: "right" });
        }
      };
      const addChart = (canvasId, x, y, width, height) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !canvas.width || !canvas.height) return;
        doc.addImage(canvas.toDataURL("image/png", 1), "PNG", x, y, width, height, undefined, "FAST");
      };
      const addSectionLabel = (text, x, y) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(23, 54, 93);
        doc.text(text, x, y);
        doc.setTextColor(35, 50, 67);
      };
      const groupLabels = analyses.map((analysis) => analysis.group).join(", ");

      pageTitle("INFORME EJECUTIVO DE MANTENIMIENTO", `Análisis CMMS · ${groupLabels} · ${new Date().toLocaleDateString("es-CL")}`);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(21);
      doc.setTextColor(23, 54, 93);
      doc.text("Resumen ejecutivo", margin, 41);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(91, 107, 121);
      const intro = analyses.length === 1
        ? `Dataset ${analyses[0].group}: ${formatNumber(analyses[0].recordCount, 0)} registros analizados después de eliminar duplicados exactos.`
        : `${analyses.length} grupos analizados de forma independiente. Las tasas comparativas y la distribución de las OT se calculan dentro de cada grupo.`;
      doc.text(doc.splitTextToSize(intro, pageWidth - margin * 2), margin, 49);

      const cards = [
        ["OT ÚNICAS", formatNumber(summary.totals.ot, 0)],
        ["HORAS-HOMBRE", formatNumber(summary.totals.hh, 1)],
        ["DOWNTIME TOTAL", `${formatNumber(summary.totals.downtime, 1)} h`],
        ["MTTR CORRECTIVO", summary.mttr === null ? "N/D" : `${formatNumber(summary.mttr, 1)} h`],
      ];
      const cardY = 61;
      const cardGap = 4;
      const cardWidth = (pageWidth - margin * 2 - cardGap * 3) / 4;
      cards.forEach(([label, value], index) => {
        const x = margin + index * (cardWidth + cardGap);
        doc.setFillColor(245, 248, 250);
        doc.roundedRect(x, cardY, cardWidth, 22, 2, 2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6);
        doc.setTextColor(113, 128, 145);
        doc.text(label, x + 3, cardY + 7);
        doc.setFontSize(10);
        doc.setTextColor(16, 37, 63);
        doc.text(doc.splitTextToSize(value, cardWidth - 6), x + 3, cardY + 16);
      });

      addSectionLabel("Volumen e impacto por grupo", margin, 94);
      doc.autoTable({
        startY: 98,
        head: [["Grupo", "Registros", "OT únicas", "HH", "Downtime [h]", "Costo directo [CLP]"]],
        body: analyses.map((analysis) => [
          analysis.group,
          formatNumber(analysis.recordCount, 0),
          formatNumber(analysis.totals.ot, 0),
          formatNumber(analysis.totals.hh, 1),
          formatNumber(analysis.totals.downtime, 1),
          formatNumber(analysis.totals.cost, 0),
        ]),
        margin: { left: margin, right: margin },
        styles: { font: "helvetica", fontSize: 7, cellPadding: 2.2 },
        headStyles: { fillColor: [23, 54, 93], textColor: 255 },
        alternateRowStyles: { fillColor: [247, 249, 251] },
      });
      const overviewY = Math.max(doc.lastAutoTable.finalY + 8, 123);
      addSectionLabel("Magnitud relativa entre grupos (máximo = 100)", margin, overviewY);
      addChart("overview-chart", margin + 8, overviewY + 3, pageWidth - margin * 2 - 16, 76);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(113, 128, 145);
      doc.text("Los costos, horas-hombre y downtime están indexados al máximo de cada indicador para facilitar su lectura conjunta.", margin, pageHeight - 20);

      doc.addPage();
      pageTitle("ESTRATEGIA DE MANTENIMIENTO", "Distribución de órdenes y contribución correctiva");
      addSectionLabel("Distribución por tipo de mantenimiento", margin, 37);
      doc.autoTable({
        startY: 41,
        head: [["Grupo", "Tipo", "OT únicas", "% OT", "HH", "% HH", "Downtime [h]", "% Downtime", "Costo [CLP]", "% Costo"]],
        body: analyses.flatMap((analysis) => analysis.maintenance.map((row) => [
          analysis.group,
          row.type,
          formatNumber(row.ot, 0),
          `${formatNumber(row.otPct, 1)}%`,
          formatNumber(row.hh, 1),
          `${formatNumber(row.hhPct, 1)}%`,
          formatNumber(row.downtime, 1),
          `${formatNumber(row.downtimePct, 1)}%`,
          formatNumber(row.cost, 0),
          `${formatNumber(row.costPct, 1)}%`,
        ])),
        margin: { left: margin, right: margin },
        styles: { font: "helvetica", fontSize: 6, cellPadding: 1.7 },
        headStyles: { fillColor: [23, 54, 93], textColor: 255 },
        alternateRowStyles: { fillColor: [247, 249, 251] },
      });
      const correctiveY = Math.min(doc.lastAutoTable.finalY + 8, 125);
      addSectionLabel("Participación del mantenimiento correctivo", margin, correctiveY);
      addChart("corrective-chart", margin + 6, correctiveY + 4, pageWidth - margin * 2 - 12, 86);
      doc.setFontSize(8);
      doc.setTextColor(91, 107, 121);
      const correctives = analyses.map((analysis) => {
        const correction = analysis.maintenance.find((row) => row.type === "Correctivo");
        return `${analysis.group}: OT ${formatNumber(percentage(analysis.correctiveOt, analysis.totals.ot), 1)}%, HH ${formatNumber(correction?.hhPct || 0, 1)}%, downtime ${formatNumber(correction?.downtimePct || 0, 1)}%, costo ${formatNumber(correction?.costPct || 0, 1)}%.`;
      }).join("  ");
      doc.text(doc.splitTextToSize(correctives, pageWidth - margin * 2), margin, Math.min(correctiveY + 100, pageHeight - 22));

      doc.addPage();
      pageTitle("MANTENIBILIDAD", "Tiempos de reparación y criterio de inclusión");
      addSectionLabel("Indicadores de reparación correctiva", margin, 38);
      doc.autoTable({
        startY: 43,
        head: [["Grupo", "OT correctivas", "Reparaciones válidas", "MTTR [h]", "Mediana [h]"]],
        body: analyses.map((analysis) => [
          analysis.group,
          formatNumber(analysis.correctiveOt, 0),
          formatNumber(analysis.correctiveValidRepairs, 0),
          analysis.mttr === null ? "N/D" : formatNumber(analysis.mttr, 2),
          analysis.medianRepair === null ? "N/D" : formatNumber(analysis.medianRepair, 2),
        ]),
        margin: { left: margin, right: margin },
        styles: { font: "helvetica", fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [23, 54, 93], textColor: 255 },
        alternateRowStyles: { fillColor: [247, 249, 251] },
      });
      let mttrY = doc.lastAutoTable.finalY + 9;
      addSectionLabel(analyses.length > 1 ? "MTTR comparativo por grupo" : "MTTR por tipo de equipo", margin, mttrY);
      addChart("mttr-chart", margin + 4, mttrY + 3, pageWidth - margin * 2 - 8, 105);
      mttrY += 116;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(91, 107, 121);
      const criteria = [
        "Se consideran solo órdenes correctivas con estado cerrada, fechas de inicio y término válidas, y duración estrictamente mayor que cero.",
        "El tiempo de reparación se calcula como fecha de término menos fecha de inicio. Es tiempo calendario y no equivale necesariamente a horas-hombre.",
        `Tamaño de muestra: ${analyses.map((analysis) => `${analysis.group}, ${formatNumber(analysis.correctiveValidRepairs, 0)} OT válidas`).join("; ")}.`,
      ].join("\n\n");
      doc.text(doc.splitTextToSize(criteria, pageWidth - margin * 2), margin, mttrY);

      const paretoModes = [
        ["frequency", "PARETO POR FRECUENCIA", "OT únicas"],
        ["downtime", "PARETO POR DOWNTIME", "Downtime [h]"],
        ["cost", "PARETO POR COSTO DIRECTO", "Costo [CLP]"],
      ];
      for (const [metric, title, measure] of paretoModes) {
        state.paretoMetric = metric;
        setSegmentActive("[data-pareto]", document.querySelector(`[data-pareto="${metric}"]`));
        renderParetoChart();
        await waitForChart();
        doc.addPage();
        pageTitle("MODOS DE FALLA PRIORITARIOS", `${title.toLocaleLowerCase("es")} · Top 10 por grupo seleccionado`);
        if (analyses.length === 1) {
          const rows = sortedPareto(analyses[0], metric);
          doc.autoTable({
            startY: 34,
            head: [["#", "Modo de falla", measure, "% acumulado"]],
            body: rows.map((row, index) => [
              index + 1,
              row.mode,
              metric === "cost" ? formatNumber(row.value, 0) : formatNumber(row.value, 1),
              `${formatNumber(row.cumulative, 1)}%`,
            ]),
            margin: { left: margin, right: margin },
            styles: { font: "helvetica", fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [23, 54, 93], textColor: 255 },
            alternateRowStyles: { fillColor: [247, 249, 251] },
          });
        }
        addChart("pareto-chart", margin, analyses.length === 1 ? 116 : 45, pageWidth - margin * 2, analyses.length === 1 ? 110 : 150);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(91, 107, 121);
        doc.text(
          doc.splitTextToSize(
            "El Pareto agrupa OT correctivas por modo de falla registrado. Las barras muestran la magnitud seleccionada y la línea el porcentaje acumulado respecto del total de la métrica.",
            pageWidth - margin * 2,
          ),
          margin,
          pageHeight - 25,
        );
      }

      state.paretoMetric = "frequency";
      setSegmentActive("[data-pareto]", document.querySelector('[data-pareto="frequency"]'));
      renderParetoChart();
      await waitForChart();

      for (const entity of ["equipment", "failure"]) {
        state.jackknifeEntity = entity;
        setSegmentActive("[data-jk]", document.querySelector(`[data-jk="${entity}"]`));
        renderJackknife();
        await waitForChart();
        doc.addPage();
        pageTitle("PRIORIZACIÓN JACK-KNIFE", entity === "equipment" ? "Frecuencia y MTTR normalizados por equipo" : "Frecuencia y MTTR normalizados por modo de falla");
        addChart("jackknife-chart", margin, 35, pageWidth - margin * 2, 123);
        const key = entity === "equipment" ? "equipmentJackknife" : "failureJackknife";
        const headerName = entity === "equipment" ? "Equipo" : "Modo de falla";
        doc.autoTable({
          startY: 163,
          head: [[headerName, "Fallas", "MTTR medio [h]", "Freq. norm.", "MTTR norm.", "R*", "Clasificación"]],
          body: analyses.flatMap((analysis) => analysis[key].slice(0, 5).map((row) => [
            analyses.length > 1 ? `${analysis.group} · ${row.name}` : row.name,
            formatNumber(row.failures, 0),
            formatNumber(row.averageRepairTime, 2),
            formatNumber(row.frequencyNorm, 2),
            formatNumber(row.mttrNorm, 2),
            formatNumber(row.risk, 2),
            row.quadrant,
          ])),
          margin: { left: margin, right: margin },
          styles: { font: "helvetica", fontSize: 6.7, cellPadding: 1.9 },
          headStyles: { fillColor: [23, 54, 93], textColor: 255 },
          alternateRowStyles: { fillColor: [247, 249, 251] },
        });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(91, 107, 121);
        const jkNote = analyses.length > 1
          ? "El Jack-Knife se normaliza dentro de cada dataset; las posiciones relativas permiten explorar prioridades de cada cohorte, pero los valores no constituyen una escala absoluta comparable entre grupos."
          : "Línea de referencia x=1: frecuencia media por entidad; y=1: MTTR medio. Agudo: baja frecuencia y alto MTTR. Crónico: alta frecuencia y bajo MTTR. Grave: ambos altos. Bajo control: ambos bajos.";
        doc.text(doc.splitTextToSize(jkNote, pageWidth - margin * 2), margin, pageHeight - 19);
      }

      state.jackknifeEntity = originalJackknifeEntity;
      setSegmentActive("[data-jk]", document.querySelector(`[data-jk="${originalJackknifeEntity}"]`));
      renderJackknife();
      await waitForChart();
      doc.addPage();
      pageTitle("METODOLOGÍA Y ALCANCE", "Reglas aplicadas por esta aplicación estática");
      const methodText = [
        "Datos: archivos CSV leídos y procesados íntegramente en el navegador. La página no carga datos a un servidor.",
        "Limpieza: eliminación de apóstrofos y espacios exteriores, normalización de tipo de mantenimiento y estado, conversión de fechas d-m-Y e importes/horas, y eliminación de filas exactamente duplicadas dentro de cada archivo.",
        "Órdenes: el volumen se calcula con identificadores OT únicos dentro de cada grupo. Horas-hombre, downtime y costo directo se suman sobre filas conservadas, siguiendo el análisis individual.",
        "Correctivo: la participación se calcula como porcentaje del total del grupo para OT únicas, horas-hombre, downtime y costo directo.",
        "Pareto: agrupa todas las OT correctivas con modo de falla informado; cuenta OT únicas por modo y suma downtime y costo. Los gráficos muestran las diez categorías de mayor magnitud.",
        "Jack-Knife: se calcula por entidad con correctivas válidas; el límite de frecuencia es fallas totales divididas por entidades y el límite de MTTR es downtime total dividido por fallas. R* es el producto de frecuencia normalizada por MTTR normalizado.",
        `Calidad: ${analyses.map((analysis) => `${analysis.group}: ${formatNumber(analysis.sourceRows, 0)} filas de origen, ${formatNumber(analysis.duplicateCount, 0)} duplicados exactos eliminados y ${formatNumber(analysis.recordCount, 0)} filas analizadas`).join("; ")}.`,
        "Interpretación: los indicadores describen los datos cargados; una asociación o clasificación no demuestra por sí sola causa raíz.",
      ].join("\n\n");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(69, 86, 101);
      doc.text(doc.splitTextToSize(methodText, pageWidth - margin * 2), margin, 38);

      pageFooter();
      const filename = `Informe_CMMS_${analyses.map((analysis) => analysis.group).join("_")}_${dateStamp()}.pdf`;
      doc.save(filename);
      showToast("Informe ejecutivo PDF generado correctamente.", "success");
    } catch (error) {
      console.error("No se pudo generar el informe PDF.", error);
      showToast(`No se pudo generar el PDF: ${error.message}`, "error", 8000);
    } finally {
      state.paretoMetric = originalParetoMetric;
      state.jackknifeEntity = originalJackknifeEntity;
      setSegmentActive("[data-pareto]", document.querySelector(`[data-pareto="${originalParetoMetric}"]`));
      setSegmentActive("[data-jk]", document.querySelector(`[data-jk="${originalJackknifeEntity}"]`));
      renderParetoChart();
      renderJackknife();
      hideLoading();
    }
  }

  function waitForChart() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function maxBy(items, getter) {
    if (!items.length) return null;
    return items.reduce((best, item) => (getter(item) > getter(best) ? item : best));
  }

  function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("es-CL", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(value));
  }

  function formatCompact(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("es-CL", {
      notation: Math.abs(Number(value)) >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    }).format(Number(value));
  }

  function formatMetric(index, value) {
    if (index === 0) return `${formatNumber(value, 0)} OT`;
    if (index === 1) return `${formatNumber(value, 1)} HH`;
    if (index === 2) return `${formatNumber(value, 1)} h`;
    return `${formatNumber(value, 0)} CLP`;
  }

  function formatDate(date, includeYear) {
    return new Intl.DateTimeFormat("es-CL", {
      month: "short",
      day: "2-digit",
      ...(includeYear ? { year: "numeric" } : {}),
    }).format(date);
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function shorten(value, maxLength) {
    const text = String(value);
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function riskClass(quadrant) {
    if (quadrant === "Grave") return "grave";
    if (quadrant === "Bajo control") return "control";
    return "";
  }

  function downloadBlob(fileName, content, mimeType) {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function showToast(message, type = "", duration = 4200) {
    if (!elements["toast-region"]) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements["toast-region"].append(toast);
    window.setTimeout(() => toast.remove(), duration);
  }

  function showLoading(message) {
    let overlay = document.querySelector(".loading-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "loading-overlay";
      overlay.innerHTML = '<div class="loading-card"><span class="spinner"></span><span class="loading-message"></span></div>';
      document.body.append(overlay);
    }
    overlay.querySelector(".loading-message").textContent = message;
  }

  function hideLoading() {
    document.querySelector(".loading-overlay")?.remove();
  }
})();
