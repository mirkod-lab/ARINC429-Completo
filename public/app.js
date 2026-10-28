const $ = (selector) => document.querySelector(selector);
const form = $('#send-form');
const messageBox = $('#message');
const instrumentSelect = $('#instrument');
const historyBody = $('#history-body');
let instruments = [];
let editingId = null;
let previewRequest = 0;

function showMessage(text, type = 'success') {
  messageBox.textContent = text;
  messageBox.className = `message message-${type}`;
  messageBox.hidden = false;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}

function selectedInstrument() {
  return instruments.find((item) => Number(item.id_instrumento) === Number(instrumentSelect.value));
}

function renderVoltageLevels(container, levels) {
  container.replaceChildren();
  for (const level of levels || []) {
    const cell = document.createElement('div');
    cell.className = `voltage-cell ${level.bit ? 'voltage-cell-high' : ''}`;
    const bit = document.createElement('small');
    bit.textContent = `B${level.bitPosition}`;
    const voltage = document.createElement('strong');
    voltage.textContent = `${level.voltage > 0 ? '+' : ''}${level.voltage} V`;
    cell.append(bit, voltage);
    container.append(cell);
  }
}

function updatePreview() {
  const requestId = ++previewRequest;
  const instrument = selectedInstrument();
  const value = Number($('#value').value);
  $('#unit').value = instrument?.unidad || '';
  $('#value').min = instrument?.valor_minimo ?? '';
  $('#value').max = instrument?.valor_maximo ?? '';
  $('#value').step = instrument?.resolucion ?? 'any';
  $('#range-help').textContent = instrument
    ? `Rango ${instrument.valor_minimo}–${instrument.valor_maximo} ${instrument.unidad} · resolución ${instrument.resolucion} · perfil de práctica`
    : '';
  if (!instrument || !Number.isFinite(value) || $('#value').value === '') {
    $('#preview-word').textContent = '—';
    $('#preview-hex').textContent = 'Ingresa un valor válido';
    $('#preview-voltages').replaceChildren();
    return;
  }
  $('#preview-word').textContent = 'Calculando palabra...';
  $('#preview-hex').textContent = '';
  api('/api/envios/preview', {
    method: 'POST',
    body: JSON.stringify({ id_instrumento: instrument.id_instrumento, valor: value })
  }).then((result) => {
    if (requestId !== previewRequest) return;
    $('#preview-word').textContent = result.binary;
    $('#preview-hex').textContent = result.hexadecimal;
    renderVoltageLevels($('#preview-voltages'), result.simulatedVoltages);
  }).catch((error) => {
    if (requestId !== previewRequest) return;
    $('#preview-word').textContent = 'No se pudo codificar';
    $('#preview-hex').textContent = error.message;
    $('#preview-voltages').replaceChildren();
  });
}

async function loadInstruments() {
  instruments = await api('/api/instrumentos');
  const options = instruments.map((item) => {
    const option = document.createElement('option');
    option.value = item.id_instrumento;
    option.textContent = item.nombre;
    return option;
  });
  instrumentSelect.replaceChildren(...options);
  const filterOptions = instruments.map((item) => {
    const option = document.createElement('option');
    option.value = item.id_instrumento;
    option.textContent = item.nombre;
    return option;
  });
  $('#filter-instrument').append(...filterOptions);
  updatePreview();
}

function makeCell(content, className = '') {
  const cell = document.createElement('td');
  if (content instanceof Node) cell.append(content);
  else cell.textContent = content;
  if (className) cell.className = className;
  return cell;
}

function makeButton(label, action, id, disabled = false, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `row-action ${extraClass}`;
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  button.disabled = disabled;
  return button;
}

