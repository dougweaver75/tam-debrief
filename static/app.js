// ── Utilities ──────────────────────────────────────────────────────────────

const API = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(url, data) {
    const r = await fetch(url, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal() {
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  document.getElementById('modalBackdrop').classList.remove('open');
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function fmtMoney(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(v);
}

function badgeHtml(cls, text) {
  return `<span class="badge badge-${cls}">${text}</span>`;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const STAGE_LABELS = { lead:'Lead', qualified:'Qualified', proposal:'Proposal', 'closed-won':'Closed Won', 'closed-lost':'Closed Lost' };
const TYPE_LABELS  = { call:'Call', email:'Email', meeting:'Meeting', note:'Note' };

// ── Contacts List ──────────────────────────────────────────────────────────

let _sortCol = 'last_name', _sortDir = 'asc', _searchTimer = null;

function initContacts() {
  loadContacts();
}

async function loadContacts(search = '') {
  const params = new URLSearchParams({ sort: _sortCol, dir: _sortDir });
  if (search) params.set('search', search);
  try {
    const contacts = await API.get('/api/contacts?' + params);
    renderContacts(contacts);
    updateSortArrows();
  } catch (e) {
    document.getElementById('contactsBody').innerHTML =
      `<tr><td colspan="6" class="empty-state">Error loading contacts.</td></tr>`;
  }
}

function renderContacts(contacts) {
  const tbody = document.getElementById('contactsBody');
  if (!contacts.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No contacts yet. Add one to get started.</td></tr>`;
    return;
  }
  tbody.innerHTML = contacts.map(c => `
    <tr>
      <td><a href="/contacts/${c.id}" class="table-link">${esc(c.last_name)}, ${esc(c.first_name)}</a></td>
      <td>${esc(c.company) || '—'}</td>
      <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
      <td>${esc(c.phone) || '—'}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td class="table-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditContact(${c.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function sortBy(col) {
  if (_sortCol === col) {
    _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _sortCol = col;
    _sortDir = 'asc';
  }
  loadContacts(document.getElementById('searchInput')?.value || '');
}

function updateSortArrows() {
  ['last_name','company','email','created_at'].forEach(col => {
    const el = document.getElementById('sort_' + col);
    if (!el) return;
    el.textContent = _sortCol === col ? (_sortDir === 'asc' ? '↑' : '↓') : '';
  });
}

function debounceSearch(val) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => loadContacts(val), 300);
}

// Add contact modal
function openAddContact() {
  document.getElementById('contactModalTitle').textContent = 'Add Contact';
  document.getElementById('contactId').value = '';
  document.getElementById('contactForm').reset();
  openModal('contactModal');
}

// Edit contact modal
async function openEditContact(id) {
  try {
    const c = await API.get(`/api/contacts/${id}`);
    document.getElementById('contactModalTitle').textContent = 'Edit Contact';
    document.getElementById('contactId').value  = c.id;
    document.getElementById('cfFirstName').value = c.first_name || '';
    document.getElementById('cfLastName').value  = c.last_name  || '';
    document.getElementById('cfCompany').value   = c.company    || '';
    document.getElementById('cfTitle').value     = c.title      || '';
    document.getElementById('cfEmail').value     = c.email      || '';
    document.getElementById('cfPhone').value     = c.phone      || '';
    document.getElementById('cfNotes').value     = c.notes      || '';
    openModal('contactModal');
  } catch (e) { showToast('Failed to load contact.'); }
}

async function submitContact(e) {
  e.preventDefault();
  const id   = document.getElementById('contactId').value;
  const data = {
    first_name: document.getElementById('cfFirstName').value.trim(),
    last_name:  document.getElementById('cfLastName').value.trim(),
    company:    document.getElementById('cfCompany').value.trim(),
    title:      document.getElementById('cfTitle').value.trim(),
    email:      document.getElementById('cfEmail').value.trim(),
    phone:      document.getElementById('cfPhone').value.trim(),
    notes:      document.getElementById('cfNotes').value.trim(),
  };
  try {
    if (id) {
      await API.put(`/api/contacts/${id}`, data);
      showToast('Contact updated.');
    } else {
      await API.post('/api/contacts', data);
      showToast('Contact added.');
    }
    closeModal();
    loadContacts(document.getElementById('searchInput')?.value || '');
  } catch (e) { showToast('Save failed.'); }
}

async function deleteContact(id) {
  if (!confirm('Delete this contact? This will also remove their interactions and deals.')) return;
  try {
    await API.del(`/api/contacts/${id}`);
    showToast('Contact deleted.');
    loadContacts(document.getElementById('searchInput')?.value || '');
  } catch (e) { showToast('Delete failed.'); }
}

// ── Contact Detail ─────────────────────────────────────────────────────────

let _currentContact = null;

function initContactDetail(contactId) {
  loadContactDetail(contactId);
}

async function loadContactDetail(contactId) {
  try {
    const [contact, interactions, deals] = await Promise.all([
      API.get(`/api/contacts/${contactId}`),
      API.get(`/api/contacts/${contactId}/interactions`),
      API.get(`/api/contacts/${contactId}/deals`)
    ]);
    _currentContact = contact;
    renderContactDetail(contact);
    renderInteractions(interactions);
    renderDeals(deals);
  } catch (e) {
    document.getElementById('contactDetailRoot').innerHTML =
      '<p class="empty-state">Contact not found.</p>';
  }
}

function renderContactDetail(c) {
  const fn = c.first_name || '';
  const ln = c.last_name  || '';
  const initials = ((fn[0] || '') + (ln[0] || '')).toUpperCase();
  document.getElementById('contactDetailRoot').innerHTML = `
    <a href="/contacts" class="back-link">← All Contacts</a>
    <div class="card">
      <div class="contact-header">
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div class="contact-avatar">${esc(initials)}</div>
          <div>
            <div class="contact-name">${esc(fn)} ${esc(ln)}</div>
            <div class="contact-meta">${esc([c.title, c.company].filter(Boolean).join(' · '))}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditContactDetail()">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteContactDetail(${c.id})">Delete</button>
        </div>
      </div>
      <div class="contact-fields">
        <div class="field-row"><span class="field-label">Email</span>
          <span class="field-value">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</span></div>
        <div class="field-row"><span class="field-label">Phone</span>
          <span class="field-value">${esc(c.phone) || '—'}</span></div>
        <div class="field-row"><span class="field-label">Added</span>
          <span class="field-value">${fmtDate(c.created_at)}</span></div>
        <div class="field-row"><span class="field-label">Updated</span>
          <span class="field-value">${fmtDate(c.updated_at)}</span></div>
        ${c.notes ? `<div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Notes</span>
          <span class="field-value" style="white-space:pre-wrap">${esc(c.notes)}</span></div>` : ''}
      </div>
    </div>
  `;
}

function openEditContactDetail() {
  const c = _currentContact;
  document.getElementById('contactModalTitle').textContent = 'Edit Contact';
  document.getElementById('contactId').value   = c.id;
  document.getElementById('cfFirstName').value = c.first_name || '';
  document.getElementById('cfLastName').value  = c.last_name  || '';
  document.getElementById('cfCompany').value   = c.company    || '';
  document.getElementById('cfTitle').value     = c.title      || '';
  document.getElementById('cfEmail').value     = c.email      || '';
  document.getElementById('cfPhone').value     = c.phone      || '';
  document.getElementById('cfNotes').value     = c.notes      || '';
  openModal('contactModal');
}

async function submitContactDetail(e) {
  e.preventDefault();
  const id   = document.getElementById('contactId').value;
  const data = {
    first_name: document.getElementById('cfFirstName').value.trim(),
    last_name:  document.getElementById('cfLastName').value.trim(),
    company:    document.getElementById('cfCompany').value.trim(),
    title:      document.getElementById('cfTitle').value.trim(),
    email:      document.getElementById('cfEmail').value.trim(),
    phone:      document.getElementById('cfPhone').value.trim(),
    notes:      document.getElementById('cfNotes').value.trim(),
  };
  try {
    const updated = await API.put(`/api/contacts/${id}`, data);
    _currentContact = updated;
    renderContactDetail(updated);
    closeModal();
    showToast('Contact updated.');
  } catch (e) { showToast('Save failed.'); }
}

async function deleteContactDetail(id) {
  if (!confirm('Delete this contact and all their interactions and deals?')) return;
  try {
    await API.del(`/api/contacts/${id}`);
    window.location.href = '/contacts';
  } catch (e) { showToast('Delete failed.'); }
}

// ── Interactions ───────────────────────────────────────────────────────────

function renderInteractions(interactions) {
  const el = document.getElementById('interactionsList');
  if (!el) return;
  if (!interactions.length) {
    el.innerHTML = '<p class="empty-state">No interactions logged yet.</p>';
    return;
  }
  el.innerHTML = interactions.map(i => `
    <div class="interaction-item">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          ${badgeHtml(i.type, TYPE_LABELS[i.type] || i.type)}
          <span class="interaction-date">${fmtDate(i.interaction_date)}</span>
        </div>
        <div class="interaction-summary">${esc(i.summary)}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteInteraction(${i.id})">✕</button>
    </div>
  `).join('');
}

function openLogInteraction() {
  document.getElementById('interactionForm').reset();
  document.getElementById('iDate').value = new Date().toISOString().slice(0,10);
  openModal('interactionModal');
}

async function submitInteraction(e) {
  e.preventDefault();
  const data = {
    contact_id:       _currentContact.id,
    type:             document.getElementById('iType').value,
    summary:          document.getElementById('iSummary').value.trim(),
    interaction_date: document.getElementById('iDate').value,
  };
  try {
    await API.post('/api/interactions', data);
    closeModal();
    showToast('Interaction logged.');
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    renderInteractions(interactions);
  } catch (e) { showToast('Failed to log interaction.'); }
}

async function deleteInteraction(id) {
  if (!confirm('Delete this interaction?')) return;
  try {
    await API.del(`/api/interactions/${id}`);
    showToast('Interaction deleted.');
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    renderInteractions(interactions);
  } catch (e) { showToast('Delete failed.'); }
}

// ── Deals ──────────────────────────────────────────────────────────────────

function renderDeals(deals) {
  const el = document.getElementById('dealsList');
  if (!el) return;
  if (!deals.length) {
    el.innerHTML = '<p class="empty-state">No deals yet.</p>';
    return;
  }
  el.innerHTML = deals.map(d => `
    <div class="deal-item">
      <div style="flex:1">
        <div class="deal-title">${esc(d.title)}</div>
        <div class="deal-meta">
          ${badgeHtml(d.stage, STAGE_LABELS[d.stage] || d.stage)}
          ${d.notes ? `<span style="margin-left:6px;color:var(--text-muted)">${esc(d.notes.slice(0,60))}${d.notes.length>60?'…':''}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="deal-value">${fmtMoney(d.value)}</span>
        <button class="btn btn-secondary btn-sm" onclick="openEditDeal(${d.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDeal(${d.id})">✕</button>
      </div>
    </div>
  `).join('');
}

function openAddDeal() {
  document.getElementById('dealModalTitle').textContent = 'Add Deal';
  document.getElementById('dealId').value = '';
  document.getElementById('dealForm').reset();
  openModal('dealModal');
}

async function openEditDeal(did) {
  try {
    const deals = await API.get(`/api/contacts/${_currentContact.id}/deals`);
    const d = deals.find(x => x.id === did);
    if (!d) return;
    document.getElementById('dealModalTitle').textContent = 'Edit Deal';
    document.getElementById('dealId').value     = d.id;
    document.getElementById('dTitle').value     = d.title   || '';
    document.getElementById('dValue').value     = d.value   || 0;
    document.getElementById('dStage').value     = d.stage   || 'lead';
    document.getElementById('dNotes').value     = d.notes   || '';
    openModal('dealModal');
  } catch (e) { showToast('Failed to load deal.'); }
}

async function submitDeal(e) {
  e.preventDefault();
  const id   = document.getElementById('dealId').value;
  const data = {
    contact_id: _currentContact.id,
    title:  document.getElementById('dTitle').value.trim(),
    value:  parseFloat(document.getElementById('dValue').value) || 0,
    stage:  document.getElementById('dStage').value,
    notes:  document.getElementById('dNotes').value.trim(),
  };
  try {
    if (id) {
      await API.put(`/api/deals/${id}`, data);
      showToast('Deal updated.');
    } else {
      await API.post('/api/deals', data);
      showToast('Deal added.');
    }
    closeModal();
    const deals = await API.get(`/api/contacts/${_currentContact.id}/deals`);
    renderDeals(deals);
  } catch (e) { showToast('Save failed.'); }
}

async function deleteDeal(did) {
  if (!confirm('Delete this deal?')) return;
  try {
    await API.del(`/api/deals/${did}`);
    showToast('Deal deleted.');
    const deals = await API.get(`/api/contacts/${_currentContact.id}/deals`);
    renderDeals(deals);
  } catch (e) { showToast('Delete failed.'); }
}

// ── Dashboard ──────────────────────────────────────────────────────────────

function initDashboard() {
  loadDashboard();
}

async function loadDashboard() {
  try {
    const data = await API.get('/api/dashboard');
    renderDashboard(data);
  } catch (e) {
    document.getElementById('dashRoot').innerHTML = '<p class="empty-state">Error loading dashboard.</p>';
  }
}

function renderDashboard(data) {
  document.getElementById('statContacts').textContent = data.total_contacts;
  document.getElementById('statDealsCount').textContent = data.open_deals_count;
  document.getElementById('statDealsValue').textContent = fmtMoney(data.open_deals_value);

  const el = document.getElementById('recentList');
  if (!data.recent_interactions.length) {
    el.innerHTML = '<p class="empty-state">No interactions yet.</p>';
    return;
  }
  el.innerHTML = data.recent_interactions.map(i => `
    <div class="interaction-item">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          ${badgeHtml(i.type, TYPE_LABELS[i.type] || i.type)}
          <a href="/contacts/${i.contact_id}" class="table-link">${esc(i.first_name)} ${esc(i.last_name)}</a>
          <span class="interaction-date">${fmtDate(i.interaction_date)}</span>
        </div>
        <div class="interaction-summary">${esc(i.summary)}</div>
      </div>
    </div>
  `).join('');
}
