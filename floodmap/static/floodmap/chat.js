/* AI analyst chat panel (Groq free tier / Claude / offline, chosen server-side). */
(function () {
  const $ = (s) => document.querySelector(s);
  const history = [];
  const LABELS = {
    groq: 'Groq · Llama 3.3 70B (free tier) · grounded on UNOSAT/NDMA data',
    claude: 'Anthropic Claude · grounded on UNOSAT/NDMA data',
    offline: 'Offline mode · answers from the database',
  };
  const CHIPS = ['Which districts had the most people exposed?', 'How many people died, and where?',
    'How fast did the water recede?', 'What did the floods cost?', 'Give me a risk brief for Dadu'];

  $('#chat-provider').textContent = LABELS[APP.aiProvider] || APP.aiProvider;
  $('#chat-chips').innerHTML = CHIPS.map((c) => `<button type="button" class="chip">${c}</button>`).join('');
  $('#chat-chips').addEventListener('click', (e) => { if (e.target.classList.contains('chip')) ask(e.target.textContent); });
  $('#btn-ai').addEventListener('click', open);
  $('#chat-close').addEventListener('click', () => { $('#chat').hidden = true; });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#chat-input').value.trim();
    if (q) { $('#chat-input').value = ''; ask(q); }
  });
  add('assistant', 'Hi! I analyse the 2022 floods using UNOSAT satellite exposure data and NDMA/PDNA figures. Ask me about any district, province, casualties, costs or recovery.');

  function open() { $('#chat').hidden = false; $('#chat-input').focus(); }

  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function md(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^\s*[-*] (.+)$/gm, '• $1').replace(/\n/g, '<br>');
  }
  function add(role, text, cls = '') {
    const el = document.createElement('div');
    el.className = `msg ${role} ${cls}`;
    el.innerHTML = md(text);
    $('#chat-log').appendChild(el);
    $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
    return el;
  }

  async function ask(question, focus = '') {
    open();
    add('user', question);
    const pending = add('assistant', 'Analysing…', 'pending');
    try {
      const res = await fetch(APP.api.ask, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content },
        body: JSON.stringify({ question, focus, history }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      pending.remove();
      add('assistant', json.answer);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: json.answer });
      flyToMention(`${question} ${focus}`);
    } catch (err) {
      pending.remove();
      add('assistant', `Sorry, something went wrong: ${err.message}`, 'error');
    }
  }

  function flyToMention(text) {
    const feats = window.FloodStory?.state.data.districts?.features;
    if (!feats || !window.FloodExplore) return;
    const t = text.toLowerCase();
    const f = feats.find((x) => new RegExp(`\\b${x.properties.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
    if (!f) return;
    if (!FloodExplore.isExploring()) FloodExplore.enter();
    setTimeout(() => FloodExplore.showDistrict(f.properties.pcode, true), 600);
  }

  window.FloodChat = { open, ask };
})();