function renderHistory(rows) {
  historyBody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = makeCell('No hay envíos para los filtros seleccionados.', 'empty');
    cell.colSpan = 5;
    row.append(cell);
    historyBody.append(row);
    return;
  }
  for (const item of rows) {
    const row = document.createElement('tr');
    const date = new Date(item.fecha_hora).toLocaleString();
    const idMeta = document.createElement('div');
    idMeta.className = 'id-meta';
    idMeta.textContent = `#${item.id_envio} · ${date}`;
    const idCell = document.createElement('div');
    idCell.textContent = `ENVÍO ${item.id_envio}`;
    idCell.append(idMeta);
    row.append(makeCell(idCell));

    const inst = document.createElement('div');
    inst.className = 'value-main';
    inst.textContent = item.instrumento;
    const val = document.createElement('div');
    val.className = 'id-meta';
    val.textContent = `${item.valor} ${item.unidad}`;
    inst.append(val);
    row.append(makeCell(inst));

    const word = document.createElement('div');
    word.className = 'word-main';
    word.textContent = item.palabra_binaria;
    const hex = document.createElement('div');
    hex.className = 'hex';
    hex.textContent = `0x${item.palabra_hexadecimal}`;
    word.append(hex);
    row.append(makeCell(word));
    const badge = document.createElement('span');
    badge.className = `status status-${item.estado}`;
    badge.textContent = item.estado;
    row.append(makeCell(badge));

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(
      makeButton('Ver', 'view', item.id_envio),
      makeButton('Editar', 'edit', item.id_envio, item.estado === 'enviado'),
      makeButton('Ejecutar', 'run', item.id_envio, item.estado === 'enviado'),
      makeButton('Eliminar', 'delete', item.id_envio, false, 'delete')
    );
    row.append(makeCell(actions));
    historyBody.append(row);
  }
}

async function loadHistory() {
  const params = new URLSearchParams();
  if ($('#filter-instrument').value) params.set('id_instrumento', $('#filter-instrument').value);
  if ($('#filter-from').value) params.set('desde', $('#filter-from').value);
  if ($('#filter-to').value) params.set('hasta', $('#filter-to').value);
  if ($('#filter-status').value) params.set('estado', $('#filter-status').value);
  try {
    renderHistory(await api(`/api/envios?${params}`));
  } catch (error) {
    renderHistory([]);
    showMessage(error.message, 'error');
  }
}

function resetForm() {
  editingId = null;
  form.reset();
  $('#form-title').textContent = 'Crear envío';
  $('#save-button').textContent = 'Crear envío';
  $('#cancel-edit').hidden = true;
  updatePreview();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  const isEditing = editingId !== null;
  try {
    const result = await api(isEditing ? `/api/envios/${editingId}` : '/api/envios', {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    showMessage(isEditing
      ? `Envío actualizado: ${result.binary} · ${result.hexadecimal}`
      : `Envío #${result.id_envio} guardado: ${result.binary} · ${result.hexadecimal}. No se transmitió.`);
    resetForm();
    await loadHistory();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

$('#cancel-edit').addEventListener('click', resetForm);
instrumentSelect.addEventListener('change', updatePreview);
$('#value').addEventListener('input', updatePreview);
$('#reload').addEventListener('click', loadHistory);
for (const selector of ['#filter-instrument', '#filter-from', '#filter-to', '#filter-status']) {
  $(selector).addEventListener('change', loadHistory);
}

historyBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  try {
    if (button.dataset.action === 'view') {
      const item = await api(`/api/envios/${id}`);
      const content = $('#detail-content');
      content.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = `Detalle del envío #${item.id_envio}`;
      content.append(heading);
      const grid = document.createElement('div');
      grid.className = 'detail-grid';
      const values = [
        ['Instrumento', item.instrumento], ['Valor', `${item.valor} ${item.unidad}`],
        ['Fecha', new Date(item.fecha_hora).toLocaleString()], ['Estado', item.estado],
        ['Palabra binaria', item.palabra_binaria], ['Hexadecimal', `0x${item.palabra_hexadecimal}`],
        ['Formato / etiqueta', `${item.formato_datos} / ${item.etiqueta_arinc}`],
        ['Detalle', item.detalle_error || 'Sin detalle adicional']
      ];
      for (const [label, value] of values) {
        const box = document.createElement('div');
        box.className = 'detail-item';
        const name = document.createElement('span');
        name.textContent = label;
        const text = document.createElement('strong');
        text.textContent = value;
        box.append(name, text);
        grid.append(box);
      }
      content.append(grid);
      const voltageTitle = document.createElement('p');
      voltageTitle.className = 'eyebrow';
      voltageTitle.textContent = 'TENSIÓN SIMULADA POR BIT · 1 = +12 V / 0 = −12 V';
      voltageTitle.style.margin = '18px 0 8px';
      const voltageNote = document.createElement('p');
      voltageNote.className = 'simulation-note';
      voltageNote.textContent = 'Modelo didáctico; no representa una salida física ni la forma de onda ARINC 429.';
      const voltages = document.createElement('div');
      voltages.className = 'voltage-grid';
      renderVoltageLevels(voltages, item.simulatedVoltages);
      content.append(voltageTitle, voltageNote, voltages);
      $('#detail-dialog').showModal();
    } else if (button.dataset.action === 'edit') {
      const item = await api(`/api/envios/${id}`);
      editingId = Number(id);
      instrumentSelect.value = item.id_instrumento;
      $('#value').value = item.valor;
      $('#form-title').textContent = `Editar envío #${id}`;
      $('#save-button').textContent = 'Guardar cambios';
      $('#cancel-edit').hidden = false;
      updatePreview();
      $('#value').focus();
    } else if (button.dataset.action === 'run') {
      const simulationMode = $('#mode-label').textContent === 'Modo simulación';
      const confirmation = simulationMode
        ? '¿Ejecutar la simulación? Solo se mostrarán los niveles didácticos 1 → +12 V y 0 → −12 V; no se transmite ni se genera tensión física.'
        : '¿Enviar este envío por serial? El ACK confirma recepción del Arduino, no la salida física ARINC.';
      if (!window.confirm(confirmation)) return;
      const result = await api(`/api/envios/${id}/ejecutar`, {
        method: 'POST',
        body: JSON.stringify({ port: $('#serial-port').value })
      });
      showMessage(result.message);
      if (result.simulatedVoltages) {
        const content = $('#detail-content');
        content.replaceChildren();
        const heading = document.createElement('h2');
        heading.textContent = `Simulación del envío #${id}`;
        const binary = document.createElement('code');
        binary.className = 'word-main';
        binary.textContent = result.palabra_binaria;
        const hex = document.createElement('p');
        hex.className = 'hex';
        hex.textContent = `0x${result.palabra_hexadecimal}`;
        const note = document.createElement('p');
        note.className = 'simulation-note';
        note.textContent = 'Mapeo didáctico: 1 → +12 V y 0 → −12 V. No hubo transmisión física; esto no modela la forma de onda ARINC 429.';
        const voltages = document.createElement('div');
        voltages.className = 'voltage-grid';
        renderVoltageLevels(voltages, result.simulatedVoltages);
        content.append(heading, binary, hex, note, voltages);
        $('#detail-dialog').showModal();
      }
      await loadHistory();
    } else if (button.dataset.action === 'delete') {
      if (!window.confirm(`¿Eliminar el envío #${id}?`)) return;
      await api(`/api/envios/${id}`, { method: 'DELETE' });
      showMessage(`Envío #${id} eliminado.`);
      await loadHistory();
    }
  } catch (error) {
    showMessage(error.message, 'error');
    await loadHistory();
  }
});

async function loadPorts() {
  const result = await api('/api/serial/puertos');
  const select = $('#serial-port');
  select.replaceChildren();
  if (result.mode === 'simulation') {
    const option = document.createElement('option');
    option.textContent = 'No requerido (simulación)';
    option.value = '';
    select.append(option);
    return;
  }
  for (const port of result.ports) {
    const option = document.createElement('option');
    option.value = port.path;
    option.textContent = `${port.path}${port.friendlyName ? ` · ${port.friendlyName}` : ''}`;
    select.append(option);
  }
  if (!result.ports.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No se detectan puertos COM';
    select.append(option);
  }
}

$('#refresh-ports').addEventListener('click', () => loadPorts().catch((error) => showMessage(error.message, 'error')));

Promise.all([loadInstruments(), loadPorts(), api('/api/estado')])
  .then(async ([, , status]) => {
    $('#mode-label').textContent = status.serialMode === 'simulation' ? 'Modo simulación' : 'Modo hardware serial';
    await loadHistory();
  })
  .catch((error) => showMessage(error.message, 'error'));
